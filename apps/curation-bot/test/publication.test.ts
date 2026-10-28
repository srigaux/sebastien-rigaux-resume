import { env } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { reconcilePublications, schedulePublicationCheck } from "@/publication";
import { Store } from "@/store";
import { cats, extraction, fixture, repository } from "@test/fixtures";
import { verifyPublication } from "@/prismic";
import { advance } from "@/flow";
import type { Steps } from "@/retry";

async function pending(status: "accepted" | "unknown" = "accepted") {
  const store = new Store(env.DB),
    item = fixture("u990");
  item.state.publishedIds = ["fr-id", "en-id"];
  item.state.publicationStarted = true;
  item.state.publicationRequested = status === "accepted";
  await store.enqueue(item.id, 990, "1", item.state, item.created_at);
  await store.claim("1");
  await store.lock(env.PRISMIC_REPOSITORY, item.id);
  await schedulePublicationCheck(env, item, status);
  await store.finish(item, "publication_pending", env.PRISMIC_REPOSITORY);
  return { store, item };
}
function remote(mode: "ready" | "missing" | "partial" | "unauthorized") {
  let searches = 0,
    writes = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("api.telegram.org"))
        return Response.json({
          ok: true,
          result: {
            message_id: 101,
            date: 1,
            chat: { id: 1, type: "private" },
          },
        });
      if (init?.method === "POST" || init?.method === "PUT") {
        writes++;
        throw new Error("No Prismic write allowed in cron");
      }
      if (mode === "unauthorized") return new Response("{}", { status: 401 });
      if (!url.includes("/documents/search")) return Response.json(repository);
      searches++;
      expect(new URL(url).searchParams.get("lang")).toBe("*");
      // Fields differ deliberately: cron checks availability, not editorial equality.
      const results =
        mode === "missing"
          ? []
          : [
              { id: "fr-id", lang: "fr-be", data: { title: "changed" } },
              ...(mode === "partial"
                ? []
                : [{ id: "en-id", lang: "en-us", data: {} }]),
            ];
      return Response.json({
        page: 1,
        results_per_page: 2,
        results_size: results.length,
        total_results_size: results.length,
        total_pages: 1,
        next_page: null,
        prev_page: null,
        results,
      });
    }),
  );
  return { searches: () => searches, writes: () => writes };
}
it.each(["accepted", "unknown"] as const)(
  "confirme %s sans réécriture ni comparaison des champs",
  async (status) => {
    const { store, item } = await pending(status),
      api = remote("ready");
    await reconcilePublications(env);
    expect((await store.get(item.id)).status).toBe("done");
    expect(
      (await env.DB.prepare("SELECT * FROM publication_lock").all()).results,
    ).toHaveLength(0);
    expect(api.searches()).toBe(1);
    expect(api.writes()).toBe(0);
    const job = await env.DB.prepare(
      "SELECT * FROM publication_checks",
    ).first();
    expect(job).toMatchObject({ status: "confirmed", notified: 1 });
    await reconcilePublications(env);
    expect(api.searches()).toBe(1);
  },
);
it.each(["missing", "partial"] as const)(
  "attend la disponibilité %s sans transformer le délai en erreur",
  async (mode) => {
    const { store, item } = await pending(),
      api = remote(mode);
    await reconcilePublications(env);
    expect((await store.get(item.id)).status).toBe("publication_pending");
    expect(
      (await env.DB.prepare("SELECT * FROM publication_lock").all()).results,
    ).toHaveLength(1);
    expect(
      await env.DB.prepare(
        "SELECT status,attempts,last_error FROM publication_checks",
      ).first(),
    ).toEqual({
      status: "accepted",
      attempts: 1,
      last_error: "documents_not_available",
    });
    await reconcilePublications(env); // Not due again until the next minute.
    expect(api.searches()).toBe(1);
  },
);
it("distingue une API inaccessible d’un document absent et garde le verrou", async () => {
  const { store, item } = await pending();
  remote("unauthorized");
  await expect(verifyPublication(env, item)).rejects.toThrow();
  await reconcilePublications(env);
  const job = await env.DB.prepare(
    "SELECT last_error FROM publication_checks",
  ).first<{ last_error: string }>();
  expect(job?.last_error).not.toBe("documents_not_available");
  expect((await store.get(item.id)).status).toBe("publication_pending");
  expect(
    (await env.DB.prepare("SELECT * FROM publication_lock").all()).results,
  ).toHaveLength(1);
});
it("déduplique deux passages cron concurrents", async () => {
  await pending();
  const api = remote("ready");
  await Promise.all([reconcilePublications(env), reconcilePublications(env)]);
  expect(api.searches()).toBe(1);
  expect(api.writes()).toBe(0);
});
it("réveille seulement une fiche déjà approuvée, après libération du verrou", async () => {
  const { store } = await pending();
  const next = fixture("u991");
  next.state.approvedRevision = 1;
  await store.enqueue(next.id, 991, "1", next.state, next.created_at);
  await store.claim("1");
  await store.save(next, "waiting_publish_slot");
  remote("missing");
  await reconcilePublications(env);
  expect(await store.nextAction(next.id)).toBeUndefined();
  await env.DB.prepare("UPDATE publication_checks SET next_check_at=0").run();
  remote("ready");
  await reconcilePublications(env);
  expect((await store.nextAction(next.id))?.action).toEqual({
    kind: "resume",
    revision: 1,
  });
  await reconcilePublications(env);
  expect(
    (
      await env.DB.prepare("SELECT * FROM actions WHERE item_id=?")
        .bind(next.id)
        .all()
    ).results,
  ).toHaveLength(1);
});
it("le cron n’approuve jamais une proposition en attente humaine", async () => {
  const { store } = await pending();
  const next = fixture("u992");
  await store.enqueue(next.id, 992, "1", next.state, next.created_at);
  await store.claim("1");
  await store.save(next, "review");
  remote("ready");
  await reconcilePublications(env);
  expect(await store.nextAction(next.id)).toBeUndefined();
  expect((await store.get(next.id)).state.approvedRevision).toBeUndefined();
});
const steps = {
  do: async (_name: string, _config: unknown, fn: () => Promise<unknown>) =>
    fn(),
  sleep: vi.fn(async () => {}),
} as unknown as Steps;
async function approved(id: string) {
  const store = new Store(env.DB),
    item = fixture(id);
  item.state.approvedRevision = 1;
  item.state.extractionKey = `extractions/${id}`;
  item.state.checked = [item.state.url];
  await env.BUCKET.put(item.state.extractionKey, JSON.stringify(extraction));
  await store.enqueue(
    id,
    Number(id.slice(1)),
    "1",
    item.state,
    item.created_at,
  );
  await store.claim("1");
  return { item, store };
}
it("une réponse de publication perdue reste inconnue sans renvoi aveugle", async () => {
  const { item, store } = await approved("u993");
  item.state.publishedIds = ["fr-id", "en-id"];
  let posts = 0;
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      if (String(input).includes("api.telegram.org"))
        return Response.json({
          ok: true,
          result: {
            message_id: 102,
            date: 1,
            chat: { id: 1, type: "private" },
          },
        });
      posts++;
      throw new Error("Response lost");
    }),
  );
  await advance(env, steps, "lost", item, cats);
  expect(item.status).toBe("publication_pending");
  expect(item.state.publicationUnknown).toBe(true);
  expect(warning.mock.calls.map(([entry]) => entry)).toContainEqual(
    expect.objectContaining({
      event: "publication.request.unknown",
      itemId: item.id,
    }),
  );
  expect(posts).toBe(1);
  expect(
    await env.DB.prepare("SELECT status FROM publication_checks").first(),
  ).toEqual({ status: "unknown" });
  await store.finish(item, "publication_pending", env.PRISMIC_REPOSITORY);
  remote("ready");
  await reconcilePublications(env);
  expect((await store.get(item.id)).status).toBe("done");
  expect(posts).toBe(1);
});
it("valide localement avant toute écriture et attend une release précédente", async () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const { item, store } = await approved("u994");
  const saved = item.state.draft!;
  item.state.draft = { ...saved, topics: ["unknown"] };
  await expect(advance(env, steps, "invalid", item, cats)).rejects.toThrow();
  expect(
    (await env.DB.prepare("SELECT * FROM operations").all()).results,
  ).toHaveLength(0);
  item.state.draft = saved;
  await store.lock(env.PRISMIC_REPOSITORY, "previous");
  await advance(env, steps, "held", item, cats);
  expect(item.status).toBe("waiting_publish_slot");
  expect(output.mock.calls.map(([entry]) => entry)).toContainEqual(
    expect.objectContaining({
      event: "publication.slot.waiting",
      itemId: item.id,
    }),
  );
  expect(item.state.publicationStarted).toBeUndefined();
  expect(
    (await env.DB.prepare("SELECT * FROM operations").all()).results,
  ).toHaveLength(0);
});

