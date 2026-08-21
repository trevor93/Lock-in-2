// Book 8.3 / 8.4 — block statuses and miss diagnosis.
//
// 8.3's ten states, and what each one MEANS for scoring:
//   planned                 nothing has happened yet          (not landed, no blame)
//   active                  it is running now                 (not landed, no blame)
//   completed / done        it landed                          (full credit)
//   completed_late          it landed after its window         (full credit, recorded late)
//   partial                 some of it landed                  (half credit)
//   rescheduled             moved to another time              (excluded — not owed here)
//   intentionally_canceled  he cancelled it on purpose, honestly (not landed, mild)
//   displaced_by_priority   something more important won       (excluded — NO moral weight)
//   missed                  it did not happen                  (not landed)
//   unreported              the window passed with no status    (not landed, PROMPT not penalty)
//
// The legacy statuses ('pending', 'done', 'skipped') are kept as synonyms so no
// historical row changes meaning: pending ≡ planned, done ≡ completed,
// skipped ≡ intentionally_canceled.

export const BLOCK_STATUSES = [
  'planned', 'active', 'completed', 'completed_late', 'partial', 'rescheduled',
  'intentionally_canceled', 'displaced_by_priority', 'missed', 'unreported',
  // legacy synonyms, still written by older clients and present in history
  'pending', 'done', 'skipped',
] as const

/** Statuses that count as the work having landed. */
const LANDED = new Set(['completed', 'completed_late', 'done'])
/** Statuses that carry no moral weight at all and are excluded from scoring. */
const EXCLUDED = new Set(['rescheduled', 'displaced_by_priority'])

export const hasLanded = (status?: string | null): boolean => !!status && LANDED.has(status)
export const isPartial = (status?: string | null): boolean => status === 'partial'
/**
 * A block moved elsewhere or displaced by a genuine higher priority is not owed on
 * this day — Book 8.4: "A higher priority marks the block displaced_by_priority with
 * no moral weight."
 */
export const isExcusedFromScoring = (status?: string | null): boolean =>
  !!status && EXCLUDED.has(status)

/** Book 8.4's fixed taxonomy. A miss must name one of these before it is rescheduled. */
export const MISS_CAUSES = [
  'unrealistic_duration', 'overpacked_schedule', 'low_energy', 'interruption',
  'unclear_next_action', 'avoidance', 'insufficient_preparation', 'wrong_priority',
  'forgotten_log', 'emergency', 'technology_failure',
] as const
export type MissCause = typeof MISS_CAUSES[number]

export type Correction = {
  /** What the correction acts on — the dimension, not a punishment. */
  dimension: 'duration' | 'scope' | 'timing' | 'clarity' | 'preparation' | 'priority' | 'record' | 'none' | 'investigation'
  /** Plain, calm instruction shown to the commander. */
  action: string
  /** True only for repeated avoidance: it escalates into investigation, never points. */
  escalates?: boolean
  /** The status the block should carry once this cause is recorded, when it differs. */
  status?: string
}

/**
 * Book 8.4: "The correction follows the cause, not the penalty." Each cause maps to
 * the one change that would actually prevent the next miss.
 */
export const CORRECTIONS: Record<MissCause, Correction> = {
  unrealistic_duration: {
    dimension: 'duration',
    action: 'Reduce or split this block. A block you cannot finish is a measurement error, not a character flaw.',
  },
  overpacked_schedule: {
    dimension: 'scope',
    action: 'Return a block to the deck. The mandatory set is too wide to hold; shrink it and earn it back.',
  },
  low_energy: {
    dimension: 'timing',
    action: 'Move this block to where your energy actually is. Same work, different hour.',
  },
  interruption: {
    dimension: 'timing',
    action: 'Reschedule it and name the interruption. If the same one recurs, the environment is the problem.',
  },
  unclear_next_action: {
    dimension: 'clarity',
    action: 'Write the first physical action in one sentence before this block is scheduled again.',
  },
  avoidance: {
    dimension: 'investigation',
    action: 'Name what you are avoiding, in one line. Repeated avoidance opens an investigation rather than a larger penalty.',
    escalates: true,
  },
  insufficient_preparation: {
    dimension: 'preparation',
    action: 'Add the preparation as its own small block before this one.',
  },
  wrong_priority: {
    dimension: 'priority',
    action: 'This block was displaced by something more important. Recorded with no moral weight.',
    status: 'displaced_by_priority',
  },
  forgotten_log: {
    dimension: 'record',
    action: 'Repair the record — the work happened, the log did not. Nothing is pretended away.',
    status: 'completed_late',
  },
  emergency: {
    dimension: 'none',
    action: 'Nothing to correct. An emergency is not a discipline failure.',
    status: 'displaced_by_priority',
  },
  technology_failure: {
    dimension: 'record',
    action: 'Repair the record and note the failure. If it recurs, the tool is the problem.',
  },
}

/**
 * Whether a recorded cause means the day should carry the ordinary miss consequence.
 * A repaired log, a genuine emergency and a real displacement do not: the work either
 * happened or was rightly displaced.
 */
export function causeCarriesConsequence(cause: MissCause): boolean {
  return !['forgotten_log', 'emergency', 'wrong_priority'].includes(cause)
}
