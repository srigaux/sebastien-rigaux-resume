import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import worker from "@/index";
import { expect, it, vi } from "vitest";
import {
  reconcilePublications,
  schedulePublicationCheck,
  recordPublicationWebhook,
  PUBLICATION_FALLBACK_DELAY_MS,
} from "@/publication";
import { Store } from "@/store";
import { cats, extraction, fixture, repository } from "@test/fixtures";
import { verifyPublication } from "@/prismic";
import { advance } from "@/flow";
import type { Env } from "@/domain";
import type { Steps } from "@/retry";

async function pending(
  status: "accepted" | "unknown" = "accepted",
  due = true,
) {
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
  if (due)
    await env.DB.prepare(
      "UPDATE publication_checks SET next_check_at=0 WHERE item_id=?",
    )
      .bind(item.id)
      .run();
  return { store, item };
}
function remote(mode: "ready" | "missing" | "partial" | "unauthorized") {
  let searches = 0,
    writes = 0,
    successes = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("api.telegram.org")) {
        if (String(init?.body).includes("C’est publié")) successes++;
        return Response.json({
          ok: true,
          result: {
            message_id: 101,
            date: 1,
            chat: { id: 1, type: "private" },
          },
        });
      }
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
  return {
    searches: () => searches,
    writes: () => writes,
    successes: () => successes,
  };
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
  await env.DB.prepare("UPDATE publication_checks SET next_check_at=0").run();
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

it.each(["missing", "unauthorized"] as const)(
  "bounds %s checks, then pauses without releasing the lock or rewriting documents",
  async (mode) => {
    const { item } = await pending();
    const api = remote(mode);
    for (let attempt = 1; attempt <= 5; attempt++) {
      await env.DB.prepare(
        "UPDATE publication_checks SET next_check_at=0",
      ).run();
      const before = Date.now();
      await reconcilePublications(env);
      const row = await env.DB.prepare(
        "SELECT status,attempts,next_check_at FROM publication_checks",
      ).first<{ status: string; attempts: number; next_check_at: number }>();
      expect(row?.attempts).toBe(attempt);
      if (attempt < 5)
        expect(row!.next_check_at - before).toBeGreaterThanOrEqual(
          [60_000, 120_000, 300_000, 600_000][attempt - 1],
        );
    }
    expect(
      await env.DB.prepare("SELECT status FROM publication_checks").first(),
    ).toEqual({ status: "attention" });
    const calls = vi.mocked(fetch).mock.calls.length;
    await reconcilePublications(env);
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
    expect(api.writes()).toBe(0);
    expect(
      await env.DB.prepare("SELECT item_id FROM publication_lock").first(),
    ).toEqual({ item_id: item.id });
  },
);
it("recovers through an explicit bounded recheck after manual publication, without replaying writes", async () => {
  const { item, store } = await pending("unknown");
  await env.DB.prepare(
    "UPDATE publication_checks SET status='attention',attempts=5",
  ).run();
  remote("missing");
  await reconcilePublications(env);
  expect(
    await store.resumePublicationCheck("wrong-chat", item.id),
  ).toBeUndefined();
  expect(await store.resumePublicationCheck("1", item.id)).toEqual({
    id: item.id,
    scheduled: true,
  });
  expect(
    await env.DB.prepare(
      "SELECT status,attempts FROM publication_checks",
    ).first(),
  ).toEqual({ status: "unknown", attempts: 0 });
  const api = remote("ready");
  await reconcilePublications(env);
  expect((await store.get(item.id)).status).toBe("done");
  expect(api.writes()).toBe(0);
  expect(
    (await env.DB.prepare("SELECT * FROM publication_lock").all()).results,
  ).toHaveLength(0);
});
it("pauses legacy jobs over budget without another remote availability request", async () => {
  await pending("unknown");
  await env.DB.prepare("UPDATE publication_checks SET attempts=512").run();
  const api = remote("missing");
  await reconcilePublications(env);
  expect(api.searches()).toBe(0);
  expect(
    await env.DB.prepare(
      "SELECT status,attempts FROM publication_checks",
    ).first(),
  ).toEqual({ status: "attention", attempts: 512 });
});
it("does not reset the paused budget through routine scheduling or an active lease", async () => {
  const { item, store } = await pending();
  await env.DB.prepare(
    "UPDATE publication_checks SET status='attention',attempts=5,lease_until=?",
  )
    .bind(Date.now() + 60_000)
    .run();
  await schedulePublicationCheck(env, item, "accepted");
  expect(
    await env.DB.prepare(
      "SELECT status,attempts FROM publication_checks",
    ).first(),
  ).toEqual({ status: "attention", attempts: 5 });
  expect(await store.resumePublicationCheck("1", item.id)).toEqual({
    id: item.id,
    scheduled: false,
  });
});

it("waits ten minutes without webhook, then uses the bounded fallback", async () => {
  const { item, store } = await pending("accepted", false);
  const api = remote("ready");
  const row = await env.DB.prepare(
    "SELECT created_at,next_check_at FROM publication_checks",
  ).first<{ created_at: number; next_check_at: number }>();
  expect(row!.next_check_at - row!.created_at).toBe(
    PUBLICATION_FALLBACK_DELAY_MS,
  );
  await reconcilePublications(env);
  expect(api.searches()).toBe(0);
  expect((await store.get(item.id)).status).toBe("publication_pending");
  await env.DB.prepare("UPDATE publication_checks SET next_check_at=0").run();
  await reconcilePublications(env);
  expect(api.searches()).toBe(1);
  expect((await store.get(item.id)).status).toBe("done");
});

