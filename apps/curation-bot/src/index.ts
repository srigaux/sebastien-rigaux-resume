import { errorFields, log, observe, withContext } from "@/observability";
import type { Update } from "grammy/types";
import type { Env } from "@/domain";
import { handleUpdate } from "@/telegram";
import { Store } from "@/store";
export { CurationWorkflow } from "@/workflow";

export async function drainInbox(env: Env) {
  const rows = await env.DB.prepare(
    "SELECT update_id,payload FROM inbox WHERE processed=0 AND lease_until<? ORDER BY update_id LIMIT 20",
  )
    .bind(Date.now())
    .all<{ update_id: number; payload: string }>();
  for (const row of rows.results) {
    const lease = await env.DB.prepare(
      "UPDATE inbox SET lease_until=? WHERE update_id=? AND processed=0 AND lease_until<?",
    )
      .bind(Date.now() + 120_000, row.update_id, Date.now())
      .run();
    if (!lease.meta.changes) continue;
    try {
      await withContext({ updateId: row.update_id }, () =>
        observe("telegram.update", {}, () =>
          handleUpdate(env, JSON.parse(row.payload) as Update),
        ),
      );
      await env.DB.prepare("UPDATE inbox SET processed=1 WHERE update_id=?")
        .bind(row.update_id)
        .run();
    } catch (error) {
      log(
        "inbox.failed",
        { updateId: row.update_id, ...errorFields(error) },
        "error",
      );
      // The lease expires and the cron retries. Inserts/actions are idempotent.
      break;
    }
  }
}
export async function dispatch(env: Env) {
  await drainInbox(env);
  const store = new Store(env.DB),
    item = await store.claim(env.TELEGRAM_CHAT_ID);
  if (!item) return;
  const id = `${item.id}-g${item.generation}`;
  let instance: WorkflowInstance | undefined;
  try {
    instance = await env.CURATION.get(id);
    await instance.status();
  } catch {
    log("workflow.create", {
      itemId: item.id,
      workflowId: id,
      generation: item.generation,
    });
    instance = await env.CURATION.create({
      id,
      params: { id: item.id, generation: item.generation },
    });
  }
  const status = await instance.status();
  if (["errored", "terminated", "complete"].includes(status.status)) {
    // An unexpected workflow failure/notification error is recoverable from the
    // journal and item checkpoints. No external write bypasses that journal.
    log(
      "workflow.recover",
      { itemId: item.id, workflowId: id, status: status.status },
      "warn",
    );
    await store.rotate(item);
    return;
  }
  if (await store.nextAction(item.id))
    await instance.sendEvent({ type: "input", payload: { id: item.id } });
}
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET")
      return Response.json({ ok: true });
    if (path !== "/telegram" || request.method !== "POST")
      return new Response("Not found", { status: 404 });
    if (
      !env.TELEGRAM_WEBHOOK_SECRET ||
      request.headers.get("X-Telegram-Bot-Api-Secret-Token") !==
        env.TELEGRAM_WEBHOOK_SECRET
    )
      return new Response("Unauthorized", { status: 401 });
    const length = Number(request.headers.get("content-length"));
    if (length > 64_000) return new Response("Too large", { status: 413 });
    const body = await request.text();
    if (body.length > 64_000) return new Response("Too large", { status: 413 });
    let update: Update;
    try {
      update = JSON.parse(body);
      if (!Number.isSafeInteger(update.update_id)) throw new Error();
    } catch {
      return new Response("Invalid update", { status: 400 });
    }
    const sender =
      "message" in update
        ? update.message?.from?.id
        : "callback_query" in update
          ? update.callback_query?.from.id
          : undefined;
    const chat =
      "message" in update
        ? update.message?.chat
        : "callback_query" in update
          ? update.callback_query?.message?.chat
          : undefined;
    if (
      String(sender) !== env.TELEGRAM_USER_ID ||
      String(chat?.id) !== env.TELEGRAM_CHAT_ID ||
      chat?.type !== "private"
    )
      return new Response("OK");
    const traceId = crypto.randomUUID();
    log("telegram.accepted", {
      traceId,
      updateId: update.update_id,
      updateType: "message" in update ? "message" : "callback_query",
    });
    await env.DB.prepare(
      "INSERT OR IGNORE INTO inbox(update_id,payload,received_at) VALUES(?,?,?)",
    )
      .bind(update.update_id, body, new Date().toISOString())
      .run();
    ctx.waitUntil(
      withContext({ updateId: update.update_id, traceId }, () =>
        observe("dispatch", {}, () => dispatch(env)).catch((error) =>
          log("dispatch.failed", errorFields(error), "error"),
        ),
      ),
    );
    return new Response("OK");
  },
  async scheduled(_event: ScheduledController, env: Env) {
    await observe("scheduled.dispatch", {}, () => dispatch(env));
  },
} satisfies ExportedHandler<Env>;
