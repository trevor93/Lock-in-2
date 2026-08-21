// Book 7 — spaced repetition: SM-2 -> FSRS (Free Spaced Repetition Scheduler).
//
// WHY. The Tongue drill currently schedules with SM-2 (an `ease` multiplier +
// fixed early steps; see src/routes/tongue.ts). SM-2 models a card with one
// number (ease) and reschedules by multiplying the interval. FSRS models memory
// with two variables — Stability S (days for recall probability to fall to 90%)
// and Difficulty D (1..10) — fit to how spaced-repetition actually decays, and
// schedules to a chosen target retention. Expected benefit: fewer reviews for
// the same retention, and honest per-card difficulty instead of a single ease.
//
// This module is PURE (no DB, no clock): given prior memory state, a grade, and
// the days elapsed since the card was last seen, it returns the next state and
// interval. Wiring it into the review route + migrating history is a later slice;
// the review_items table already carries stability/difficulty/last_review columns
// (migration 0012) for that switch.
//
// Formulas follow FSRS-4.5 (open-spaced-repetition). Grades used across the app
// are 0 blank | 1 shaky | 2 solid | 3 fluent; FSRS ratings are 1 Again | 2 Hard |
// 3 Good | 4 Easy, so rating = grade + 1.

export type MemoryState = { stability: number; difficulty: number }

// FSRS-4.5 default weights. Tunable per-user later; the scheduling PROPERTIES the
// tests assert (stability grows on success, drops on lapse, difficulty stays in
// range, higher retention -> shorter interval) hold for any sane weight vector.
export const FSRS_DEFAULT_WEIGHTS = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031,
  1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755,
] as const

export const FSRS_DECAY = -0.5
// FACTOR makes retrievability exactly 0.9 when elapsed = stability.
export const FSRS_FACTOR = 19 / 81
export const DEFAULT_REQUEST_RETENTION = 0.9

const clampDifficulty = (d: number) => Math.min(10, Math.max(1, d))
const clampStability = (s: number) => Math.max(0.1, s)

/** Probability of recall for a card of stability S after `elapsedDays`. */
export function retrievability(elapsedDays: number, stability: number): number {
  return Math.pow(1 + FSRS_FACTOR * Math.max(0, elapsedDays) / stability, FSRS_DECAY)
}

/** Whole-day interval that lands the card at `requestRetention` recall probability. */
export function intervalForRetention(
  stability: number,
  requestRetention = DEFAULT_REQUEST_RETENTION,
): number {
  const raw = (stability / FSRS_FACTOR) * (Math.pow(requestRetention, 1 / FSRS_DECAY) - 1)
  return Math.max(1, Math.round(raw))
}

function initialDifficulty(rating: number, w: readonly number[]): number {
  return clampDifficulty(w[4] - w[5] * (rating - 3))
}
function initialStability(rating: number, w: readonly number[]): number {
  return clampStability(w[rating - 1])
}

function nextDifficulty(d: number, rating: number, w: readonly number[]): number {
  const delta = d - w[6] * (rating - 3)
  // Mean-revert toward the "Easy" anchor so difficulty doesn't drift unbounded.
  const reverted = w[7] * initialDifficulty(4, w) + (1 - w[7]) * delta
  return clampDifficulty(reverted)
}

function stabilityAfterRecall(
  d: number, s: number, r: number, rating: number, w: readonly number[],
): number {
  const hardPenalty = rating === 2 ? w[15] : 1
  const easyBonus = rating === 4 ? w[16] : 1
  const growth =
    Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) *
    (Math.exp(w[10] * (1 - r)) - 1) * hardPenalty * easyBonus
  return clampStability(s * (1 + growth))
}

function stabilityAfterLapse(
  d: number, s: number, r: number, w: readonly number[],
): number {
  const postLapse =
    w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r))
  // A forgotten card is never MORE stable than it was.
  return clampStability(Math.min(postLapse, s))
}

/**
 * Advance a card. `prior` is null for a card's first-ever review. `elapsedDays`
 * is days since it was last reviewed (ignored for the first review). Returns the
 * next memory state and the next interval in whole days.
 */
export function fsrsReview(
  prior: MemoryState | null,
  grade: number,
  elapsedDays: number,
  weights: readonly number[] = FSRS_DEFAULT_WEIGHTS,
  requestRetention = DEFAULT_REQUEST_RETENTION,
): { state: MemoryState; interval: number } {
  const rating = grade + 1 // 0..3 -> 1..4
  if (rating < 1 || rating > 4) throw new RangeError('grade must be 0..3')

  if (!prior) {
    const state = {
      stability: initialStability(rating, weights),
      difficulty: initialDifficulty(rating, weights),
    }
    return { state, interval: intervalForRetention(state.stability, requestRetention) }
  }

  const r = retrievability(elapsedDays, prior.stability)
  const difficulty = nextDifficulty(prior.difficulty, rating, weights)
  const stability = rating === 1
    ? stabilityAfterLapse(prior.difficulty, prior.stability, r, weights)
    : stabilityAfterRecall(prior.difficulty, prior.stability, r, rating, weights)
  const state = { stability, difficulty }
  return { state, interval: intervalForRetention(stability, requestRetention) }
}

/**
 * Stated one-way mapping from a legacy SM-2 row to an initial FSRS state, used
 * once when migrating existing cards. Assumptions: the SM-2 interval was chosen
 * for ~90% retention, so it is a fair estimate of Stability; and SM-2 `ease`
 * (1.3 hard .. ~2.7 easy) inversely tracks FSRS Difficulty, nudged up by lapses.
 * New reviews after migration use pure FSRS, so any imprecision here washes out
 * within a few reviews.
 */
export function sm2ToFsrs(sm2: {
  interval_days: number
  ease: number
  lapses: number
}): MemoryState {
  const stability = clampStability(sm2.interval_days > 0 ? sm2.interval_days : 0.5)
  // ease 2.5 -> D 2.5 ; ease 1.3 -> D ~9.4 ; each lapse adds 0.3.
  const difficulty = clampDifficulty(2.5 + (2.5 - sm2.ease) * (7.5 / 1.2) + sm2.lapses * 0.3)
  return { stability, difficulty }
}
