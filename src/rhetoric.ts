// Book 11 — the Farnsworth programme as a TRACK.
//
// This module holds the parts of Book 11 that are RULES rather than rows, because a
// rule that lives only in a migration is a rule the application can drift away from:
//
//   11.1  The three-part architecture and the root node. Part III is only usable once
//         Parts I and II are in hand, "because the dramatic devices are silences and
//         gaps, and a gap only registers against an established pattern."
//   11.3  The seven-day cycle. Day 1 produces NOTHING; Day 2's copying is BY HAND;
//         Day 5 counts bad renderings; Day 6 requires a failure.
//   11.4  The tier targets, and the thousand-specimen allocation the book REJECTS with
//         the warning that "the application must not silently reintroduce it."
//   11.5  The review ladder is FIXED at 1/3/7/16/35. Not FSRS: FSRS would compute its
//         own intervals and silently override the book.
//   11.6  The thirteen chapter slots, as a schema rather than as prose.
//   11.7  The conversational-job index, every entry carrying its misuse boundary.
//   11.9  The track metrics, all falsifiable, including the one that inverts:
//         being noticed is the FAILURE condition.
//   11.10 The field default while the programme runs.

// ---------------------------------------------------------------------------
// 11.1 — the architecture, taught explicitly because the book never states it.
// ---------------------------------------------------------------------------
export const ROOT_NODE =
  'Every figure in the book is a form of controlled repetition or controlled absence. '
  + 'That is the entire technology. Parts I and II build patterns; Part III breaks them on purpose.'

export type RhetoricPart = {
  part: number
  acts_on: string
  operates_on: string
  why: string
}

export const PARTS: readonly RhetoricPart[] = [
  {
    part: 1,
    acts_on: 'words',
    operates_on: 'the ear, below the level of argument',
    why: 'Repetition is percussion. A listener feels anaphora before he understands it.',
  },
  {
    part: 2,
    acts_on: 'sentences',
    operates_on: 'comprehension and expectation',
    why: 'Chiasmus and inversion work by violating an order the listener has already predicted.',
  },
  {
    part: 3,
    acts_on: 'the listener',
    operates_on: 'stance and relationship',
    why: 'Every device here is a relationship move, not a word move: it hands the audience a job.',
  },
] as const

export const PART_ORDER_REASON =
  'Sound, then structure, then stance. First to be heard, then to be followed, then to be felt. '
  + 'Part III is only usable once Parts I and II are in hand, because the dramatic devices are '
  + 'silences and gaps, and a gap only registers against an established pattern.'

/**
 * 11.1's ordering constraint, as a gate rather than a paragraph. Part III drills are
 * refused until the earlier parts are installed, because a gap the listener cannot
 * perceive is not a device — it is just an absence.
 */
export function partIsUnlocked(
  part: number,
  installedParts: readonly number[],
): { unlocked: boolean; reason: string | null } {
  if (part <= 1) return { unlocked: true, reason: null }
  const missing = [] as number[]
  for (let earlier = 1; earlier < part; earlier++) {
    if (!installedParts.includes(earlier)) missing.push(earlier)
  }
  if (!missing.length) return { unlocked: true, reason: null }
  return {
    unlocked: false,
    reason: `Part ${part} needs Part ${missing.join(' and Part ')} first. ${PART_ORDER_REASON}`,
  }
}

// ---------------------------------------------------------------------------
// 11.2 — the phases, as fixed data. The day ranges themselves live in
// migrations/0025_rhetoric_seed.sql, which is the single source for the syllabus.
// ---------------------------------------------------------------------------
export const PHASE_CODES = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'] as const
export type PhaseCode = typeof PHASE_CODES[number]

export const TRACK_FIRST_DAY = 53   // P0 calibration
export const TRACK_LAST_DAY = 204   // end of P5, transfer to speech

// ---------------------------------------------------------------------------
// 11.3 — the seven-day cycle. Each day has one job, and three of them carry a
// constraint that the application must not quietly relax.
// ---------------------------------------------------------------------------
export type CycleDay = {
  day: number
  slug: string
  title: string
  job: string
  constraint: string | null
}

