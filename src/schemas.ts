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
