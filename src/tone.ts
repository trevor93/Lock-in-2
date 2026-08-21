// Book 8.7 — LANGUAGE AND TONE. "Firmness without contempt is the target."
//
// Two things live here.
//
// 1. THE SEVERITY HIERARCHY, exactly as 8.7 names it: neutral, information,
//    attention, warning, critical. Red is reserved for genuine risk or failure, never
//    for ordinary incompletion — so `attention` (an unreported block, a prompt) is
//    amber, and only `critical` is red. The engine's older severity words are mapped
//    onto this ladder rather than left to drift.
//
// 2. THE TONE SETTING: neutral, firm, military, compassionate, defaulting to firm.
//    Military mode may be cold; it may never be abusive. A calm mode keeps the visual
//    sophistication without the constant warfare imagery. This is the INTERFACE
//    register only — Book 15 governs Hermes, and Hermes stays cold and exact
//    regardless of what is set here. The interface is furniture; the counsel is a
//    person.

export const SEVERITIES = ['neutral', 'information', 'attention', 'warning', 'critical'] as const
export type Severity = typeof SEVERITIES[number]

/**
 * Legacy severity words the engine has written historically, mapped onto 8.7's
 * ladder. 'serious' was used for ordinary incompletion, which 8.7 says must not read
 * as red — it becomes `warning`, leaving `critical` for genuine risk.
 */
const SEVERITY_ALIASES: Record<string, Severity> = {
  neutral: 'neutral',
  info: 'information',
  information: 'information',
  attention: 'attention',
  warn: 'attention',
  warning: 'warning',
  serious: 'warning',
  critical: 'critical',
}

export function normaliseSeverity(value?: string | null): Severity {
  if (!value) return 'neutral'
  return SEVERITY_ALIASES[value] ?? 'neutral'
}

/** Only genuine risk or failure is red. Ordinary incompletion never is. */
export function isRed(severity?: string | null): boolean {
  return normaliseSeverity(severity) === 'critical'
}

export const TONES = ['neutral', 'firm', 'military', 'compassionate'] as const
export type Tone = typeof TONES[number]
export const DEFAULT_TONE: Tone = 'firm'

export function normaliseTone(value?: string | null): Tone {
  return (TONES as readonly string[]).includes(String(value)) ? (value as Tone) : DEFAULT_TONE
}

/**
 * The core interface statements, in each register. The keys are the moments where the
 * old copy was loudest; the wording is calm and exact in every register, because 8.7
 * removes the theatrical lines outright rather than making them optional. Military is
 * clipped and cold; compassionate is warm; neutral is bare; firm is the default.
 */
export const TONE_STRINGS: Record<string, Record<Tone, string>> = {
  unreported_block: {
    neutral: 'This block passed without a status.',
    firm: 'This block passed without a status. Choose what actually happened.',
    military: 'Block closed unreported. Report the outcome.',
    compassionate: 'This block went by without a status — no judgement. When you can, record what actually happened.',
  },
  no_targets: {
    neutral: 'No targets were set last night.',
    firm: 'No targets were set last night. Set tonight’s three in the debrief.',
    military: 'No targets on record for today. Set three tonight.',
    compassionate: 'Last night ended without targets. It happens — set three tonight so tomorrow starts with a direction.',
  },
  repeated_miss: {
    neutral: 'Three similar misses have been recorded.',
    firm: 'Three similar misses suggest a scheduling problem, not a will problem.',
    military: 'Three misses, same block. The schedule is wrong. Correct it.',
    compassionate: 'Three similar misses usually mean the plan needs changing, not that you do.',
  },
  cause_required: {
    neutral: 'Record the cause before rescheduling.',
    firm: 'Record the cause before rescheduling.',
    military: 'State the cause. Then reschedule.',
    compassionate: 'Note what got in the way before you move it — that is what stops it happening again.',
  },
  day_open: {
    neutral: 'The day is in progress.',
    firm: 'The day is in progress. The mandatory set is what counts.',
    military: 'Day in progress. Hold the mandatory set.',
    compassionate: 'The day is in progress — the mandatory set is all that is being asked of you.',
  },
}

/** One statement in the commander's chosen register, falling back to firm. */
export function toned(key: string, tone: Tone): string {
  const entry = TONE_STRINGS[key]
  if (!entry) return ''
  return entry[tone] ?? entry[DEFAULT_TONE]
}
