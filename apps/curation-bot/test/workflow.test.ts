import { env, introspectWorkflowInstance } from "cloudflare:test";
import { it, expect, vi } from "vitest";
import { Store } from "@/store";
import { dispatch } from "@/index";
import { reconcilePublications, recordPublicationWebhook } from "@/publication";
import type { Env } from "@/domain";
import { cats, fixture, extraction } from "@test/fixtures";

async function queuedChoice(store: Store, id: string, update: number) {
  const next = fixture(id);
  next.state.choices = ["https://example.com/next", "https://example.org/next"];
  await store.enqueue(id, update, "1", next.state, next.created_at);
  return introspectWorkflowInstance(env.CURATION, `${id}-g0`);
}

it("attend une action persistée dans un véritable Workflow Cloudflare et rejette une ancienne confirmation", async () => {
  const store = new Store(env.DB),
    item = fixture("u900");
  item.status = "duplicate";
  item.state.duplicateMatches = ["Fiche existante"];
  item.state.checked = [item.state.url];
  await store.enqueue(item.id, 900, "1", item.state, item.created_at);
  await store.claim("1");
  await store.save(item, "duplicate");
  await store.putCache(`catalog:${env.PRISMIC_REPOSITORY}`, cats, 3600000);
  let messages = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) =>
      Response.json({
        ok: true,
        result: {
          message_id: ++messages,
          date: 1,
          chat: { id: 1, type: "private" },
          text: "test",
        },
      }),
    ),
  );
  const id = "workflow-test-wait";
  const inspector = await introspectWorkflowInstance(env.CURATION, id);
  const next = await queuedChoice(store, "u950", 950);
  try {
    await env.CURATION.create({ id, params: { id: item.id, generation: 0 } });
    await inspector.waitForStepResult({ name: "g0-c0-present" });
    expect((await store.get(item.id)).state.approvedRevision).toBeUndefined();
    await store.addAction(901, item, { kind: "approve", revision: 0 });
    await (
      await env.CURATION.get(id)
    ).sendEvent({ type: "input", payload: {} });
    await inspector.waitForStepResult({ name: "g0-c0-commit-action" });
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) =>
          String(url).endsWith("/editMessageReplyMarkup"),
        ),
    ).toBe(false);
    expect((await store.get(item.id)).state.approvedRevision).toBeUndefined();
    await inspector.waitForStepResult({ name: "g0-c1-present" });
    const resumed = new Store(env.DB);
    await resumed.addAction(902, item, { kind: "cancel", revision: 1 });
    await (
      await env.CURATION.get(id)
    ).sendEvent({ type: "input", payload: {} });
    await inspector.waitForStatus("complete");
    const finished = await resumed.get(item.id);
    expect(finished.status).toBe("cancelled");
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) =>
          String(url).endsWith("/editMessageReplyMarkup"),
        ),
    ).toBe(true);
    expect(finished.active).toBe(0);
    await next.waitForStepResult({ name: "g0-c0-present" });
    expect((await store.get("u950")).status).toBe("choose");
    expect((await store.active("1"))?.id).toBe("u950");
    expect(
      (
        await env.DB.prepare(
          "SELECT * FROM operations WHERE target LIKE '%migration.prismic.io%'",
        ).all()
      ).results,
    ).toHaveLength(0);
  } finally {
    await inspector.dispose();
    await next.dispose();
  }
});

