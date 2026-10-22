import { env, introspectWorkflowInstance } from "cloudflare:test";
import { it, expect, vi } from "vitest";
import { Store } from "@/store";
import { dispatch } from "@/index";
import type { Env } from "@/domain";
import { cats, fixture } from "@test/fixtures";

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
  try {
    await env.CURATION.create({ id, params: { id: item.id, generation: 0 } });
    await inspector.waitForStepResult({ name: "g0-c0-present" });
    expect((await store.get(item.id)).state.approvedRevision).toBeUndefined();
    await store.addAction(901, item, { kind: "approve", revision: 0 });
    await (
      await env.CURATION.get(id)
    ).sendEvent({ type: "input", payload: {} });
    await inspector.waitForStepResult({ name: "g0-c0-commit-action" });
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
    expect(finished.active).toBe(0);
    expect(
      (await env.DB.prepare("SELECT * FROM operations").all()).results,
    ).toHaveLength(0);
  } finally {
    await inspector.dispose();
  }
});

it("publie après confirmation et attend que les deux traductions soient visibles avant de libérer la file", async () => {
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
  let messageId = 0,
    published = false,
    publishCalls = 0,
    createCalls = 0;
  const docs = new Map<string, Record<string, unknown>>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("api.telegram.org"))
        return Response.json({
          ok: true,
          result: {
            message_id: ++messageId,
            date: 1,
            chat: { id: 1, type: "private" },
            text: "test",
          },
        });
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
        published = true;
        publishCalls++;
        return Response.json({ totalItems: 2 }, { status: 202 });
      }
      if (url.includes("/documents/search")) {
        const query = new URL(url).searchParams.get("q") ?? "";
        const doc = [...docs.values()].find((d) =>
          query.includes(String(d.id)),
        );
        // The Content API defaults to the master locale, even for getByID.
        const locale = new URL(url).searchParams.get("lang") ?? "fr-be";
        const visible = doc && (locale === "*" || doc.lang === locale);
        const results = published && visible ? [doc] : [];
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
    expect(finished.status).toBe("done");
    expect(finished.active).toBe(0);
    expect(finished.state.publishedIds).toEqual(["live-fr", "live-en"]);
    expect(publishCalls).toBe(1);
    expect(createCalls).toBe(2);
    expect(
      (await env.DB.prepare("SELECT * FROM publication_lock").all()).results,
    ).toHaveLength(0);
  } finally {
    await inspector.dispose();
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
