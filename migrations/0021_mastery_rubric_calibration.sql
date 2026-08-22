-- Book 10.2 / 10.3 / 10.4 — the mastery ladder with declared evidence, the
-- nine-dimension rubric, calibration on learning, and R0.
--
-- 10.2: six levels, each with REQUIRED EVIDENCE, and "self-scoring is never a gate."
-- So a level is not a field the client sets: it is derived from evidence rows that
-- exist, each carrying its rubric. `mastery` is a cache of that derivation, never the
-- source of truth.
--
-- 10.3: "Every review item, rhetoric attempt, and exam records confidence_before and
-- confidence_after, and computes calibration_error." That produces a second Brier
-- score — knowledge calibration — reported beside the decision Brier. Overconfidence
-- is a named pattern, never a penalty.
--
-- 10.4: R0 is same-session, no-notes retrieval, and no lesson closes without it.
--
-- Additive: new tables, and nullable columns on review_items. Nothing is altered or
-- deleted; existing review rows simply have no confidence recorded yet.
--
-- ROLLBACK (manual): DROP TABLE IF EXISTS mastery; DROP TABLE IF EXISTS
-- mastery_evidence; DROP TABLE IF EXISTS retrieval_attempts; DROP TABLE IF EXISTS
-- calibration_events; the added review_items columns are nullable and ignored by the
-- prior application. No user data is destroyed either way.

-- ---------------------------------------------------------------------------
-- 10.2 EVIDENCE. Append-only: each row is a piece of evidence for one level of one
-- subject, with the nine rubric dimensions scored 0-3 by the adversarial grader.
-- `self_score` is recorded for calibration only and is explicitly NOT a gate.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mastery_evidence (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id),
  subject_kind  TEXT NOT NULL,      -- 'unit' | 'concept' | 'principle' | 'capture'
  subject_id    TEXT NOT NULL,      -- unit id, concept slug, principle slug, anchor...
  level         TEXT NOT NULL
    CHECK (level IN ('encountered','recalled','explained','applied','transferred','integrated')),
  evidence_kind TEXT NOT NULL,      -- 'reading_record' | 'retrieval' | 'explanation' | ...
  evidence_ref  TEXT,               -- session id, attempt id, decision id, anchor...
  body          TEXT,               -- his own words, when the evidence IS words
  word_count    INTEGER NOT NULL DEFAULT 0,
  -- the nine dimensions, 0-3 each (NULL where the evidence cannot speak to one)
  r_recall      INTEGER, r_explanation INTEGER, r_mechanism INTEGER,
  r_application INTEGER, r_reversal    INTEGER, r_defence   INTEGER,
  r_evidence    INTEGER, r_transfer    INTEGER, r_retention INTEGER,
  rubric_mean   REAL,
  graded_by     TEXT NOT NULL DEFAULT 'adversarial',  -- 'adversarial' | 'cloze' | 'diff'
  self_score    INTEGER,            -- recorded for calibration; never a gate
  transfer_ref  TEXT,               -- 10.2: 'transferred' needs a populated reference
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mastery_evidence_subject
  ON mastery_evidence(user_id, subject_kind, subject_id);

CREATE TRIGGER IF NOT EXISTS trg_mastery_evidence_no_update
BEFORE UPDATE ON mastery_evidence
BEGIN
  SELECT RAISE(ABORT, 'MASTERY_EVIDENCE_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS trg_mastery_evidence_no_delete
BEFORE DELETE ON mastery_evidence
BEGIN
  SELECT RAISE(ABORT, 'MASTERY_EVIDENCE_APPEND_ONLY');
END;

-- A derived cache of the highest level whose evidence exists. Recomputed from
-- mastery_evidence; never written by a client.
CREATE TABLE IF NOT EXISTS mastery (
  user_id      INTEGER NOT NULL REFERENCES users(id),
  subject_kind TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  level        TEXT NOT NULL DEFAULT 'encountered',
  rubric_mean  REAL,
  updated_at   TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, subject_kind, subject_id)
);

-- ---------------------------------------------------------------------------
-- 10.4 R0 + 10.2 'recalled'. A retrieval attempt is the no-notes answer, with the
-- cloze/diff evidence of how close it came. `same_session` records whether it was the
-- R0 attempt taken in the lesson itself.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retrieval_attempts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER REFERENCES users(id),
  subject_kind   TEXT NOT NULL,
  subject_id     TEXT NOT NULL,
  anchor         TEXT,              -- the passage tested, when there is one
  prompt         TEXT NOT NULL,
  answer         TEXT NOT NULL,
  mode           TEXT NOT NULL DEFAULT 'free_recall'   -- 'free_recall' | 'cloze'
    CHECK (mode IN ('free_recall','cloze')),
  hit_ratio      REAL,              -- free-recall diff: fraction of key terms recovered
  same_session   INTEGER NOT NULL DEFAULT 0,           -- 1 = this was R0
  used_source    INTEGER NOT NULL DEFAULT 0,           -- honesty flag: notes were open
  confidence_before INTEGER, confidence_after INTEGER, -- 0-100
  calibration_error REAL,
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_retrieval_subject
  ON retrieval_attempts(user_id, subject_kind, subject_id);

-- ---------------------------------------------------------------------------
-- 10.3 CALIBRATION ON LEARNING. One row per graded moment, whatever produced it, so
-- the knowledge Brier can be computed across review items, retrieval attempts,
-- rhetoric attempts and exams together.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calibration_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER REFERENCES users(id),
  domain            TEXT NOT NULL DEFAULT 'knowledge'   -- 'knowledge' | 'decision'
    CHECK (domain IN ('knowledge','decision')),
  source_kind       TEXT NOT NULL,   -- 'review_item' | 'retrieval' | 'exam' | 'rhetoric'
  source_ref        TEXT,
  confidence_before INTEGER NOT NULL,                   -- 0-100
  confidence_after  INTEGER,
  outcome           REAL NOT NULL,                      -- 0..1, what actually happened
  calibration_error REAL NOT NULL,                      -- |confidence/100 - outcome|
  brier_term        REAL NOT NULL,                      -- (confidence/100 - outcome)^2
  occurred_on       TEXT NOT NULL,
  created_at        TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_calibration_owner_domain
  ON calibration_events(user_id, domain, occurred_on);

-- Confidence on the spaced-repetition queue itself (10.3: "every review item").
ALTER TABLE review_items ADD COLUMN confidence_before INTEGER;
ALTER TABLE review_items ADD COLUMN confidence_after INTEGER;
ALTER TABLE review_items ADD COLUMN last_calibration_error REAL;
