-- Book 11 — THE FARNSWORTH PROGRAMME, as fixed curriculum data.
-- Book 12 — the Rhetoric Lab and Response Lab tables.
--
-- Book 11 opens: "This book is curriculum data, not aspiration. It is already running
-- on paper. The application's job is to carry it, never to compete with it, and never
-- to replace the parts that must stay physical." Book 11.8 is therefore enforced in
-- schema: the commonplace book stays handwritten, and the application records only
-- THAT Tier 1 was copied and when. There is no column anywhere for the copied text.
--
-- Additive: new tables only. Nothing existing is altered or deleted.
--
-- ROLLBACK (manual): drop the tables created here, in reverse dependency order. Only
-- curriculum rows and rhetoric-track records are involved.

-- ---------------------------------------------------------------------------
-- 11.1 / 11.2 THE SYLLABUS. Nineteen chapters in three parts, one chapter per
-- seven-day cycle, with the exact day ranges Book 11.2 fixes. Consolidations and the
-- final two phases are rows too, so the track is complete rather than implied.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rhetoric_phases (
  code        TEXT PRIMARY KEY,       -- 'P0'..'P5'
  sort_order  INTEGER NOT NULL,
  title       TEXT NOT NULL,
  subtitle    TEXT,                   -- 'repetition, the ear' etc.
  day_from    INTEGER NOT NULL,
  day_to      INTEGER NOT NULL,
  -- 11.1's architecture, which "the book never states outright and which the
  -- application must teach explicitly".
  architecture TEXT
);

CREATE TABLE IF NOT EXISTS rhetoric_chapters (
  id           INTEGER PRIMARY KEY,   -- the book's own chapter number (1..19)
  phase_code   TEXT NOT NULL REFERENCES rhetoric_phases(code),
  part         INTEGER NOT NULL,      -- I, II, III
  title        TEXT NOT NULL,         -- the book's chapter title
  figure_slug  TEXT,                  -- the primary figure taught
  day_from     INTEGER NOT NULL,
  day_to       INTEGER NOT NULL,
  -- 11.9's self-audit mark: U already done unconsciously, R recognised not producible,
  -- N new. Set by the operator; used to weight early cycles.
  self_audit   TEXT CHECK (self_audit IN ('U','R','N') OR self_audit IS NULL),
  created_at   TEXT DEFAULT (datetime('now'))
);

