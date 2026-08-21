// Book 7 refactor — the daily-flow routes: the read-only /api/state heartbeat,
// the /api/tick engine crank (the only place enforcement runs, server clock),
// block logging with the window-close rule, appeals, load reduction, the
// prediction log, and debriefs. Orchestrators come from ../state and
// ../enforcement; scoring/clock/validation from their modules.
import { Hono } from 'hono'
import type { Bindings, Variables } from '../env'
import { parseJson, parseValue, parseEmptyBody, RequestValidationError } from '../validation'
import { withIdempotency } from '../request-support'
import { safeDate, userNow } from '../clock'
import { addDays, isoWeekKey } from '../time'
import { getSetting, setSetting } from '../repositories'
import { timingSafeEq } from '../crypto'
import { runEnforcement, writeDaySummary } from '../enforcement'
import { buildState } from '../state'
import {
  tickBodySchema, blockLogBodySchema, appealBodySchema, loadReductionBodySchema,
  predictionBodySchema, predictionResolutionBodySchema, debriefBodySchema, positiveIdSchema,
} from '../schemas'

export function registerDayRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {
// ============ STATE (read-only heartbeat) + TICK (the engine crank) ============
// GET /api/state no longer mutates anything — engines run ONLY via POST /api/tick,
// with the SERVER's clock. A client can no longer time-travel penalties into existence.
// buildState extracted to ./state (Book 7).


// READ — no side effects, ever. Server clock, client clock ignored.
app.get('/api/state', async (c) => {
  const userId = c.get('userId')
  const { date, time } = await userNow(c.env.DB, userId)
  return c.json(await buildState(c.env.DB, userId, date, time))
})

// VERSION — the cheap "has anything changed?" probe that replaces polling.
// Book 6: the client refreshes on focus, after an action, and near a block
// boundary. When it does need to check, this costs a few indexed MAX() reads
// instead of a full /api/state build, and answers 304 when nothing moved.
app.get('/api/version', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { date, time } = await userNow(DB, userId)
  // Highest rowid + newest key per consequence-bearing table. Any write the UI
  // cares about moves at least one of these. day_summary is keyed by date, not
  // by an autoincrement id, so its marker is the newest summary_date plus a
  // row count (a re-finalised day updates in place without adding a row).
  const marks = await DB.batch([
    DB.prepare(
      `SELECT COALESCE(MAX(id),0) AS m FROM block_logs WHERE user_id=?`,
    ).bind(userId),
    DB.prepare(
      `SELECT COALESCE(MAX(id),0) AS m FROM points_ledger WHERE user_id=?`,
    ).bind(userId),
    DB.prepare(
      `SELECT COALESCE(MAX(id),0) AS m FROM honesty_flags WHERE user_id=?`,
    ).bind(userId),
    DB.prepare(
      `SELECT COALESCE(MAX(summary_date),'-') || ':' || COUNT(*) AS m
       FROM day_summary WHERE user_id=?`,
    ).bind(userId),
  ])
  const stamp = (marks as any[])
    .map((r) => String(r.results?.[0]?.m ?? 0))
    .join('.')
  // The civil date and the current minute are part of the version so a block
  // boundary or midnight rollover invalidates it even with no new writes.
  const version = `${date}T${time}-${stamp}`
  const etag = `W/"${version}"`

  if (c.req.header('if-none-match') === etag) {
    c.header('ETag', etag)
    return c.body(null, 304)
  }
  c.header('ETag', etag)
  return c.json({ version, date, time })
})

// CRANK — the ONLY place engines run. Server-derived date/time; future dates impossible.
app.post('/api/tick', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const body = await parseJson(c, tickBodySchema)
  // capture the commander's timezone once (first tick from the UI sends it)
  if (body.tz && !(await getSetting(DB, 'timezone_locked', userId))) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: body.tz })
      await setSetting(DB, 'timezone', body.tz, userId)
      await setSetting(DB, 'timezone_locked', '1', userId)
    } catch (_) {
      throw new RequestValidationError()
    }
  }
  const { date, time } = await runEnforcement(c.env.DB, userId)
  return c.json(await buildState(DB, userId, date, time))
})

