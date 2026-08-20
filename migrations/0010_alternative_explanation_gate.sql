-- ============================================================
-- 0010 BOOK 13.2 — the alternative-explanation gate (the brake).
-- Phase Three of the Book 17 build order: "every day the pattern engine runs
-- without a brake trains the wrong instinct."
--
-- alternative_explanation is a REQUIRED, non-empty field on every capture whose
-- heat is not calm (and, as later phases land, on every decision and every
-- pattern output that attributes intent to a person). "None plausible" is a
-- legal value, but it is logged and COUNTED — a rising count is the paranoia
-- tell, and the operator must be able to see it. Law 23 is enforced HERE in
-- schema, not in advice.
-- ============================================================
-- Production precondition: complete OPERATIONS.md Sections 4 and 5 first.
-- Rollback: deploy the prior application while retaining these additive
-- columns/tables and every row. The added columns are nullable and the older
-- application ignores them; no user data is deleted.

-- Capture heat and its required brake. Both nullable so historical rows and
-- plain intel entries (no heat) are unaffected.
ALTER TABLE intel_entries ADD COLUMN heat TEXT;
ALTER TABLE intel_entries ADD COLUMN alternative_explanation TEXT;

-- The counted ledger. Every gated write records one row; none_plausible is the
-- paranoia tell the operator watches. Append-only: a brake record is evidence.
CREATE TABLE IF NOT EXISTS alternative_explanations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,          -- 'capture' | 'decision' | 'pattern'
  entity_id TEXT,
  heat TEXT,
  text TEXT NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 2000),
  none_plausible INTEGER NOT NULL DEFAULT 0 CHECK (none_plausible IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_alt_expl_user_time
  ON alternative_explanations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alt_expl_none
  ON alternative_explanations(user_id, none_plausible);

CREATE TRIGGER IF NOT EXISTS trg_alt_expl_no_update
BEFORE UPDATE ON alternative_explanations
BEGIN
  SELECT RAISE(ABORT, 'ALT_EXPLANATION_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS trg_alt_expl_no_delete
BEFORE DELETE ON alternative_explanations
BEGIN
  SELECT RAISE(ABORT, 'ALT_EXPLANATION_APPEND_ONLY');
END;

-- The gate, in schema. A capture whose heat is anything other than calm cannot
-- be written without a non-empty alternative_explanation. This is the brake
-- Law 23 requires — a machine constraint, not a suggestion.
CREATE TRIGGER IF NOT EXISTS trg_intel_alt_gate_insert
BEFORE INSERT ON intel_entries
WHEN NEW.heat IS NOT NULL AND NEW.heat <> 'calm'
     AND (NEW.alternative_explanation IS NULL OR length(trim(NEW.alternative_explanation)) = 0)
BEGIN
  SELECT RAISE(ABORT, 'ALT_EXPLANATION_REQUIRED');
END;

CREATE TRIGGER IF NOT EXISTS trg_intel_alt_gate_update
BEFORE UPDATE ON intel_entries
WHEN NEW.heat IS NOT NULL AND NEW.heat <> 'calm'
     AND (NEW.alternative_explanation IS NULL OR length(trim(NEW.alternative_explanation)) = 0)
BEGIN
  SELECT RAISE(ABORT, 'ALT_EXPLANATION_REQUIRED');
END;
