// Book 10.1 — READING IS MEASURED, NOT CLICKED.
//
// "reading_done is dwell time plus traversal, never a button. A chapter is opened,
// scrolled at a plausible reading speed, and anchored, with section-level positions
// recorded."
//
// So the verdict is computed here, from what the reader actually did, and the client
// cannot assert it. Three things must all hold:
//
//   1. DWELL  — enough time was spent for the words to have been read at all;
//   2. TRAVERSAL — the reader actually reached the end of the chapter, not just
//      opened it;
//   3. PLAUSIBLE SPEED — the time spent is consistent with reading rather than
//      scrolling. Too fast is not reading. Unusually slow is fine: a paused tab, a
//      re-read, a long think are all honest.
//
// The numbers are stated once, here, so the in-app scoring changelog can cite them
// and the commander can see exactly what the application is measuring.

/** Words per minute above which the traversal cannot be reading. */
export const MAX_PLAUSIBLE_WPM = 450
/** The floor on dwell for any chapter, however short, in seconds. */
export const MIN_DWELL_SECONDS = 45
/** How much of the chapter must be traversed. */
export const MIN_SCROLL_PCT = 90
/** A gap longer than this is not counted as dwell: the reader walked away. */
export const IDLE_GAP_SECONDS = 120

export type ReadingSession = {
  dwell_seconds: number
  max_scroll_pct: number
  word_count: number
  sections_seen?: number
}

export type ReadingVerdict = {
  plausible: boolean
  /** Why, in the commander's own terms — never a scolding. */
  reason: string
  requiredSeconds: number
  dwellSeconds: number
  scrollPct: number
  wpm: number | null
}

/** The dwell a chapter of this length needs before it can count as read. */
export function requiredSeconds(wordCount: number): number {
  // At MAX_PLAUSIBLE_WPM, this many seconds is the fastest the words could pass.
  const atMaxSpeed = Math.ceil((wordCount / MAX_PLAUSIBLE_WPM) * 60)
  return Math.max(MIN_DWELL_SECONDS, atMaxSpeed)
}

/**
 * The application's own verdict on whether a chapter was read. Deliberately explicit
 * about which condition failed, because the reader deserves to know what the
 * application is measuring rather than being told "no".
 */
export function readingVerdict(session: ReadingSession): ReadingVerdict {
  const dwell = Math.max(0, Math.floor(session.dwell_seconds || 0))
  const scroll = Math.max(0, Math.min(100, Math.floor(session.max_scroll_pct || 0)))
  const words = Math.max(0, Math.floor(session.word_count || 0))
  const required = requiredSeconds(words)
  const wpm = dwell > 0 && words > 0 ? Math.round((words / dwell) * 60) : null

  const base = { requiredSeconds: required, dwellSeconds: dwell, scrollPct: scroll, wpm }

  if (scroll < MIN_SCROLL_PCT) {
    return {
      ...base,
      plausible: false,
      reason: `The chapter was not read to the end (${scroll}% traversed, ${MIN_SCROLL_PCT}% needed). Keep reading — the record waits.`,
    }
  }
  if (dwell < required) {
    return {
      ...base,
      plausible: false,
      reason: `The chapter was open for ${dwell}s; ${required}s is the fastest these ${words} words could honestly be read. Nothing is being judged — the reading simply is not recorded yet.`,
    }
  }
  if (wpm !== null && wpm > MAX_PLAUSIBLE_WPM) {
    return {
      ...base,
      plausible: false,
      reason: `That pace (${wpm} words a minute) is scrolling, not reading. The record is honest or it is worthless.`,
    }
  }
  return {
    ...base,
    plausible: true,
    reason: `Read: ${dwell}s over ${words} words${wpm !== null ? ` (${wpm} wpm)` : ''}, traversed to ${scroll}%.`,
  }
}

/**
 * Dwell contributed by one heartbeat. A gap longer than IDLE_GAP_SECONDS means the
 * reader left the page, so it adds nothing — dwell must mean attention, not an open
 * tab. Anything longer than the idle gap is clamped to it.
 */
export function dwellIncrement(elapsedMs: number): number {
  const seconds = Math.floor(Math.max(0, elapsedMs) / 1000)
  return seconds > IDLE_GAP_SECONDS ? 0 : seconds
}
