import type { Action, Item, Stage, State } from "@/domain";

export class Store {
  constructor(readonly db: D1Database) {}
  async get(id: string): Promise<Item> {
    const row = await this.db
      .prepare("SELECT * FROM items WHERE id=?")
      .bind(id)
      .first<Omit<Item, "state"> & { state: string }>();
    if (!row) throw new Error("Unknown item");
    return { ...row, state: JSON.parse(row.state) };
  }
  async active(chat: string) {
    const row = await this.db
      .prepare("SELECT id FROM items WHERE chat_id=? AND active=1")
      .bind(chat)
      .first<{ id: string }>();
    return row ? this.get(row.id) : undefined;
  }
  async save(item: Item, status: Stage = item.status) {
    await this.db
      .prepare("UPDATE items SET state=?,status=? WHERE id=?")
      .bind(JSON.stringify(item.state), status, item.id)
      .run();
    item.status = status;
  }
  async enqueue(
    id: string,
    update: number,
    chat: string,
    state: State,
    received: string,
  ) {
    const result = await this.db
      .prepare(
        "INSERT OR IGNORE INTO items(id,update_id,chat_id,state,created_at) VALUES(?,?,?,?,?)",
      )
      .bind(id, update, chat, JSON.stringify(state), received)
      .run();
    return result.meta.changes > 0;
  }
  async clearQueue(chat: string, updateId: number): Promise<number> {
    // A replayed reset cannot remove links received after that command.
    const result = await this.db
      .prepare(
        "UPDATE items SET status='cancelled' WHERE chat_id=? AND active=0 AND status IN ('queued','waiting_publish_slot') AND update_id<=? AND COALESCE(json_extract(state,'$.publicationStarted'),0)=0",
      )
      .bind(chat, updateId)
      .run();
    return result.meta.changes;
  }
  async claim(chat: string): Promise<Item | undefined> {
    await this.db
      .prepare(
        `UPDATE items SET active=1,
          generation=generation+CASE WHEN status='waiting_publish_slot' THEN 1 ELSE 0 END,status='queued'
          WHERE id=(SELECT id FROM items WHERE chat_id=? AND active=0 AND
            (status='queued' OR (status='waiting_publish_slot'
              AND json_extract(state,'$.approvedRevision')=json_extract(state,'$.revision')
              AND COALESCE(json_extract(state,'$.publicationStarted'),0)=0
              AND NOT EXISTS(SELECT 1 FROM publication_lock)))
            ORDER BY CASE WHEN status='waiting_publish_slot' THEN 0 ELSE 1 END,created_at,id LIMIT 1)
          AND NOT EXISTS(SELECT 1 FROM items WHERE chat_id=? AND active=1)`,
      )
      .bind(chat, chat)
      .run();
    return this.active(chat);
  }
  async parkPublication(item: Item) {
    return this.db
      .prepare(
        "UPDATE items SET active=0 WHERE id=? AND active=1 AND generation=? AND ((status='waiting_publish_slot' AND COALESCE(json_extract(state,'$.publicationStarted'),0)=0 AND json_extract(state,'$.approvedRevision')=json_extract(state,'$.revision')) OR (status='error' AND json_extract(state,'$.publicationStarted')=1))",
      )
      .bind(item.id, item.generation)
      .run();
  }
  async resumeParkedPublication(chat: string, id: string) {
    const row = await this.db
      .prepare(
        "SELECT id FROM items WHERE id=? AND chat_id=? AND active=0 AND status='error' AND json_extract(state,'$.publicationStarted')=1",
      )
      .bind(id, chat)
      .first();
    if (!row) return undefined;
    const result = await this.db
      .prepare(
        "UPDATE items SET status='queued',generation=generation+1 WHERE id=? AND chat_id=? AND active=0 AND status='error' AND NOT EXISTS(SELECT 1 FROM operations WHERE item_id=? AND status='pending' AND target LIKE '%prismic.io%')",
      )
      .bind(id, chat, id)
      .run();
    return result.meta.changes ? ("queued" as const) : ("blocked" as const);
  }
  async cancelParked(chat: string, id: string, revision?: number) {
    const result = await this.db
      .prepare(
        "UPDATE items SET status='cancelled',generation=generation+1 WHERE id=? AND chat_id=? AND active=0 AND status='waiting_publish_slot' AND COALESCE(json_extract(state,'$.publicationStarted'),0)=0 AND (? IS NULL OR json_extract(state,'$.revision')=?)",
      )
      .bind(id, chat, revision ?? null, revision ?? null)
      .run();
    return result.meta.changes > 0;
  }
  async finish(
    item: Item,
    status: "done" | "cancelled" | "publication_pending",
    repository?: string,
  ) {
    const statements = [
      this.db
        .prepare(
          "UPDATE items SET state=?,status=?,active=0 WHERE id=? AND NOT(status='done' AND ?='publication_pending')",
        )
        .bind(JSON.stringify(item.state), status, item.id, status),
    ];
    if (repository && status !== "publication_pending")
      statements.push(
        this.db
          .prepare(
            "DELETE FROM publication_lock WHERE repository=? AND item_id=?",
          )
          .bind(repository, item.id),
      );
    statements.push(
      this.db
        .prepare("UPDATE actions SET consumed=1 WHERE item_id=? AND consumed=0")
        .bind(item.id),
    );
    await this.db.batch(statements);
    item.status = status;
  }
  async rotate(item: Item) {
    await this.db
      .prepare(
        "UPDATE items SET generation=generation+1 WHERE id=? AND generation=?",
      )
      .bind(item.id, item.generation)
      .run();
  }
  async addAction(update: number, item: Item, action: Action) {
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO actions(update_id,item_id,payload) VALUES(?,?,?)",
      )
      .bind(update, item.id, JSON.stringify(action))
      .run();
  }
  async resumePublicationCheck(chat: string, id?: string) {
    const row = await this.db
      .prepare(
        `SELECT p.item_id,p.status FROM publication_checks p JOIN items i ON i.id=p.item_id
       WHERE i.chat_id=? AND i.status='publication_pending' AND i.active=0
       AND p.status IN ('requesting','accepted','unknown','attention') AND (? IS NULL OR i.id=?)
       AND (? IS NOT NULL OR p.status='attention')
       ORDER BY CASE WHEN p.status='attention' THEN 0 ELSE 1 END,p.created_at LIMIT 1`,
      )
      .bind(chat, id ?? null, id ?? null, id ?? null)
      .first<{ item_id: string; status: string }>();
    if (!row) return undefined;
    const result = await this.db
      .prepare(
        `UPDATE publication_checks SET status=CASE WHEN status='attention' THEN 'unknown' ELSE status END,
       attempts=CASE WHEN status='attention' THEN 0 ELSE attempts END,next_check_at=0,notified=0
       WHERE item_id=? AND status=? AND lease_until<=?`,
      )
      .bind(row.item_id, row.status, Date.now())
      .run();
    return { id: row.item_id, scheduled: result.meta.changes > 0 };
  }
  async pendingCancellation(item: Item) {
    const row = await this.db
      .prepare(
        "SELECT id,payload FROM actions WHERE item_id=? AND consumed=0 AND json_extract(payload,'$.kind')='cancel' AND json_extract(payload,'$.revision')=? ORDER BY id LIMIT 1",
      )
      .bind(item.id, item.state.revision)
      .first<{ id: number; payload: string }>();
    return row
      ? { id: row.id, action: JSON.parse(row.payload) as Action }
      : undefined;
  }
  async nextAction(
    id: string,
  ): Promise<{ id: number; action: Action } | undefined> {
    const row = await this.db
      .prepare(
        "SELECT id,payload FROM actions WHERE item_id=? AND consumed=0 ORDER BY id LIMIT 1",
      )
      .bind(id)
      .first<{ id: number; payload: string }>();
    return row ? { id: row.id, action: JSON.parse(row.payload) } : undefined;
  }
  async consume(id: number) {
    await this.db
      .prepare("UPDATE actions SET consumed=1 WHERE id=?")
      .bind(id)
      .run();
  }
  async lock(repo: string, id: string) {
    if (!(await this.tryLock(repo, id)))
      throw new Error("Publication lock held");
  }
  async tryLock(repo: string, id: string): Promise<boolean> {
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO publication_lock(repository,item_id) VALUES(?,?)",
      )
      .bind(repo, id)
      .run();
    const row = await this.db
      .prepare("SELECT item_id FROM publication_lock WHERE repository=?")
      .bind(repo)
      .first<{ item_id: string }>();
    return row?.item_id === id;
  }
  async unlock(repo: string, id: string) {
    await this.db
      .prepare("DELETE FROM publication_lock WHERE repository=? AND item_id=?")
      .bind(repo, id)
      .run();
  }
  async operation(key: string) {
    return this.db
      .prepare("SELECT status,response FROM operations WHERE key=?")
      .bind(key)
      .first<{ status: string; response: string | null }>();
  }
  async begin(key: string, id: string, target = "", request: unknown = null) {
    return this.db
      .prepare(
        "INSERT OR IGNORE INTO operations(key,item_id,target,request,status,updated_at) VALUES(?,?,?,?,'pending',?)",
      )
      .bind(key, id, target, JSON.stringify(request), new Date().toISOString())
      .run();
  }
  async completed(key: string, response: unknown, status = "done") {
    await this.db
      .prepare(
        "UPDATE operations SET status=?,response=?,updated_at=? WHERE key=?",
      )
      .bind(status, JSON.stringify(response), new Date().toISOString(), key)
      .run();
  }
  async cache<T>(key: string): Promise<T | undefined> {
    const row = await this.db
      .prepare("SELECT value FROM cache WHERE key=? AND expires_at>?")
      .bind(key, Date.now())
      .first<{ value: string }>();
    return row ? JSON.parse(row.value) : undefined;
  }
  async putCache(key: string, value: unknown, ttl: number) {
    await this.db
      .prepare(
        "INSERT OR REPLACE INTO cache(key,value,expires_at) VALUES(?,?,?)",
      )
      .bind(key, JSON.stringify(value), Date.now() + ttl)
      .run();
  }
  async duplicates(item: Item, url: string) {
    const { normalizeUrl } = await import("@/domain");
    const key = normalizeUrl(url);
    const rows = await this.db
      .prepare(
        "SELECT id,state,status FROM items WHERE id<>? AND status<>'cancelled'",
      )
      .bind(item.id)
      .all<{ id: string; state: string; status: string }>();
    return rows.results
      .filter((row) => {
        const s = JSON.parse(row.state) as State;
        return [s.url, ...(s.checked ?? [])].some(
          (u) => normalizeUrl(u) === key,
        );
      })
      .map((row) => {
        const state = JSON.parse(row.state) as State;
        return {
          title: `${row.status === "done" ? "Déjà sélectionné" : "Déjà dans ta file"} : ${state.draft?.fr.title ?? state.url}`,
        };
      });
  }
}
