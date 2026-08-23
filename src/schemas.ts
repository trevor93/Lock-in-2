// Book 7 refactor — request/response validation schemas (the schemas/ layer).
// Pure Zod definitions and their small factories; depend only on zod. Agent
// scope schemas stay in index.tsx with the AGENT_SCOPES constant they read.
import { z } from 'zod'

export const positiveIdSchema = z.string().regex(/^[1-9]\d*$/)
  .transform(Number).refine(Number.isSafeInteger)
export const chapterIndexSchema = z.string().regex(/^(0|[1-9]\d*)$/)
  .transform(Number).refine(Number.isSafeInteger)
export const dateSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 && date.getUTCDate() === day
})
export const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
export const optionalText = (max: number) =>
  z.string().max(max).optional().nullable()
export const optionalTrimmedText = (max: number) =>
  z.string().trim().max(max).optional().nullable()
export const requiredTrimmedText = (min: number, max: number) =>
  z.string().trim().min(min).max(max)
export const optionalDate = dateSchema.optional().nullable()
export const gradeSchema = z.number().int().min(0).max(3)
// Book 8.3 - ten honest states. The legacy trio (pending/done/skipped) is kept
// as synonyms so historical rows and older clients keep working unchanged.
export const blockStatusSchema = z.enum([
  'planned', 'active', 'completed', 'completed_late', 'partial', 'rescheduled',
  'intentionally_canceled', 'displaced_by_priority', 'missed', 'unreported',
  'pending', 'done', 'skipped',
])
// Book 8.4 - every miss names a cause before it can be rescheduled.
export const missCauseSchema = z.enum([
  'unrealistic_duration', 'overpacked_schedule', 'low_energy', 'interruption',
  'unclear_next_action', 'avoidance', 'insufficient_preparation', 'wrong_priority',
  'forgotten_log', 'emergency', 'technology_failure',
])
export const loadReductionReasonSchema = z.enum([
  'wrong_time', 'too_long', 'wrong_prereq', 'dont_want_it',
])
export const predictionOutcomeSchema = z.enum(['right', 'wrong', 'void'])
export const responseCategorySchema = z.enum([
  'deflection', 'wit', 'power', 'mystery', 'boundaries', 'praise',
  'conflict', 'small_talk', 'negotiation', 'silence',
])
export const tongueModeSchema = z.enum([
  'recall', 'cloze', 'first_letters', 'reverse', 'delivery',
])
// Book 9 - the sixteen domains collapse to six. Both are accepted: new captures
// use the six, historical rows keep their legacy value and are grouped under the
// domain they now belong to (see src/intel-domains.ts). Nothing becomes unfindable.
export const intelDomainSchema = z.enum([
  'people', 'network', 'intimacy', 'money', 'tactics', 'wisdom',
  'loyalty', 'family', 'friends', 'community', 'neighbours', 'classmates',
  'women_relationships', 'hustle', 'society', 'manipulation_spotted',
  'clever_move', 'dumb_move', 'workaround', 'other',
])
export const intelVerdictSchema = z.enum(['smart', 'dumb', 'neutral', 'pending'])
export const bookStatusSchema = z.enum(['unread', 'reading', 'done'])
export const hermesRoleSchema = z.enum(['user', 'assistant'])

export const passwordBodySchema = z.strictObject({
  password: z.string().min(1).max(1024),
})
export const tickBodySchema = z.strictObject({
  tz: z.string().trim().min(1).max(100).optional(),
})