// runEnforcement extracted to ./enforcement (Book 7).

// Cloudflare Pages has no native scheduled handler. A separately configured Cron
// Worker calls this POST with the shared secret; no client-supplied clock is read.
app.post('/internal/jobs/enforcement', async (c) => {
  const expected = c.env.ENFORCEMENT_JOB_SECRET
  const authorization = c.req.header('authorization') || ''
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!expected || !supplied || !timingSafeEq(supplied, expected)) {
    return c.json({ error: 'INVALID INTERNAL CREDENTIAL' }, 401)
  }
  await parseEmptyBody(c)

  const owners = (await c.env.DB.prepare(`SELECT id FROM users WHERE role='owner' ORDER BY id`).all()).results as Array<{ id: number }>
  const runs = []
  for (const owner of owners) runs.push(await runEnforcement(c.env.DB, owner.id))
  return c.json({ ok: true, runs })
})




// ============ BLOCK LOGGING ============
// Date is SERVER-derived. You log the block you are living, not the day you wish.
app.post('/api/blocks/:id/log', async (c) => withIdempotency(c, 'block:log', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  const { status, note } = await parseJson(c, blockLogBodySchema)
  const { date } = await userNow(DB, userId)
  const block = await DB.prepare(
    `SELECT * FROM schedule_blocks WHERE id=? AND user_id=?`,
  ).bind(id, userId).first<any>()
  if (!block) return c.json({ error: 'no such block' }, 404)

  const prev = await DB.prepare(
    `SELECT * FROM block_logs WHERE block_id=? AND log_date=? AND user_id=?`,
  ).bind(id, date, userId).first<any>()
  // Book 8.3/8.4: a window that closed with no status leaves the block
  // `unreported` - a data state carrying a prompt, not a verdict. It can be
  // resolved, but the cause comes first: "Record the cause before rescheduling."
  if (prev && prev.status === 'unreported') {
    const diagnosed = await DB.prepare(
      `SELECT 1 AS x FROM block_miss_causes WHERE user_id=? AND block_id=? AND log_date=?`,
    ).bind(userId, id, date).first<{ x: number }>()
    if (!diagnosed) {
      return c.json({
        error: 'CAUSE REQUIRED. This block passed without a status. Record what caused the miss (POST /api/blocks/' + id + '/cause) before setting a status.',
        needsCause: true,
      }, 409)
    }
  }
  // THE WINDOW RULE: a block auto-canceled by the enforcement engine is CLOSED.
  // The only exit is the weekly appeal token (which costs a permanent written reason).
  if (prev && prev.status === 'missed') {
    return c.json({ error: 'WINDOW CLOSED. "' + block.title + '" was auto-canceled unlogged — it cannot be reopened. The penalty stands. One appeal token per week exists, if you can face writing the reason.' }, 409)
  }

  // atomic: log + points transition in one batch
  const stmts: D1PreparedStatement[] = [
    DB.prepare(
      `INSERT INTO block_logs (user_id, block_id, log_date, status, note, completed_at)
       VALUES (?,?,?,?,?,datetime('now'))
       ON CONFLICT(block_id, log_date) DO UPDATE SET
         status=excluded.status, note=excluded.note, completed_at=excluded.completed_at
       WHERE block_logs.user_id=excluded.user_id`
    ).bind(userId, id, date, status, note || null)
  ]
  const prevEarned = prev && (prev.status === 'done' || prev.status === 'partial')
  const nowEarns = status === 'done' || status === 'partial'
  if (nowEarns && !prevEarned) {
    const p = status === 'done' ? block.points : Math.ceil(block.points / 2)
    stmts.push(DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type, ref_id)
       VALUES (?,?,?,?,?,?)`,
    ).bind(userId, date, p, `${status === 'done' ? 'Completed' : 'Partial'}: ${block.title} (+${p})`, 'block', id))
  } else if (!nowEarns && prevEarned) {
    const p = prev.status === 'done' ? block.points : Math.ceil(block.points / 2)
    stmts.push(DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type, ref_id)
       VALUES (?,?,?,?,?,?)`,
    ).bind(userId, date, -p, `Reverted: ${block.title} (-${p})`, 'block', id))
  }
  await DB.batch(stmts)
  await writeDaySummary(DB, userId, date, false)
  return c.json({ ok: true, date })
}))

