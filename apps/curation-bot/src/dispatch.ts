import { log } from "@/observability";
import type { Env } from "@/domain";
import { Store } from "@/store";

// Shared by webhook/cron dispatch and the workflow's durable queue handoff.
export async function dispatchQueue(env: Env) {
  const store = new Store(env.DB),
    item = await store.claim(env.TELEGRAM_CHAT_ID);
  if (!item) return;
  const id = `${item.id}-g${item.generation}`;
  let instance: WorkflowInstance | undefined;
  let created = false;
  try {
    instance = await env.CURATION.get(id);
    await instance.status();
  } catch {
    log("workflow.create", {
      itemId: item.id,
      workflowId: id,
      generation: item.generation,
      ...(item.generation === 0
        ? { queueWaitMs: Math.max(0, Date.now() - Date.parse(item.created_at)) }
        : {}),
    });
    try {
      instance = await env.CURATION.create({
        id,
        params: { id: item.id, generation: item.generation },
      });
      created = true;
    } catch (error) {
      instance = await env.CURATION.get(id);
      await instance.status();
    }
  }
  const status = await instance.status();
  if (
    !created &&
    !item.state.publicationStarted &&
    (await store.pendingCancellation(item))
  ) {
    // A wake event cannot interrupt step.sleep (e.g. a long Retry-After).
    // Stop the old generation before reading its last publication checkpoint.
    if (!["errored", "terminated", "complete"].includes(status.status)) {
      try {
        await instance.terminate();
      } catch (error) {
        const latest = await instance.status();
        if (!["errored", "terminated", "complete"].includes(latest.status))
          throw error;
      }
    }
    const stopped = await store.get(item.id);
    if (!stopped.active || stopped.generation !== item.generation) return;
    await store.rotate(stopped);
    const next = await store.get(item.id);
    if (!next.active) return;
    const nextId = `${next.id}-g${next.generation}`;
    log("workflow.cancel_interrupt", {
      itemId: next.id,
      workflowId: id,
      nextWorkflowId: nextId,
      publicationStarted: !!next.state.publicationStarted,
    });
    try {
      await env.CURATION.create({
        id: nextId,
        params: { id: next.id, generation: next.generation },
      });
    } catch (error) {
      // Concurrent cron/webhook dispatches may already have created it.
      const existing = await env.CURATION.get(nextId);
      await existing.status();
    }
    return;
  }
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
  // Also wake workflows from older deployments which were already waiting
  // on an input event when their publication slot became blocked.
  if (
    item.status === "waiting_publish_slot" &&
    !item.state.publicationStarted &&
    item.state.approvedRevision === item.state.revision
  ) {
    await store.addAction(
      -(item.update_id * 1000 + item.state.revision),
      item,
      { kind: "resume", revision: item.state.revision },
    );
  }
  if (await store.nextAction(item.id))
    await instance.sendEvent({ type: "input", payload: { id: item.id } });
}
