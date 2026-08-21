-- Book 8.1 — THE RATCHET. The mandatory day shrinks to what the commander can
-- actually hold; everything else becomes a deck he draws from, not a schedule that
-- indicts him.
--
-- MODEL. Every schedule block gets a tier: 'mandatory' (it carries consequence) or
-- 'deck' (visible, loggable, never scored and never penalised). One block is
-- promoted from the deck only after a clean seven-day hold on the current mandatory
-- set; a promoted block that misses three times running is demoted back.
--
-- SEEDING — no invention. The mandatory set is seeded from the commander's OWN
-- prior declarations, in this order, capped at the three anchors Book 8.1 specifies
-- and ordered by start time:
--   1. blocks he already nominated as Minimum-Viable-Day CORE (`is_mvd = 1`);
--   2. failing that, blocks he already marked non-negotiable (`is_non_negotiable = 1`).
-- If he declared neither, the set is left EMPTY and the application asks him to name
-- his three anchors rather than guessing them. While the set is empty the prior
-- scoring rule stands unchanged, so no existing day silently becomes unscored.
--
-- Additive: one column with a safe default, two new tables. No row is altered or
-- deleted, and every existing block keeps its weight, points and history.
--
-- ROLLBACK (manual): DROP TABLE IF EXISTS ratchet_events; DROP TABLE IF EXISTS
-- ratchet_state; and redeploy the prior application, which ignores `ratchet_tier`
-- (SQLite cannot drop a column in older engines; leaving it is harmless because the
-- prior application never reads it). No user data is destroyed either way.

ALTER TABLE schedule_blocks ADD COLUMN ratchet_tier TEXT NOT NULL DEFAULT 'deck';

CREATE TABLE IF NOT EXISTS ratchet_state (
  user_id           INTEGER PRIMARY KEY REFERENCES users(id),
  hold_started_on   TEXT,          -- the day the current mandatory set took its shape
  last_promotion_on TEXT,
  last_demotion_on  TEXT,
  updated_at        TEXT DEFAULT (datetime('now'))
);

-- Append-only history of how the mandatory set changed. It is evidence for pattern
-- analysis (Book 8.5) and it is why a demotion can never be quietly rewritten.
CREATE TABLE IF NOT EXISTS ratchet_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  block_id    INTEGER,
  event       TEXT NOT NULL,       -- 'seeded' | 'promoted' | 'demoted'
  occurred_on TEXT NOT NULL,
  reason      TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ratchet_events_owner ON ratchet_events(user_id, occurred_on);

CREATE TRIGGER IF NOT EXISTS trg_ratchet_events_no_update
BEFORE UPDATE ON ratchet_events
BEGIN
  SELECT RAISE(ABORT, 'RATCHET_EVENTS_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS trg_ratchet_events_no_delete
BEFORE DELETE ON ratchet_events
BEGIN
  SELECT RAISE(ABORT, 'RATCHET_EVENTS_APPEND_ONLY');
END;

-- Seed from his own CORE nominations (at most three, earliest first).
UPDATE schedule_blocks SET ratchet_tier = 'mandatory'
WHERE id IN (
  SELECT id FROM schedule_blocks b
  WHERE b.is_mvd = 1
  ORDER BY b.start_time, b.sort_order
  LIMIT 3
);

-- Only if he nominated no CORE set at all, fall back to his non-negotiables.
UPDATE schedule_blocks SET ratchet_tier = 'mandatory'
WHERE NOT EXISTS (SELECT 1 FROM schedule_blocks WHERE ratchet_tier = 'mandatory')
  AND id IN (
    SELECT id FROM schedule_blocks b
    WHERE b.is_non_negotiable = 1
    ORDER BY b.start_time, b.sort_order
    LIMIT 3
  );

INSERT INTO ratchet_events (user_id, block_id, event, occurred_on, reason)
SELECT user_id, id, 'seeded', date('now'),
       'Seeded from the commander''s own prior declaration (CORE nomination, else non-negotiable).'
FROM schedule_blocks WHERE ratchet_tier = 'mandatory';
