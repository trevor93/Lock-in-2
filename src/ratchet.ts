// Book 8.1 — THE RATCHET. The mandatory day is three anchors; the thirty-block list
// is a deck he draws from, not a schedule that indicts him. A block is promoted from
// the deck only after a clean seven-day hold on the current mandatory set, and a
// promoted block that misses three times running is demoted back to the deck.
//
// The rule this module exists to enforce: consequence applies ONLY to the mandatory
// set. Deck blocks are visible and loggable and earn their points, but they are never
// scored and never penalised — that is what "the surface area of consequence shrinks
// to what he can actually hold" means in code.
//
// TRANSITION. Until a mandatory set exists (a commander who declared neither a CORE
// set nor any non-negotiable), the prior scoring rule stands unchanged and the
// application asks him to name his anchors instead of silently unscoring his day.

import { addDays } from './time'
import { hasLanded, isPartial, isExcusedFromScoring } from './block-status'

/** Book 8.1: week one is three anchors. */
export const ANCHOR_TARGET = 3
/** A clean hold of this many consecutive days earns one promotion. */
export const HOLD_DAYS = 7
/** A promoted block that misses this many times running goes back to the deck. */
export const DEMOTE_AFTER_MISSES = 3

export type RatchetBlock = {
  id: number
  title: string
  start_time: string
  end_time?: string
  category?: string
  weight?: number
  ratchet_tier?: string
  log_status?: string | null
}

export const isMandatory = (b: RatchetBlock): boolean => b.ratchet_tier === 'mandatory'

/**
 * The blocks a day is scored and penalised on. When no mandatory set has been named
 * yet the caller's original set is returned unchanged (documented transition rule),
 * so no existing day silently becomes unscored.
 */
export function consequenceBlocks<T extends RatchetBlock>(blocks: T[]): T[] {
  const mandatory = blocks.filter(isMandatory)
  return mandatory.length ? mandatory : blocks
}

/**
 * The blocks that may carry a penalty. Once a mandatory set exists it is the whole
 * surface of consequence (Book 8.1). Before that, the prior rule — his declared
 * non-negotiables — still stands, so nothing about an existing day changes silently.
 */
export function penalisedBlocks<T extends RatchetBlock & { is_non_negotiable?: number }>(
  blocks: T[],
): T[] {
  const mandatory = blocks.filter(isMandatory)
  if (mandatory.length) return mandatory
  return blocks.filter((b) => !!b.is_non_negotiable)
}

/** True when the commander has not yet named any anchor. */
export function needsAnchors(blocks: RatchetBlock[]): boolean {
  return !blocks.some(isMandatory)
}

/** A day counts as held when every mandatory block that was scheduled landed. */
export function heldCleanly(blocks: RatchetBlock[]): boolean {
  const mandatory = blocks.filter(isMandatory)
  if (!mandatory.length) return false
  return mandatory.every((b) =>
    hasLanded(b.log_status) || isPartial(b.log_status) || isExcusedFromScoring(b.log_status))
}

export type RatchetState = {
  hold_started_on: string | null
  last_promotion_on: string | null
  last_demotion_on: string | null
}

export async function readRatchetState(
  DB: D1Database, userId: number,
): Promise<RatchetState> {
  const row = await DB.prepare(
    `SELECT hold_started_on, last_promotion_on, last_demotion_on
     FROM ratchet_state WHERE user_id=?`,
  ).bind(userId).first<RatchetState>()
  return row || { hold_started_on: null, last_promotion_on: null, last_demotion_on: null }
}

/**
 * Consecutive days, counting back from `throughDate`, on which every scheduled
 * mandatory block landed. Days on which no mandatory block was scheduled are
 * skipped rather than counted as breaks — a rest day is not a failure.
 */
export async function cleanHoldDays(
  DB: D1Database,
  userId: number,
  throughDate: string,
  loadBlocks: (date: string) => Promise<RatchetBlock[]>,
  window = HOLD_DAYS,
): Promise<number> {
  let streak = 0
  for (let i = 0; i < window; i++) {
    const date = addDays(throughDate, -i)
    const blocks = await loadBlocks(date)
    const mandatory = blocks.filter(isMandatory)
    if (!mandatory.length) continue                 // nothing owed that day
    if (!heldCleanly(blocks)) break
    streak++
  }
  return streak
}

/**
 * Consecutive scheduled days, counting back from `throughDate`, on which this
 * mandatory block did NOT land. Used to demote a block that is not holding.
 */
export async function consecutiveMisses(
  DB: D1Database,
  userId: number,
  blockId: number,
  throughDate: string,
  loadBlocks: (date: string) => Promise<RatchetBlock[]>,
  window = DEMOTE_AFTER_MISSES,
): Promise<number> {
  let misses = 0
  for (let i = 0; i < window; i++) {
    const date = addDays(throughDate, -i)
    const blocks = await loadBlocks(date)
    const block = blocks.find((b) => b.id === blockId)
    if (!block) continue                            // not scheduled that day
    if (hasLanded(block.log_status) || isPartial(block.log_status)
        || isExcusedFromScoring(block.log_status)) break
    misses++
  }
  return misses
}

export type PromotionVerdict = {
  allowed: boolean
  reason: string
  holdDays: number
  mandatoryCount: number
}

/**
 * Whether the deck may hand one block up today. Below the three anchors the set is
 * still being assembled, so naming an anchor is always allowed; above it, one
 * promotion is earned per clean seven-day hold, and only one per day.
 */
export function promotionVerdict(
  mandatoryCount: number, holdDays: number, state: RatchetState, today: string,
): PromotionVerdict {
  const base = { holdDays, mandatoryCount }
  if (mandatoryCount < ANCHOR_TARGET) {
    return { ...base, allowed: true, reason: 'Naming an anchor — the mandatory set is still being assembled.' }
  }
  if (state.last_promotion_on === today) {
    return { ...base, allowed: false, reason: 'One promotion per day. Hold what you just took on.' }
  }
  if (holdDays < HOLD_DAYS) {
    return {
      ...base,
      allowed: false,
      reason: `A clean ${HOLD_DAYS}-day hold earns the next block. You are ${holdDays} of ${HOLD_DAYS}.`,
    }
  }
  return { ...base, allowed: true, reason: `Held cleanly for ${holdDays} days. The deck may hand one up.` }
}
