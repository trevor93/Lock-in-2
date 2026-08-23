-- Book 12.4 — the transition the red-team card guards.
--
-- 12.4 makes the outbound card "mandatory before any draft is marked deployed", which
-- presupposes a deployed state. Migration 0024 gave rhetoric_attempts everything except
-- that flag, so this adds it. The flag is set only by POST /api/lab/attempt/:id/deploy,
-- which refuses when no outbound card exists for the attempt and refuses again when the
-- newest card on it still carries a defect or fails the Daylight Test.
--
-- Additive: two nullable columns with safe defaults. No existing row changes meaning —
-- an attempt written before this migration is simply not yet deployed, which is true.
--
-- ROLLBACK (manual): SQLite cannot drop a column in the versions D1 has historically
-- supported, and dropping one here would destroy the deployment record. The rollback is
-- therefore to leave the columns in place and ignore them:
--   UPDATE rhetoric_attempts SET deployed = 0, deployed_on = NULL;
-- That restores the pre-migration behaviour (nothing deployed) without deleting rows.

ALTER TABLE rhetoric_attempts ADD COLUMN deployed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rhetoric_attempts ADD COLUMN deployed_on TEXT;

CREATE INDEX IF NOT EXISTS idx_rhetoric_attempts_deployed
  ON rhetoric_attempts(user_id, deployed, occurred_on);
