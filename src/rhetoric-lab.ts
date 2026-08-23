// Book 12 — Rhetoric Lab and Response Lab.
//
// The rules of Book 12, in code, because each of them is a gate rather than a topic:
//
//   12.1 Figures are chosen AFTER the six-slot canon map, never before. "Figure-first
//        composition is how a student produces ornamented nonsense." The rhetorical
//        triangle is taught with BOTH FACES.
//   12.2 Thirteen exercise types. The thirteenth teaches the anti-obvious rule as a
//        SKILL instead of enforcing it as a validator.
//   12.3 The inbound analysis card: nine questions, the defensive half.
//   12.4 The outbound red-team card: four questions, mandatory before 'deployed'.
//   12.5 The pivot table, the delivery notation, the never-list, and the Daylight Test.
//   12.6 Detection PROPOSES; his correction is the training signal. why_not_obvious is
//        mandatory. "If it reads like a reel, it is rejected." The source field records
//        the room, not the book.
//   12.7 Eleven intents, four layers, six assessment criteria.

// ---------------------------------------------------------------------------
// 12.1 — the canon layer. The gate that runs before any figure is named.
// ---------------------------------------------------------------------------
export type CanonSlot = { slug: string; title: string; asks: string }

export const CANON_SLOTS: readonly CanonSlot[] = [
  { slug: 'purpose', title: 'Purpose',
    asks: 'Which of the ten: inform, clarify, persuade, repair, decline, negotiate, '
      + 'de-escalate, inspire, pause, challenge.' },
  { slug: 'audience', title: 'Audience',
    asks: 'What they know, value, fear, need, or misunderstand.' },
  { slug: 'occasion', title: 'Occasion', asks: 'Why now, what tone, what length.' },
  { slug: 'proof', title: 'Proof',
    asks: 'The facts, examples, principles, and reasons that justify it.' },
  { slug: 'arrangement', title: 'Arrangement',
    asks: 'The order that lets a listener follow without distortion.' },
  { slug: 'delivery', title: 'Delivery',
    asks: 'Cadence, word choice, emphasis, restraint, presence.' },
] as const

export const CANON_PURPOSES = [
  'inform', 'clarify', 'persuade', 'repair', 'decline', 'negotiate',
  'de-escalate', 'inspire', 'pause', 'challenge',
] as const

export const FIGURE_FIRST_REASON =
  'Figures are chosen after the map, never before. Figure-first composition is how a student '
  + 'produces ornamented nonsense.'

/**
 * 12.1's gate: a figure cannot be named until all six canon slots are filled. Returns
 * the missing slots so the refusal can say what is missing rather than merely refusing.
 */
export function canonMapComplete(
  filled: Readonly<Record<string, string | null | undefined>>,
): { complete: boolean; missing: string[]; reason: string | null } {
  const missing = CANON_SLOTS
    .filter((s) => !String(filled[s.slug] ?? '').trim())
    .map((s) => s.slug)
  if (!missing.length) return { complete: true, missing: [], reason: null }
  return { complete: false, missing, reason: FIGURE_FIRST_REASON }
}

// The triangle, with both faces. Farnsworth teaches style; style is one canon of five,
// and a figure deployed without the triangle is decoration on an unexamined claim.
export type TriangleLeg = { slug: string; honest: string; corrupted: string }

export const TRIANGLE: readonly TriangleLeg[] = [
  { slug: 'ethos',
    honest: 'Credibility earned through truthfulness and consistency.',
    corrupted: 'Pretended expertise, or false certainty.' },
  { slug: 'logos',
    honest: 'A clear chain of reasons and evidence.',
    corrupted: 'Cherry-picking and obfuscation.' },
  { slug: 'pathos',
    honest: 'Honest acknowledgement of human stakes.',
    corrupted: 'Triggering fear, shame, or urgency to bypass judgment.' },
] as const

// ---------------------------------------------------------------------------
// 12.2 — thirteen exercise types. The thirteenth is the one that teaches rather
// than polices, which is why it is listed as an exercise and not as a validator.
// ---------------------------------------------------------------------------
export type ExerciseType = { n: number; slug: string; title: string; teaches: string | null }