export const CYCLE_DAYS: readonly CycleDay[] = [
  {
    day: 1, slug: 'install', title: 'Install',
    job: 'The chapter is taught in full: name and etymology, plain definition, the mechanism, '
      + 'structural notation, sub-variants, and the hidden layer.',
    constraint: 'He reads and listens. He produces NOTHING. A Day 1 that asks for output is wrong.',
  },
  {
    day: 2, slug: 'tier_and_copy', title: 'Tier and copy',
    job: 'Specimens are sorted into the three tiers, and Tier 1 is copied into the commonplace book.',
    constraint: 'BY HAND. Handwriting, not typing: it slows him to the speed of the pattern. '
      + 'The app logs that it happened and when, never the text (11.8, Law 22).',
  },
  {
    day: 3, slug: 'mouth', title: 'Mouth',
    job: 'Tier 1 aloud, ten passes each, until the rhythm sits in the jaw instead of the eye. '
      + 'Then Tier 3 read aloud once, straight through, for ear-soak.',
    constraint: 'Aloud. These are auditory technologies; silent reading teaches recognition only.',
  },
  {
    day: 4, slug: 'skeleton', title: 'Skeleton',
    job: 'Tier 2 stripped to bare structural formula, then refilled with content from his own '
      + 'life, work, and arguments.',
    constraint: 'This is the day that builds capacity. Refilling with the book’s content instead '
      + 'of his own makes it a copying exercise.',
  },
  {
    day: 5, slug: 'copia', title: 'Copia',
    job: 'The Erasmus drill: one real sentence he actually had to say that week, rendered twenty '
      + 'ways through the figure.',
    constraint: 'Bad renderings INCLUDED and counted. Volume is the trainer, not quality.',
  },
  {
    day: 6, slug: 'live_fire', title: 'Live fire',
    job: 'Three deployments in real conversation: one where it fits, one where it barely fits, '
      + 'one where it fails. All three logged.',
    constraint: 'The failure is required, not tolerated. The failure teaches the boundary, and '
      + 'boundaries separate a stylist from a man who sounds like he swallowed a thesaurus.',
  },
  {
    day: 7, slug: 'consolidation', title: 'Consolidation',
    job: 'Spaced review of all prior figures, plus one commonplace page holding the five best '
      + 'constructions heard or made that week.',
    constraint: null,
  },
] as const

export const CYCLE_LENGTH = 7

/**
 * 11.3 Day 5: "one real sentence he actually had to say that week, rendered twenty ways
 * through the figure, bad renderings included." Twenty is the drill, so a session short
 * of it is reported as short rather than accepted as done.
 */
export const COPIA_TARGET = 20

/** Which day of the seven-day cycle a given track day falls on, for a chapter that began on `chapterStartDay`. */
export function cycleDayFor(day: number, chapterStartDay: number): CycleDay | null {
  const offset = day - chapterStartDay
  if (offset < 0 || offset >= CYCLE_LENGTH) return null
  return CYCLE_DAYS[offset]
}

// ---------------------------------------------------------------------------
// 11.4 — the tier system, and the allocation the book rejects.
// ---------------------------------------------------------------------------
export type TierTarget = {
  tier: 1 | 2 | 3
  name: string
  per_figure: string
  total: number
  treatment: string
  purpose: string
}

export const TIER_TARGETS: readonly TierTarget[] = [
  {
    tier: 1, name: 'Own', per_figure: '6-8', total: 150,
    treatment: 'Held verbatim and permanently.',
    purpose: 'This is the arsenal that comes out under pressure.',
  },
  {
    tier: 2, name: 'Skeleton', per_figure: 'about 20', total: 400,
    treatment: 'Structure memorised, content replaced.',
    purpose: 'This is the generative engine.',
  },
  {
    tier: 3, name: 'Ear', per_figure: 'the remainder', total: 500,
    treatment: 'Read aloud once, marked, and revisited only in review.',
    purpose: 'Trains recognition and rhythm so the figure can be heard coming in other people’s speech.',
  },
] as const

