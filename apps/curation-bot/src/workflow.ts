import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import type { Env, Item } from "@/domain";
import { advance, applyAction, catalog, errorText, stepConfig } from "@/flow";
import { retry, type Steps } from "@/retry";
import { Store } from "@/store";
import { present, sendText } from "@/telegram";

export class CurationWorkflow extends WorkflowEntrypoint<
  Env,
  { id: string; generation: number }
> {
  async run(
    event: WorkflowEvent<{ id: string; generation: number }>,
    nativeStep: WorkflowStep,
  ) {
    const step = nativeStep as unknown as Steps,
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
        console.error(
          JSON.stringify({
            item: item.id,
            phase: "advance",
            message: errorText(error),
            error: error instanceof Error ? error.name : "UnknownError",
          }),
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
      await step.do(`${prefix}-present`, stepConfig, async () => {
        await present(this.env, item, cats);
        return true;
      });
      // D1 is the durable inbox. Events only wake the workflow; even if a wakeup
      // races with a deployment or is delivered twice, the action remains in D1.
      let pending = await step.do(`${prefix}-pending`, stepConfig, () =>
        store.nextAction(item.id).then((v) => v ?? null),
      );
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
      try {
        const message = await applyAction(
          this.env,
          step,
          `${prefix}-action-${pending.id}`,
          item,
          cats,
          pending.action,
        );
        if (message)
          await step.do(`${prefix}-action-notice`, stepConfig, async () => {
            await sendText(this.env, message);
            return true;
          });
      } catch (error) {
        item.status = "error";
        item.state.error = errorText(error);
        console.error(
          JSON.stringify({
            item: item.id,
            phase: "action",
            message: errorText(error),
            error: error instanceof Error ? error.name : "UnknownError",
          }),
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
    await step.do(`${prefix}-notify-finished`, stepConfig, async () => {
      await sendText(
        this.env,
        item.status === "done"
          ? `Fiche ${item.id} : FR et EN publiés et liés dans Prismic.\nDocuments : ${item.state.publishedIds?.join(", ")}\nLe site apparaîtra après sa prochaine reconstruction.`
          : `Fiche ${item.id} annulée.`,
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
