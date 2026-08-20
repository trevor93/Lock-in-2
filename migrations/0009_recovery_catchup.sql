-- ============================================================
-- 0009 BOOK 8.2 / 8.6 — Minimum Viable Recovery and the /catchup
-- re-entry protocol. Phase Two of the Book 17 build order: "the observed
-- failure is re-entry and nothing else addresses it."
--
-- Minimum Viable Recovery is the alternative floor to the Minimum Viable Day:
-- on a breach day, the single action that restores agency makes the day count
-- as non-broken. The streak survives — it does not advance. This is survival,
-- never a manufactured victory.
-- ============================================================
-- Production precondition: complete OPERATIONS.md Sections 4 and 5 first.
-- Rollback: deploy the prior application while retaining these additive
-- columns/tables and every row. day_summary.mvr_held defaults to 0, so the
-- older application simply never reads it; no user data is deleted.

-- Additive column: a Minimum Viable Recovery was logged for this day, so the
-- streak survives it (neutral), exactly like mvd_held.
ALTER TABLE day_summary ADD COLUMN mvr_held INTEGER NOT NULL DEFAULT 0;

-- The single restoring action taken on a breach day. Metadata + the operator's
-- own words only; never third-party data.
CREATE TABLE IF NOT EXISTS recovery_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  action_date TEXT NOT NULL,               -- civil date (server-derived)
  action_text TEXT NOT NULL CHECK (length(action_text) BETWEEN 1 AND 500),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- One recovery per owner per day: the floor is a single action, not a tally.
CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_identity
  ON recovery_actions(user_id, action_date);

-- Each /catchup run is recorded so re-entries are visible in pattern analysis.
-- Stores the generated protocol as metadata; carries no punitive content and
-- no third-party data.
CREATE TABLE IF NOT EXISTS catchup_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  triggered_at TEXT NOT NULL DEFAULT (datetime('now')),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'auto_zero_streak')),
  days_absent INTEGER NOT NULL DEFAULT 0 CHECK (days_absent >= 0),
  missed_json TEXT,          -- what was actually missed, without rewriting history
  mechanism TEXT,            -- likely cause drawn from the 8.4 taxonomy
  mvr_prompt TEXT,           -- the minimum viable recovery offered
  structural_patch TEXT,     -- one change to time/environment/cue/scope/support
  keystone_json TEXT,        -- tomorrow's single protected action
  diagnostic_json TEXT,      -- the 5-question re-entry diagnostic (absence > 14d)
  reseat_level INTEGER,      -- ratchet level the diagnostic supports (nullable)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_catchup_user_time
  ON catchup_sessions(user_id, triggered_at DESC);

-- Append-only: a re-entry record is history and cannot be rewritten or erased.
CREATE TRIGGER IF NOT EXISTS trg_catchup_no_update
BEFORE UPDATE ON catchup_sessions
BEGIN
  SELECT RAISE(ABORT, 'CATCHUP_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS trg_catchup_no_delete
BEFORE DELETE ON catchup_sessions
BEGIN
  SELECT RAISE(ABORT, 'CATCHUP_APPEND_ONLY');
END;
