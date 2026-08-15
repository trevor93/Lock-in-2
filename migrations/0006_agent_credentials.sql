-- ============================================================
-- 0006 BOOK 5.5 — scoped, hashed, expiring, revocable agent
-- credentials with coarse request metadata and lifecycle events.
-- ============================================================
-- Production precondition: complete OPERATIONS.md Sections 4 and 5 first.
-- Rollback: deploy the prior application while retaining these additive
-- tables and all rows. The legacy plaintext master token is intentionally
-- erased and must not be restored; agent access remains disabled until
-- the owner issues a new scoped credential. See OPERATIONS.md Section 5.2.

CREATE TABLE IF NOT EXISTS agent_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE
    CHECK (length(token_hash) = 64),
  token_prefix TEXT NOT NULL
    CHECK (length(token_prefix) BETWEEN 12 AND 24),
  device_label TEXT NOT NULL
    CHECK (length(trim(device_label)) BETWEEN 1 AND 100),
  scopes TEXT NOT NULL
    CHECK (json_valid(scopes) AND json_type(scopes) = 'array'),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  last_request_method TEXT,
  last_request_route TEXT,
  last_request_country TEXT,
  last_request_network TEXT,
  rate_window_started_at TEXT,
  rate_window_count INTEGER NOT NULL DEFAULT 0
    CHECK (rate_window_count >= 0),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_credentials_user_active
  ON agent_credentials(user_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS agent_credential_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  credential_id INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'issued', 'used', 'revoked', 'scope_denied', 'rate_limited'
    )
  ),
  request_method TEXT,
  request_route TEXT,
  request_country TEXT,
  request_network TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (credential_id) REFERENCES agent_credentials(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_credential_events_user_time
  ON agent_credential_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_credential_events_credential_time
  ON agent_credential_events(credential_id, created_at DESC);

-- A legacy master token cannot be safely migrated because SQLite has no
-- compatible one-way digest function here. Erase it without deleting the
-- settings row; the owner issues replacement credentials after rollout.
UPDATE settings
SET value=''
WHERE key='agent_token';
