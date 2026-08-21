-- Book 7 — table unification, Slice 1 (ADDITIVE + REVERSIBLE).
--
-- Creates the unified capture/review/exam tables and backfills them 1:1 from the
-- existing per-kind tables. It does NOT drop or modify any existing table, and it
-- does NOT change application behaviour: intel_entries / maxims / responses /
-- response_srs / tongue_exams remain the authoritative stores that every route
-- still reads and writes. The unified tables are populated shadows that later
-- slices will dual-write and then switch reads onto, one feature at a time.
--
-- Every unified row carries (legacy_table, legacy_id) so the backfill is fully
-- traceable and verifiable, and so a later slice can map review_items/exams back
-- to their capture. No user data is deleted or rewritten; rollback is dropping
-- the three new tables (see the bottom of this file).

-- ---------------------------------------------------------------------------
-- captures — unifies intel_entries + maxims + responses under a `kind`.
-- The column set is the faithful UNION of the three sources; a given row
-- populates only its kind's columns. Shared column names (situation, source)
-- are reused where the meaning lines up.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS captures (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                INTEGER REFERENCES users(id),
  kind                   TEXT NOT NULL,               -- 'intel' | 'maxim' | 'response'
  created_at             TEXT DEFAULT (datetime('now')),
  -- shared-ish
  source                 TEXT,                          -- maxim.source | response.source
  title                  TEXT,                          -- intel.title
  situation              TEXT,                          -- intel.situation | response.situation
  -- intel
  log_date               TEXT,
  domain                 TEXT,
  my_move                TEXT,
  outcome                TEXT,
  verdict                TEXT,
  principle_used         TEXT,
  lesson                 TEXT,
  people                 TEXT,
  hermes_analysis        TEXT,
  heat                   TEXT,
  alternative_explanation TEXT,
  -- maxim
  principle              TEXT,
  naive_reading          TEXT,
  master_reading         TEXT,
  my_words               TEXT,
  unit_id                INTEGER,
  created_by_user        INTEGER DEFAULT 0,
  -- response
  trigger_q              TEXT,
  response               TEXT,
  why_works              TEXT,
  category               TEXT,
  archived               INTEGER DEFAULT 0,
  -- provenance (traceable, reversible)
  legacy_table           TEXT,
  legacy_id              INTEGER
);
CREATE INDEX IF NOT EXISTS idx_captures_owner_kind ON captures(user_id, kind);
CREATE INDEX IF NOT EXISTS idx_captures_legacy ON captures(legacy_table, legacy_id);

-- ---------------------------------------------------------------------------
-- review_items — unifies response_srs and any future spaced-repetition state.
-- FSRS columns (stability, difficulty, last_review) are added now so the table
-- is FSRS-ready (Book 7, spaced-repetition item); they stay NULL until the
-- SM-2 -> FSRS migration lands and populates them.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER REFERENCES users(id),
  kind             TEXT NOT NULL,               -- 'response' today; 'maxim' etc. later
  item_id          INTEGER NOT NULL,            -- reviewed item's id (response id today)
  interval_days    INTEGER DEFAULT 0,
  ease             REAL DEFAULT 2.5,
  reps             INTEGER DEFAULT 0,
  lapses           INTEGER DEFAULT 0,
  due_date         TEXT NOT NULL,
  mastery          TEXT DEFAULT 'new',
  total_reviews    INTEGER DEFAULT 0,
  correct_reviews  INTEGER DEFAULT 0,
  last_mode        TEXT,
  -- FSRS-ready (NULL until FSRS migration)
  stability        REAL,
  difficulty       REAL,
  last_review      TEXT,
  legacy_table     TEXT,
  legacy_id        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_review_items_owner_kind ON review_items(user_id, kind);
