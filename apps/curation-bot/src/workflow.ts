import { errorFields, log, observedSteps, withContext } from "@/observability";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import type { Env, Item } from "@/domain";
import { advance, applyAction, catalog, errorText, stepConfig } from "@/flow";
import { retry, type Steps } from "@/retry";
import { Store } from "@/store";
import {
  present,
  sendText,
  sendActionNotice,
  clearItemButtons,
  publicationNotice,
} from "@/telegram";

export class CurationWorkflow extends WorkflowEntrypoint<
  Env,
  { id: string; generation: number }
> {
  async run(
    event: WorkflowEvent<{ id: string; generation: number }>,
    nativeStep: WorkflowStep,
  ) {
    return withContext(
      {
        itemId: event.payload.id,
        generation: event.payload.generation,
        workflowId: `${event.payload.id}-g${event.payload.generation}`,
        traceId: `${event.payload.id}-g${event.payload.generation}`,
      },
      () => this.execute(event, nativeStep),
    );
  }
  private async execute(
    event: WorkflowEvent<{ id: string; generation: number }>,
    nativeStep: WorkflowStep,
  ) {
    const step = observedSteps(nativeStep as unknown as Steps),
      store = new Store(this.env.DB);
    for (let cycle = 0; cycle < 30; cycle++) {
      const prefix = `g${event.payload.generation}-c${cycle}`;
      const item = await step.do(`${prefix}-load`, stepConfig, () =>
        store.get(event.payload.id),
      );
      if (!item.active || item.generation !== event.payload.generation) return;
      let cats = { topics: [], sources: [] } as Awaited<
        ReturnType<typeof catalog>
      >;
      try {
        cats = await retry(step, `${prefix}-catalog`, () => catalog(this.env));
        await advance(this.env, step, prefix, item, cats);
      } catch (error) {
        item.status = "error";
        item.state.error = errorText(error);
        log(
          "workflow.failed",
          { phase: "advance", ...errorFields(error) },
          "error",
        );
      }
      await step.do(`${prefix}-save`, stepConfig, async () => {
        await store.save(item);
        return true;
      });
      if (item.status === "done" || item.status === "cancelled") {
        await this.finish(step, prefix, item, store);
        return;
      }
      const previewImageKey = await step.do(
        `${prefix}-present`,
        stepConfig,
        async () => {
          log("workflow.state", {
            status: item.status,
            revision: item.state.revision,
          });
          await present(this.env, item, cats);
          return item.state.previewImageKey ?? null;
        },
      );
      // Restore presentation metadata even when this durable step was replayed.
      // Older executions returned true; retain compatibility across deployment.
      if (typeof previewImageKey === "string")
        item.state.previewImageKey = previewImageKey;
      // D1 is the durable inbox. Events only wake the workflow; even if a wakeup
      // races with a deployment or is delivered twice, the action remains in D1.
      let pending = await step.do(`${prefix}-pending`, stepConfig, () =>
        store.nextAction(item.id).then((v) => v ?? null),
      );
      if (!pending)
        log("workflow.waiting", {
          status: item.status,
          revision: item.state.revision,
        });
      for (let wait = 0; !pending && wait < 30; wait++) {
        try {
          await nativeStep.waitForEvent(`${prefix}-wake-${wait}`, {
            type: "input",
            timeout: "1 day",
          });
        } catch {
          /* A human wait expires without approval; check inbox and renew. */
        }
        pending = await step.do(`${prefix}-pending-${wait}`, stepConfig, () =>
          store.nextAction(item.id).then((v) => v ?? null),
        );
      }
      if (!pending) {
        await step.do(`${prefix}-rotate-idle`, stepConfig, async () => {
          await store.rotate(item);
          return true;
        });
        return;
      }
      let accepted = false;
      try {
        log("workflow.action", {
          action: pending.action.kind,
          revision: item.state.revision,
        });
        const message = await applyAction(
          this.env,
          step,
          `${prefix}-action-${pending.id}`,
          item,
          cats,
          pending.action,
        );
        accepted = message === undefined;
        if (message)
          await step.do(`${prefix}-action-notice`, stepConfig, async () => {
            await sendActionNotice(this.env, item, pending!.action, message);
            return true;
          });
      } catch (error) {
        item.status = "error";
        item.state.error = errorText(error);
        log(
          "workflow.failed",
          { phase: "action", ...errorFields(error) },
          "error",
        );
      }
      await step.do(`${prefix}-commit-action`, stepConfig, async () => {
        // Save and consume together: a crash never loses an action nor applies a
        // correction twice. The worker only appends actions; this is sole writer.
        await store.db.batch([
          store.db
            .prepare("UPDATE items SET state=?,status=? WHERE id=?")
            .bind(JSON.stringify(item.state), item.status, item.id),
          store.db
            .prepare("UPDATE actions SET consumed=1 WHERE id=?")
            .bind(pending!.id),
        ]);
        return true;
      });
      if (accepted)
        await step.do(
          `${prefix}-clear-action-buttons`,
          stepConfig,
          async () => {
            await clearItemButtons(this.env, item);
            return true;
          },
        );
      if ((item as Item).status === "cancelled") {
        await this.finish(step, prefix, item, store);
        return;
      }
    }
    await nativeStep.do("continue-workflow", async () => {
      const item = await store.get(event.payload.id);
      await store.rotate(item);
    });
  }
  private async finish(step: Steps, prefix: string, item: Item, store: Store) {
    await step.do(`${prefix}-clear-finished-buttons`, stepConfig, async () => {
      await clearItemButtons(this.env, item);
      return true;
    });
    await step.do(`${prefix}-notify-finished`, stepConfig, async () => {
      log("workflow.finished", {
        status: item.status,
        documentIds: item.state.publishedIds,
      });
      if (item.status === "done") await publicationNotice(this.env, item, true);
      else
        await sendText(
          this.env,
          "🗑️ C’est annulé ! On passe à la suite quand tu veux.",
        );
      return true;
    });
    await step.do(`${prefix}-release-item`, stepConfig, async () => {
      await store.finish(
        item,
        item.status === "done" ? "done" : "cancelled",
        this.env.PRISMIC_REPOSITORY,
      );
      return true;
    });
  }
}
