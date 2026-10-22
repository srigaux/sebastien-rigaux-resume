import { env } from "cloudflare:test";
import { it, expect, vi } from "vitest";
import type { Update } from "grammy/types";
import { handleUpdate } from "@/telegram";
import { Store } from "@/store";
import { fixture } from "@test/fixtures";

function telegramApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) =>
      Response.json({
        ok: true,
        result: String(input).endsWith("getMe")
          ? {
              id: 999,
              is_bot: true,
              first_name: "Bot",
              username: "curation_test_bot",
            }
          : {
              message_id: 999,
              date: 1,
              chat: { id: 1, type: "private", first_name: "Bot" },
              text: "ok",
            },
      }),
    ),
  );
}
function update(id: number, text: string, replyId?: number): Update {
  return {
    update_id: id,
    message: {
      message_id: id,
      date: 1792324800,
      from: { id: 1, is_bot: false, first_name: "User" },
      chat: { id: 1, type: "private", first_name: "User" },
      text,
      ...(replyId
        ? {
            reply_to_message: {
              reply_to_message: undefined,
              message_id: replyId,
              date: 1,
              chat: { id: 1, type: "private", first_name: "Bot" },
            },
          }
        : {}),
    },
  };
}
it("enregistre un seul lien par soumission et demande le choix lorsque plusieurs liens sont possibles", async () => {
  telegramApi();
  const event = update(301, "https://example.com/a https://example.org/b");
  await handleUpdate(env, event);
  await handleUpdate(env, event);
  const rows = await env.DB.prepare("SELECT id,state FROM items").all<{
    id: string;
    state: string;
  }>();
  expect(rows.results).toHaveLength(1);
  expect(JSON.parse(rows.results[0].state).choices).toHaveLength(2);
});
it("accepte une réponse à la bonne version et refuse une approbation sans référence", async () => {
  telegramApi();
  const store = new Store(env.DB),
    item = fixture();
  await store.enqueue(item.id, 100, "1", item.state, item.created_at);
  await store.claim("1");
  await store.save(item, "review");
  await env.DB.prepare("INSERT INTO messages VALUES(?,?,?,?)")
    .bind("1", 10, item.id, 1)
    .run();
  await handleUpdate(env, update(302, "oui"));
  expect(await store.nextAction(item.id)).toBeUndefined();
  await handleUpdate(env, update(303, "valider", 10));
  expect((await store.nextAction(item.id))?.action).toEqual({
    kind: "approve",
    revision: 1,
  });
});
it("n’enregistre pas une ancienne réponse et déduplique les callbacks", async () => {
  telegramApi();
  const store = new Store(env.DB),
    item = fixture();
  item.state.revision = 2;
  await store.enqueue(item.id, 100, "1", item.state, item.created_at);
  await store.claim("1");
  await store.save(item, "review");
  await env.DB.prepare("INSERT INTO messages VALUES(?,?,?,?)")
    .bind("1", 10, item.id, 1)
    .run();
  await handleUpdate(env, update(304, "Insiste sur les performances.", 10));
  expect(await store.nextAction(item.id)).toBeUndefined();
  const callback: Update = {
    update_id: 305,
    callback_query: {
      id: "cb1",
      from: { id: 1, is_bot: false, first_name: "User" },
      chat_instance: "test",
      data: `${item.id}:2:approve:`,
      message: {
        message_id: 11,
        date: 1,
        chat: { id: 1, type: "private", first_name: "Bot" },
      },
    },
  };
  await handleUpdate(env, callback);
  await handleUpdate(env, callback);
  expect(
    (await env.DB.prepare("SELECT * FROM actions").all()).results,
  ).toHaveLength(1);
});