/**
 * 11.4's explicit rejection: "Memorising a thousand specimens verbatim was considered
 * and rejected as a wrong allocation of effort. The application must not silently
 * reintroduce it." Only Tier 1 is held verbatim, so only Tier 1 counts against this.
 */
export const REJECTED_VERBATIM_ALLOCATION = 1000

export const MUST_NOT_ABSORB = [
  {
    slug: 'commonplace_book',
    rule: 'The commonplace book stays handwritten. The application logs that Tier 1 was copied '
      + 'and when, and never becomes a substitute surface for it.',
  },
  {
    slug: 'deployment_log',
    rule: 'The deployment log MAY live in the application, in four columns — date, figure, '
      + 'context, what happened — because that is data the pattern engine needs.',
  },
  {
    slug: 'recordings',
    rule: 'Recordings are files the app references, not media it manages.',
  },
  {
    slug: 'law_22',
    rule: 'If a feature would make the paper obsolete without making the skill better, it is a defect.',
  },
] as const

/** True when a proposed verbatim bank has drifted back toward the rejected allocation. */
export function verbatimAllocationIsRejected(tier1Count: number): boolean {
  return tier1Count >= REJECTED_VERBATIM_ALLOCATION
}

// ---------------------------------------------------------------------------
// 11.5 — the ladder. FIXED, and deliberately not FSRS.
// ---------------------------------------------------------------------------
export const LADDER = [1, 3, 7, 16, 35] as const

export const LADDER_IS_FIXED_REASON =
  'Book 11.5 fixes the intervals at one, three, seven, sixteen and thirty-five days. FSRS would '
  + 'compute its own intervals from stability and difficulty and silently override the book, which '
  + 'is why the rhetoric cards have their own tables instead of joining review_items.'

/**
 * The next interval on the fixed ladder. Once the last rung is reached the card stays
 * there: 11.5 names five intervals and no sixth, so extrapolating one would be the
 * application inventing curriculum.
 */
export function nextLadderInterval(currentInterval: number | null): number {
  if (currentInterval === null) return LADDER[0]
  for (const rung of LADDER) if (rung > currentInterval) return rung
  return LADDER[LADDER.length - 1]
}

export const CARD_TYPES = [
  { slug: 'name_to_definition', prompt: 'figure name', answer: 'definition' },
  {
    slug: 'skeleton_to_example', prompt: 'skeleton',
    answer: 'a fresh example generated on the spot',
  },
  {
    slug: 'situation_to_figure', prompt: 'situation prompt',
    answer: 'the figure to deploy',
  },
] as const

export const DAILY_REVIEW_MINUTES = 10
export const DAILY_REVIEW_REASON =
  'Ten minutes daily, non-negotiable — this is the difference between finishing the book and owning it.'

// ---------------------------------------------------------------------------
// 11.6 — the thirteen-slot chapter delivery format, as a SCHEMA rather than as
// prose. The LEARN renderer walks this list, so a chapter cannot ship with a
// slot quietly missing.
// ---------------------------------------------------------------------------
export type ChapterSlot = { slot: number; slug: string; title: string; requirement: string }

