-- Book 7 table unification — maxims cutover (captures becomes the maxim store).
--
-- After migration 0012 backfilled every maxim into captures(kind='maxim'), this
-- migration repoints the flashcards spaced-repetition rows from maxims(id) onto
-- captures(id). D1 ENFORCES foreign keys, so flashcards' declared
-- `maxim_id REFERENCES maxims(id)` cannot simply be re-pointed by UPDATE — the
-- table is recreated with the FK now targeting captures(id) and its rows copied
-- with maxim_id remapped through captures.legacy_id.
--
-- DATA SAFETY: flashcards is the ONLY home of the maxim SR state (interval, ease,
-- due, reps, lapses), so before it is recreated the whole table is copied verbatim
-- into flashcards_pre0013_backup, which is KEPT. The copy into the new table is a
-- JOIN on captures, and migration 0012 backfilled every maxim, so no row is lost;
-- test/migration-0013.test.ts asserts exact count parity and correct remapping
-- before this is ever applied to production. The maxims table itself is retained
-- untouched as an additional backup.
--
-- ROLLBACK (manual): DROP TABLE flashcards; ALTER TABLE flashcards_pre0013_backup
-- RENAME TO flashcards; then redeploy the prior application (which reads maxims).
-- No user data is destroyed by applying or rolling back.

-- 1. Full, retained backup of the SR state before any structural change.
CREATE TABLE IF NOT EXISTS flashcards_pre0013_backup AS SELECT * FROM flashcards;

-- 2. New flashcards whose maxim_id references captures(id).
CREATE TABLE flashcards_v2 (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  maxim_id      INTEGER UNIQUE NOT NULL,     -- now a captures.id (kind='maxim')
  interval_days REAL DEFAULT 0,
  ease          REAL DEFAULT 2.5,
  due_date      TEXT DEFAULT (date('now')),
  reps          INTEGER DEFAULT 0,
  lapses        INTEGER DEFAULT 0,
  user_id       INTEGER REFERENCES users(id),
  FOREIGN KEY (maxim_id) REFERENCES captures(id)
);

-- 3. Copy every flashcard, remapping maxim_id (maxims.id -> captures.id). The JOIN
--    keys on captures.legacy_id, which 0012 set for every backfilled maxim.
INSERT INTO flashcards_v2 (id, maxim_id, interval_days, ease, due_date, reps, lapses, user_id)
SELECT f.id, c.id, f.interval_days, f.ease, f.due_date, f.reps, f.lapses, f.user_id
FROM flashcards f
JOIN captures c ON c.kind='maxim' AND c.legacy_id=f.maxim_id;

-- 4. Swap in the new table.
DROP TABLE flashcards;
ALTER TABLE flashcards_v2 RENAME TO flashcards;
CREATE INDEX IF NOT EXISTS idx_cards_due ON flashcards(due_date);
CREATE INDEX IF NOT EXISTS idx_flashcards_user_due ON flashcards(user_id, due_date);