it("une erreur de notification finale ne garde pas le verrou et sera retentée séparément", async () => {
  const { store, item } = await pending();
  const api = remote("ready");
  const initial = vi.mocked(fetch).getMockImplementation()!;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      if (String(input).includes("api.telegram.org"))
        throw new Error("Telegram unavailable");
      return initial(input as RequestInfo, init);
    }),
  );
  await reconcilePublications(env);
  expect((await store.get(item.id)).status).toBe("done");
  expect(
    (await env.DB.prepare("SELECT * FROM publication_lock").all()).results,
  ).toHaveLength(0);
  expect(
    await env.DB.prepare(
      "SELECT status,notified FROM publication_checks",
    ).first(),
  ).toEqual({ status: "confirmed", notified: 0 });
  await env.DB.prepare("UPDATE publication_checks SET next_check_at=0").run();
  remote("ready");
  await reconcilePublications(env);
  expect(
    await env.DB.prepare("SELECT notified FROM publication_checks").first(),
  ).toEqual({ notified: 1 });
  expect(api.searches()).toBe(1);
  expect(
    await env.DB.prepare("SELECT attempts FROM publication_checks").first(),
  ).toEqual({ attempts: 1 });
});

it("logs publication age, actual checks and the next scheduled check", async () => {
  const { item } = await pending();
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const started = Date.now() - 120_000;
  await env.DB.prepare("UPDATE publication_checks SET created_at=?,attempts=2")
    .bind(started)
    .run();
  remote("missing");
  await reconcilePublications(env);
  const entry = output.mock.calls
    .map(([entry]) => entry)
    .find((entry) => entry.event === "publication.availability.pending");
  expect(entry).toMatchObject({ itemId: item.id, checks: 3 });
  expect(entry.pendingMs).toBeGreaterThanOrEqual(120_000);
  expect(Date.parse(entry.nextCheckAt)).toBeGreaterThan(Date.now());
  expect(entry.message).toContain("3 vérification(s)");
});

it("reports the duplicate decision without logging the matching titles or URLs", async () => {
  const store = new Store(env.DB),
    existing = fixture("u997"),
    item = fixture("u998");
  await store.enqueue(
    existing.id,
    997,
    "1",
    existing.state,
    existing.created_at,
  );
  remote("missing");
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  await advance(env, steps, "g0-c0", item, cats);
  expect(item.status).toBe("duplicate");
  const entry = output.mock.calls
    .map(([entry]) => entry)
    .find((entry) => entry.event === "item.duplicate");
  expect(entry).toMatchObject({ itemId: item.id, matchCount: 1 });
  expect(entry.message).toContain("1 correspondance(s)");
  expect(JSON.stringify(entry)).not.toContain(item.state.url);
  expect(JSON.stringify(entry)).not.toContain(existing.state.draft!.fr.title);
});
