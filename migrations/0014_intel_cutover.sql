-- Book 7 table unification — intel cutover (captures becomes the intel store).
--
-- After 0012 backfilled every intel entry into captures(kind='intel'), this
-- migration re-establishes the Law-23 alternative-explanation brake ON captures,
-- so the gate keeps holding once the routes read/write intel through captures.
-- The 0010 triggers live on intel_entries; captures needs its own kind-scoped
-- copies. intel_entries has NO incoming foreign keys, so (unlike maxims/flashcards)
-- no table is recreated — intel_entries is simply frozen (never written) and kept,
-- along with its own triggers, as a backup.
--
-- ROLLBACK (manual): DROP the two captures triggers below and redeploy the prior
-- application (which reads/writes intel_entries, whose rows and triggers are
-- untouched). No user data is destroyed by applying or rolling back.

-- Law 23, enforced in schema on the unified table: a non-calm intel capture may
-- not be written without a non-empty alternative_explanation.
CREATE TRIGGER IF NOT EXISTS trg_captures_alt_gate_insert
BEFORE INSERT ON captures
WHEN NEW.kind = 'intel' AND NEW.heat IS NOT NULL AND NEW.heat <> 'calm'
     AND (NEW.alternative_explanation IS NULL OR length(trim(NEW.alternative_explanation)) = 0)
BEGIN
  SELECT RAISE(ABORT, 'ALT_EXPLANATION_REQUIRED');
END;

CREATE TRIGGER IF NOT EXISTS trg_captures_alt_gate_update
BEFORE UPDATE ON captures
WHEN NEW.kind = 'intel' AND NEW.heat IS NOT NULL AND NEW.heat <> 'calm'
     AND (NEW.alternative_explanation IS NULL OR length(trim(NEW.alternative_explanation)) = 0)
BEGIN
  SELECT RAISE(ABORT, 'ALT_EXPLANATION_REQUIRED');
END;
