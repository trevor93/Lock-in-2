// Book 7 refactor — the scoped agent bridge API (Book 5.5). Versioned POST-only
// endpoints; the /api/agent/v1/* guard (in index.tsx, registered first) has
// already authenticated the credential, enforced its scope, and set userId.
import { Hono } from 'hono'
import type { Bindings, Variables } from '../env'
import { parseJson, parseEmptyBody } from '../validation'
import { withIdempotency } from '../request-support'
import { userNow, safeDate } from '../clock'
import { blocksForDate } from '../repositories'
import { dayAdherence } from '../scoring'
import { hermesBriefing } from '../commanders-file'
import { EXTERNAL_MESSAGE_PREFIX } from '../ai'
import { isMissed } from '../block-status'
import {
  agentIntelBodySchema, agentDebriefBodySchema,
  agentBlockLogBodySchema, agentMessageBodySchema,
} from '../schemas'

export function registerAgentV1Routes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {

// Full situational briefing for the agent (text + structured JSON)
app.post('/api/agent/v1/briefing', async (c) => {
  await parseEmptyBody(c)
  const userId = c.get('userId')
  const DB = c.env.DB
  const { date, time } = await userNow(DB, userId) // server clock; reads never run engines
  const briefing = await hermesBriefing(DB, userId, date)
  const blocks = await blocksForDate(DB, userId, date)
  const current = blocks.find((b: any) => b.start_time <= time && time < b.end_time) || null
  const next = blocks.find((b: any) => b.start_time > time) || null
  const flags = (await DB.prepare(
    `SELECT * FROM honesty_flags WHERE user_id=? AND acknowledged=0`,
  ).bind(userId).all()).results
  return c.json({ date, briefing, current, next, adherence: dayAdherence(blocks), flags, blocks })
})

// What needs attention RIGHT NOW (for the agent's watch loop → Telegram/termux-notification)
app.post('/api/agent/v1/pending', async (c) => {
  await parseEmptyBody(c)
  const userId = c.get('userId')
  const DB = c.env.DB
  const { date, time } = await userNow(DB, userId) // server clock; reads never run engines
  const blocks = await blocksForDate(DB, userId, date)
  const overdue = blocks.filter((b: any) => b.end_time <= time && !b.log_status)
  const current = blocks.find((b: any) => b.start_time <= time && time < b.end_time) || null
  const flags = (await DB.prepare(
    `SELECT * FROM honesty_flags WHERE user_id=? AND acknowledged=0 ORDER BY created_at DESC`,
  ).bind(userId).all()).results
  const debriefToday = await DB.prepare(
    `SELECT id FROM debriefs WHERE user_id=? AND log_date=?`,
  ).bind(userId, date).first()
  const dueCards = await DB.prepare(
    `SELECT COUNT(*) n FROM flashcards WHERE user_id=? AND due_date<=?`,
  ).bind(userId, date).first<any>()
  return c.json({
    date, time,
    current_block: current ? { id: current.id, title: current.title, start: current.start_time, end: current.end_time, status: current.log_status } : null,
    overdue_unlogged: overdue.map((b: any) => ({ id: b.id, title: b.title, end: b.end_time, non_negotiable: !!b.is_non_negotiable })),
    unacknowledged_flags: flags,
    debrief_filed_today: !!debriefToday,
    flashcards_due: dueCards?.n ?? 0
  })
})

app.post('/api/agent/v1/debriefs', async (c) => {
  await parseEmptyBody(c)
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM debriefs WHERE user_id=? ORDER BY log_date DESC LIMIT 60`,
  ).bind(c.get('userId')).all()
  return c.json(results)
})

app.post('/api/agent/v1/intel/read', async (c) => {
  await parseEmptyBody(c)
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM captures WHERE kind='intel' AND user_id=?
     ORDER BY log_date DESC, id DESC LIMIT 100`,
  ).bind(c.get('userId')).all()
  return c.json(results)
})