it("presents a compact photo preview once and sends only formatted text on corrections", async () => {
  const { present } = await import("@/telegram");
  const { cats } = await import("@test/fixtures");
  const calls: { method: string; body?: Record<string, any> }[] = [];
  let messageId = 1000;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const method = String(input).split("/").at(-1)!;
      calls.push({
        method,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return Response.json({
        ok: true,
        result: {
          message_id: ++messageId,
          date: 1,
          chat: { id: 1, type: "private" },
        },
      });
    }),
  );
  const item = fixture(),
    store = new Store(env.DB);
  item.state.media = {
    failures: [],
    image: {
      key: "test/image",
      url: "https://example.com/image.png",
      mime: "image/png",
      filename: "image.png",
      size: 3,
    },
    icon: {
      key: "test/icon",
      url: "https://example.com/favicon.ico",
      mime: "image/x-icon",
      filename: "favicon.ico",
      size: 3,
    },
  };
  await env.BUCKET.put("test/image", new Uint8Array([1, 2, 3]));
  await store.enqueue(item.id, 100, "1", item.state, item.created_at);
  await store.claim("1");
  await present(env, item, cats);
  expect(item.state.previewImageKey).toBe("test/image");
  expect((await store.get(item.id)).state.previewImageKey).toBe("test/image");
  item.state.revision = 2;
  item.state.revisionNote = "titres modifiés.";
  item.state.draft!.fr.title = "React : une organisation plus simple";
  await present(env, item, cats);
  expect(calls.filter((call) => call.method === "sendPhoto")).toHaveLength(1);
  expect(calls.filter((call) => call.method === "sendDocument")).toHaveLength(
    0,
  );
  const messages = calls.filter((call) => call.method === "sendMessage");
  expect(messages).toHaveLength(2);
  expect(messages[1].body).toMatchObject({
    parse_mode: "HTML",
    text: expect.stringContaining("<i>Version 2 — titres modifiés.</i>"),
  });
  expect(
    messages[1]
      .body!.reply_markup.inline_keyboard.flat()
      .map((b: { text: string }) => b.text),
  ).toEqual(["🚀 Publier", "🗑 Annuler"]);
  const rows = await env.DB.prepare(
    "SELECT revision FROM messages WHERE item_id=? ORDER BY message_id",
  )
    .bind(item.id)
    .all<{ revision: number }>();
  expect(rows.results.map((row) => row.revision)).toEqual([1, 2]);
});

it("opens source and image menus from messages without adding review buttons", async () => {
  telegramApi();
  const store = new Store(env.DB),
    item = fixture();
  await store.enqueue(item.id, 100, "1", item.state, item.created_at);
  await store.claim("1");
  await handleUpdate(env, update(401, "Change l’image"));
  await handleUpdate(env, update(402, "Change la source"));
  const rows = await env.DB.prepare(
    "SELECT payload FROM actions ORDER BY update_id",
  ).all<{ payload: string }>();
  expect(rows.results.map((row) => JSON.parse(row.payload).kind)).toEqual([
    "images",
    "sources",
  ]);
});

function receiptApi(mode: "normal" | "deleted" | "network" = "normal") {
  const calls: { method: string; body: Record<string, any> }[] = [];
  let serial = 1000;
  const edited = new Map<string, string>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const method = String(input).split("/").at(-1)!;
      let body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      if (method === "editMessageMedia") {
        const form = await new Request(String(input), init).formData();
        body = {
          message_id: Number(form.get("message_id")),
          media: JSON.parse(String(form.get("media"))),
        };
      }
      calls.push({ method, body });
      if (method === "getMe")
        return Response.json({
          ok: true,
          result: {
            id: 999,
            is_bot: true,
            first_name: "Bot",
            username: "curation_test_bot",
          },
        });
      if (method === "sendChatAction")
        return Response.json({ ok: true, result: true });
      if (method === "editMessageText" || method === "editMessageMedia") {
        if (mode === "network") throw new Error("Network disconnected");
        const key = `${method}:${body.message_id}`;
        const unchanged = edited.get(key) === JSON.stringify(body);
        edited.set(key, JSON.stringify(body));
        if (mode === "deleted" || unchanged)
          return Response.json({
            ok: false,
            error_code: 400,
            description:
              mode === "deleted"
                ? "Bad Request: message to edit not found"
                : "Bad Request: message is not modified",
          });
      }
      return Response.json({
        ok: true,
        result: {
          message_id: method.startsWith("editMessage")
            ? body.message_id
            : ++serial,
          date: 1,
          chat: { id: 1, type: "private" },
          text: body.text,
        },
      });
    }),
  );
  return calls;
}

it("replaces the durable receipt with the proposal, tolerates replay and keeps revisions separate", async () => {
  const { present } = await import("@/telegram");
  const { cats } = await import("@test/fixtures");
  const calls = receiptApi(),
    store = new Store(env.DB);
  const incoming = update(501, "https://example.com/article");
  await handleUpdate(env, incoming);
  await handleUpdate(env, incoming);
  expect(calls.filter((call) => call.method === "sendMessage")).toHaveLength(1);
  expect(
    (await env.DB.prepare("SELECT * FROM messages").all()).results,
  ).toHaveLength(0);
  const item = (await store.claim("1"))!;
  item.status = "review";
  item.state.draft = fixture().state.draft;
  item.state.media = { failures: [] };
  item.state.sourceUid = null;
  await present(env, item, cats);
  const edited = calls.find((call) => call.method === "editMessageText")!;
  expect(edited.body).toMatchObject({
    message_id: 1001,
    parse_mode: "HTML",
    text: expect.stringContaining("🇫🇷"),
  });
  expect(
    edited.body.reply_markup.inline_keyboard
      .flat()
      .map((button: { text: string }) => button.text),
  ).toEqual(["🚀 Publier", "🗑 Annuler"]);
  await present(env, item, cats); // Telegram already has this exact proposal.
  expect(calls.filter((call) => call.method === "sendMessage")).toHaveLength(1);
  expect(
    (await env.DB.prepare("SELECT message_id,revision FROM messages").all())
      .results,
  ).toEqual([{ message_id: 1001, revision: 1 }]);
  item.state.revision = 2;
  item.state.revisionNote = "Titres raccourcis.";
  await present(env, item, cats);
  expect(calls.filter((call) => call.method === "sendMessage")).toHaveLength(2);
  expect(
    calls.filter((call) => call.method === "editMessageText"),
  ).toHaveLength(2);
  await handleUpdate(env, update(502, "valider", 1001));
  expect(await store.nextAction(item.id)).toBeUndefined();
});