export const EXERCISE_TYPES: readonly ExerciseType[] = [
  { n: 1, slug: 'identify_figure', title: 'Identify the figure', teaches: null },
  { n: 2, slug: 'construct_original', title: 'Construct an original example', teaches: null },
  { n: 3, slug: 'rewrite_with_figure', title: 'Rewrite a plain sentence using the figure', teaches: null },
  { n: 4, slug: 'strip_rhetoric', title: 'Strip rhetoric from a statement', teaches: null },
  { n: 5, slug: 'identify_proposition', title: 'Identify the factual proposition', teaches: null },
  { n: 6, slug: 'identify_omission', title: 'Identify omitted information', teaches: null },
  { n: 7, slug: 'separate_force_from_evidence', title: 'Separate emotional force from evidence', teaches: null },
  { n: 8, slug: 'rewrite_manipulative_as_honest', title: 'Rewrite manipulative rhetoric into honest persuasion', teaches: null },
  { n: 9, slug: 'respond_false_binary', title: 'Respond to false binaries', teaches: null },
  { n: 10, slug: 'respond_loaded_question', title: 'Respond to loaded questions', teaches: null },
  { n: 11, slug: 'compare_two_versions', title: 'Compare two versions for clarity and effect', teaches: null },
  { n: 12, slug: 'practise_four_deliveries', title: 'Practise neutral, warm, firm, and concise delivery', teaches: null },
  { n: 13, slug: 'three_versions_and_diagnosis',
    title: 'Three versions — plain and direct, controlled rhetorical, deliberately excessive — '
      + 'followed by a written diagnosis of exactly why the excessive version fails',
    teaches: 'This teaches the anti-obvious rule as a SKILL instead of enforcing it as a validator.' },
] as const

export const DELIVERY_REGISTERS = ['neutral', 'warm', 'firm', 'concise'] as const
export const THREE_VERSIONS = ['plain', 'controlled', 'excessive'] as const

// ---------------------------------------------------------------------------
// 12.3 — the inbound analysis card. Nine questions, the defensive half.
// ---------------------------------------------------------------------------
export const INBOUND_QUESTIONS = [
  { slug: 'figure_used', question: 'What figure is used?' },
  { slug: 'emphasis', question: 'What receives emphasis?' },
  { slug: 'expectation', question: 'What expectation is created?' },
  { slug: 'repetition', question: 'What is repeated?' },
  { slug: 'omission', question: 'What is omitted?' },
  { slug: 'emotion', question: 'Which emotion is activated?' },
  { slug: 'wanted_action', question: 'Which action does the speaker want?' },
  { slug: 'independent_support', question: 'Is the proposition independently supported?' },
  { slug: 'survives_plainly', question: 'Would the argument survive being stated plainly?' },
] as const

// ---------------------------------------------------------------------------
// 12.4 — the outbound red-team card. The mirror, run on his OWN drafts, and
// mandatory before any draft is marked deployed.
// ---------------------------------------------------------------------------
export const OUTBOUND_QUESTIONS = [
  { slug: 'overstates_certainty', question: 'Does the wording overstate certainty?' },
  { slug: 'hides_downside', question: 'Does it hide a material downside?' },
  { slug: 'pressures', question: 'Does it pressure rather than persuade?' },
  { slug: 'defensible_if_quoted', question: 'Would it remain defensible if quoted publicly?' },
] as const

export const DAYLIGHT_TEST =
  'Would it remain defensible if quoted publicly? The Daylight Test applies to every scripted exchange.'

/**
 * 12.4: the red-team card is MANDATORY before a draft is marked deployed. A missing
 * answer blocks the transition; so does an unresolved yes on the first three, because
 * those three are defects and the fourth is the Daylight Test.
 */
export function outboundGate(
  answers: Readonly<Record<string, boolean | null | undefined>>,
): { deployable: boolean; unanswered: string[]; failed: string[] } {
  const unanswered = OUTBOUND_QUESTIONS
    .filter((q) => typeof answers[q.slug] !== 'boolean')
    .map((q) => q.slug)
  const failed: string[] = []
  for (const slug of ['overstates_certainty', 'hides_downside', 'pressures']) {
    if (answers[slug] === true) failed.push(slug)
  }
  if (answers.defensible_if_quoted === false) failed.push('defensible_if_quoted')
  return { deployable: !unanswered.length && !failed.length, unanswered, failed }
}

// ---------------------------------------------------------------------------
// 12.5 — live fire. The script, the pivot table, the delivery notation, and the
// never-list. The pivots are rules, not suggestions: three of them tell him to do
// LESS, which is the part a person under pressure abandons first.
// ---------------------------------------------------------------------------
export type PivotRule = { trigger: string; execute: string; why: string }

export const PIVOT_RULES: readonly PivotRule[] = [
  { trigger: 'they say X', execute: 'execute the prepared Y',
    why: 'The prepared branch exists so the decision is not made at the moment of pressure.' },
  { trigger: 'they concede', execute: 'stop talking',
    why: 'Continuing after a concession re-opens it. There is nothing left to win.' },
  { trigger: 'they escalate', execute: 'slow the pace and ask one precise question',
    why: 'Escalation runs on tempo, and one question hands them the next move. A second question is an interrogation.' },
  { trigger: 'they deflect', execute: 'restate the request once and let the silence sit',
    why: 'Once. Restating twice converts a request into nagging and gives them the grievance.' },
] as const

export const DELIVERY_NOTATION = [
  { slug: 'pause_points', records: 'Where to pause.' },
  { slug: 'stressed_word', records: 'The one stressed word.' },
  { slug: 'pace', records: 'The pace.' },
  { slug: 'where_to_stop', records: 'Where to stop.' },
] as const