// Book 8.2 / 8.6 — recovery and re-entry.
export const recoveryBodySchema = z.strictObject({
  date: dateSchema.optional(),
  action: z.string().trim().min(1).max(500),
})
export const catchupBodySchema = z.strictObject({
  // Optional operator hint when the log is too sparse to infer absence length.
  days_absent_override: z.number().int().min(0).max(3650).optional(),
})
export const blockLogBodySchema = z.strictObject({
  status: blockStatusSchema,
  note: optionalText(4000),
})
export const appealBodySchema = z.strictObject({
  block_id: z.number().int().positive(),
  block_date: dateSchema,
  reason: requiredTrimmedText(100, 10000),
})
export const loadReductionBodySchema = z.strictObject({
  reason: loadReductionReasonSchema,
})
export const predictionBodySchema = z.strictObject({
  claim: requiredTrimmedText(10, 2000),
  confidence: z.number().int().min(50).max(99),
  resolve_by: dateSchema,
  domain: z.string().trim().max(100).optional().nullable(),
})
export const predictionResolutionBodySchema = z.strictObject({
  outcome: predictionOutcomeSchema,
  note: optionalText(4000),
})
export const debriefBodySchema = z.strictObject({
  date: optionalDate,
  wins: optionalText(10000),
  breaks: optionalText(10000),
  tomorrow_targets: optionalText(10000),
  strategy_insight: optionalText(10000),
  mood: z.number().int().min(1).max(5).optional().nullable(),
  energy: z.number().int().min(1).max(5).optional().nullable(),
  sleep_time: timeSchema.optional().nullable(),
  wake_time: timeSchema.optional().nullable(),
  sleep_hours: z.number().min(0).max(24).optional().nullable(),
})
export const unitStepBodySchema = z.strictObject({
  step: z.enum(['reading', 'drill', 'complete']),
  drill_report: optionalText(20000),
  debrief_answer: optionalText(20000),
  exam_answers: z.array(z.string().max(20000)).max(200).optional(),
  exam_self_score: z.number().int().min(0).max(100).optional(),
  date: optionalDate,
})
export const maximBodySchema = z.strictObject({
  source: requiredTrimmedText(1, 500),
  principle: requiredTrimmedText(1, 4000),
  naive_reading: optionalText(10000),
  master_reading: optionalText(10000),
  my_words: optionalText(10000),
})
export const myWordsBodySchema = z.strictObject({
  my_words: optionalText(10000),
})
export const cardReviewBodySchema = z.strictObject({
  grade: gradeSchema,
  date: optionalDate,
})
export const tongueBodySchema = z.strictObject({
  situation: requiredTrimmedText(1, 10000),
  trigger_q: requiredTrimmedText(1, 10000),
  response: requiredTrimmedText(1, 10000),
  why_works: optionalTrimmedText(10000),
  source: optionalTrimmedText(1000),
  category: responseCategorySchema.optional(),
})
export const tongueReviewBodySchema = z.strictObject({
  grade: gradeSchema,
  mode: tongueModeSchema,
  date: optionalDate,
})
export const tongueExamBodySchema = z.strictObject({
  total: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  date: optionalDate,
}).refine((body) => body.correct <= body.total)
export const lawCheckBodySchema = z.strictObject({
  date: dateSchema,
  kept: z.boolean(),
  note: optionalText(4000),
})
export const captureHeatSchema = z.enum(['calm', 'baited', 'proud', 'afraid'])
export const intelBodySchema = z.strictObject({
  log_date: optionalDate,
  domain: intelDomainSchema,
  title: requiredTrimmedText(1, 1000),
  situation: optionalText(20000),
  my_move: optionalText(20000),
  outcome: optionalText(20000),
  verdict: intelVerdictSchema.optional(),
  principle_used: optionalText(10000),
  lesson: optionalText(20000),
  people: optionalText(4000),
  // Book 13.2 — capture heat and its required brake.
  heat: captureHeatSchema.optional(),
  alternative_explanation: optionalText(2000),
})
export const agentIntelBodySchema = intelBodySchema.extend({
  analysis: optionalText(20000),
}).strict()
export const intelVerdictBodySchema = z.strictObject({
  verdict: z.enum(['smart', 'dumb', 'neutral']),
  lesson: optionalText(20000),
})
export const bookProgressBodySchema = z.strictObject({
  status: bookStatusSchema.optional(),
  last_para: z.number().int().nonnegative().optional(),
  notes: optionalText(20000),
  date: optionalDate,
})
export const MODEL_USER_INPUT_CHARS = 16000
export const MODEL_TOTAL_INPUT_CHARS = 48000
export const hermesBodySchema = z.strictObject({
  message: requiredTrimmedText(1, 20000),
  date: optionalDate,
})
export const councilBodySchema = z.strictObject({ date: optionalDate })
export const agentDebriefBodySchema = debriefBodySchema
export const agentBlockLogBodySchema = z.strictObject({
  block_id: z.number().int().positive(),
  date: optionalDate,
  status: blockStatusSchema,
  note: optionalText(4000),
})
export const agentMessageBodySchema = z.strictObject({
  content: requiredTrimmedText(1, 20000),
  role: hermesRoleSchema.optional(),
})

// Book 7 alarms — Web Push subscription + notification preferences.
// The endpoint must be an https push-service URL; the key material is base64url
// handed out by the browser, bounded so a malformed subscription is refused.
const base64UrlText = (max: number) =>
  z.string().trim().min(1).max(max).regex(/^[A-Za-z0-9_-]+$/)
