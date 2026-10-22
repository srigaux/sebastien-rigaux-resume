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
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO items(id,update_id,chat_id,state,created_at) VALUES(?,?,?,?,?)",
      )
      .bind(id, update, chat, JSON.stringify(state), received)
      .run();
  }
  async clearQueue(chat: string, updateId: number): Promise<number> {
    // A replayed reset cannot remove links received after that command.
    const result = await this.db
      .prepare(
        "UPDATE items SET status='cancelled' WHERE chat_id=? AND active=0 AND status='queued' AND update_id<=? AND COALESCE(json_extract(state,'$.publicationStarted'),0)=0",
      )
      .bind(chat, updateId)
      .run();
    return result.meta.changes;
  }
  async claim(chat: string): Promise<Item | undefined> {
    await this.db
      .prepare(
        `UPDATE items SET active=1 WHERE id=(SELECT id FROM items WHERE chat_id=? AND status='queued' AND active=0 ORDER BY created_at,id LIMIT 1) AND NOT EXISTS(SELECT 1 FROM items WHERE chat_id=? AND active=1)`,
      )
      .bind(chat, chat)
      .run();
    return this.active(chat);
  }
  async finish(item: Item, status: "done" | "cancelled", repository?: string) {
    const statements = [
      this.db
        .prepare("UPDATE items SET state=?,status=?,active=0 WHERE id=?")
        .bind(JSON.stringify(item.state), status, item.id),
    ];
    if (repository)
      statements.push(
        this.db
          .prepare(
            "DELETE FROM publication_lock WHERE repository=? AND item_id=?",
          )
          .bind(repository, item.id),
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
    if (row?.item_id !== id) throw new Error("Publication lock held");
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
      .map((row) => `Fiche ${row.id} (${row.status})`);
  }
}