CREATE INDEX IF NOT EXISTS idx_review_items_due ON review_items(user_id, due_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_items_identity ON review_items(kind, item_id, user_id);

-- ---------------------------------------------------------------------------
-- exams — unifies tongue_exams and any future exam kinds.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exams (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER REFERENCES users(id),
  kind         TEXT NOT NULL DEFAULT 'tongue',
  exam_date    TEXT NOT NULL,
  total        INTEGER NOT NULL,
  correct      INTEGER NOT NULL,
  score_pct    INTEGER NOT NULL,
  passed       INTEGER NOT NULL,
  created_at   TEXT DEFAULT (datetime('now')),
  legacy_table TEXT,
  legacy_id    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_exams_owner ON exams(user_id, exam_date);

-- ---------------------------------------------------------------------------
-- Backfill 1:1. INSERT ... SELECT copies every existing row into the unified
-- table with its provenance. Re-runnable safely: the NOT EXISTS guard keys on
-- (legacy_table, legacy_id) so a second application inserts nothing.
-- ---------------------------------------------------------------------------
INSERT INTO captures (
  user_id, kind, created_at, title, situation, log_date, domain, my_move, outcome,
  verdict, principle_used, lesson, people, hermes_analysis, heat, alternative_explanation,
  legacy_table, legacy_id)
SELECT user_id, 'intel', created_at, title, situation, log_date, domain, my_move, outcome,
       verdict, principle_used, lesson, people, hermes_analysis, heat, alternative_explanation,
       'intel_entries', id
FROM intel_entries e
WHERE NOT EXISTS (SELECT 1 FROM captures c WHERE c.legacy_table='intel_entries' AND c.legacy_id=e.id);

INSERT INTO captures (
  user_id, kind, source, principle, naive_reading, master_reading, my_words, unit_id,
  created_by_user, legacy_table, legacy_id)
SELECT user_id, 'maxim', source, principle, naive_reading, master_reading, my_words, unit_id,
       created_by_user, 'maxims', id
FROM maxims m
WHERE NOT EXISTS (SELECT 1 FROM captures c WHERE c.legacy_table='maxims' AND c.legacy_id=m.id);

INSERT INTO captures (
  user_id, kind, created_at, situation, source, trigger_q, response, why_works, category,
  archived, legacy_table, legacy_id)
SELECT user_id, 'response', created_at, situation, source, trigger_q, response, why_works, category,
       archived, 'responses', id
FROM responses r
WHERE NOT EXISTS (SELECT 1 FROM captures c WHERE c.legacy_table='responses' AND c.legacy_id=r.id);

INSERT INTO review_items (
  user_id, kind, item_id, interval_days, ease, reps, lapses, due_date, mastery,
  total_reviews, correct_reviews, last_mode, legacy_table, legacy_id)
SELECT user_id, 'response', response_id, interval_days, ease, reps, lapses, due_date, mastery,
       total_reviews, correct_reviews, last_mode, 'response_srs', response_id
FROM response_srs s
WHERE NOT EXISTS (SELECT 1 FROM review_items ri WHERE ri.legacy_table='response_srs' AND ri.legacy_id=s.response_id);

INSERT INTO exams (
  user_id, kind, exam_date, total, correct, score_pct, passed, created_at, legacy_table, legacy_id)
SELECT user_id, 'tongue', exam_date, total, correct, score_pct, passed, created_at, 'tongue_exams', id
FROM tongue_exams x
WHERE NOT EXISTS (SELECT 1 FROM exams e WHERE e.legacy_table='tongue_exams' AND e.legacy_id=x.id);

-- ---------------------------------------------------------------------------
-- ROLLBACK (manual, destructive to the SHADOWS ONLY — never to source data):
--   DROP TABLE IF EXISTS exams;
--   DROP TABLE IF EXISTS review_items;
--   DROP TABLE IF EXISTS captures;
-- The authoritative intel_entries / maxims / responses / response_srs /
-- tongue_exams tables and their rows are untouched by this migration, so the
-- prior application continues to work unchanged after a rollback.
-- ---------------------------------------------------------------------------
