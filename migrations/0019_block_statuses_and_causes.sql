-- Book 8.3 / 8.4 — block statuses and miss diagnosis.
--
-- 8.3 gives a block ten honest states, and says plainly: "A block is never
-- auto-cancelled merely because its window passed. unreported is a data state, not a
-- moral one; it carries a prompt, not a penalty." So the same-day window close stays
-- (it is a standing constraint of this system) but what it writes changes: the block
-- becomes `unreported` and the commander is asked what actually happened.
--
-- 8.4 then requires a CAUSE before a miss can be rescheduled, from a fixed taxonomy,
-- and the correction follows the cause rather than the penalty. This migration adds
-- the ledger that records it. It is append-only: a diagnosis is evidence, and
-- evidence is not edited later to look better.
--
-- Additive: one table, its index and its guards. Nothing is altered or deleted, and
-- every existing block_log keeps its status.
--
-- ROLLBACK (manual): DROP TABLE IF EXISTS block_miss_causes; then redeploy the prior
-- application, which never read it. No user data is destroyed either way.

CREATE TABLE IF NOT EXISTS block_miss_causes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  block_id    INTEGER NOT NULL,
  log_date    TEXT NOT NULL,
  cause       TEXT NOT NULL,     -- one of the eleven Book 8.4 causes
  correction  TEXT NOT NULL,     -- the dimension the correction acts on
  note        TEXT,              -- his own words, optional
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_miss_causes_owner ON block_miss_causes(user_id, log_date);
-- One recorded cause per block per day: the diagnosis is a fact about that day.
CREATE UNIQUE INDEX IF NOT EXISTS idx_miss_causes_identity
  ON block_miss_causes(user_id, block_id, log_date);

CREATE TRIGGER IF NOT EXISTS trg_miss_causes_no_update
BEFORE UPDATE ON block_miss_causes
BEGIN
  SELECT RAISE(ABORT, 'MISS_CAUSE_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS trg_miss_causes_no_delete
BEFORE DELETE ON block_miss_causes
BEGIN
  SELECT RAISE(ABORT, 'MISS_CAUSE_APPEND_ONLY');
END;
