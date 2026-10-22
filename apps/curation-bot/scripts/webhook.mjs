import { pathToFileURL } from "node:url";

export async function main(
  action = "register",
  env = process.env,
  fetcher = fetch,
  log = console.log,
) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing in .dev.vars");
  async function api(method, body) {
    const response = await fetcher(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const data = await response.json();
    if (!data.ok)
      throw new Error(
        `Telegram ${method} failed (${data.error_code}): ${String(data.description ?? "Unknown error").replaceAll(token, "[redacted]")}${data.error_code === 409 ? "\nArrêtez tout autre programme utilisant getUpdates. Si un webhook est actif, consultez la commande info ; unregister permet de le retirer explicitement en conservant les messages en attente." : ""}`,
      );
    return data.result;
  }
  if (action === "identity") {
    const webhook = await api("getWebhookInfo");
    if (webhook.url)
      throw new Error(
        "Un webhook est déjà actif : Telegram interdit getUpdates dans ce mode.\nPour transférer ce bot à cette application : exécutez pnpm telegram:webhook unregister, envoyez /start au bot, puis relancez identity. Réenregistrez ensuite le webhook avec register. Aucun webhook n’a été modifié.",
      );
    const updates = await api("getUpdates", {
      allowed_updates: ["message", "callback_query"],
      limit: 100,
    });
    const identities = new Map();
    for (const update of updates)
      if (update.message?.chat.type === "private")
        identities.set(update.message.chat.id, {
          userId: update.message.from.id,
          chatId: update.message.chat.id,
        });
    log(JSON.stringify([...identities.values()], null, 2));
    if (!identities.size)
      log(
        "Aucun message privé en attente. Envoyez /start au bot dans Telegram, puis relancez identity.",
      );
  } else if (action === "info") {
    const result = await api("getWebhookInfo");
    log(
      JSON.stringify(
        {
          url: result.url,
          pendingUpdates: result.pending_update_count,
          lastError: result.last_error_message,
        },
        null,
        2,
      ),
    );
  } else if (action === "unregister") {
    await api("deleteWebhook", { drop_pending_updates: false });
    log(
      "Webhook retiré ; messages en attente conservés. Envoyez /start au bot, lancez identity, puis register pour réactiver la réception.",
    );
  } else if (action === "register") {
    const url = new URL("/telegram", env.PUBLIC_BOT_URL);
    if (url.protocol !== "https:" || !env.TELEGRAM_WEBHOOK_SECRET)
      throw new Error(
        "Set an HTTPS PUBLIC_BOT_URL and TELEGRAM_WEBHOOK_SECRET.",
      );
    await api("setWebhook", {
      url: url.href,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    });
    log("Webhook registered.");
  } else
    throw new Error("Usage: webhook.mjs [identity|info|register|unregister]");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv[2]).catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Telegram command failed.",
    );
    process.exitCode = 1;
  });
}