async function webhook(
  extra: Record<string, unknown> = {},
  githubOk = true,
  bindingsOverride: Partial<Env> = {},
) {
  const prior = vi.mocked(fetch).getMockImplementation()!;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      if (String(input).includes("api.github.com"))
        return new Response(null, { status: githubOk ? 204 : 500 });
      return prior(input as RequestInfo, init);
    }),
  );
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request("https://worker.test/prismic/webhook", {
      method: "POST",
      body: JSON.stringify({
        type: "api-update",
        domain: env.PRISMIC_REPOSITORY,
        secret: "webhook-secret",
        masterRef: "published-ref",
        documents: ["fr-id", "en-id"],
        ...extra,
      }),
    }),
    {
      ...env,
      PRISMIC_WEBHOOK_SECRET: "webhook-secret",
      GITHUB_ACTIONS_TOKEN: "github-token",
      ...bindingsOverride,
    },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

it.each(["accepted", "unknown"] as const)(
  "webhook confirms %s immediately and sends success only once",
  async (status) => {
    const { item, store } = await pending(status, false);
    const api = remote("ready");
    expect((await webhook()).status).toBe(200);
    expect((await store.get(item.id)).status).toBe("done");
    expect(api.searches()).toBe(1);
    expect(
      await env.DB.prepare(
        "SELECT status,notified,webhook_ref FROM publication_checks",
      ).first(),
    ).toEqual({
      status: "confirmed",
      notified: 1,
      webhook_ref: "published-ref",
    });
    expect(api.successes()).toBe(1);
    await webhook();
    await reconcilePublications(env);
    expect(api.searches()).toBe(1);
    expect(api.successes()).toBe(1);
    expect(
      await env.DB.prepare("SELECT notified FROM publication_checks").first(),
    ).toEqual({ notified: 1 });
  },
);

it("release deletion with nested IDs wakes only a matching publication", async () => {
  const { item, store } = await pending("accepted", false);
  const api = remote("ready");
  await webhook({
    documents: [],
    releases: { deletion: [{ documents: ["fr-id", "en-id"] }] },
  });
  expect((await store.get(item.id)).status).toBe("done");
  expect(api.searches()).toBe(1);
});
it("a deletion without IDs checks the locked publication without trusting the event", async () => {
  const { store, item } = await pending("accepted", false);
  const api = remote("partial");
  await webhook({
    documents: [],
    releases: { deletion: [{ id: "release-id" }] },
  });
  expect((await store.get(item.id)).status).toBe("publication_pending");
  expect(api.searches()).toBe(1);
  const row = await env.DB.prepare(
    "SELECT created_at,next_check_at FROM publication_checks",
  ).first<{ created_at: number; next_check_at: number }>();
  expect(row!.next_check_at).toBeGreaterThanOrEqual(
    row!.created_at + PUBLICATION_FALLBACK_DELAY_MS,
  );
  await reconcilePublications(env);
  expect(api.searches()).toBe(1);
});
it("does not wake for unrelated IDs, wrong secrets or unpublished release updates", async () => {
  await pending("accepted", false);
  const api = remote("ready");
  await webhook({ documents: ["unrelated"] });
  await webhook({ secret: "wrong" });
  await webhook({
    documents: [],
    releases: { update: [{ documents: ["fr-id", "en-id"] }] },
  });
  expect(api.searches()).toBe(0);
  expect(
    await env.DB.prepare("SELECT webhook_ref FROM publication_checks").first(),
  ).toEqual({ webhook_ref: null });
});
it("persists an early webhook until the active workflow parks", async () => {
  const { store, item } = await pending("accepted", false);
  await env.DB.prepare(
    "UPDATE items SET active=1,status='publishing' WHERE id=?",
  )
    .bind(item.id)
    .run();
  const api = remote("ready");
  await webhook();
  expect(api.searches()).toBe(0);
  await schedulePublicationCheck(env, item, "accepted");
  await store.finish(item, "publication_pending", env.PRISMIC_REPOSITORY);
  await reconcilePublications(env);
  expect(api.searches()).toBe(1);
  expect((await store.get(item.id)).status).toBe("done");
});
it("deduplicates concurrent deliveries and retains confirmation when GitHub fails", async () => {
  const { store, item } = await pending("accepted", false);
  const api = remote("ready");
  expect((await webhook({}, false)).status).toBe(503);
  expect((await store.get(item.id)).status).toBe("done");
  expect(api.searches()).toBe(1);
  expect(
    await recordPublicationWebhook(env, "published-ref", ["fr-id"], false),
  ).toBe(false);
});
it("persists a wake-up across concurrent webhook receipts", async () => {
  await pending("accepted", false);
  const results = await Promise.all([
    recordPublicationWebhook(env, "same-ref", ["fr-id"], false),
    recordPublicationWebhook(env, "same-ref", ["en-id"], false),
  ]);
  expect(results.sort()).toEqual([false, true]);
});

it("confirms the bot even when the GitHub token is unconfigured", async () => {
  const { item, store } = await pending("accepted", false);
  const api = remote("ready");
  expect(
    (await webhook({}, true, { GITHUB_ACTIONS_TOKEN: undefined })).status,
  ).toBe(503);
  expect((await store.get(item.id)).status).toBe("done");
  expect(api.successes()).toBe(1);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) => String(url).includes("api.github.com")),
  ).toBe(false);
});