it("libère la file dès l’acceptation et garde le verrou jusqu’au contrôle cron des deux versions", async () => {
  const { repository, extraction } = await import("@test/fixtures");
  const store = new Store(env.DB),
    item = fixture("u901");
  item.state.extractionKey = "extractions/u901.json";
  item.state.checked = [item.state.url];
  await env.BUCKET.put(item.state.extractionKey, JSON.stringify(extraction));
  await store.enqueue(item.id, 901, "1", item.state, item.created_at);
  await store.claim("1");
  await store.save(item, "review");
  await store.putCache(`catalog:${env.PRISMIC_REPOSITORY}`, cats, 3600000);
  let publicationMessageId: number | undefined;
  let publicationConfirmed = false;
  let publicationAccepted = false;
  const publicationUpdates: string[] = [];
  let messageId = 0,
    published = false,
    publishCalls = 0,
    createCalls = 0;
  const docs = new Map<string, Record<string, unknown>>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("api.telegram.org")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (body.text?.includes("acceptée par Prismic"))
          publicationAccepted = true;
        if (body.text?.includes("Publication en cours"))
          publicationUpdates.push(body.text);
        if (
          url.endsWith("/sendMessage") &&
          body.text?.includes("Publication en cours")
        )
          publicationMessageId = messageId + 1;
        if (
          url.endsWith("/editMessageText") &&
          body.text?.includes("C’est publié")
        ) {
          expect(body.message_id).toBe(publicationMessageId);
          publicationConfirmed = true;
        }
        return Response.json({
          ok: true,
          result: {
            message_id: ++messageId,
            date: 1,
            chat: { id: 1, type: "private" },
            text: "test",
          },
        });
      }
      if (
        url.includes("cdn.prismic.io/api/v2") &&
        !url.includes("documents/search")
      )
        return Response.json(repository);
      if (url.endsWith("/documents") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        const id = body.lang === "fr-be" ? "live-fr" : "live-en";
        docs.set(id, {
          ...body,
          id,
          alternate_languages: [
            {
              id: id === "live-fr" ? "live-en" : "live-fr",
              lang: id === "live-fr" ? "en-us" : "fr-be",
            },
          ],
        });
        createCalls++;
        return Response.json({ id }, { status: 201 });
      }
      if (url.includes("/documents/") && init?.method === "PUT") {
        const id = new URL(url).pathname.split("/").pop()!;
        docs.set(id, { ...docs.get(id), ...JSON.parse(String(init.body)) });
        return Response.json({});
      }
      if (url.includes("migration-release/publish")) {
        expect(
          vi
            .mocked(fetch)
            .mock.calls.some(([url]) =>
              String(url).endsWith("/editMessageReplyMarkup"),
            ),
        ).toBe(true);
        expect(publicationMessageId).toBeDefined();
        published = true;
        publishCalls++;
        return Response.json({ totalItems: 2 }, { status: 202 });
      }
      if (url.includes("/documents/search")) {
        const query = new URL(url).searchParams.get("q") ?? "";
        const locale = new URL(url).searchParams.get("lang") ?? "fr-be";
        const results = published
          ? [...docs.values()].filter(
              (doc) =>
                query.includes(String(doc.id)) &&
                (locale === "*" || doc.lang === locale),
            )
          : [];
        return Response.json({
          page: 1,
          results_per_page: 20,
          results_size: results.length,
          total_results_size: results.length,
          total_pages: 1,
          next_page: null,
          prev_page: null,
          results,
        });
      }
      throw new Error(`Unexpected ${url}`);
    }),
  );
  const id = "workflow-test-publish",
    inspector = await introspectWorkflowInstance(env.CURATION, id);
  const next = await queuedChoice(store, "u951", 951);
  try {
    await inspector.modify(async (m) => {
      await m.disableSleeps();
    });
    await env.CURATION.create({ id, params: { id: item.id, generation: 0 } });
    await inspector.waitForStepResult({ name: "g0-c0-present" });
    expect(publishCalls).toBe(0);
    await store.addAction(903, item, { kind: "approve", revision: 1 });
    await (
      await env.CURATION.get(id)
    ).sendEvent({ type: "input", payload: {} });
    await inspector.waitForStatus("complete");
    const finished = await store.get(item.id);
    expect(finished.status).toBe("publication_pending");
    expect(finished.active).toBe(0);
    expect(finished.state.publishedIds).toEqual(["live-fr", "live-en"]);
    expect(publishCalls).toBe(1);
    expect(createCalls).toBe(2);
    expect(publicationAccepted).toBe(true);
    expect(publicationConfirmed).toBe(false);
    for (const text of [
      "⏳ Création de la fiche FR",
      "✅ Création de la fiche FR",
      "⏳ Création de la fiche EN",
      "⏳ Enregistrement des textes",
      "⏳ Publication dans Prismic",
    ]) {
      expect(publicationUpdates.some((update) => update.includes(text))).toBe(
        true,
      );
    }
    await next.waitForStepResult({ name: "g0-c0-present" });
    expect((await store.get("u951")).status).toBe("choose");
    expect((await store.active("1"))?.id).toBe("u951");
    expect(
      (await env.DB.prepare("SELECT * FROM publication_lock").all()).results,
    ).toHaveLength(1);
    await reconcilePublications(env);
    expect((await store.get(item.id)).status).toBe("publication_pending");
    await recordPublicationWebhook(
      env,
      "published-ref",
      (await store.get(item.id)).state.publishedIds!,
      false,
    );
    await reconcilePublications(env);
    expect((await store.get(item.id)).status).toBe("done");
    expect(publicationConfirmed).toBe(true);
    expect(publishCalls).toBe(1);
    expect(
      (await env.DB.prepare("SELECT * FROM publication_lock").all()).results,
    ).toHaveLength(0);
  } finally {
    await inspector.dispose();
    await next.dispose();
  }
}, 30000);