export const pushSubscriptionBodySchema = z.strictObject({
  endpoint: z.string().trim().url().max(1000).refine((u) => u.startsWith('https://')),
  p256dh: base64UrlText(200),
  auth: base64UrlText(100),
  device_label: optionalTrimmedText(100),
})
export const pushUnsubscribeBodySchema = z.strictObject({
  endpoint: z.string().trim().url().max(1000),
})
const clockTime = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
export const notificationPreferencesBodySchema = z.strictObject({
  blocks_enabled: z.boolean().optional(),
  debrief_enabled: z.boolean().optional(),
  review_enabled: z.boolean().optional(),
  quiet_start: clockTime.optional(),
  quiet_end: clockTime.optional(),
  lead_minutes: z.number().int().min(0).max(60).optional(),
})

// Book 8.1 — the ratchet. Promotion/demotion name a block the commander already owns.
export const ratchetPromoteBodySchema = z.strictObject({
  block_id: positiveIdSchema.or(z.number().int().positive()),
})
export const ratchetDemoteBodySchema = z.strictObject({
  block_id: positiveIdSchema.or(z.number().int().positive()),
  reason: optionalTrimmedText(500),
})

// Book 8.4 - recording a miss diagnosis (and rescheduling only after it).
export const missCauseBodySchema = z.strictObject({
  cause: missCauseSchema,
  note: optionalTrimmedText(1000),
  date: optionalDate,
})

// Book 8.7 - the interface register (Hermes is governed separately by Book 15).
export const toneBodySchema = z.strictObject({
  tone: z.enum(['neutral', 'firm', 'military', 'compassionate']),
})

// Book 10.1 - measured reading. The client reports what it observed; the server
// decides what it means. word_count is the chapter being displayed, so a verdict
// is always about THIS text.
export const readingOpenBodySchema = z.strictObject({
  book_id: requiredTrimmedText(1, 100),
  chapter_idx: z.number().int().nonnegative().max(1000),
  word_count: z.number().int().nonnegative().max(500000),
  edition_id: optionalTrimmedText(200),
  unit_id: z.number().int().positive().optional(),
})
export const readingProgressBodySchema = z.strictObject({
  session_id: z.number().int().positive(),
  scroll_pct: z.number().int().min(0).max(100),
  elapsed_ms: z.number().int().min(0).max(600000),
  anchor: optionalTrimmedText(200),
})
export const readingCloseBodySchema = z.strictObject({
  session_id: z.number().int().positive(),
})

// Book 10.2 - mastery evidence. The rubric is nine dimensions scored 0-3; the
// self-score is accepted and stored for calibration but is never a gate.
const rubricScore = z.number().int().min(0).max(3)
export const masteryRubricSchema = z.strictObject({
  recall: rubricScore.optional(), explanation: rubricScore.optional(),
  mechanism: rubricScore.optional(), application: rubricScore.optional(),
  reversal: rubricScore.optional(), defence: rubricScore.optional(),
  evidence: rubricScore.optional(), transfer: rubricScore.optional(),
  retention: rubricScore.optional(),
})
export const masteryEvidenceBodySchema = z.strictObject({
  subject_kind: z.enum(['unit', 'concept', 'principle', 'capture', 'section']),
  subject_id: requiredTrimmedText(1, 200),
  level: z.enum(['encountered', 'recalled', 'explained', 'applied', 'transferred', 'integrated']),
  evidence_kind: requiredTrimmedText(1, 50),
  evidence_ref: optionalTrimmedText(200),
  body: optionalTrimmedText(20000),
  rubric: masteryRubricSchema.optional(),
  graded_by: z.enum(['adversarial', 'cloze', 'diff']).optional(),
  self_score: z.number().int().min(0).max(100).optional(),
  transfer_ref: optionalTrimmedText(200),
  no_source: z.boolean().optional(),
})
// Book 10.3/10.4 - retrieval with confidence recorded before and after.
const confidence = z.number().int().min(0).max(100)
export const retrievalBodySchema = z.strictObject({
  subject_kind: z.enum(['unit', 'concept', 'principle', 'capture', 'section']),
  subject_id: requiredTrimmedText(1, 200),
  anchor: optionalTrimmedText(200),
  passage: optionalText(20000),
  prompt: requiredTrimmedText(1, 2000),
  answer: requiredTrimmedText(1, 20000),
  confidence_before: confidence,
  confidence_after: confidence.optional(),
  same_session: z.boolean().optional(),
  used_source: z.boolean().optional(),
})
export const clozeBodySchema = z.strictObject({
  answers: z.array(z.string().trim().max(200)).min(1).max(100),
  confidence_before: confidence,
  confidence_after: confidence.optional(),
  same_session: z.boolean().optional(),
  used_source: z.boolean().optional(),
})