-- Consolidations and non-chapter cycles (Consolidation A/B/C, Phases 4 and 5).
CREATE TABLE IF NOT EXISTS rhetoric_milestones (
  slug       TEXT PRIMARY KEY,
  phase_code TEXT NOT NULL REFERENCES rhetoric_phases(code),
  title      TEXT NOT NULL,
  day_from   INTEGER NOT NULL,
  day_to     INTEGER NOT NULL,
  purpose    TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 11.7 FIGURE RECORDS. Every field Book 11.7 names, including both faces:
-- legitimate use AND manipulative misuse, plus the detection question for spotting it
-- inbound and the overuse tells.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS figures (
  slug                TEXT PRIMARY KEY,
  canonical_name      TEXT NOT NULL,
  classical_name      TEXT,            -- Greek or Latin
  etymology           TEXT,
  plain_definition    TEXT NOT NULL,
  structural_formula  TEXT NOT NULL,   -- notation, e.g. 'A… A… A…'
  sub_variants        TEXT,
  mechanism           TEXT NOT NULL,   -- why it works on the mind
  part                INTEGER NOT NULL,
  chapter_id          INTEGER,
  conversational_job  TEXT NOT NULL,   -- 11.7's situation-to-figure mapping
  rhetorical_effect   TEXT NOT NULL,
  emotional_effect    TEXT NOT NULL,
  legitimate_use      TEXT NOT NULL,
  manipulative_misuse TEXT NOT NULL,   -- both faces, in the same record
  detection_question  TEXT NOT NULL,   -- for spotting it inbound
  overuse_tells       TEXT NOT NULL,
  related_figures     TEXT,            -- comma-separated slugs
  stackable_with      TEXT,            -- comma-separated slugs
  hidden_layer        TEXT,            -- 11.3 Day 1 / 11.6 slot 4
  created_at          TEXT DEFAULT (datetime('now'))
);

-- The operator's own examples live separately: they are HIS, not the book's.
CREATE TABLE IF NOT EXISTS figure_own_examples (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  figure_slug TEXT NOT NULL REFERENCES figures(slug),
  text        TEXT NOT NULL,
  context     TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_figure_own_examples ON figure_own_examples(user_id, figure_slug);

-- ---------------------------------------------------------------------------
-- 11.4 THE SPECIMEN TIER SYSTEM. Tier 1 own (verbatim, permanent), Tier 2 skeleton
-- (structure memorised, content replaced), Tier 3 ear (read aloud once, revisited in
-- review). Book 11.4 explicitly REJECTS memorising a thousand specimens verbatim and
-- says the application "must not silently reintroduce it" — the target counts live in
-- src/rhetoric.ts and a test asserts Tier 1 stays small.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS specimens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  figure_slug  TEXT NOT NULL REFERENCES figures(slug),
  tier         INTEGER NOT NULL CHECK (tier IN (1,2,3)),
  text         TEXT NOT NULL,
  attribution  TEXT,                  -- author, work, year
  year         TEXT,
  public_domain INTEGER NOT NULL DEFAULT 1,
  -- Where this specimen sits in HIS copy of the book (Book 11.8: the app references,
  -- it does not absorb).
  page_ref     TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_specimens_figure_tier ON specimens(figure_slug, tier);

-- 11.3 Day 2: "Tier 1 is copied by hand into the commonplace book. Handwriting, not
-- typing." The application logs THAT it happened and when. There is deliberately no
-- text column here — Book 11.8 and Law 22.
CREATE TABLE IF NOT EXISTS commonplace_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER REFERENCES users(id),
  figure_slug  TEXT REFERENCES figures(slug),
  specimen_id  INTEGER REFERENCES specimens(id),
  copied_on    TEXT NOT NULL,
  page_of_book TEXT,                  -- which page of HIS commonplace book
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_commonplace_owner ON commonplace_log(user_id, copied_on);

-- ---------------------------------------------------------------------------
-- 11.3 THE SEVEN-DAY CYCLE. One row per cycle day completed, so the cycle is carried
-- rather than assumed. Day 1 produces nothing by design.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cycle_days (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  chapter_id  INTEGER NOT NULL REFERENCES rhetoric_chapters(id),
  cycle_day   INTEGER NOT NULL CHECK (cycle_day BETWEEN 1 AND 7),
  occurred_on TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cycle_days_identity
  ON cycle_days(user_id, chapter_id, cycle_day);

-- 11.3 Day 5 / 12.2: the Erasmus copia drill. One real sentence, rendered twenty ways,
-- BAD RENDERINGS INCLUDED — "volume is the trainer, not quality."
CREATE TABLE IF NOT EXISTS copia_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id),
  figure_slug   TEXT NOT NULL REFERENCES figures(slug),
  seed_sentence TEXT NOT NULL,        -- a real sentence he actually had to say
  occurred_on   TEXT NOT NULL,
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS copia_renderings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES copia_sessions(id),
  user_id    INTEGER REFERENCES users(id),
  text       TEXT NOT NULL,
  -- Bad renderings are kept, not deleted: the drill is volume.
  self_marked_bad INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_copia_renderings ON copia_renderings(session_id);

-- ---------------------------------------------------------------------------
-- 11.3 Day 6 + 12.5 LIVE FIRE. Three deployments per cycle: one where it FITS, one
-- where it BARELY fits, one where it FAILS — "the failure teaches the boundary".
-- 12.5 adds the script, the pivot table, delivery notation and the never-list.
-- 11.8 allows the deployment log in the app: four columns, date/figure/context/outcome.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deployments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id),
  figure_slug   TEXT NOT NULL REFERENCES figures(slug),
  occurred_on   TEXT NOT NULL,
  context       TEXT NOT NULL,        -- the room, not the book (12.6)
  what_happened TEXT NOT NULL,
  fit           TEXT NOT NULL CHECK (fit IN ('fits','barely','fails')),
  -- 11.9: "being noticed is the failure condition."
  counterpart_noticed INTEGER NOT NULL DEFAULT 0,
  script        TEXT,                 -- 12.5
  delivery_notation TEXT,             -- pause points, stressed word, pace, where to stop
  never_list    TEXT,                 -- what not to say/concede/reveal in THIS exchange
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deployments_owner ON deployments(user_id, occurred_on);

-- 12.5's pivot table: if they say X, execute Y.
CREATE TABLE IF NOT EXISTS deployment_pivots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  deployment_id INTEGER NOT NULL REFERENCES deployments(id),
  user_id       INTEGER REFERENCES users(id),
  trigger       TEXT NOT NULL,        -- 'concede' | 'escalate' | 'deflect' | free text
  response      TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_deployment_pivots ON deployment_pivots(deployment_id);

-- ---------------------------------------------------------------------------
-- 12.1 THE CANON LAYER. "Figures are chosen after the map, never before.
-- Figure-first composition is how a student produces ornamented nonsense." The draft
-- cannot name a figure until all six slots are populated — enforced in the route and
-- proven by test.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canon_maps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  purpose     TEXT NOT NULL,          -- inform|clarify|persuade|repair|decline|negotiate|de_escalate|inspire|pause|challenge
  audience    TEXT NOT NULL,          -- what they know, value, fear, need, misunderstand
  occasion    TEXT NOT NULL,          -- why now, what tone, what length
  proof       TEXT NOT NULL,          -- facts, examples, principles, reasons
  arrangement TEXT NOT NULL,          -- the order a listener can follow
  delivery    TEXT NOT NULL,          -- cadence, word choice, emphasis, restraint, presence
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_canon_maps_owner ON canon_maps(user_id, created_at);

-- ---------------------------------------------------------------------------
-- 12.2 EXERCISE ATTEMPTS (thirteen types) and 12.6's linter fields.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rhetoric_attempts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER REFERENCES users(id),
  exercise_type  TEXT NOT NULL,
  figure_slug    TEXT REFERENCES figures(slug),
  canon_map_id   INTEGER REFERENCES canon_maps(id),
  prompt         TEXT,
  answer         TEXT NOT NULL,
  -- 12.2's thirteenth exercise: three versions plus a written diagnosis.
  version_plain      TEXT,
  version_controlled TEXT,
  version_excessive  TEXT,
  excess_diagnosis   TEXT,
  -- 12.6: "Every saved line requires a populated why_not_obvious field."
  why_not_obvious TEXT,
  source_room     TEXT,               -- the room, not the book
  -- 10.3 calibration rides along on rhetoric attempts too.
  confidence_before INTEGER,
  confidence_after  INTEGER,
  occurred_on    TEXT NOT NULL,
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rhetoric_attempts_owner ON rhetoric_attempts(user_id, occurred_on);

-- 12.6: detection proposes tags; HIS CORRECTION is the training signal.
CREATE TABLE IF NOT EXISTS figure_detections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id),
  text          TEXT NOT NULL,
  proposed      TEXT NOT NULL,        -- JSON array of proposed figure slugs
  corrected     TEXT,                 -- JSON array he corrected it to
  was_correct   INTEGER,              -- derived: proposed == corrected
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_figure_detections_owner ON figure_detections(user_id, created_at);