export const NEVER_LIST_SCOPE = {
  is: 'The specific things not to say, not to concede, and not to reveal in this exchange, '
    + 'regardless of provocation.',
  is_not: 'The never-list is a constraint on his own leakage, not an instruction to conceal '
    + 'material facts from someone entitled to them.',
} as const

// ---------------------------------------------------------------------------
// 12.6 — detection and the anti-obvious rule.
// Detection PROPOSES tags. His correction is stored as the training signal, which
// means the model is never the authority on what he actually did.
// ---------------------------------------------------------------------------
export const DETECTION_IS_A_PROPOSAL =
  'Figure detection proposes tags. His correction is stored as the training signal, so a '
  + 'proposed tag is never written as fact.'

export const SOURCE_IS_THE_ROOM =
  'The source field records the room, not the book: who said it, where, and when — not which '
  + 'film, podcast, or author it came from.'

// Registers that mark a line as written for an audience rather than heard in a room.
const REEL_TELLS: readonly RegExp[] = [
  /\blet that sink in\b/i,
  /\bnobody talks about\b/i,
  /\bhere'?s (?:the thing|why)\b/i,
  /\bhigh[- ]value (?:man|men|woman|women)\b/i,
  /\balpha\b|\bsigma\b|\bbeta male\b/i,
  /\bsigma (?:male|grindset)\b/i,
  /\bthey hate to see it\b/i,
  /\bstay dangerous\b/i,
  /\bunbothered\b.*\bmoisturi[sz]ed\b/i,
  /\bif (?:he|she|they) wanted to,? (?:he|she|they) would\b/i,
  /\bnever (?:explain|justify) yourself\b/i,
  /\breal (?:men|kings|queens)\b/i,
  /\bthat'?s on (?:you|them)\b.*\bperiod\b/i,
  /\bfacts only\b|\bno cap\b/i,
]

export type AntiObviousVerdict = {
  accepted: boolean
  reasons: string[]
}

/**
 * 12.6's two hard requirements on any saved line: why_not_obvious must be populated,
 * and "if it reads like a reel, it is rejected."
 *
 * This is a validator on SAVED LINES only. The teaching of the same rule is exercise
 * thirteen in 12.2, where he writes the diagnosis himself — a validator can stop a bad
 * line, but only the exercise builds the ear that stops writing them.
 */
export function antiObviousVerdict(line: {
  text: string
  why_not_obvious?: string | null
  source?: string | null
}): AntiObviousVerdict {
  const reasons: string[] = []
  const why = String(line.why_not_obvious ?? '').trim()
  if (!why) {
    reasons.push('why_not_obvious is empty. 12.6 makes it mandatory on every saved line.')
  } else if (why.length < 20) {
    reasons.push('why_not_obvious is too short to be an answer.')
  }
  const text = String(line.text ?? '')
  for (const tell of REEL_TELLS) {
    if (tell.test(text)) {
      reasons.push('If it reads like a reel, it is rejected.')
      break
    }
  }
  return { accepted: !reasons.length, reasons }
}

// ---------------------------------------------------------------------------
// 12.7 — the Response Lab. Eleven intents, four layers, six assessment criteria.
// The intents' architectures and logic live in migrations/0027_response_lab_seed.sql,
// which is the single source for them; these are the slugs and the invariants.
// ---------------------------------------------------------------------------
export const RESPONSE_INTENTS = [
  'boundary', 'pressure', 'provocation', 'loaded_question', 'negotiation',
  'disagreement', 'clarify', 'repair', 'de_escalate', 'inspire', 'pause',
] as const
export type ResponseIntent = typeof RESPONSE_INTENTS[number]

export const RESPONSE_LAYERS = [
  { slug: 'intent', asks: 'What this response is for.' },
  { slug: 'truth', asks: 'What is actually true, stated to himself first.' },
  { slug: 'structure', asks: 'The moves, in order, following the intent’s architecture.' },
  { slug: 'delivery', asks: 'Cadence, emphasis, where to stop.' },
] as const

export const NEVER_THE_LINE_ALONE =
  'Never give the line alone; give the logic of the line so it can be adapted.'

export const ASSESSMENT_CRITERIA = [
  { slug: 'appropriateness', better: 'higher' },
  { slug: 'clarity', better: 'higher' },
  { slug: 'proportionality', better: 'higher' },
  { slug: 'naturalness', better: 'higher' },
  { slug: 'objective_achieved', better: 'higher' },
  { slug: 'escalation_risk', better: 'lower' },
] as const

/** A build is complete only with all four layers. A line with no logic is the thing 12.7 replaced. */
export function missingResponseLayers(
  build: Readonly<Record<string, string | null | undefined>>,
): string[] {
  return RESPONSE_LAYERS
    .filter((l) => !String(build[`layer_${l.slug}`] ?? build[l.slug] ?? '').trim())
    .map((l) => l.slug)
}

/** escalation_risk is the one criterion where a higher score is a worse result. */
export function criterionIsInverted(slug: string): boolean {
  return ASSESSMENT_CRITERIA.some((c) => c.slug === slug && c.better === 'lower')
}
