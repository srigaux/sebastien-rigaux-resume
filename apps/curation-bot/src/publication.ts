import type { Env, Item } from "@/domain";
import { errorFields, log } from "@/observability";
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
    `SELECT p.item_id,p.status FROM publication_checks p
    JOIN items i ON i.id=p.item_id WHERE p.lease_until<=? AND p.next_check_at<=?
    AND ((p.status IN ('requesting','accepted','unknown') AND i.status='publication_pending' AND i.active=0)
      OR (p.status='confirmed' AND p.notified=0))
    ORDER BY CASE WHEN p.status='confirmed' THEN 1 ELSE 0 END,p.created_at,p.item_id LIMIT 1`,
  )
    .bind(now, now)
    .first<{ item_id: string; status: string }>();
  if (row) {
    const claim = await env.DB.prepare(
      "UPDATE publication_checks SET lease_until=? WHERE item_id=? AND lease_until<=? AND next_check_at<=? AND status=? AND notified=0",
    )
      .bind(now + 120_000, row.item_id, now, now, row.status)
      .run();
    if (claim.meta.changes) {
      try {
        let item = await store.get(row.item_id);
        if (row.status !== "confirmed") {
          const available = await verifyPublication(env, item);
          if (!available) {
            await env.DB.prepare(
              "UPDATE publication_checks SET attempts=attempts+1,last_error='documents_not_available',next_check_at=?,lease_until=0 WHERE item_id=?",
            )
              .bind((Math.floor(Date.now() / 60_000) + 1) * 60_000, item.id)
              .run();
            log("publication.availability.pending", { itemId: item.id });
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
            log("publication.availability.confirmed", { itemId: item.id });
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
        await env.DB.prepare(
          "UPDATE publication_checks SET attempts=attempts+1,last_error=?,next_check_at=?,lease_until=0 WHERE item_id=?",
        )
          .bind(
            fields.errorType ?? "read_failed",
            (Math.floor(Date.now() / 60_000) + 1) * 60_000,
            row.item_id,
          )
          .run();
        log(
          "publication.availability.failed",
          { itemId: row.item_id, ...fields },
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
