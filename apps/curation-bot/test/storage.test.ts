import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import { Store } from "@/store";
import worker from "@/index";
import { fixture } from "@test/fixtures";
import { journaledFetch } from "@/prismic";
import { AmbiguousWrite, MediaRejected } from "@/domain";

describe("inbox, file et verrous D1", () => {
  it("déduplique les envois et ne rend active qu’une fiche malgré des prises concurrentes", async () => {
    const store = new Store(env.DB),
      a = fixture("u1"),
      b = fixture("u2");
    await store.enqueue(a.id, 1, "1", a.state, a.created_at);
    await store.enqueue(a.id, 1, "1", a.state, a.created_at);
    await store.enqueue(b.id, 2, "1", b.state, b.created_at);
    await Promise.all([store.claim("1"), store.claim("1")]);
    expect(
      (await env.DB.prepare("SELECT id FROM items WHERE active=1").all())
        .results,
    ).toHaveLength(1);
    const active = (await store.active("1"))!;
    expect(active.id).toBe("u1");
    expect(await store.duplicates(b, b.state.url)).toContainEqual({
      title: `Déjà dans ta file : ${active.state.draft!.fr.title}`,
    });
    await store.finish(active, "done");
    expect((await store.claim("1"))?.id).toBe("u2");
  });
  it("conserve les actions et les verrous après création d’un nouvel adaptateur", async () => {
    const store = new Store(env.DB),
      item = fixture();
    await store.enqueue(item.id, 100, "1", item.state, item.created_at);
    await store.claim("1");
    await store.addAction(101, item, { kind: "approve", revision: 1 });
    await store.addAction(101, item, { kind: "approve", revision: 1 });
    const resumed = new Store(env.DB);
    expect((await resumed.nextAction(item.id))?.action.kind).toBe("approve");
    await resumed.lock("repo", item.id);
    await expect(resumed.lock("repo", "other")).rejects.toThrow();
    await resumed.unlock("repo", "other");
    await expect(store.lock("repo", "other")).rejects.toThrow();
    const action = (await resumed.nextAction(item.id))!;
    await resumed.consume(action.id);
    expect(await store.nextAction(item.id)).toBeUndefined();
  });
  it("exige le secret webhook et ignore les autres comptes sans appel externe", async () => {
    const ctx = createExecutionContext();
    expect(
      (
        await worker.fetch(
          new Request("https://bot/telegram", { method: "POST" }),
          env,
          ctx,
        )
      ).status,
    ).toBe(401);
    const update = {
      update_id: 100,
      message: {
        message_id: 1,
        date: 1,
        from: { id: 2 },
        chat: { id: 2, type: "private" },
        text: "https://example.com",
      },
    };
    expect(
      (
        await worker.fetch(
          new Request("https://bot/telegram", {
            method: "POST",
            headers: { "X-Telegram-Bot-Api-Secret-Token": "test-secret" },
            body: JSON.stringify(update),
          }),
          env,
          ctx,
        )
      ).status,
    ).toBe(200);
    await waitOnExecutionContext(ctx);
    expect(
      (await env.DB.prepare("SELECT * FROM inbox").all()).results,
    ).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
describe("journal des écritures Prismic", () => {
  it("explique un conflit de traduction, y compris au rejeu du refus, sans réécriture", async () => {
    const remote = vi.fn(async () =>
      Response.json(
        {
          message:
            "There is already an existing translation in this language for the document referenced in 'alternate_language_id'",
        },
        { status: 400 },
      ),
    );
    const request = journaledFetch(
      new Store(env.DB),
      "u-translation-conflict",
      remote as typeof fetch,
    )!;
    const args = [
      "https://migration.prismic.io/documents",
      {
        method: "POST",
        body: JSON.stringify({ lang: "en-us", alternate_language_id: "fr-id" }),
      },
    ] as const;
    await expect(request(...args)).rejects.toThrow("traduction existe déjà");
    await expect(request(...args)).rejects.toThrow("réconcilier");
    expect(remote).toHaveBeenCalledTimes(1);
  });
  it("rejoue une réponse connue sans seconde écriture réseau", async () => {
    const remote = vi.fn(async () => Response.json({ id: "fr-id" }));
    const first = journaledFetch(
      new Store(env.DB),
      "u1",
      remote as typeof fetch,
    )!;
    const init = { method: "POST", body: JSON.stringify({ uid: "test" }) };
    expect(
      await (
        await first("https://migration.prismic.io/documents", init)
      ).json(),
    ).toEqual({ id: "fr-id" });
    const resumed = journaledFetch(
      new Store(env.DB),
      "u1",
      remote as typeof fetch,
    )!;
    expect(
      await (
        await resumed("https://migration.prismic.io/documents", init)
      ).json(),
    ).toEqual({ id: "fr-id" });
    expect(remote).toHaveBeenCalledTimes(1);
  });
  it("bloque une réponse perdue et ne réessaie jamais aveuglément une création", async () => {
    const remote = vi.fn(async () => {
      throw new Error("connection lost after commit");
    });
    const request = journaledFetch(
      new Store(env.DB),
      "u1",
      remote as typeof fetch,
    )!;
    const init = { method: "POST", body: '{"uid":"lost"}' };
    await expect(
      request("https://migration.prismic.io/documents", init),
    ).rejects.toBeInstanceOf(AmbiguousWrite);
    await expect(
      request("https://migration.prismic.io/documents", init),
    ).rejects.toBeInstanceOf(AmbiguousWrite);
    expect(remote).toHaveBeenCalledTimes(1);
  });
  it("expose 429 au contrôleur durable et rejoue aussi un refus de média", async () => {
    const remote = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", { status: 429, headers: { "Retry-After": "60" } }),
      )
      .mockResolvedValueOnce(Response.json({ id: "ok" }));
    const request = journaledFetch(
      new Store(env.DB),
      "u1",
      remote as typeof fetch,
    )!;
    await expect(
      request("https://migration.prismic.io/documents", {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toMatchObject({ retryAfter: 60000 });
    await expect(
      request("https://migration.prismic.io/documents", {
        method: "POST",
        body: "{}",
      }),
    ).resolves.toHaveProperty("status", 200);
    const form = new FormData();
    form.append(
      "file",
      new File(["image"], "broken.ico", { type: "image/x-icon" }),
    );
    const rejected = vi.fn(async () => new Response("{}", { status: 415 }));
    const asset = journaledFetch(
      new Store(env.DB),
      "u2",
      rejected as typeof fetch,
    )!;
    await expect(
      asset("https://asset-api.prismic.io/assets", {
        method: "POST",
        body: form,
      }),
    ).rejects.toBeInstanceOf(MediaRejected);
    await expect(
      asset("https://asset-api.prismic.io/assets", {
        method: "POST",
        body: form,
      }),
    ).rejects.toBeInstanceOf(MediaRejected);
    expect(rejected).toHaveBeenCalledTimes(1);
  });
});

it("logs the specific CMS activity, safe failure reason and replay without sending a write twice", async () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const store = new Store(env.DB);
  const transport = vi.fn(async () =>
    Response.json({ id: "fr-doc" }, { status: 201 }),
  );
  const request = journaledFetch(store, "u707", transport)!;
  const url = "https://migration.prismic.io/documents?access_token=secret";
  // Use the canonical document endpoint; credentials only appear in headers/body.
  const endpoint = "https://migration.prismic.io/documents";
  const init = {
    method: "POST",
    body: JSON.stringify({ lang: "fr-be", private: "private-body" }),
    headers: { authorization: "Bearer secret" },
  };
  await request(endpoint, init);
  await request(endpoint, init);
  expect(transport).toHaveBeenCalledTimes(1);
  const entries = output.mock.calls.map(([entry]) => entry);
  expect(entries.find((entry) => entry.replayed === true)).toMatchObject({
    operation: "prismic.create-fr",
    activity: "Création du brouillon français",
    httpStatus: 201,
  });
  const lost = journaledFetch(
    store,
    "u708",
    vi.fn(async () => {
      throw new Error(url);
    }),
  )!;
  await expect(lost(endpoint, init)).rejects.toThrow();
  expect(errors.mock.calls.at(-1)![0]).toMatchObject({
    reasonCode: "write_unknown",
  });
  expect(errors.mock.calls.at(-1)![0].message).toContain(
    "rapprochement nécessaire",
  );
  expect(
    JSON.stringify([...output.mock.calls, ...errors.mock.calls]),
  ).not.toMatch(/private-body|Bearer secret|access_token=secret/);
});

it("lets preparation continue while approved drafts wait, then claims them fairly in a new generation", async () => {
  const store = new Store(env.DB),
    first = fixture("u810"),
    second = fixture("u811");
  first.state.approvedRevision = first.state.revision;
  await store.enqueue(first.id, 810, "1", first.state, first.created_at);
  await store.claim("1");
  await store.lock(env.PRISMIC_REPOSITORY, "older-publication");
  await store.save(first, "waiting_publish_slot");
  await store.parkPublication(first);
  await store.enqueue(second.id, 811, "1", second.state, second.created_at);
  expect((await store.claim("1"))?.id).toBe(second.id);
  await store.save(second, "review");
  // Releasing the publication lock must not interrupt the human's current review.
  await store.unlock(env.PRISMIC_REPOSITORY, "older-publication");
  expect((await store.claim("1"))?.id).toBe(second.id);
  await store.finish(second, "cancelled");
  const resumed = await store.claim("1");
  expect(resumed).toMatchObject({
    id: first.id,
    generation: 1,
    status: "queued",
  });
  expect(resumed?.state.approvedRevision).toBe(first.state.revision);
});
it("keeps uncertain writes protected while releasing the conversational slot and requires reconciliation before retry", async () => {
  const store = new Store(env.DB),
    item = fixture("u812");
  item.state.publicationStarted = true;
  await store.enqueue(item.id, 812, "1", item.state, item.created_at);
  await store.claim("1");
  await store.lock(env.PRISMIC_REPOSITORY, item.id);
  await store.save(item, "error");
  await store.begin(
    `${item.id}:unknown`,
    item.id,
    "POST https://migration.prismic.io/documents",
    {},
  );
  await store.parkPublication(item);
  expect((await store.get(item.id)).active).toBe(0);
  expect(
    await store.resumeParkedPublication("other-chat", item.id),
  ).toBeUndefined();
  expect(await store.resumeParkedPublication("1", item.id)).toBe("blocked");
  expect(await store.cancelParked("1", item.id)).toBe(false);
  await store.completed(`${item.id}:unknown`, { status: 201 });
  expect(await store.resumeParkedPublication("1", item.id)).toBe("queued");
  expect(await store.resumeParkedPublication("1", item.id)).toBeUndefined();
  expect((await store.get(item.id)).generation).toBe(1);
});
it("cancels only an unstarted parked publication with the matching revision", async () => {
  const store = new Store(env.DB),
    item = fixture("u813");
  item.state.approvedRevision = item.state.revision;
  await store.enqueue(item.id, 813, "1", item.state, item.created_at);
  await store.claim("1");
  await store.save(item, "waiting_publish_slot");
  await store.parkPublication(item);
  expect(await store.cancelParked("1", item.id, item.state.revision - 1)).toBe(
    false,
  );
  expect(await store.cancelParked("other-chat", item.id)).toBe(false);
  expect(await store.cancelParked("1", item.id, item.state.revision)).toBe(
    true,
  );
  expect(await store.claim("1")).toBeUndefined();
});