// Book 10 - curriculum slugs (principles, concepts, graph nodes).
export const slugParamSchema = z.string().trim().min(1).max(100).regex(/^[a-z0-9_:-]+$/)

// ---------------------------------------------------------------------------
// Book 11 / 12 — the Farnsworth track and the two Labs.
// ---------------------------------------------------------------------------
const figureSlugSchema = z.string().trim().min(1).max(60).regex(/^[a-z_]+$/)
const assessmentScore = z.number().int().min(0).max(3)

// 11.3 Day 2: the app logs THAT Tier 1 was copied and WHEN. There is deliberately no
// text field — Book 11.8 and Law 22 keep the commonplace book on paper.
export const commonplaceLogBodySchema = z.strictObject({
  figure_slug: figureSlugSchema,
  specimen_id: z.number().int().positive().optional().nullable(),
  copied_on: dateSchema,
  // The column is TEXT: his commonplace book is paper and its pages may be labelled
  // however he labels them. The app records the reference, never the content.
  page_of_book: optionalTrimmedText(60),
})

// 11.3 — one row per cycle day completed.
export const cycleDayBodySchema = z.strictObject({
  chapter_id: z.number().int().min(1).max(19),
  cycle_day: z.number().int().min(1).max(7),
  occurred_on: dateSchema,
  note: optionalTrimmedText(2000),
})

// 11.3 Day 5 — the copia drill. Bad renderings are submitted WITH the rest and marked,
// never withheld: "volume is the trainer, not quality."
export const copiaSessionBodySchema = z.strictObject({
  figure_slug: figureSlugSchema,
  seed_sentence: requiredTrimmedText(1, 2000),
  occurred_on: dateSchema,
  renderings: z.array(z.strictObject({
    text: requiredTrimmedText(1, 2000),
    self_marked_bad: z.boolean().optional(),
  })).min(1).max(100),
})

// 11.3 Day 6 + 12.5 — a deployment, with its script, notation, never-list and pivots.
export const deploymentBodySchema = z.strictObject({
  figure_slug: figureSlugSchema,
  occurred_on: dateSchema,
  context: requiredTrimmedText(1, 4000),
  what_happened: requiredTrimmedText(1, 4000),
  fit: z.enum(['fits', 'barely', 'fails']),
  counterpart_noticed: z.boolean(),
  script: optionalTrimmedText(8000),
  delivery_notation: optionalTrimmedText(2000),
  never_list: optionalTrimmedText(2000),
  pivots: z.array(z.strictObject({
    trigger: requiredTrimmedText(1, 200),
    response: requiredTrimmedText(1, 2000),
  })).max(20).optional(),
})

// 12.1 — the six-slot canon map. All six are required by the schema, because 12.1's
// gate is that a figure cannot be named until the map is complete.
export const canonMapBodySchema = z.strictObject({
  purpose: z.enum([
    'inform', 'clarify', 'persuade', 'repair', 'decline', 'negotiate',
    'de-escalate', 'inspire', 'pause', 'challenge',
  ]),
  audience: requiredTrimmedText(1, 4000),
  occasion: requiredTrimmedText(1, 4000),
  proof: requiredTrimmedText(1, 8000),
  arrangement: requiredTrimmedText(1, 4000),
  delivery: requiredTrimmedText(1, 4000),
})

// 12.2 — an exercise attempt. why_not_obvious is required by 12.6 on any saved line,
// and the route refuses the attempt when it is missing or when the line reads like a reel.
export const rhetoricAttemptBodySchema = z.strictObject({
  exercise_type: requiredTrimmedText(1, 60),
  figure_slug: figureSlugSchema.optional().nullable(),
  canon_map_id: z.number().int().positive().optional().nullable(),
  prompt: optionalTrimmedText(4000),
  answer: requiredTrimmedText(1, 20000),
  version_plain: optionalTrimmedText(8000),
  version_controlled: optionalTrimmedText(8000),
  version_excessive: optionalTrimmedText(8000),
  excess_diagnosis: optionalTrimmedText(8000),
  why_not_obvious: optionalTrimmedText(4000),
  source_room: optionalTrimmedText(500),
  confidence_before: confidence.optional(),
  confidence_after: confidence.optional(),
  occurred_on: dateSchema,
})

