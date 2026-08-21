-- Book 7 — SM-2 -> FSRS: migrate the spaced-repetition history.
--
-- review_items already carries FSRS columns (stability, difficulty, last_review),
-- left NULL by migration 0012. This backfills stability and difficulty for every
-- response review_item from its SM-2 columns, using the SAME stated mapping the
-- application applies in src/fsrs.ts sm2ToFsrs():
--   stability  = the current interval (a fair estimate of days-to-90%-recall);
--                a never-scheduled card (interval 0) seeds at 0.5.
--   difficulty = 2.5 at ease 2.5, rising as ease falls (7.5 / 1.2 = 6.25 per ease
--                point) and by 0.3 per lapse, clamped to [1, 10].
-- last_review stays NULL: the first FSRS review treats the card as reviewed on time
-- (elapsed = its interval), after which real elapsed time is tracked.
--
-- Purely additive: it only fills columns that were NULL, touches no other table,
-- and deletes nothing. New reviews after this use pure FSRS. Rollback: the prior
-- application ignores these columns; optionally NULL them again.
--
-- SCHEDULING ASSUMPTIONS + EXPECTED BENEFIT (Book 7): FSRS models memory with
-- stability + difficulty fit to real forgetting curves and schedules to a target
-- retention (default 90%), rather than SM-2's single ease multiplier. Expected
-- benefit: fewer reviews for the same retention and honest per-card difficulty.
-- test/fsrs.test.ts verifies the scheduler's properties; test/tongue-review.test.ts
-- verifies the live review flow through review_items.

UPDATE review_items
SET stability = CASE WHEN interval_days > 0 THEN interval_days ELSE 0.5 END,
    difficulty = MAX(1.0, MIN(10.0, 2.5 + (2.5 - ease) * 6.25 + lapses * 0.3))
WHERE kind = 'response' AND stability IS NULL;
