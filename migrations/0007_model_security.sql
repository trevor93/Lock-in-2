-- ============================================================
-- 0007 BOOK 5.6 — per-owner model rate/cost reservations and
-- append-only model audit evidence. No prompts, outputs, keys, or
-- raw upstream errors are stored in either table.
-- ============================================================
-- Production precondition: complete OPERATIONS.md Sections 4 and 5 first.
-- Rollback: deploy the prior application while retaining these additive
-- tables and every row. No user data is deleted; the older application
-- ignores the retained model accounting evidence.

CREATE TABLE IF NOT EXISTS model_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  request_id TEXT NOT NULL UNIQUE
    CHECK (length(request_id) BETWEEN 16 AND 100),
  route TEXT NOT NULL CHECK (
    route IN ('hermes:chat', 'hermes:council', 'intel:analyze')
  ),
  model TEXT NOT NULL CHECK (model = 'gpt-5-mini-2025-08-07'),
  input_chars INTEGER NOT NULL CHECK (input_chars >= 0),
  reserved_tokens INTEGER NOT NULL CHECK (
    reserved_tokens BETWEEN 1 AND 1300
  ),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_model_requests_user_time
  ON model_requests(user_id, created_at DESC);

-- The trigger executes within the reservation INSERT, so concurrent
-- requests cannot pass a read-then-write race. Limits are per owner:
-- 10 requests/minute, 100/day, 2,000/month, 20,000 reserved output
-- tokens/day, and 100,000 reserved output tokens/month.
CREATE TRIGGER IF NOT EXISTS trg_model_requests_budget
BEFORE INSERT ON model_requests
BEGIN
  SELECT RAISE(ABORT, 'MODEL_RATE_LIMIT')
  WHERE (
    SELECT COUNT(*) FROM model_requests
    WHERE user_id=NEW.user_id
      AND unixepoch(created_at) > unixepoch('now') - 60
  ) >= 10;

  SELECT RAISE(ABORT, 'MODEL_DAILY_BUDGET')
  WHERE (
    SELECT COUNT(*) FROM model_requests
    WHERE user_id=NEW.user_id
      AND date(created_at)=date('now')
  ) >= 100
  OR (
    SELECT COALESCE(SUM(reserved_tokens),0) FROM model_requests
    WHERE user_id=NEW.user_id
      AND date(created_at)=date('now')
  ) + NEW.reserved_tokens > 20000;

  SELECT RAISE(ABORT, 'MODEL_MONTHLY_BUDGET')
  WHERE (
    SELECT COUNT(*) FROM model_requests
    WHERE user_id=NEW.user_id
      AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now')
  ) >= 2000
  OR (
    SELECT COALESCE(SUM(reserved_tokens),0) FROM model_requests
    WHERE user_id=NEW.user_id
      AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now')
  ) + NEW.reserved_tokens > 100000;
END;

CREATE TABLE IF NOT EXISTS model_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  route TEXT NOT NULL CHECK (
    route IN ('hermes:chat', 'hermes:council', 'intel:analyze')
  ),
  model TEXT NOT NULL CHECK (model = 'gpt-5-mini-2025-08-07'),
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'accepted', 'succeeded', 'rate_limited', 'daily_budget_denied',
      'monthly_budget_denied', 'offline', 'upstream_error', 'timeout',
      'invalid_output'
    )
  ),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 2),
  input_chars INTEGER NOT NULL DEFAULT 0 CHECK (input_chars >= 0),
  output_chars INTEGER CHECK (output_chars IS NULL OR output_chars >= 0),
  prompt_tokens INTEGER CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
  completion_tokens INTEGER CHECK (
    completion_tokens IS NULL OR completion_tokens >= 0
  ),
  upstream_status INTEGER CHECK (
    upstream_status IS NULL OR upstream_status BETWEEN 100 AND 599
  ),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_model_audit_user_time
  ON model_audit_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_audit_request
  ON model_audit_events(request_id, created_at);

CREATE TRIGGER IF NOT EXISTS trg_model_audit_no_update
BEFORE UPDATE ON model_audit_events
BEGIN
  SELECT RAISE(ABORT, 'MODEL_AUDIT_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS trg_model_audit_no_delete
BEFORE DELETE ON model_audit_events
BEGIN
  SELECT RAISE(ABORT, 'MODEL_AUDIT_APPEND_ONLY');
END;
