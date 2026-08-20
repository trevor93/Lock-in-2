-- ============================================================
-- 0011 BOOK 16 / R9 — the chapter cursor.
-- Phase Four of the Book 17 build order (serves the active front today).
--
-- The cursor is a DATABASE value, never a constant in code. Every
-- figure-of-the-week, drill, and card selection reads it. There is no default
-- starter figure in code: selection reads this row. The seeded current value
-- is Chapter 2 — Repetition at the Start — Anaphora, cycle day 1 (R9).
-- ============================================================
-- Production precondition: complete OPERATIONS.md Sections 4 and 5 first.
-- Rollback: deploy the prior application while retaining this additive table
-- and every row. The older application ignores it; no user data is deleted.

CREATE TABLE IF NOT EXISTS chapter_cursor (
  user_id INTEGER PRIMARY KEY,
  book TEXT NOT NULL DEFAULT 'Farnsworth — Classical English Rhetoric',
  part TEXT NOT NULL DEFAULT 'Repetition at the Start',
  chapter INTEGER NOT NULL DEFAULT 2 CHECK (chapter >= 1),
  figure TEXT NOT NULL DEFAULT 'Anaphora',
  cycle_day INTEGER NOT NULL DEFAULT 1 CHECK (cycle_day BETWEEN 1 AND 7),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
