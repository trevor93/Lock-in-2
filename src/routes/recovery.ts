// Book 7 refactor — the re-entry routes (Book 8.2/8.6): Minimum Viable Recovery
// and the deterministic /catchup protocol (its taxonomy + helpers travel here).
import { Hono } from 'hono'
import { hasLanded, isPartial, isExcusedFromScoring } from '../block-status'
import type { Bindings, Variables } from '../env'
import { parseJson } from '../validation'
import { requestId, auditEvent } from '../request-support'
import { safeDate, userNow } from '../clock'
import { addDays } from '../time'
import { blocksForDate } from '../repositories'
import { computeStreak } from '../streak'
import { writeDaySummary } from '../enforcement'
import { recoveryBodySchema, catchupBodySchema } from '../schemas'

export function registerRecoveryRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {
// ============ RECOVERY & RE-ENTRY (Book 8.2 / 8.6) ============

// The 8.4 miss-diagnosis taxonomy, reused as the /catchup mechanism vocabulary.
const MISS_TAXONOMY = [
  'unrealistic duration', 'overpacked schedule', 'low energy', 'interruption',
  'unclear next action', 'avoidance', 'insufficient preparation', 'wrong priority',
  'forgotten log', 'emergency', 'technology failure',
] as const

// Consecutive days ending yesterday with no logged activity (a block
// done/partial, or a debrief). Bounded walk; the server owns the clock.
async function computeDaysAbsent(DB: D1Database, userId: number, today: string): Promise<number> {
  let absent = 0
  for (let i = 1; i <= 60; i++) {
    const d = addDays(today, -i)
    const act = await DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM block_logs WHERE user_id=? AND log_date=? AND status IN ('done','partial')) AS blocks,
         (SELECT COUNT(*) FROM debriefs WHERE user_id=? AND log_date=?) AS debriefs`,
    ).bind(userId, d, userId, d).first<{ blocks: number; debriefs: number }>()
    if ((act?.blocks ?? 0) > 0 || (act?.debriefs ?? 0) > 0) break
    absent++
  }
  return absent
}

// A likely cause from the taxonomy — named as a structural hypothesis, never a
// character verdict (Book R2 register). For this operator a multi-day stop is
// the documented overpacking failure (R14), not a moral one.
async function inferMechanism(
  DB: D1Database, userId: number, today: string, daysAbsent: number,
): Promise<typeof MISS_TAXONOMY[number]> {
  if (daysAbsent >= 3) return 'overpacked schedule'
  const y = addDays(today, -1)
  const blocks = await blocksForDate(DB, userId, y)
  if (blocks.length >= 6) return 'overpacked schedule'
  const coreMissed = blocks.some((b: any) =>
    (b.is_non_negotiable || (b.weight ?? 1) >= 3) &&
    !(hasLanded(b.log_status) || isPartial(b.log_status) || isExcusedFromScoring(b.log_status)))
  if (coreMissed) return 'unclear next action'
  return 'low energy'
}

// What was actually missed, reported as fact and never rewritten. One entry per
// recent absent day, capped so the briefing stays short.
async function buildMissed(
  DB: D1Database, userId: number, today: string, daysAbsent: number,
): Promise<Array<{ date: string; unlogged_blocks: number; debrief_missed: boolean }>> {
  const out: Array<{ date: string; unlogged_blocks: number; debrief_missed: boolean }> = []
  const span = Math.min(Math.max(daysAbsent, 1), 7)
  for (let i = 1; i <= span; i++) {
    const d = addDays(today, -i)
    const blocks = await blocksForDate(DB, userId, d)
    const scored = blocks.filter((b: any) => (b.weight ?? 1) > 0)
    const unlogged = scored.filter((b: any) =>
      !(hasLanded(b.log_status) || isPartial(b.log_status) || isExcusedFromScoring(b.log_status))).length
    const deb = await DB.prepare(
      `SELECT 1 AS d FROM debriefs WHERE user_id=? AND log_date=?`,
    ).bind(userId, d).first<{ d: number }>()
    out.push({ date: d, unlogged_blocks: unlogged, debrief_missed: !deb })
  }
  return out
}

// The single protected keystone for tomorrow, drawn from the operator's own
// CORE anchors so it is real, not invented.
async function buildKeystone(DB: D1Database, userId: number, today: string) {
  const t = addDays(today, 1)
  const blocks = await blocksForDate(DB, userId, t)
  const core = blocks
    .filter((b: any) => b.is_mvd || b.is_non_negotiable || (b.weight ?? 1) >= 3)
    .sort((a: any, b: any) => String(a.start_time).localeCompare(String(b.start_time)))
  const anchor = core[0] || blocks[0]
  return {
    action: anchor ? String(anchor.title) : 'One deep block',
    start_time: anchor && /^\d{2}:\d{2}$/.test(String(anchor.start_time)) ? String(anchor.start_time) : '06:00',
    environment: 'The room where you do focused work. Phone in another room.',
    first_physical_action: 'Sit down and open the material. Nothing more is required to begin.',
  }
}

// POST /api/recovery — log the single restoring action for a breach day; the
// day then survives the streak (Book 8.2). One per day, idempotent.
app.post('/api/recovery', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const body = await parseJson(c, recoveryBodySchema)
  const date = await safeDate(DB, body.date, userId)
  const claim = await DB.prepare(
    `INSERT OR IGNORE INTO recovery_actions (user_id, action_date, action_text)
     VALUES (?,?,?)`,
  ).bind(userId, date, body.action.trim()).run()
  // Re-materialise the day so mvr_held reflects the action (survival, not victory).
  await writeDaySummary(DB, userId, date, false)
  const streak = await computeStreak(DB, userId, (await userNow(DB, userId)).date)
  const rid = requestId(c)
  if (rid && (claim.meta as any).changes > 0) {
    await auditEvent(DB, {
      userId, actorType: 'user', requestId: rid,
      action: 'recovery.log', entityType: 'recovery_action', entityId: date,
      metadata: { date },
    })
  }
  return c.json({ ok: true, date, streak, already: (claim.meta as any).changes === 0 })
})

// POST /api/catchup — the re-entry protocol (Book 8.6), in fixed output order.
// Deterministic and offline-safe: it reads the record, it does not call a model.
app.post('/api/catchup', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const body = await parseJson(c, catchupBodySchema)
  const { date } = await userNow(DB, userId)
  const daysAbsent = body.days_absent_override ?? await computeDaysAbsent(DB, userId, date)
  const trigger: 'manual' | 'auto_zero_streak' = daysAbsent >= 3 ? 'auto_zero_streak' : 'manual'

  const missed = await buildMissed(DB, userId, date, daysAbsent)
  const mechanism = await inferMechanism(DB, userId, date, daysAbsent)
  const keystone = await buildKeystone(DB, userId, date)

  // What NOT to do — the recovery path never generates these (Book 8.6).
  const do_not = [
    'Do not reschedule the days you missed. Backlog is forgiven, not carried.',
    'Do not add extra load to compensate. There is no make-up debt.',
    'Do not write a self-critical entry. Record what happened, not a verdict on yourself.',
  ]

  const minimum_viable_recovery =
    'One action, right now, small enough to finish in ten minutes and close enough to a CORE anchor to count. Do it, then log it — that single act makes today a non-broken day.'

  // One structural change, matched to the mechanism (time/environment/cue/scope/support).
  const patchByMechanism: Record<string, { dimension: string; suggestion: string }> = {
    'overpacked schedule': { dimension: 'scope', suggestion: 'Cut the mandatory set to a single keystone until you hold it cleanly for seven days. The deck waits.' },
    'unclear next action': { dimension: 'cue', suggestion: 'Define the first physical action for the keystone the night before, written down, so starting needs no decision.' },
    'low energy': { dimension: 'time', suggestion: 'Move the keystone to your highest-energy hour and protect the hour before it.' },
  }
  const structural_patch = patchByMechanism[mechanism] ||
    { dimension: 'environment', suggestion: 'Remove the one friction that most reliably stops you starting.' }

  // Absence over fourteen days re-opens the five-question diagnostic and
  // re-seats the ratchet at whatever level it supports (Book 8.6).
  let diagnostic: string[] | null = null
  let reseat_level: number | null = null
  if (daysAbsent > 14) {
    diagnostic = [
      'Separate one fact from one interpretation in a recent situation.',
      'Map a choice you face by timing, terrain, options, and downside.',
      'Improve a flat sentence without overstating it.',
      'Write a calm, concise refusal to a request you should decline.',
      "Retrieve yesterday's concept from memory, without notes.",
    ]
    reseat_level = 1 // re-seat at the base ratchet: three anchors only
  }

  const protocol = {
    days_absent: daysAbsent,
    trigger,
    missed,
    mechanism,
    do_not,
    minimum_viable_recovery,
    structural_patch,
    keystone,
    diagnostic,
    reseat_level,
  }

  await DB.prepare(
    `INSERT INTO catchup_sessions
       (user_id, trigger_type, days_absent, missed_json, mechanism, mvr_prompt,
        structural_patch, keystone_json, diagnostic_json, reseat_level)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    userId, trigger, daysAbsent, JSON.stringify(missed), mechanism,
    minimum_viable_recovery, JSON.stringify(structural_patch),
    JSON.stringify(keystone), diagnostic ? JSON.stringify(diagnostic) : null,
    reseat_level,
  ).run()

  const rid = requestId(c)
  if (rid) {
    await auditEvent(DB, {
      userId, actorType: 'user', requestId: rid,
      action: 'catchup.run', entityType: 'catchup_session', entityId: date,
      metadata: { days_absent: daysAbsent, trigger, mechanism },
    })
  }
  return c.json(protocol)
})
}