it("sends a replacement if the original receipt was deleted", async () => {
  const { present } = await import("@/telegram");
  const { cats } = await import("@test/fixtures");
  const calls = receiptApi("deleted"),
    store = new Store(env.DB),
    item = fixture();
  await store.enqueue(item.id, 100, "1", item.state, item.created_at);
  await store.claim("1");
  await store.begin(`telegram:receipt:${item.id}`, item.id, "telegram.receipt");
  await store.completed(`telegram:receipt:${item.id}`, { messageId: 10 });
  await present(env, item, cats);
  expect(calls.map((call) => call.method)).toEqual([
    "editMessageText",
    "sendMessage",
  ]);
  expect(
    JSON.parse(
      (await store.operation(`telegram:receipt:${item.id}`))!.response!,
    ),
  ).toEqual({ messageId: 1001, revision: 1 });
});

it("does not send a duplicate proposal after an edit with an unknown network result", async () => {
  const { present } = await import("@/telegram");
  const { cats } = await import("@test/fixtures");
  const calls = receiptApi("network"),
    store = new Store(env.DB),
    item = fixture();
  await store.enqueue(item.id, 100, "1", item.state, item.created_at);
  await store.claim("1");
  await store.begin(`telegram:receipt:${item.id}`, item.id, "telegram.receipt");
  await store.completed(`telegram:receipt:${item.id}`, { messageId: 10 });
  await expect(present(env, item, cats)).rejects.toThrow();
  expect(calls.map((call) => call.method)).toEqual(["editMessageText"]);
});

it("turns the initial receipt into the image and sends the complete texts separately", async () => {
  const { present, sendPreview } = await import("@/telegram");
  const { cats } = await import("@test/fixtures");
  const calls = receiptApi(),
    store = new Store(env.DB);
  await handleUpdate(env, update(601, "https://example.com/article"));
  const item = (await store.claim("1"))!;
  item.state.media = {
    failures: [],
    image: {
      key: "test/receipt-image",
      filename: "image.png",
      mime: "image/png",
      size: 3,
      url: "https://example.com/image.png",
    },
  };
  await env.BUCKET.put("test/receipt-image", new Uint8Array([1, 2, 3]));
  await sendPreview(env, item);
  const media = calls.find((call) => call.method === "editMessageMedia")!;
  expect(media.body).toMatchObject({
    message_id: 1001,
    media: { type: "photo", parse_mode: "HTML" },
  });
  expect(calls.some((call) => call.method === "sendPhoto")).toBe(false);
  expect(calls.some((call) => call.method === "sendChatAction")).toBe(true);
  expect(
    (await env.DB.prepare("SELECT * FROM messages").all()).results,
  ).toHaveLength(0);
  // Recover a successful media edit even if the mutable item flag was lost.
  item.state.previewImageKey = undefined;
  await sendPreview(env, item);
  expect(
    calls.filter((call) => call.method === "editMessageMedia"),
  ).toHaveLength(1);
  item.state.draft = fixture().state.draft;
  item.state.sourceUid = null;
  item.status = "review";
  await present(env, item, cats);
  expect(calls.filter((call) => call.method === "sendMessage")).toHaveLength(2);
  expect(calls.some((call) => call.method === "editMessageText")).toBe(false);
  expect(
    (await env.DB.prepare("SELECT message_id,revision FROM messages").all())
      .results,
  ).toEqual([{ message_id: 1002, revision: 1 }]);
  await handleUpdate(env, update(602, "valider", 1001));
  expect(await store.nextAction(item.id)).toBeUndefined();
});

