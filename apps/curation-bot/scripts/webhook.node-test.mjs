import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "./webhook.mjs";

const env = { TELEGRAM_BOT_TOKEN: "secret-token" };
function mock(results) {
  const calls = [];
  return {
    calls,
    fetch: async (url, options) => {
      calls.push({
        method: url.split("/").at(-1),
        body: JSON.parse(options.body),
      });
      return { json: async () => results.shift() };
    },
  };
}
test("identity leaves an existing webhook intact", async () => {
  const api = mock([
    { ok: true, result: { url: "https://example.com/telegram" } },
  ]);
  await assert.rejects(
    main("identity", env, api.fetch),
    /webhook est déjà actif/,
  );
  assert.deepEqual(
    api.calls.map((call) => call.method),
    ["getWebhookInfo"],
  );
});
test("identity returns private chat identities without acknowledging updates", async () => {
  const api = mock([
    { ok: true, result: { url: "" } },
    {
      ok: true,
      result: [
        { message: { chat: { type: "private", id: 42 }, from: { id: 42 } } },
        { message: { chat: { type: "group", id: -1 }, from: { id: 12 } } },
      ],
    },
  ]);
  const output = [];
  await main("identity", env, api.fetch, (line) => output.push(line));
  assert.deepEqual(JSON.parse(output[0]), [{ userId: 42, chatId: 42 }]);
  assert.equal(api.calls[1].body.offset, undefined);
  assert.deepEqual(api.calls[1].body.allowed_updates, [
    "message",
    "callback_query",
  ]);
});
test("409 keeps Telegram's explanation and redacts the token", async () => {
  const api = mock([
    { ok: true, result: { url: "" } },
    {
      ok: false,
      error_code: 409,
      description: "Conflict: other getUpdates secret-token",
    },
  ]);
  await assert.rejects(main("identity", env, api.fetch), (error) => {
    assert.match(error.message, /other getUpdates \[redacted\]/);
    assert.match(error.message, /Arrêtez/);
    assert.ok(!error.message.includes(env.TELEGRAM_BOT_TOKEN));
    return true;
  });
});
test("explicit unregister preserves pending messages", async () => {
  const api = mock([{ ok: true, result: true }]);
  await main("unregister", env, api.fetch, () => {});
  assert.deepEqual(api.calls, [
    { method: "deleteWebhook", body: { drop_pending_updates: false } },
  ]);
});
test("empty inbox explains how to obtain an identity", async () => {
  const api = mock([
    { ok: true, result: { url: "" } },
    { ok: true, result: [] },
  ]);
  const output = [];
  await main("identity", env, api.fetch, (line) => output.push(line));
  assert.match(output[1], /Envoyez \/start/);
});

test("commands configures the chat menu without changing the webhook", async () => {
  const api = mock([
    { ok: true, result: true },
    { ok: true, result: true },
  ]);
  await main(
    "commands",
    { ...env, TELEGRAM_CHAT_ID: "42" },
    api.fetch,
    () => {},
  );
  assert.deepEqual(
    api.calls.map((call) => call.method),
    ["setMyCommands", "setChatMenuButton"],
  );
  assert.deepEqual(api.calls[0].body.scope, { type: "chat", chat_id: "42" });
  assert.ok(
    api.calls[0].body.commands.some((entry) => entry.command === "reset"),
  );
  assert.deepEqual(api.calls[1].body.menu_button, { type: "commands" });
});