-- ---------------------------------------------------------------------------
-- 12.3 / 12.4 THE TWO CARDS. Inbound is the defensive half; outbound is the mirror,
-- MANDATORY before a draft is marked deployed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inbound_cards (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER REFERENCES users(id),
  text                TEXT NOT NULL,
  figure_used         TEXT,
  emphasis            TEXT NOT NULL,
  expectation_created TEXT NOT NULL,
  what_is_repeated    TEXT NOT NULL,
  what_is_omitted     TEXT NOT NULL,
  emotion_activated   TEXT NOT NULL,
  action_wanted       TEXT NOT NULL,
  independently_supported INTEGER NOT NULL,   -- is the proposition supported?
  survives_plain_statement INTEGER NOT NULL,  -- would it survive being stated plainly?
  created_at          TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inbound_cards_owner ON inbound_cards(user_id, created_at);

CREATE TABLE IF NOT EXISTS outbound_cards (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              INTEGER REFERENCES users(id),
  attempt_id           INTEGER REFERENCES rhetoric_attempts(id),
  draft                TEXT NOT NULL,
  overstates_certainty INTEGER NOT NULL,
  hides_downside       INTEGER NOT NULL,
  pressures_rather_than_persuades INTEGER NOT NULL,
  defensible_if_quoted INTEGER NOT NULL,      -- the Daylight Test (12.5)
  notes                TEXT,
  created_at           TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_outbound_cards_owner ON outbound_cards(user_id, created_at);

-- ---------------------------------------------------------------------------
-- 12.7 RESPONSE LAB — eleven intents, each an ARCHITECTURE rather than a line.
-- "Never give the line alone; give the logic of the line so it can be adapted."
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS response_intents (
  slug         TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  architecture TEXT NOT NULL,         -- the ordered moves, e.g. 'observation → standard → consequence → exit'
  when_to_use  TEXT NOT NULL,
  logic        TEXT NOT NULL,         -- why the architecture works, so it can be adapted
  sort_order   INTEGER NOT NULL DEFAULT 0
);

-- A built response: four layers, never a bare line.
CREATE TABLE IF NOT EXISTS response_builds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER REFERENCES users(id),
  intent_slug  TEXT NOT NULL REFERENCES response_intents(slug),
  situation    TEXT NOT NULL,
  layer_intent TEXT NOT NULL,
  layer_truth  TEXT NOT NULL,
  layer_structure TEXT NOT NULL,
  layer_delivery  TEXT NOT NULL,
  -- 12.7's assessment dimensions, 0-3 each.
  a_appropriateness INTEGER, a_clarity INTEGER, a_proportionality INTEGER,
  a_naturalness INTEGER, a_objective_achieved INTEGER, a_escalation_risk INTEGER,
  occurred_on  TEXT NOT NULL,
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_response_builds_owner ON response_builds(user_id, occurred_on);

-- ---------------------------------------------------------------------------
-- 11.9 MEASUREMENT. Recordings are FILES THE APP REFERENCES, not media it manages
-- (11.8). Re-listens are scheduled at Day 143 and Day 204 and only then.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recordings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER REFERENCES users(id),
  kind           TEXT NOT NULL CHECK (kind IN ('baseline','thirty_day','written_baseline')),
  file_reference TEXT NOT NULL,       -- a path/name the operator controls; never uploaded
  made_on        TEXT NOT NULL,
  programme_day  INTEGER,
  duration_seconds INTEGER,
  -- 11.9: the baseline is "never listened back" until the scheduled points.
  relisten_allowed_on_day INTEGER,
  relistened_on  TEXT,
  word_count     INTEGER,             -- for the 200-word written baseline
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recordings_owner ON recordings(user_id, made_on);

-- ---------------------------------------------------------------------------
-- 11.8 PAGE REFERENCES. His own copies of the two books, indexed page by page so a
-- chapter can open at the real page. The application stores a REFERENCE, never the
-- page content: Law 22 — "if a feature would make the paper obsolete without making
-- the skill better, it is a defect."
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS book_page_refs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  book_slug   TEXT NOT NULL,          -- 'classical_english_rhetoric' | 'classical_english_argument'
  page_index  INTEGER NOT NULL,       -- 0-based position in the capture sequence
  file_name   TEXT NOT NULL,          -- the operator's own file, on his own machine
  captured_at TEXT,
  chapter_id  INTEGER,                -- filled where known
  note        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_book_page_refs_identity
  ON book_page_refs(book_slug, page_index);
CREATE INDEX IF NOT EXISTS idx_book_page_refs_chapter ON book_page_refs(book_slug, chapter_id);

-- ---------------------------------------------------------------------------
-- 11.5 SPACED REPETITION FOR THE TRACK. A FIXED ladder — one, three, seven,
-- sixteen, thirty-five days — not FSRS. Book 11.5 names the intervals, so they are
-- data here and constants in src/rhetoric.ts, and three card types: figure name to
-- definition, skeleton to a fresh example generated on the spot, and situation prompt
-- to the figure to deploy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rhetoric_cards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  card_type   TEXT NOT NULL CHECK (card_type IN ('name_to_definition','skeleton_to_example','situation_to_figure')),
  figure_slug TEXT NOT NULL REFERENCES figures(slug),
  specimen_id INTEGER REFERENCES specimens(id),
  -- 0 = not yet started; 1..5 = position on the 1/3/7/16/35 ladder.
  ladder_step INTEGER NOT NULL DEFAULT 0,
  due_date    TEXT NOT NULL,
  lapses      INTEGER NOT NULL DEFAULT 0,
  total_reviews INTEGER NOT NULL DEFAULT 0,
  correct_reviews INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rhetoric_cards_identity
  ON rhetoric_cards(user_id, card_type, figure_slug, COALESCE(specimen_id, 0));
CREATE INDEX IF NOT EXISTS idx_rhetoric_cards_due ON rhetoric_cards(user_id, due_date);

-- Append-only: what was actually answered. The ladder is derived from this, never
-- from a self-report of "I know it".
CREATE TABLE IF NOT EXISTS rhetoric_card_reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id    INTEGER NOT NULL REFERENCES rhetoric_cards(id),
  user_id    INTEGER REFERENCES users(id),
  reviewed_on TEXT NOT NULL,
  correct    INTEGER NOT NULL,
  -- For skeleton_to_example: the example he generated on the spot, scored against
  -- the structural formula (11.9's "construction accuracy").
  produced   TEXT,
  step_before INTEGER NOT NULL,
  step_after  INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rhetoric_card_reviews ON rhetoric_card_reviews(card_id, reviewed_on);

CREATE TRIGGER IF NOT EXISTS trg_rhetoric_card_reviews_no_update
BEFORE UPDATE ON rhetoric_card_reviews
BEGIN
  SELECT RAISE(ABORT, 'rhetoric_card_reviews is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_rhetoric_card_reviews_no_delete
BEFORE DELETE ON rhetoric_card_reviews
BEGIN
  SELECT RAISE(ABORT, 'rhetoric_card_reviews is append-only');
END;

-- ---------------------------------------------------------------------------
-- CHAPTER ANCHORS. Where a chapter demonstrably begins in the operator's own page
-- capture of his own copy. CONFIRMED ANCHORS ONLY: a row exists here when the page
-- was read and the chapter opening was seen on it. Ranges between anchors are
-- derived, and the gap between the last confirmed anchor and the next is reported as
-- unconfirmed rather than guessed — Law: never fabricate chapter numbers.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS book_chapter_anchors (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  book_slug    TEXT NOT NULL,
  chapter_id   INTEGER,              -- NULL for front/back matter anchors
  label        TEXT NOT NULL,        -- 'Contents', 'Chapter 2 — Anaphora', ...
  page_index   INTEGER NOT NULL,     -- 0-based position in the capture sequence
  confirmed_by TEXT NOT NULL,        -- how it was confirmed, in words
  is_opening   INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_book_chapter_anchors_identity
  ON book_chapter_anchors(book_slug, page_index);