it("acknowledges each correction once and replaces that receipt with the new revision", async () => {
  const { present } = await import("@/telegram");
  const { applyAction } = await import("@/flow");
  const { cats } = await import("@test/fixtures");
  const calls = receiptApi(),
    store = new Store(env.DB),
    item = fixture();
  await store.enqueue(item.id, 100, "1", item.state, item.created_at);
  await store.claim("1");
  await store.save(item, "review");
  const incoming = update(603, "Raccourcis les titres.");
  await handleUpdate(env, incoming);
  await handleUpdate(env, incoming);
  expect(calls.filter((call) => call.method === "sendMessage")).toHaveLength(1);
  expect(
    calls.find((call) => call.method === "sendMessage")!.body.text,
  ).toContain("Je prépare la nouvelle version");
  const pending = (await store.nextAction(item.id))!;
  expect(pending.action.receiptKey).toBe(`telegram:revision:${item.id}:603`);
  expect(
    (await env.DB.prepare("SELECT * FROM messages").all()).results,
  ).toHaveLength(0);
  const step = {
    do: async (_n: string, _c: unknown, fn: () => Promise<unknown>) => fn(),
    sleep: async () => {},
  } as Parameters<typeof applyAction>[1];
  await applyAction(env, step, "revision", item, cats, pending.action);
  expect(item.state.revisionReceiptKey).toBe(pending.action.receiptKey);
  item.state.needsRevision = false;
  item.state.draft!.fr.title = "React : simplifier les variantes";
  item.state.revisionNote = "Titres raccourcis.";
  item.status = "review";
  await present(env, item, cats);
  expect(calls.filter((call) => call.method === "sendMessage")).toHaveLength(1);
  expect(
    calls.find((call) => call.method === "editMessageText")!.body,
  ).toMatchObject({
    message_id: 1001,
    text: expect.stringContaining("Version 2 — Titres raccourcis."),
  });
  expect(
    (await env.DB.prepare("SELECT message_id,revision FROM messages").all())
      .results,
  ).toEqual([{ message_id: 1001, revision: 2 }]);
});

it("vide l’attente du chat sans toucher à la fiche active ni aux nouveaux liens", async () => {
  telegramApi();
  const store = new Store(env.DB),
    item = fixture("u700");
  await store.enqueue(item.id, 700, "1", item.state, item.created_at);
  await store.claim("1");
  await store.enqueue("u701", 701, "1", item.state, item.created_at);
  await store.enqueue("u702", 702, "2", item.state, item.created_at);
  await handleUpdate(env, update(703, "/vider"));
  expect((await store.get("u701")).status).toBe("cancelled");
  expect((await store.get("u702")).status).toBe("queued");
  expect((await store.get(item.id)).active).toBe(1);
  expect(await store.nextAction(item.id)).toBeUndefined();
  await store.enqueue("u704", 704, "1", item.state, item.created_at);
  await handleUpdate(env, update(703, "/vider"));
  expect((await store.get("u704")).status).toBe("queued");
});
it.each([false, true])(
  "reset protège une publication commencée : %s",
  async (started) => {
    telegramApi();
    const store = new Store(env.DB),
      item = fixture("u710");
    item.state.publicationStarted = started;
    await store.enqueue(item.id, 710, "1", item.state, item.created_at);
    await store.claim("1");
    await store.enqueue(
      "u711",
      711,
      "1",
      { ...item.state, publicationStarted: false },
      item.created_at,
    );
    await handleUpdate(env, update(712, "/reset"));
    expect((await store.get("u711")).status).toBe("cancelled");
    expect((await store.get(item.id)).active).toBe(1);
    expect((await store.nextAction(item.id))?.action.kind).toBe(
      started ? undefined : "cancel",
    );
  },
);
it("help et les commandes inconnues ne deviennent pas des corrections", async () => {
  telegramApi();
  const store = new Store(env.DB),
    item = fixture("u720");
  await store.enqueue(item.id, 720, "1", item.state, item.created_at);
  await store.claim("1");
  await handleUpdate(env, update(721, "/help"));
  await handleUpdate(env, update(722, "/inconnue"));
  expect(await store.nextAction(item.id)).toBeUndefined();
  const bodies = vi
    .mocked(fetch)
    .mock.calls.map(([, init]) => String(init?.body));
  expect(
    bodies.some(
      (body) => body.includes("/reset") && body.includes("/reprendre"),
    ),
  ).toBe(true);
});
it("un reset rejoué ne peut pas annuler une nouvelle fiche active", async () => {
  telegramApi();
  await handleUpdate(env, update(730, "/reset"));
  const store = new Store(env.DB),
    item = fixture("u731");
  await store.enqueue(item.id, 731, "1", item.state, item.created_at);
  await store.claim("1");
  await handleUpdate(env, update(730, "/reset"));
  expect(await store.nextAction(item.id)).toBeUndefined();
  expect((await store.get(item.id)).active).toBe(1);
});
