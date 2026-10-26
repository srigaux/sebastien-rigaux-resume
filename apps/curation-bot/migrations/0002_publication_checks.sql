CREATE TABLE publication_checks (
  item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('requesting','accepted','unknown','confirmed','attention')),
  created_at INTEGER NOT NULL,
  next_check_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  notified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX publication_checks_due ON publication_checks(status,next_check_at,lease_until);
