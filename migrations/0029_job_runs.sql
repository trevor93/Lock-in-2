-- Book 7 named table: job_runs. Book 5.3 requires audit events on the internal job
-- path and Book 17's test matrix requires duplicate-job idempotency. Both were
-- already true in behaviour — the enforcement pass is idempotent and the alarm
-- ledger has a UNIQUE identity — but neither job left a RUN record, so the operator
-- had no way to answer "did the Cron fire at 07:31, and what did it do?" from the
-- database. A silent job that never ran looks exactly like a job that ran and found
-- nothing, and the nine cancellations at 07:31 are precisely the kind of question
-- this table has to be able to answer.
--
-- The row is metadata only: which job, when it started and finished, what it
-- touched as counts, and an error CLASS if it failed. No journal text, no block
-- titles, no credentials, and never the shared secret.
--
-- Not per-user: a run covers every owner the job walked, so ownership lives in the
-- counts. That is why this table carries no user_id and is exempt from the
-- ownership sweep in test/session-ownership.test.ts.
--
-- ROLLBACK (destroys only the run history, never a personal record):
--   DROP TABLE IF EXISTS job_runs;
-- Nothing references it, so the drop is safe and the jobs keep working without it.

CREATE TABLE IF NOT EXISTS job_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job           TEXT NOT NULL CHECK (job IN ('enforcement','alarms')),
  -- 'cron' when the operator's Cron Worker called it, 'user' when a browser tick
  -- cranked the same engine. The distinction is the whole point: it separates
  -- "the Cron is dead" from "he opened the app and it caught up".
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('cron','user','system')),
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT,
  status        TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','ok','error')),
  owners_walked INTEGER NOT NULL DEFAULT 0,
  -- Free-form small counts per job, e.g. {"sent":2,"skipped":0}. Counts only.
  counts_json   TEXT,
  -- An error CLASS, never a message that could carry a row value.
  error_class   TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_runs_job_time ON job_runs(job, started_at DESC);

-- Append-only in the sense that matters: a finished run is never re-opened. The
-- trigger allows exactly the completion write (running -> ok/error) and refuses any
-- later edit, so a run record cannot be rewritten after the fact.
CREATE TRIGGER IF NOT EXISTS trg_job_runs_no_reopen
BEFORE UPDATE ON job_runs
WHEN OLD.status <> 'running'
BEGIN
  SELECT RAISE(ABORT, 'job_runs is append-only: a finished run cannot be edited');
END;