// Agent auto-journals anything it observes: intel, debrief updates, block check-offs
app.post('/api/agent/v1/intel', async (c) => withIdempotency(c, 'agent:intel', async () => {
  const userId = c.get('userId')
  const b = await parseJson(c, agentIntelBodySchema)
  const r = await c.env.DB.prepare(
    `INSERT INTO captures
       (user_id, kind, log_date, domain, title, situation, my_move, outcome, verdict,
        principle_used, lesson, people, hermes_analysis)
     VALUES (?,'intel',?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(userId, await safeDate(c.env.DB, b.log_date, userId),
    b.domain, '[HERMES] ' + b.title, b.situation || null,
    b.my_move || null, b.outcome || null, b.verdict || 'pending', b.principle_used || null,
    b.lesson || null, b.people || null, b.analysis || null).run()
  return c.json({ ok: true, id: r.meta.last_row_id })
}))

app.post('/api/agent/v1/debrief', async (c) => withIdempotency(c, 'agent:debrief', async () => {
  const userId = c.get('userId')
  const DB = c.env.DB
  const b = await parseJson(c, agentDebriefBodySchema)
  const date = await safeDate(DB, b.date, userId)
  const prev = await DB.prepare(
    `SELECT * FROM debriefs WHERE user_id=? AND log_date=?`,
  ).bind(userId, date).first<any>()
  const merge = (a: string | null | undefined, x: string | null | undefined) =>
    x ? (a ? a + '\n[HERMES] ' + x : '[HERMES] ' + x) : (a ?? null)
  const values = [
    merge(prev?.wins, b.wins),
    merge(prev?.breaks, b.breaks),
    merge(prev?.tomorrow_targets, b.tomorrow_targets),
    merge(prev?.strategy_insight, b.strategy_insight),
    b.mood ?? prev?.mood ?? null,
    b.energy ?? prev?.energy ?? null,
    b.sleep_time ?? prev?.sleep_time ?? null,
    b.wake_time ?? prev?.wake_time ?? null,
    b.sleep_hours ?? prev?.sleep_hours ?? null,
  ]
  if (prev) {
    await DB.prepare(
      `UPDATE debriefs SET wins=?, breaks=?, tomorrow_targets=?, strategy_insight=?,
         mood=?, energy=?, sleep_time=?, wake_time=?, sleep_hours=?
       WHERE id=? AND user_id=?`,
    ).bind(...values, prev.id, userId).run()
  } else {
    await DB.prepare(
      `INSERT INTO debriefs
         (user_id, log_date, wins, breaks, tomorrow_targets, strategy_insight,
          mood, energy, sleep_time, wake_time, sleep_hours)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(userId, date, ...values).run()
  }
  return c.json({ ok: true })
}))

app.post('/api/agent/v1/block-log', async (c) => withIdempotency(c, 'agent:block-log', async () => {
  const userId = c.get('userId')
  const DB = c.env.DB
  const { block_id, date, status, note } =
    await parseJson(c, agentBlockLogBodySchema)
  const block = await DB.prepare(
    `SELECT id FROM schedule_blocks WHERE id=? AND user_id=?`,
  ).bind(block_id, userId).first()
  if (!block) return c.json({ error: 'no such block' }, 404)
  const logDate = await safeDate(DB, date, userId)
  const existing = await DB.prepare(
    `SELECT id, status FROM block_logs
     WHERE user_id=? AND block_id=? AND log_date=?`,
  ).bind(userId, block_id, logDate).first<{
    id: number
    status: string
  }>()
  // Book 8.3: nothing auto-misses a block. The same-day close writes `unreported` and
  // moves no points, so a `missed` log is one the commander recorded himself - and Hermes
  // may not overwrite his own verdict. The old message called them "Auto-missed", which
  // described the engine 2c07344 removed and told an AGENT it could blame the clock.
  if (isMissed(existing?.status)) {
    return c.json({
      error: 'RECORDED AS MISSED by the commander. An agent cannot re-log it — only his weekly appeal reopens that.',
    }, 409)
  }
  if (existing) {
    await DB.prepare(
      `UPDATE block_logs SET status=?, note=?, completed_at=datetime('now')
       WHERE id=? AND user_id=?`,
    ).bind(status, note ? '[HERMES] ' + note : null, existing.id, userId).run()
  } else {
    await DB.prepare(
      `INSERT INTO block_logs
         (user_id, block_id, log_date, status, note, completed_at)
       VALUES (?,?,?,?,?,datetime('now'))`,
    ).bind(userId, block_id, logDate, status, note ? '[HERMES] ' + note : null).run()
  }
  return c.json({ ok: true })
}))

// Agent posts its counsel into the app's Council log (visible in the COUNCIL tab)
app.post('/api/agent/v1/message', async (c) => withIdempotency(c, 'agent:message', async () => {
  const userId = c.get('userId')
  const { content, role } = await parseJson(c, agentMessageBodySchema)
  await c.env.DB.prepare(
    `INSERT INTO hermes_messages (user_id, role, content, context_date)
     VALUES (?,?,?,?)`,
  ).bind(userId, role === 'user' ? 'user' : 'assistant',
    EXTERNAL_MESSAGE_PREFIX + content,
    (await userNow(c.env.DB, userId)).date).run()
  return c.json({ ok: true })
}))

// Everything endpoint: full DB export for the credential owner only.
app.post('/api/agent/v1/export', async (c) => {
  await parseEmptyBody(c)
  const userId = c.get('userId')
  const DB = c.env.DB
  const out: Record<string, any> = {}
  for (const t of ['debriefs', 'honesty_flags', 'points_ledger', 'unit_progress', 'book_progress', 'law_checks']) {
    out[t] = (await DB.prepare(`SELECT * FROM ${t} WHERE user_id=?`).bind(userId).all()).results
  }
  // Book 7: maxims and intel now live in the unified captures table, not the
  // frozen legacy tables — export from captures so newly-created rows are included.
  out['maxims'] = (await DB.prepare(
    `SELECT * FROM captures WHERE kind='maxim' AND user_id=?`,
  ).bind(userId).all()).results
  out['intel_entries'] = (await DB.prepare(
    `SELECT * FROM captures WHERE kind='intel' AND user_id=?`,
  ).bind(userId).all()).results
  return c.json(out)
})
}
