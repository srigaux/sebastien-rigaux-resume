import type { Env, Item } from "@/domain";
import { errorFields, log, observe, withContext } from "@/observability";
import { verifyPublication } from "@/prismic";
import { publicationNotice } from "@/telegram";
import { Store } from "@/store";

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
      WHEN publication_checks.status='accepted' AND excluded.status='requesting' THEN 'accepted'
      ELSE excluded.status END,
    next_check_at=MIN(publication_checks.next_check_at,excluded.next_check_at)`,
  )
    .bind(item.id, status, now, now)
    .run();
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
            const nextCheckAt = (Math.floor(Date.now() / 60_000) + 1) * 60_000;
            await env.DB.prepare(
              "UPDATE publication_checks SET attempts=attempts+1,last_error='documents_not_available',next_check_at=?,lease_until=0 WHERE item_id=?",
            )
              .bind(nextCheckAt, item.id)
              .run();
            log("publication.availability.pending", {
              itemId: item.id,
              checks,
              pendingMs: Math.max(0, Date.now() - row.created_at),
              nextCheckAt: new Date(nextCheckAt).toISOString(),
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
        const nextCheckAt = (Math.floor(Date.now() / 60_000) + 1) * 60_000;
        await env.DB.prepare(
          "UPDATE publication_checks SET attempts=attempts+?,last_error=?,next_check_at=?,lease_until=0 WHERE item_id=?",
        )
          .bind(
            row.status === "confirmed" ? 0 : 1,
            fields.reasonCode ?? fields.errorType ?? "read_failed",
            nextCheckAt,
            row.item_id,
          )
          .run();
        log(
          row.status === "confirmed"
            ? "publication.notification.failed"
            : "publication.availability.failed",
          {
            itemId: row.item_id,
            checks,
            pendingMs: Math.max(0, Date.now() - row.created_at),
            nextCheckAt: new Date(nextCheckAt).toISOString(),
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