// 12.6 — detection proposes; his correction is the training signal.
export const figureDetectionBodySchema = z.strictObject({
  text: requiredTrimmedText(1, 20000),
})
export const figureCorrectionBodySchema = z.strictObject({
  corrected: z.array(figureSlugSchema).max(20),
})

// 12.3 — the inbound analysis card, all nine questions.
export const inboundCardBodySchema = z.strictObject({
  text: requiredTrimmedText(1, 20000),
  figure_used: figureSlugSchema.optional().nullable(),
  emphasis: requiredTrimmedText(1, 4000),
  expectation_created: requiredTrimmedText(1, 4000),
  what_is_repeated: requiredTrimmedText(1, 4000),
  what_is_omitted: requiredTrimmedText(1, 4000),
  emotion_activated: requiredTrimmedText(1, 4000),
  action_wanted: requiredTrimmedText(1, 4000),
  independently_supported: z.boolean(),
  survives_plain_statement: z.boolean(),
})

// 12.4 — the outbound red-team card, all four questions, mandatory before deployed.
export const outboundCardBodySchema = z.strictObject({
  attempt_id: z.number().int().positive().optional().nullable(),
  draft: requiredTrimmedText(1, 20000),
  overstates_certainty: z.boolean(),
  hides_downside: z.boolean(),
  pressures_rather_than_persuades: z.boolean(),
  defensible_if_quoted: z.boolean(),
  notes: optionalTrimmedText(4000),
})

// 12.7 — a built response. Four layers, never a bare line.
export const responseBuildBodySchema = z.strictObject({
  intent_slug: z.enum([
    'boundary', 'pressure', 'provocation', 'loaded_question', 'negotiation',
    'disagreement', 'clarify', 'repair', 'de_escalate', 'inspire', 'pause',
  ]),
  situation: requiredTrimmedText(1, 4000),
  layer_intent: requiredTrimmedText(1, 4000),
  layer_truth: requiredTrimmedText(1, 4000),
  layer_structure: requiredTrimmedText(1, 8000),
  layer_delivery: requiredTrimmedText(1, 4000),
  a_appropriateness: assessmentScore.optional(),
  a_clarity: assessmentScore.optional(),
  a_proportionality: assessmentScore.optional(),
  a_naturalness: assessmentScore.optional(),
  a_objective_achieved: assessmentScore.optional(),
  a_escalation_risk: assessmentScore.optional(),
  occurred_on: dateSchema,
})

// 11.5 — a card review. `correct` is what was actually answered; the ladder step is
// derived from it, never submitted.
export const rhetoricCardReviewBodySchema = z.strictObject({
  correct: z.boolean(),
  produced: optionalTrimmedText(4000),
  reviewed_on: optionalDate,
})

// 11.9 — a recording is a REFERENCE to his own file (11.8), never an upload.
export const recordingBodySchema = z.strictObject({
  kind: z.enum(['baseline', 'thirty_day', 'written_baseline']),
  file_reference: requiredTrimmedText(1, 500),
  made_on: dateSchema,
  programme_day: z.number().int().min(0).max(400).optional().nullable(),
  duration_seconds: z.number().int().min(0).max(86400).optional().nullable(),
  word_count: z.number().int().min(0).max(100000).optional().nullable(),
})

// 11.9 — the self-audit mark on a chapter: U, R, or N.
export const selfAuditBodySchema = z.strictObject({
  self_audit: z.enum(['U', 'R', 'N']),
})

// 11.7 slot 5 — his OWN example of the figure. Kept apart from the book's specimens
// because it is his, and because Tier 1 stays small (11.4).
export const figureOwnExampleBodySchema = z.strictObject({
  text: requiredTrimmedText(1, 4000),
  context: optionalTrimmedText(2000),
})

// 11.5 — a card is created from a figure and a card type. The ladder step is never
// submitted: a new card starts at step 0 and is moved only by a recorded review.
export const rhetoricCardBodySchema = z.strictObject({
  card_type: z.enum(['name_to_definition', 'skeleton_to_example', 'situation_to_figure']),
  figure_slug: figureSlugSchema,
  specimen_id: z.number().int().positive().optional().nullable(),
  due_date: optionalDate,
})