// ============ APPEALS — one token per week, permanent reason ============
app.post('/api/appeals', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { block_id, block_date, reason } = await parseJson(c, appealBodySchema)
  const { date } = await userNow(DB, userId)
  if (!reason || String(reason).trim().length < 100) {
    return c.json({ error: 'THE REASON IS THE PRICE. Write at least 100 characters explaining exactly what happened — this goes on the permanent record.' }, 400)
  }
  if (!block_id || !block_date) return c.json({ error: 'block_id and block_date required' }, 400)
  if (block_date > date) return c.json({ error: 'Cannot appeal the future.' }, 400)
  if (block_date < addDays(date, -7)) return c.json({ error: 'Too late. Appeals reach back 7 days at most — old wounds stay closed.' }, 400)
  const log = await DB.prepare(
    `SELECT l.* FROM block_logs l JOIN schedule_blocks b ON b.id=l.block_id
     WHERE l.user_id=? AND b.user_id=? AND l.block_id=? AND l.log_date=?`,
  ).bind(userId, userId, block_id, block_date).first<any>()
  if (!log || log.status !== 'missed') return c.json({ error: 'That block was not auto-canceled. Appeals only reopen closed windows.' }, 400)
  const week = isoWeekKey(date)
  const used = await DB.prepare(
    `SELECT id FROM appeals WHERE user_id=? AND week_key=?`,
  ).bind(userId, week).first()
  if (used) return c.json({ error: 'APPEAL TOKEN SPENT. One per week — the next one arrives Monday.' }, 409)
  const ins = await DB.prepare(
    `INSERT OR IGNORE INTO appeals
       (user_id, appeal_date, block_id, block_date, reason, week_key)
     VALUES (?,?,?,?,?,?)`
  ).bind(userId, date, block_id, block_date, String(reason).trim(), week).run()
  if ((ins.meta as any).changes === 0) {
    return c.json({ error: 'APPEAL TOKEN SPENT. One per week — the next one arrives Monday.' }, 409)
  }
  // reopen the window: missed → pending, ack the flag, refund the penalty
  const pen = await DB.prepare(
    `SELECT COALESCE(SUM(points),0) p FROM points_ledger
     WHERE user_id=? AND log_date=? AND ref_type='flag' AND ref_id=? AND points<0`
  ).bind(userId, block_date, block_id).first<any>()
  const stmts: D1PreparedStatement[] = [
    DB.prepare(
      `UPDATE block_logs SET status='pending', note='REOPENED BY APPEAL ('||?||')'
       WHERE user_id=? AND block_id=? AND log_date=?`,
    ).bind(date, userId, block_id, block_date),
    DB.prepare(
      `UPDATE honesty_flags SET acknowledged=1
       WHERE user_id=? AND flag_date=? AND flag_type='missed_live'
         AND ref_type='block' AND ref_id=?`,
    ).bind(userId, block_date, block_id),
  ]
  if ((pen?.p ?? 0) < 0) {
    stmts.push(DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type, ref_id)
       VALUES (?,?,?,?,?,?)`,
    ).bind(userId, date, -pen.p, `APPEAL GRANTED: penalty refunded for reopened window (block #${block_id}, ${block_date}). The reason is on the permanent record.`, 'appeal', block_id))
  }
  await DB.batch(stmts)
  await writeDaySummary(DB, userId, block_date, false)
  return c.json({ ok: true, refunded: -(pen?.p ?? 0) })
})
app.get('/api/appeals', async (c) => {
  const userId = c.get('userId')
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, b.title FROM appeals a
     JOIN schedule_blocks b ON b.id=a.block_id AND b.user_id=a.user_id
     WHERE a.user_id=? ORDER BY a.created_at DESC LIMIT 50`
  ).bind(userId).all()
  return c.json(results)
})

// ============ LOAD REDUCTION — answer the why ============
app.post('/api/load-reductions/:id/answer', async (c) => {
  const userId = c.get('userId')
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  const { reason } = await parseJson(c, loadReductionBodySchema)
  const updated = await c.env.DB.prepare(
    `UPDATE load_reductions SET reason=?, answered_at=datetime('now') WHERE id=? AND user_id=?`,
  ).bind(reason, id, userId).run()
  if ((updated.meta as any).changes === 0) return c.json({ error: 'not found' }, 404)
  const advice: Record<string, string> = {
    wrong_time: 'Then MOVE it. Edit the block to the hour your energy actually supports it.',
    too_long: 'Then SHRINK it permanently. A 25-minute block done daily beats a 90-minute block done never.',
    wrong_prereq: 'Then fix the pipeline. What has to exist before this block can succeed? Schedule THAT.',
    dont_want_it: 'Then that is the real finding. Either recommit for a reason you actually believe, or delete it with honor. Zombie blocks corrupt the whole ledger.'
  }
  return c.json({ ok: true, advice: advice[reason] })
})

// ============ PREDICTION LOG — the calibration instrument ============
app.post('/api/predictions', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { claim, confidence, resolve_by, domain } =
    await parseJson(c, predictionBodySchema)
  const { date } = await userNow(DB, userId)
  if (resolve_by <= date) return c.json({ error: 'Resolution date must be in the future.' }, 400)
  const r = await DB.prepare(
    `INSERT INTO predictions (user_id, made_date, claim, confidence, resolve_by, domain)
     VALUES (?,?,?,?,?,?)`
  ).bind(userId, date, claim, confidence, resolve_by, domain || null).run()
  return c.json({ ok: true, id: r.meta.last_row_id })
})
app.get('/api/predictions', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM predictions WHERE user_id=?
     ORDER BY (outcome='unresolved') DESC, resolve_by ASC, id DESC LIMIT 200`,
  ).bind(c.get('userId')).all()
  return c.json(results)
})
app.post('/api/predictions/:id/resolve', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  const { outcome, note } = await parseJson(c, predictionResolutionBodySchema)
  const { date } = await userNow(DB, userId)
  const p = await DB.prepare(`SELECT * FROM predictions WHERE id=? AND user_id=?`)
    .bind(id, userId).first<any>()
  if (!p) return c.json({ error: 'not found' }, 404)
  if (p.outcome !== 'unresolved') return c.json({ error: 'Already resolved. The record does not get rewritten.' }, 409)
  await DB.prepare(`UPDATE predictions SET outcome=?, resolved_date=?, resolution_note=? WHERE id=? AND user_id=?`)
    .bind(outcome, date, note || null, p.id, userId).run()
  return c.json({ ok: true })
})
// Calibration report: Brier score, bucketed curve, plain-language bias
app.get('/api/predictions/calibration', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT confidence, outcome FROM predictions
     WHERE user_id=? AND outcome IN ('right','wrong')`
  ).bind(c.get('userId')).all()
  const rows = results as any[]
  if (!rows.length) return c.json({ n: 0, brier: null, buckets: [], verdict: 'No resolved predictions yet. Make claims. Date them. Grade them.' })
  let brier = 0
  const buckets: Record<string, { n: number; hits: number; confSum: number }> = {}
  for (const r of rows) {
    const p = r.confidence / 100, hit = r.outcome === 'right' ? 1 : 0
    brier += (p - hit) ** 2
    const bk = r.confidence < 60 ? '50-59' : r.confidence < 70 ? '60-69' : r.confidence < 80 ? '70-79' : r.confidence < 90 ? '80-89' : '90-99'
    ;(buckets[bk] ||= { n: 0, hits: 0, confSum: 0 })
    buckets[bk].n++; buckets[bk].hits += hit; buckets[bk].confSum += r.confidence
  }
  brier = brier / rows.length
  const curve = Object.entries(buckets).sort().map(([range, b]) => ({
    range, n: b.n, avgConfidence: Math.round(b.confSum / b.n), hitRate: Math.round((b.hits / b.n) * 100)
  }))
  // plain-language bias statement
  const gaps = curve.filter(b => b.n >= 3).map(b => b.avgConfidence - b.hitRate)
  const avgGap = gaps.length ? Math.round(gaps.reduce((a, g) => a + g, 0) / gaps.length) : 0
  let verdict: string
  if (!gaps.length) verdict = `Only ${rows.length} graded predictions — grade at least 3 per bucket before trusting the curve.`
  else if (avgGap >= 15) verdict = `OVERCONFIDENT by ~${avgGap} points: when you say ${curve[curve.length - 1].avgConfidence}%, reality delivers ${curve[curve.length - 1].hitRate}%. Your certainty is louder than your accuracy — shave ${avgGap} points off every gut number before acting on it.`
  else if (avgGap >= 7) verdict = `Mildly overconfident (~${avgGap} pts). Decent, but when the stakes are high, treat your "sure" as "probably".`
  else if (avgGap <= -10) verdict = `UNDERCONFIDENT by ~${-avgGap} points: you know more than you let yourself act on. Your hesitation is costing you moves you would have won.`
  else verdict = `WELL CALIBRATED (gap ~${avgGap} pts, Brier ${brier.toFixed(3)}). Your stated confidence is close to reality — rare. Keep grading.`
  return c.json({ n: rows.length, brier: Number(brier.toFixed(4)), buckets: curve, verdict })
})

// ============ DEBRIEF ============
app.post('/api/debrief', async (c) => withIdempotency(c, 'debrief:file', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const b = await parseJson(c, debriefBodySchema)
  const date = await safeDate(DB, b.date, userId) // clamp: no future debriefs
  const existing = await DB.prepare(
    `SELECT id FROM debriefs WHERE user_id=? AND log_date=?`,
  ).bind(userId, date).first<{ id: number }>()
  const values = [
    b.wins || null,
    b.breaks || null,
    b.tomorrow_targets || null,
    b.strategy_insight || null,
    b.mood || null,
    b.energy || null,
    b.sleep_time || null,
    b.wake_time || null,
    b.sleep_hours || null,
  ]
  if (existing) {
    await DB.prepare(
      `UPDATE debriefs SET wins=?, breaks=?, tomorrow_targets=?, strategy_insight=?,
       mood=?, energy=?, sleep_time=?, wake_time=?, sleep_hours=?
       WHERE id=? AND user_id=?`,
    ).bind(...values, existing.id, userId).run()
  } else {
    await DB.prepare(
      `INSERT INTO debriefs
         (user_id, log_date, wins, breaks, tomorrow_targets, strategy_insight,
          mood, energy, sleep_time, wake_time, sleep_hours)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(userId, date, ...values).run()
    await DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type)
       VALUES (?,?,?,?,?)`,
    ).bind(userId, date, 25, 'Night debrief filed. Intelligence report received. (+25)', 'debrief').run()
  }
  await writeDaySummary(DB, userId, date, false)
  return c.json({ ok: true })
}))

app.get('/api/debriefs', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM debriefs WHERE user_id=? ORDER BY log_date DESC LIMIT 60`,
  ).bind(c.get('userId')).all()
  return c.json(results)
})
}
