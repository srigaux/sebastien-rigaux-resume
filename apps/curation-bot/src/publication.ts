import type { Env, Item } from "@/domain";
import { errorFields, log, observe, withContext } from "@/observability";
import { verifyPublication } from "@/prismic";
import { publicationNotice } from "@/telegram";
import { Store } from "@/store";

// Keep ordinary propagation asynchronous, but stop presenting hours of missing
// documents as a normal publication delay. No write is retried by this checker.
export const MAX_PUBLICATION_CHECKS = 5;
export const PUBLICATION_FALLBACK_DELAY_MS = 10 * 60_000;
const RECHECK_DELAYS_MS = [60_000, 120_000, 300_000, 600_000];
function nextCheck(attempts: number, createdAt = 0) {
  return Math.max(
    createdAt + PUBLICATION_FALLBACK_DELAY_MS,
    Date.now() +
      RECHECK_DELAYS_MS[
        Math.min(Math.max(0, attempts - 1), RECHECK_DELAYS_MS.length - 1)
      ],
  );
}

type CheckStatus = "requesting" | "accepted" | "unknown" | "attention";

export async function schedulePublicationCheck(
  env: Env,
  item: Item,
  status: CheckStatus,
) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO publication_checks(item_id,status,created_at,next_check_at)
    VALUES(?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET
    status=CASE WHEN publication_checks.status='confirmed' THEN 'confirmed'
      WHEN publication_checks.status='attention' THEN 'attention'
      WHEN publication_checks.status='accepted' AND excluded.status='requesting' THEN 'accepted'
      ELSE excluded.status END,
    next_check_at=MIN(publication_checks.next_check_at,excluded.next_check_at)`,
  )
    .bind(item.id, status, now, now + PUBLICATION_FALLBACK_DELAY_MS)
    .run();
}

// IDs are checkpointed before requesting publication. Persist the wake-up even
// while the workflow is active: the cron can consume it after the workflow parks.
// The master ref deduplicates deliveries without persisting secrets or payloads.
export async function recordPublicationWebhook(
  env: Env,
  masterRef: string,
  documentIds: string[],
  releaseDeleted: boolean,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE publication_checks SET webhook_ref=?,next_check_at=MIN(next_check_at,?)
     WHERE status IN ('requesting','accepted','unknown') AND webhook_ref IS NOT ?
     AND item_id IN (
       SELECT i.id FROM items i
       WHERE EXISTS (
         SELECT 1 FROM json_each(i.state,'$.publishedIds') ids
         WHERE ids.value IN (SELECT value FROM json_each(?))
       ) OR (?=1 AND EXISTS (
         SELECT 1 FROM publication_lock l WHERE l.repository=? AND l.item_id=i.id
       ))
     )`,
  )
    .bind(
      masterRef,
      Date.now(),
      masterRef,
      JSON.stringify(documentIds),
      releaseDeleted && documentIds.length === 0 ? 1 : 0,
      env.PRISMIC_REPOSITORY,
    )
    .run();
  return result.meta.changes > 0;
}

