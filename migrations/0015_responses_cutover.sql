-- Book 7 table unification — responses cutover: responses -> captures, and the
-- spaced-repetition state response_srs -> review_items.
--
-- 0012 already backfilled captures(kind='response') from responses, and
-- review_items(kind='response') from response_srs with item_id = the LEGACY
-- response id (responses had not been cut over yet). This migration:
--   1. remaps review_items(kind='response').item_id from the legacy response id
--      onto the new captures.id (kind='response'), collision-proof;
--   2. recreates tongue_reviews WITHOUT the responses foreign key (D1 enforces FKs,
--      and new reviews must log a captures.id) — it is a date-aggregated log, so no
--      FK is needed; rows are copied with response_id remapped for consistency;
--   3. leaves responses and response_srs FROZEN (never written) as backups.
--
-- The application (tongue routes, state, enforcement, commander's-file) now reads
-- and writes response content from captures and SR state from review_items, keeping
-- the existing SM-2 scheduling (the SM-2 -> FSRS switch is the following slice, on
-- review_items' already-present stability/difficulty/last_review columns).
--
-- DATA SAFETY: response_srs and responses are untouched; tongue_reviews is backed
-- up verbatim into tongue_reviews_pre0015_backup before recreation. review_items
-- was itself backfilled from response_srs, which remains as the original. Nothing
-- is dropped that is not first preserved; test/responses-cutover.test.ts asserts
-- parity before this is applied.
--
-- ROLLBACK (manual): DROP TABLE tongue_reviews; ALTER TABLE
-- tongue_reviews_pre0015_backup RENAME TO tongue_reviews; and redeploy the prior
-- application (which reads responses/response_srs, both untouched). The review_items
-- item_id remap is reversible via captures.legacy_id if ever needed. No user data
-- is destroyed by applying or rolling back.

-- 1. Collision-proof two-phase remap of the SR rows' item_id. Phase A parks every
--    response item_id far above any real id; phase B resolves it to the capture id.
UPDATE review_items
SET item_id = item_id + 1000000000
WHERE kind = 'response';

UPDATE review_items
SET item_id = (
  SELECT c.id FROM captures c
  WHERE c.kind = 'response' AND c.legacy_id = review_items.item_id - 1000000000
)
WHERE kind = 'response'
  AND EXISTS (
    SELECT 1 FROM captures c
    WHERE c.kind = 'response' AND c.legacy_id = review_items.item_id - 1000000000
  );

-- 2. Recreate tongue_reviews without the responses FK (log; new rows carry a
--    captures.id). Full backup retained.
CREATE TABLE IF NOT EXISTS tongue_reviews_pre0015_backup AS SELECT * FROM tongue_reviews;
CREATE TABLE tongue_reviews_v2 (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  response_id INTEGER NOT NULL,          -- now a captures.id (kind='response')
  review_date TEXT NOT NULL,
  mode        TEXT NOT NULL,
  grade       INTEGER NOT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  user_id     INTEGER REFERENCES users(id)
);
INSERT INTO tongue_reviews_v2 (id, response_id, review_date, mode, grade, created_at, user_id)
SELECT t.id,
       COALESCE((SELECT c.id FROM captures c WHERE c.kind='response' AND c.legacy_id=t.response_id), t.response_id),
       t.review_date, t.mode, t.grade, t.created_at, t.user_id
FROM tongue_reviews t;
DROP TABLE tongue_reviews;
ALTER TABLE tongue_reviews_v2 RENAME TO tongue_reviews;
CREATE INDEX IF NOT EXISTS idx_treviews_date ON tongue_reviews(review_date);
CREATE INDEX IF NOT EXISTS idx_tongue_reviews_user_date ON tongue_reviews(user_id, review_date);