it("recrée une instance après panne en reprenant la fiche persistée et ses actions", async () => {
  const store = new Store(env.DB),
    item = fixture("u902");
  item.status = "duplicate";
  item.state.duplicateMatches = ["Déjà publié"];
  await store.enqueue(item.id, 902, "1", item.state, item.created_at);
  await store.claim("1");
  await store.save(item, "duplicate");
  await store.putCache(`catalog:${env.PRISMIC_REPOSITORY}`, cats, 3600000);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ok: true,
        result: { message_id: 1, date: 1, chat: { id: 1, type: "private" } },
      }),
    ),
  );
  const binding = {
    get: async (id: string) =>
      id === "u902-g0"
        ? { status: async () => ({ status: "errored" }) }
        : env.CURATION.get(id),
    create: env.CURATION.create.bind(env.CURATION),
  };
  const recovering = new Proxy(env, {
    get: (target, key) =>
      key === "CURATION" ? binding : Reflect.get(target, key),
  }) as Env;
  await dispatch(recovering);
  expect((await store.get(item.id)).generation).toBe(1);
  const inspector = await introspectWorkflowInstance(env.CURATION, "u902-g1");
  try {
    await dispatch(recovering);
    await inspector.waitForStepResult({ name: "g1-c0-present" });
    const persisted = await new Store(env.DB).get(item.id);
    expect(persisted.state.duplicateMatches).toEqual(["Déjà publié"]);
    await store.addAction(904, persisted, { kind: "cancel", revision: 1 });
    await (
      await env.CURATION.get("u902-g1")
    ).sendEvent({ type: "input", payload: {} });
    await inspector.waitForStatus("complete");
    expect((await store.get(item.id)).status).toBe("cancelled");
  } finally {
    await inspector.dispose();
  }
});