export const CHAPTER_SLOTS: readonly ChapterSlot[] = [
  { slot: 1, slug: 'orientation', title: 'Orientation',
    requirement: 'Name, etymology, and plain-English definition.' },
  { slot: 2, slug: 'mechanism', title: 'Mechanism',
    requirement: 'Why it works on the mind. Not what it is — why it lands.' },
  { slot: 3, slug: 'notation_and_variants', title: 'Notation and variants',
    requirement: 'The structural formula, plus the named sub-variants.' },
  { slot: 4, slug: 'hidden_layer', title: 'The hidden layer',
    requirement: 'The devices the chapter conceals inside itself, made explicit.' },
  { slot: 5, slug: 'tiered_specimen_bank', title: 'Tiered specimen bank',
    requirement: 'The specimens, split across the three tiers.' },
  { slot: 6, slug: 'skeleton_set', title: 'The skeleton set',
    requirement: 'Tier 2 stripped to structure, ready for Day 4.' },
  { slot: 7, slug: 'failure_modes', title: 'Failure modes and overuse tells',
    requirement: 'How it fails, and how he will know he is overusing it.' },
  { slot: 8, slug: 'copia_drill', title: 'The copia drill',
    requirement: 'The Day 5 instruction, with the sentence slot named.' },
  { slot: 9, slug: 'live_fire_script', title: 'The live-fire script',
    requirement: 'The Day 6 three deployments: fits, barely fits, fails.' },
  { slot: 10, slug: 'conversational_conversion', title: 'Conversational conversion',
    requirement: 'How the written figure survives being spoken.' },
  { slot: 11, slug: 'sayings', title: 'Sayings',
    requirement: 'The compressed forms worth carrying.' },
  { slot: 12, slug: 'one_line_summary', title: 'One-line summary',
    requirement: 'The whole chapter in a sentence.' },
  { slot: 13, slug: 'next_figure_preview', title: 'Next-figure preview',
    requirement: 'What comes next and why it comes next.' },
] as const

/** A chapter is deliverable only when all thirteen slots are populated. */
export function missingChapterSlots(populated: readonly string[]): string[] {
  return CHAPTER_SLOTS.filter((s) => !populated.includes(s.slug)).map((s) => s.slug)
}

// ---------------------------------------------------------------------------
// 11.7 — the conversational-job index. Phase 4 consolidates it; it is seeded now
// so it is usable from Chapter 1. Every entry carries its misuse boundary in the
// same record, "because the same device that pre-empts an honest objection can
// bury a real one, and the operator must be able to see both faces at once."
// ---------------------------------------------------------------------------
export type ConversationalJob = {
  job: string
  figures: readonly string[]
  misuse_boundary: string
}

export const CONVERSATIONAL_JOBS: readonly ConversationalJob[] = [
  { job: 'making a point unforgettable', figures: ['anaphora', 'epistrophe'],
    misuse_boundary: 'The pattern supplies conviction the content lacks: three weak items in a row feel like accumulated proof.' },
  { job: 'binding a theme', figures: ['symploce', 'polyptoton'],
    misuse_boundary: 'A fixed frame around things that are not the same kind of thing presents false equivalence as arithmetic.' },
  { job: 'suspense', figures: ['anadiplosis', 'anastrophe'],
    misuse_boundary: 'The grammar supplies a "therefore" the reasoning never earned; adjacency is dressed as causation.' },
  { job: 'cadence', figures: ['isocolon', 'polysyndeton'],
    misuse_boundary: 'Matched length makes an unequal pair sound equal, and a short list sound like a flood.' },
  { job: 'reversal, and making a claim feel self-evidently balanced', figures: ['chiasmus'],
    misuse_boundary: 'The most seductive misuse in the book: reversing terms whose relation is not symmetrical, so the shape delivers a proof the logic never supplied.' },
  { job: 'energy and compression', figures: ['asyndeton', 'ellipsis'],
    misuse_boundary: 'Speed prevents examination, and what the listener supplies himself he does not argue with — including the part that would not survive being said.' },
  { job: 'raising what you decline to raise', figures: ['praeteritio'],
    misuse_boundary: 'Plants an accusation and keeps the deniability: the claim was never made, so it cannot be asked to be supported.' },
  { job: 'stopping short', figures: ['aposiopesis'],
    misuse_boundary: 'Manufactured menace — an implied threat that was never made, so it cannot be answered or withdrawn.' },
  { job: 'visible self-correction, and the credibility it buys', figures: ['metanoia'],
    misuse_boundary: 'A staged first version put there to be withdrawn, so the second arrives wearing borrowed integrity and is never scrutinised.' },
  { job: 'projecting calm through understatement', figures: ['litotes'],
    misuse_boundary: 'A serious harm minimised into acceptability, or false modesty fishing for the listener to overstate on your behalf.' },
  { job: 'pressure without accusation', figures: ['erotema'],
    misuse_boundary: 'A closed question with the accusation loaded in the premise: answering concedes the frame, refusing looks evasive.' },
  { job: 'owning the frame of the question', figures: ['hypophora'],
    misuse_boundary: 'An easy version of a hard question, answered — so the real objection now seems addressed and out of order to raise.' },
  { job: 'disarming the objection before it is spoken', figures: ['prolepsis'],
    misuse_boundary: 'The straw pre-emption: a weakened version of their objection defeated, so the strong version reads as a settled point repeated.' },
] as const