// One pending release at most: this bounded pass performs no sleeps and no writes
// to Prismic. A lease makes overlapping cron invocations harmless.
export async function reconcilePublications(env: Env) {
  const now = Date.now(),
    store = new Store(env.DB);
  const row = await env.DB.prepare(
    `SELECT p.item_id,p.status,p.attempts,p.created_at FROM publication_checks p
    JOIN items i ON i.id=p.item_id WHERE p.lease_until<=? AND p.next_check_at<=?
    AND ((p.status IN ('requesting','accepted','unknown') AND i.status='publication_pending' AND i.active=0)
      OR (p.status='confirmed' AND p.notified=0))
    ORDER BY CASE WHEN p.status='confirmed' THEN 1 ELSE 0 END,p.created_at,p.item_id LIMIT 1`,
  )
    .bind(now, now)
    .first<{
      item_id: string;
      status: string;
      attempts: number;
      created_at: number;
    }>();
  if (row) {
    const claim = await env.DB.prepare(
      "UPDATE publication_checks SET lease_until=? WHERE item_id=? AND lease_until<=? AND next_check_at<=? AND status=? AND notified=0",
    )
      .bind(now + 120_000, row.item_id, now, now, row.status)
      .run();
    if (claim.meta.changes) {
      let checks = row.attempts;
      try {
        let item = await store.get(row.item_id);
        if (row.status !== "confirmed") {
          // Old deployments may already have exceeded the budget. Do not issue
          // hundreds more reads just because the state survived a deployment.
          if (checks >= MAX_PUBLICATION_CHECKS) {
            await env.DB.prepare(
              "UPDATE publication_checks SET status='attention',lease_until=0 WHERE item_id=?",
            )
              .bind(item.id)
              .run();
            log("publication.attention", { itemId: item.id, checks }, "warn");
            await publicationNotice(env, item, "attention");
            return;
          }
          checks++;
          const available = await withContext({ itemId: item.id }, () =>
            observe(
              "publication.verify",
              { checks, provider: "prismic" },
              () => verifyPublication(env, item),
              { resultFields: (available) => ({ available }) },
            ),
          );
          if (!available) {
            const needsAttention = checks >= MAX_PUBLICATION_CHECKS;
            const nextCheckAt = nextCheck(checks, row.created_at);
            await env.DB.prepare(
              "UPDATE publication_checks SET status=?,attempts=attempts+1,last_error='documents_not_available',next_check_at=?,lease_until=0 WHERE item_id=?",
            )
              .bind(
                needsAttention ? "attention" : row.status,
                nextCheckAt,
                item.id,
              )
              .run();
            if (needsAttention) {
              if (row.status !== "attention")
                log(
                  "publication.attention",
                  {
                    itemId: item.id,
                    checks,
                    pendingMs: Math.max(0, Date.now() - row.created_at),
                  },
                  "warn",
                );
              // Stop remote reads. The user can re-arm this check explicitly
              // after resolving the migration release; no write is replayed.
              await publicationNotice(env, item, "attention");
            }
            log("publication.availability.pending", {
              itemId: item.id,
              checks,
              pendingMs: Math.max(0, Date.now() - row.created_at),
              ...(needsAttention
                ? {}
                : { nextCheckAt: new Date(nextCheckAt).toISOString() }),
            });
          } else {
            await env.DB.batch([
              env.DB.prepare(
                "UPDATE publication_checks SET status='confirmed',attempts=attempts+1,last_error=NULL WHERE item_id=?",
              ).bind(item.id),
              env.DB.prepare(
                "UPDATE items SET status='done',state=json_set(state,'$.publicationRequested',1,'$.publicationUnknown',0) WHERE id=? AND status='publication_pending' AND active=0",
              ).bind(item.id),
              env.DB.prepare(
                "DELETE FROM publication_lock WHERE repository=? AND item_id=?",
              ).bind(env.PRISMIC_REPOSITORY, item.id),
            ]);
            row.status = "confirmed";
            log("publication.availability.confirmed", {
              itemId: item.id,
              checks,
              pendingMs: Math.max(0, Date.now() - row.created_at),
            });
          }
        }
        if (row.status === "confirmed") {
          item = await store.get(row.item_id);
          await publicationNotice(env, item, true);
          await env.DB.prepare(
            "UPDATE publication_checks SET notified=1,lease_until=0,last_error=NULL WHERE item_id=?",
          )
            .bind(item.id)
            .run();
        }
      } catch (error) {
        const fields = errorFields(error);
        const nextCheckAt = nextCheck(
          checks,
          row.status === "confirmed" ? 0 : row.created_at,
        );
        const needsAttention =
          row.status !== "confirmed" && checks >= MAX_PUBLICATION_CHECKS;
        await env.DB.prepare(
          "UPDATE publication_checks SET status=?,attempts=attempts+?,last_error=?,next_check_at=?,lease_until=0 WHERE item_id=?",
        )
          .bind(
            needsAttention ? "attention" : row.status,
            row.status === "confirmed" ? 0 : 1,
            fields.reasonCode ?? fields.errorType ?? "read_failed",
            nextCheckAt,
            row.item_id,
          )
          .run();
        if (needsAttention) {
          log(
            "publication.attention",
            { itemId: row.item_id, checks, ...fields },
            "warn",
          );
          await publicationNotice(
            env,
            await store.get(row.item_id),
            "attention",
          );
        }
        log(
          row.status === "confirmed"
            ? "publication.notification.failed"
            : "publication.availability.failed",
          {
            itemId: row.item_id,
            checks,
            pendingMs: Math.max(0, Date.now() - row.created_at),
            ...(needsAttention
              ? {}
              : { nextCheckAt: new Date(nextCheckAt).toISOString() }),
            ...fields,
          },
          "warn",
        );
      }
    }
  }
  // Wake only an already-approved selection waiting for the publication lock.
  // Human review is never auto-approved by cron.
  const waiting = await store.active(env.TELEGRAM_CHAT_ID);
  if (
    waiting?.status === "waiting_publish_slot" &&
    waiting.state.approvedRevision === waiting.state.revision
  ) {
    const held = await env.DB.prepare(
      "SELECT item_id FROM publication_lock WHERE repository=?",
    )
      .bind(env.PRISMIC_REPOSITORY)
      .first();
    if (!held) {
      await store.addAction(
        -(waiting.update_id * 1000 + waiting.state.revision),
        waiting,
        {
          kind: "resume",
          revision: waiting.state.revision,
        },
      );
    }
  }
}
