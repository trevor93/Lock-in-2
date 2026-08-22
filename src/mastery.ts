// Book 10.2 — THE MASTERY LADDER AND THE RUBRIC.
//
// Six levels, each with declared required evidence. A level is never a field someone
// sets: it is derived from evidence that exists. "Self-scoring is never a gate" — the
// self-score is recorded for calibration (Book 10.3) and has no vote here.
//
// Grading is adversarial. Cheap immediate testing comes from cloze deletions generated
// out of the source text; free recall is diffed against the passage; and the model is
// asked to ATTACK the answer rather than accept it (see src/ai.ts callers). What lands
// in the rubric is the attack's verdict, not the learner's opinion of himself.

export const LEVELS = [
  'encountered', 'recalled', 'explained', 'applied', 'transferred', 'integrated',
] as const
export type Level = typeof LEVELS[number]

/** What each level will not be granted without. Stated so the UI can show the bar. */
export const REQUIRED_EVIDENCE: Record<Level, string> = {
  encountered: 'A reading record — measured dwell and traversal, not a click (Book 10.1).',
  recalled: 'Short-answer retrieval with the source closed.',
  explained: 'Fifty to one hundred fifty words in your own language.',
  applied: 'A decision map, a rewrite, or a field drill in one bounded case.',
  transferred: 'Recognised in a NEW context, fit distinguished from misuse, pointing at a real decision, capture or deployment.',
  integrated: 'A case briefing, essay or oral explanation combining lenses, with accurate source handling.',
}

/** The evidence kind each level accepts. */
export const ACCEPTED_EVIDENCE: Record<Level, readonly string[]> = {
  encountered: ['reading_record'],
  recalled: ['retrieval'],
  explained: ['explanation'],
  applied: ['decision_map', 'rewrite', 'field_drill'],
  transferred: ['transfer'],
  integrated: ['case_briefing', 'essay', 'oral'],
}

export const EXPLANATION_MIN_WORDS = 50
export const EXPLANATION_MAX_WORDS = 150

/** The nine dimensions, scored 0-3. */
export const RUBRIC_DIMENSIONS = [
  'recall', 'explanation', 'mechanism', 'application',
  'reversal', 'defence', 'evidence', 'transfer', 'retention',
] as const
export type RubricDimension = typeof RUBRIC_DIMENSIONS[number]
export type Rubric = Partial<Record<RubricDimension, number>>

/** What each score means, verbatim from 10.2, so the grader and the UI agree. */
export const SCORE_MEANING: Record<number, string> = {
  0: 'absent',
  1: 'partial or vague',
  2: 'accurate and applicable',
  3: 'accurate, nuanced, transferable, and aware of its own limits',
}

/** Integrated needs a rubric mean of at least 2.5 with no dimension at zero. */
export const INTEGRATED_MIN_MEAN = 2.5

export function rubricMean(rubric: Rubric): number | null {
  const scored = RUBRIC_DIMENSIONS
    .map((d) => rubric[d])
    .filter((v): v is number => typeof v === 'number')
  if (!scored.length) return null
  return scored.reduce((a, b) => a + b, 0) / scored.length
}

export function hasZeroDimension(rubric: Rubric): boolean {
  return RUBRIC_DIMENSIONS.some((d) => rubric[d] === 0)
}

export type EvidenceSubmission = {
  level: Level
  evidence_kind: string
  rubric?: Rubric
  word_count?: number
  transfer_ref?: string | null
  /** Recorded, never consulted for the verdict. */
  self_score?: number | null
  /** True when the retrieval was taken with the source closed. */
  no_source?: boolean
}

export type EvidenceVerdict = {
  accepted: boolean
  reason: string
}

/**
 * Whether a submission is admissible evidence for the level it claims. This is the
 * gate 10.2 asks for, and it never consults `self_score`.
 */
export function admitEvidence(sub: EvidenceSubmission): EvidenceVerdict {
  const accepted = ACCEPTED_EVIDENCE[sub.level]
  if (!accepted) return { accepted: false, reason: `Unknown level.` }
  if (!accepted.includes(sub.evidence_kind)) {
    return {
      accepted: false,
      reason: `${sub.level} is evidenced by ${accepted.join(' or ')}. ${REQUIRED_EVIDENCE[sub.level]}`,
    }
  }
  if (sub.level === 'recalled' && sub.no_source === false) {
    return {
      accepted: false,
      reason: 'Retrieval counts only with the source closed. Familiarity feels like knowing; only recall proves it.',
    }
  }
  if (sub.level === 'explained') {
    const words = sub.word_count ?? 0
    if (words < EXPLANATION_MIN_WORDS || words > EXPLANATION_MAX_WORDS) {
      return {
        accepted: false,
        reason: `An explanation is ${EXPLANATION_MIN_WORDS}-${EXPLANATION_MAX_WORDS} words in your own language (this was ${words}).`,
      }
    }
  }
  if (sub.level === 'transferred' && !(sub.transfer_ref && sub.transfer_ref.trim())) {
    return {
      accepted: false,
      reason: 'Transfer needs a populated reference to a real decision, capture or deployment — otherwise it is a claim, not a transfer.',
    }
  }
  if (sub.level === 'integrated') {
    const rubric = sub.rubric || {}
    const mean = rubricMean(rubric)
    if (mean === null) {
      return { accepted: false, reason: 'Integrated status requires a graded rubric.' }
    }
    if (hasZeroDimension(rubric)) {
      return {
        accepted: false,
        reason: 'Integrated status requires no dimension at zero. One absent dimension is the gap to close next.',
      }
    }
    if (mean < INTEGRATED_MIN_MEAN) {
      return {
        accepted: false,
        reason: `Integrated status requires a rubric mean of at least ${INTEGRATED_MIN_MEAN} (this was ${mean.toFixed(2)}).`,
      }
    }
  }
  return { accepted: true, reason: `Admitted as evidence of ${sub.level}.` }
}

/**
 * The level a subject has actually reached: the highest level for which admitted
 * evidence exists, walking the ladder in order and stopping at the first gap. A later
 * level cannot be skipped, because each one rests on the one below it.
 */
export function levelFromEvidence(levelsWithEvidence: Iterable<string>): Level {
  const have = new Set(levelsWithEvidence)
  let reached: Level = 'encountered'
  for (const level of LEVELS) {
    if (have.has(level)) reached = level
    else break
  }
  return reached
}