it("interrompt un Retry-After de 15 minutes pour annuler sans attendre ni appeler le LLM", async () => {
  const { extraction, repository } = await import("@test/fixtures");
  const store = new Store(env.DB),
    item = fixture("u903");
  item.state.extractionKey = "extractions/u903.json";
  item.state.checked = [item.state.url];
  delete item.state.media;
  await env.BUCKET.put(item.state.extractionKey, JSON.stringify(extraction));
  await store.enqueue(item.id, 903, "1", item.state, item.created_at);
  await store.claim("1");
  await store.putCache(`catalog:${env.PRISMIC_REPOSITORY}`, cats, 3600000);
  let messageId = 0;
  const sent: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("api.telegram.org")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (body.text) sent.push(body.text);
        return Response.json({
          ok: true,
          result: {
            message_id: ++messageId,
            date: 1,
            chat: { id: 1, type: "private" },
          },
        });
      }
      if (url === "https://example.com/image.png")
        return new Response("", {
          status: 429,
          headers: { "Retry-After": "900" },
        });
      if (
        url.includes("cdn.prismic.io/api/v2") &&
        !url.includes("documents/search")
      )
        return Response.json(repository);
      throw new Error("Unexpected request during cancellation");
    }),
  );
  const first = await introspectWorkflowInstance(env.CURATION, "u903-g0");
  const second = await introspectWorkflowInstance(env.CURATION, "u903-g1");
  try {
    await env.CURATION.create({
      id: "u903-g0",
      params: { id: item.id, generation: 0 },
    });
    await first.waitForStepResult({
      name: "u903/g0-c0/image-0-backoff-0-notify-wait",
    });
    expect(sent.some((text) => text.includes("15 minute(s)"))).toBe(true);
    await store.addAction(905, await store.get(item.id), {
      kind: "cancel",
      revision: 1,
    });
    await dispatch(env);
    await second.waitForStatus("complete");
    const cancelled = await store.get(item.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.active).toBe(0);
    expect(await store.nextAction(item.id)).toBeUndefined();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) => String(url).includes("openai")),
    ).toBe(false);
  } finally {
    await first.dispose();
    await second.dispose();
  }
}, 30000);

it("ne termine pas un workflow si la publication a déjà commencé", async () => {
  const store = new Store(env.DB),
    item = fixture("u904");
  item.state.publicationStarted = true;
  await store.enqueue(item.id, 904, "1", item.state, item.created_at);
  await store.claim("1");
  await store.addAction(906, item, { kind: "cancel", revision: 1 });
  const instance = {
    status: async () => ({ status: "running" }),
    terminate: vi.fn(),
    sendEvent: vi.fn(),
  };
  const protectedEnv = new Proxy(env, {
    get: (target, key) =>
      key === "CURATION"
        ? { get: async () => instance }
        : Reflect.get(target, key),
  }) as Env;
  await dispatch(protectedEnv);
  expect(instance.terminate).not.toHaveBeenCalled();
  expect(instance.sendEvent).toHaveBeenCalled();
  expect((await store.get(item.id)).active).toBe(1);
});

it("parks an approved publication behind an uncertain release and starts the next preparation workflow", async () => {
  const store = new Store(env.DB),
    item = fixture("u860");
  item.state.approvedRevision = item.state.revision;
  item.state.extractionKey = "extractions/u860";
  item.state.checked = [item.state.url];
  await env.BUCKET.put(item.state.extractionKey, JSON.stringify(extraction));
  await store.enqueue(item.id, 860, "1", item.state, item.created_at);
  await store.claim("1");
  await store.putCache(`catalog:${env.PRISMIC_REPOSITORY}`, cats, 60_000);
  await store.lock(env.PRISMIC_REPOSITORY, "uncertain-older-publication");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ok: true,
        result: {
          message_id: 500,
          date: 1,
          chat: { id: 1, type: "private" },
          text: "ok",
        },
      }),
    ),
  );
  const id = "workflow-test-park-publication";
  const inspector = await introspectWorkflowInstance(env.CURATION, id);
  const next = await queuedChoice(store, "u861", 861);
  try {
    await env.CURATION.create({ id, params: { id: item.id, generation: 0 } });
    await inspector.waitForStatus("complete");
    await next.waitForStepResult({ name: "g0-c0-present" });
    expect(await store.get(item.id)).toMatchObject({
      active: 0,
      status: "waiting_publish_slot",
    });
    expect((await store.active("1"))?.id).toBe("u861");
    expect(
      await env.DB.prepare("SELECT item_id FROM publication_lock").first(),
    ).toEqual({ item_id: "uncertain-older-publication" });
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) =>
          String(url).includes("migration.prismic.io"),
        ),
    ).toBe(false);
  } finally {
    await inspector.dispose();
    await next.dispose();
  }
});