/** The situation-to-figure diagnostic index Phase 4 consolidates, keyed by figure. */
export function jobsForFigure(slug: string): ConversationalJob[] {
  return CONVERSATIONAL_JOBS.filter((j) => j.figures.includes(slug))
}

// ---------------------------------------------------------------------------
// 11.9 — measurement. All falsifiable, and one of them inverts: being noticed is
// the failure condition, so a high "noticed" ratio is a WORSE result, not a better one.
// ---------------------------------------------------------------------------
export const RECORDING_KINDS = ['baseline', 'thirty_day', 'written_baseline'] as const

export const BASELINE_MINUTES = 3
export const BASELINE_SEGMENTS = ['explaining', 'arguing', 'narrating'] as const
export const BASELINE_NEVER_LISTENED_BACK = true
export const RECORDING_INTERVAL_DAYS = 30
/** 11.9: scheduled re-listens at Day 143 and Day 204, "and only then." */
export const RELISTEN_DAYS = [143, 204] as const
export const WRITTEN_BASELINE_WORDS = 200

export const SELF_AUDIT_MARKS = [
  { mark: 'U', meaning: 'already done unconsciously' },
  { mark: 'R', meaning: 'recognised in others but not producible' },
  { mark: 'N', meaning: 'new' },
] as const

export type TrackMetric = {
  slug: string
  title: string
  measures: string
  /** Higher is better for most metrics. 'lower' marks the one that inverts. */
  better: 'higher' | 'lower'
  note: string | null
}

export const TRACK_METRICS: readonly TrackMetric[] = [
  { slug: 'identification_accuracy', title: 'Figure identification accuracy',
    measures: 'Correct figure named on inbound text.', better: 'higher', note: null },
  { slug: 'construction_accuracy', title: 'Construction accuracy',
    measures: 'His own constructions checked against the structural formula.', better: 'higher', note: null },
  { slug: 'copia_volume', title: 'Copia volume and variety',
    measures: 'Renderings produced on Day 5, and how different they are from each other.',
    better: 'higher', note: 'Bad renderings count. Volume is the trainer.' },
  { slug: 'deployment_outcomes', title: 'Deployment outcomes',
    measures: 'Day 6 results across fits, barely fits, and fails.', better: 'higher',
    note: 'A cycle with no failure logged is an incomplete cycle, not a perfect one.' },
  { slug: 'noticed_ratio', title: 'Noticed versus landed invisibly',
    measures: 'The share of deployments the counterpart noticed.', better: 'lower',
    note: 'BEING NOTICED IS THE FAILURE CONDITION. This is the one metric where a rising '
      + 'number is a worsening result, and no view of it may be rendered as progress.' },
  { slug: 'recording_comparison', title: 'Recording comparison',
    measures: 'The scheduled re-listens at Day 143 and Day 204, against the baseline.',
    better: 'higher', note: 'Compared at those two points and no others.' },
] as const

/** The one metric that must never be rendered as "more is better". */
export function metricIsInverted(slug: string): boolean {
  return TRACK_METRICS.some((m) => m.slug === slug && m.better === 'lower')
}

// ---------------------------------------------------------------------------
// 11.10 — the field default while the programme runs.
// ---------------------------------------------------------------------------
export const FIELD_DEFAULT = {
  rule: 'One figure, used once, never announced, sourced from the chapter cursor.',
  success: 'If they walk away thinking the conclusion was their own, he was correct.',
  failure: 'If they walk away remembering his style, he was too loud.',
  figures_per_exchange: 1,
  announce: false,
} as const
