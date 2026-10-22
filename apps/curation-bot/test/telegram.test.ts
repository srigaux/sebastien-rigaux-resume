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
