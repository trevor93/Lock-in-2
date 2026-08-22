-- Book 10.1 + 10.5 — measured reading, and honest source metadata.
--
-- 10.1: "reading_done is dwell time plus traversal, never a button. A chapter is
-- opened, scrolled at a plausible reading speed, and anchored, with section-level
-- positions recorded." So the application records reading SESSIONS and decides for
-- itself whether a chapter was read; a client can no longer simply assert it.
--
-- 10.5: every source records its full provenance, and partial works and
-- public-domain translations are labelled as exactly that. "Never call a translation
-- 'official' unless it is." Where editions disagree on wording, the disagreement is
-- stored so it can be displayed rather than silently resolved.
--
-- 10.6: sections carry paragraph-level anchors, so a figure, a maxim, a drill, a
-- decision and an autopsy can all point at the same identifier.
--
-- Additive: new tables only. Nothing is altered or deleted.
--
-- ROLLBACK (manual): DROP TABLE IF EXISTS reading_events; DROP TABLE IF EXISTS
-- reading_sessions; DROP TABLE IF EXISTS section_variants; DROP TABLE IF EXISTS
-- source_sections; DROP TABLE IF EXISTS source_editions; DROP TABLE IF EXISTS sources;
-- The prior application never referenced them and keeps working unchanged.

-- ---------------------------------------------------------------------------
-- 10.5 SOURCES. One row per work, with the provenance the book demands.
-- `translation_status` is deliberately not free-form praise: 'public_domain',
-- 'official' (only when it genuinely is), 'licensed', or 'unknown'.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sources (
  id                 TEXT PRIMARY KEY,          -- stable slug, e.g. 'art_of_war'
  title              TEXT NOT NULL,
  author             TEXT NOT NULL,
  original_language  TEXT,
  first_published    TEXT,                      -- year or period, as text (some are ranges)
  notes              TEXT,                      -- editorial notes about the work itself
  created_at         TEXT DEFAULT (datetime('now'))
);

-- One row per edition/translation actually shipped. completeness says plainly whether
-- the included text is the whole work.
CREATE TABLE IF NOT EXISTS source_editions (
  id                 TEXT PRIMARY KEY,          -- e.g. 'art_of_war:giles_1910'
  source_id          TEXT NOT NULL REFERENCES sources(id),
  translator         TEXT,
  edition            TEXT,
  publication_year   TEXT,
  source_url         TEXT,
  translation_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (translation_status IN ('public_domain','official','licensed','unknown')),
  portion_included   TEXT,                      -- e.g. 'Chapters I-XIII (complete)'
  completeness       TEXT NOT NULL DEFAULT 'unknown'
    CHECK (completeness IN ('complete','partial','excerpt','unknown')),
  editorial_notes    TEXT,
  checksum           TEXT,                      -- version checksum of the shipped text
  created_at         TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_source_editions_source ON source_editions(source_id);

-- ---------------------------------------------------------------------------
-- 10.6 SECTIONS. Paragraph-level anchors are the shared identifier everything else
-- points at: `anchor` is stable and citable (e.g. 'art_of_war:1:4' = chapter 1,
-- paragraph 4).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_sections (
  anchor         TEXT PRIMARY KEY,
  edition_id     TEXT NOT NULL REFERENCES source_editions(id),
  chapter_idx    INTEGER NOT NULL,
  chapter_title  TEXT,
  paragraph_idx  INTEGER NOT NULL,
  text           TEXT NOT NULL,
  word_count     INTEGER NOT NULL DEFAULT 0,
  original_term  TEXT,                          -- e.g. 始計, where the passage carries one
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sections_edition_chapter
  ON source_sections(edition_id, chapter_idx, paragraph_idx);

-- 10.5: "Where translations or editions disagree on wording, display the disagreement
-- rather than resolving it silently." One row per alternative rendering.
CREATE TABLE IF NOT EXISTS section_variants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  anchor      TEXT NOT NULL REFERENCES source_sections(anchor),
  edition_id  TEXT NOT NULL REFERENCES source_editions(id),
  text        TEXT NOT NULL,
  note        TEXT,                             -- why the renderings differ
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_section_variants_anchor ON section_variants(anchor);

-- ---------------------------------------------------------------------------
-- 10.1 READING SESSIONS. A session is opened when a chapter is opened and closed when
-- the reader leaves. dwell_seconds and max_scroll_pct are accumulated from the events
-- below, and `plausible` is the application's own verdict — never the client's claim.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reading_sessions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER REFERENCES users(id),
  edition_id     TEXT,                           -- nullable: books not yet catalogued
  book_id        TEXT NOT NULL,                  -- the id the reader UI already uses
  chapter_idx    INTEGER NOT NULL,
  unit_id        INTEGER,                        -- the curriculum unit, when opened from one
  started_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_event_at  TEXT,
  dwell_seconds  INTEGER NOT NULL DEFAULT 0,
  max_scroll_pct INTEGER NOT NULL DEFAULT 0,
  sections_seen  INTEGER NOT NULL DEFAULT 0,
  word_count     INTEGER NOT NULL DEFAULT 0,     -- words in the chapter being read
  plausible      INTEGER NOT NULL DEFAULT 0,     -- the verdict (0/1), server-computed
  closed_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_reading_sessions_owner
  ON reading_sessions(user_id, book_id, chapter_idx);

-- Append-only traversal record: which anchor was reached, and when. This is the
-- "traversal" half of 10.1 and the section-level position record.
CREATE TABLE IF NOT EXISTS reading_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES reading_sessions(id),
  user_id     INTEGER REFERENCES users(id),
  anchor      TEXT,                              -- section anchor reached, when known
  scroll_pct  INTEGER NOT NULL DEFAULT 0,
  elapsed_ms  INTEGER NOT NULL DEFAULT 0,        -- since the previous event
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reading_events_session ON reading_events(session_id);

CREATE TRIGGER IF NOT EXISTS trg_reading_events_no_update
BEFORE UPDATE ON reading_events
BEGIN
  SELECT RAISE(ABORT, 'READING_EVENTS_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS trg_reading_events_no_delete
BEFORE DELETE ON reading_events
BEGIN
  SELECT RAISE(ABORT, 'READING_EVENTS_APPEND_ONLY');
END;
