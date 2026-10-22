CREATE TABLE items (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  update_id INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  active INTEGER NOT NULL DEFAULT 0,
  generation INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX one_active_per_chat ON items(chat_id) WHERE active = 1;
CREATE INDEX queue_order ON items(chat_id, active, created_at);
CREATE TABLE inbox (
  update_id INTEGER PRIMARY KEY,
  payload TEXT NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL
);
CREATE TABLE actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  update_id INTEGER NOT NULL UNIQUE,
  item_id TEXT NOT NULL REFERENCES items(id),
  payload TEXT NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE messages (
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY(chat_id, message_id)
);
CREATE TABLE operations (
  key TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  target TEXT NOT NULL,
  request TEXT,
  status TEXT NOT NULL,
  response TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE publication_lock (
  repository TEXT PRIMARY KEY,
  item_id TEXT NOT NULL
);
CREATE TABLE cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
