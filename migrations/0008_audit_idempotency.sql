-- ============================================================
-- 0008 BOOK 5.7 — append-only audit events and delivery idempotency.
--
-- audit_events uses the exact column set specified in MASTERPROMPT.md
-- Book 5.7: no column is added, renamed, or removed. It stores metadata
-- and before/after state only — never tokens, passwords, hashes, or keys.
--
-- idempotency_keys is the delivery arbiter. State-machine idempotency
-- (window-closed 409s, unit step gates, UNIQUE flag identity) already
-- exists; this table closes the separate gap where the SAME request
-- delivered twice — a bridge retry after a network failure, a
-- double-tapped button — would apply a consequence twice.
-- ============================================================
-- Production precondition: complete OPERATIONS.md Sections 4 and 5 first.
-- Rollback: deploy the prior application while retaining these additive
-- tables and every row. No user data is deleted; the older application
-- ignores the retained audit and idempotency evidence. Because both
-- tables are additive and no existing table is altered, the previous
-- application runs unchanged against this schema.

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  actor_type TEXT NOT NULL,      -- 'user' | 'agent' | 'cron' | 'system'
  actor_id TEXT,
  request_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_user_time
  ON audit_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity
  ON audit_events(entity_type, entity_id);

-- Append-only: the record of what happened cannot be edited or erased,
-- including by the application itself.
CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_APPEND_ONLY');
END;

-- Only these actor types may be recorded. Enforced in the database so a
-- future caller cannot invent an unaudited actor class.
CREATE TRIGGER IF NOT EXISTS trg_audit_actor_type
BEFORE INSERT ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_ACTOR_TYPE')
  WHERE NEW.actor_type NOT IN ('user', 'agent', 'cron', 'system');
END;

-- ------------------------------------------------------------
-- Delivery idempotency
-- ------------------------------------------------------------
-- scope      = the consequence class ('intel:file', 'reward:redeem', ...)
-- request_id = caller-supplied identity of the user intent, reused on retry
-- response_json = the first response, replayed verbatim on redelivery
--
-- UNIQUE(user_id, scope, request_id) is the atomic arbiter: the INSERT
-- either lands (first delivery, do the work) or reports zero changes
-- (redelivery, replay the stored response). No read-then-write race.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  scope TEXT NOT NULL CHECK (length(scope) BETWEEN 1 AND 64),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 200),
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'complete')),
  response_status INTEGER
    CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
  response_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_identity
  ON idempotency_keys(user_id, scope, request_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_user_time
  ON idempotency_keys(user_id, created_at DESC);
