// Book 10.3 — CALIBRATION ON LEARNING.
//
// "Every review item, rhetoric attempt, and exam records confidence_before and
// confidence_after, and computes calibration_error. This produces a second Brier score
// — knowledge calibration — rendered beside the decision Brier. Overconfidence is
// reported as a named pattern ... never as a penalty."
//
// Nothing here subtracts a point. The whole purpose is to tell him the truth about the
// gap between how well he thinks he knows something and how well he does, because
// "familiarity produces fluency illusions, and only retrieval and application refute
// them."

/** Confidence is stated 0-100; outcomes are 0..1. */
export function normaliseConfidence(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value))) / 100
}

export type CalibrationTerms = {
  /** |confidence − outcome| — how far off this one prediction was. */
  calibrationError: number
  /** (confidence − outcome)² — this event's contribution to the Brier score. */
  brierTerm: number
}

export function calibrationTerms(confidence0to100: number, outcome0to1: number): CalibrationTerms {
  const c = normaliseConfidence(confidence0to100)
  const o = Math.min(1, Math.max(0, outcome0to1))
  const diff = c - o
  return { calibrationError: Math.abs(diff), brierTerm: diff * diff }
}

/** The Brier score over a set of events: the mean squared error. Lower is better. */
export function brierScore(terms: number[]): number | null {
  if (!terms.length) return null
  return terms.reduce((a, b) => a + b, 0) / terms.length
}

export type ConfidenceBucket = {
  /** e.g. '80-89' */
  label: string
  count: number
  meanConfidence: number
  meanOutcome: number
  /** Positive means he was more confident than correct. */
  gap: number
}

/**
 * Reliability buckets: within each confidence band, what actually happened. This is
 * what makes overconfidence visible as a fact rather than an accusation.
 */
export function reliabilityBuckets(
  events: Array<{ confidence: number; outcome: number }>,
): ConfidenceBucket[] {
  const bands = new Map<number, Array<{ confidence: number; outcome: number }>>()
  for (const e of events) {
    const band = Math.min(9, Math.floor(normaliseConfidence(e.confidence) * 10))
    if (!bands.has(band)) bands.set(band, [])
    bands.get(band)!.push(e)
  }
  return [...bands.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([band, list]) => {
      const meanConfidence = list.reduce((a, e) => a + normaliseConfidence(e.confidence), 0) / list.length
      const meanOutcome = list.reduce((a, e) => a + Math.min(1, Math.max(0, e.outcome)), 0) / list.length
      return {
        label: `${band * 10}-${band * 10 + 9}`,
        count: list.length,
        meanConfidence: Number(meanConfidence.toFixed(3)),
        meanOutcome: Number(meanOutcome.toFixed(3)),
        gap: Number((meanConfidence - meanOutcome).toFixed(3)),
      }
    })
}

/** How many events before a pattern is worth naming at all. */
export const PATTERN_MIN_EVENTS = 8
/** The gap at which the pattern is named. */
export const OVERCONFIDENCE_GAP = 0.15

export type CalibrationPattern = {
  named: boolean
  /** The sentence to show him — specific, factual, and never a penalty. */
  statement: string
  gap: number | null
  events: number
}

/**
 * The named pattern. Book 10.3's own example is the shape to match: "you rate yourself
 * four of five and score two of three on reversal questions" — a concrete comparison,
 * not a label like "overconfident".
 */
export function namePattern(
  events: Array<{ confidence: number; outcome: number }>,
  subject = 'these questions',
): CalibrationPattern {
  if (events.length < PATTERN_MIN_EVENTS) {
    return {
      named: false,
      statement: `Not enough answers yet to say anything honest about calibration (${events.length} of ${PATTERN_MIN_EVENTS}).`,
      gap: null,
      events: events.length,
    }
  }
  const meanConfidence = events.reduce((a, e) => a + normaliseConfidence(e.confidence), 0) / events.length
  const meanOutcome = events.reduce((a, e) => a + Math.min(1, Math.max(0, e.outcome)), 0) / events.length
  const gap = Number((meanConfidence - meanOutcome).toFixed(3))
  const rateOutOfFive = Math.round(meanConfidence * 5)
  const scoreOutOfThree = Math.round(meanOutcome * 3)

  if (gap >= OVERCONFIDENCE_GAP) {
    return {
      named: true,
      gap,
      events: events.length,
      statement: `You rate yourself ${rateOutOfFive} of 5 and score ${scoreOutOfThree} of 3 on ${subject}. High confidence is not proof of mastery — only retrieval and application settle it. No points are involved.`,
    }
  }
  if (gap <= -OVERCONFIDENCE_GAP) {
    return {
      named: true,
      gap,
      events: events.length,
      statement: `You score better than you predict on ${subject} (${scoreOutOfThree} of 3 while rating yourself ${rateOutOfFive} of 5). You know more than you are giving yourself credit for; trust the retrieval.`,
    }
  }
  return {
    named: false,
    gap,
    events: events.length,
    statement: `Your confidence and your results agree on ${subject} within ${Math.abs(gap * 100).toFixed(0)} points. That is calibration.`,
  }
}
