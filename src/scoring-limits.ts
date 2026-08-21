// Book 8.5 — the limits that keep the ledger honest instead of punitive.
//
// Two of 8.5's rules are hard bounds rather than judgements, so they live here as
// pure functions the flag writer applies to every penalty it is about to file:
//
//   "A hard cap on daily penalties."  — one bad day cannot compound into a rout.
//   "A floor on the ledger so it cannot spiral." — the total cannot fall below zero,
//   so recovery is always arithmetically possible.
//
// Both numbers are stated here, once, so the scoring changelog can cite them and the
// commander can see exactly what the ceiling and the floor are.

/** The most the honesty engine may subtract from a single day, in points. */
export const DAILY_PENALTY_CAP = 30
/** The lowest the lifetime ledger may reach. Below this, penalties stop biting. */
export const LEDGER_FLOOR = 0

/**
 * Reduce a proposed penalty so neither bound is breached. `penalty` is negative;
 * `spentToday` is the (negative) sum of penalties already filed today; `total` is the
 * current lifetime balance. Returns the penalty that may actually be written (never
 * positive, never beyond either bound) plus which bound bit, for an honest message.
 */
export function boundedPenalty(
  penalty: number, spentToday: number, total: number,
): { penalty: number; cappedByDay: boolean; cappedByFloor: boolean } {
  if (penalty >= 0) return { penalty, cappedByDay: false, cappedByFloor: false }

  // Daily cap: how much of today's allowance is left.
  const alreadyTaken = Math.min(0, spentToday)
  const dayRemaining = Math.max(0, DAILY_PENALTY_CAP + alreadyTaken)
  let allowed = -Math.min(Math.abs(penalty), dayRemaining)
  const cappedByDay = allowed > penalty      // less was allowed than was proposed

  // Ledger floor: never push the lifetime balance below the floor.
  const floorRemaining = Math.max(0, total - LEDGER_FLOOR)
  const afterFloor = -Math.min(Math.abs(allowed), floorRemaining)
  const cappedByFloor = afterFloor > allowed
  allowed = afterFloor

  // Normalise -0 so callers and tests compare against a plain zero.
  return { penalty: allowed + 0, cappedByDay, cappedByFloor }
}

/** The plain sentence appended when a bound reduced a penalty. */
export function boundNote(cappedByDay: boolean, cappedByFloor: boolean): string {
  if (cappedByFloor) {
    return ` (Ledger floor reached: the balance stops at ${LEDGER_FLOOR}, so this costs nothing further. The record still stands.)`
  }
  if (cappedByDay) {
    return ` (Daily penalty cap of ${DAILY_PENALTY_CAP} reached: nothing further is subtracted today. The record still stands.)`
  }
  return ''
}
