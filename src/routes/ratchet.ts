// Book 8.1 — the ratchet's routes. Read the mandatory set and the hold, promote one
// block from the deck when a clean hold has earned it, and demote by choice at any
// time (shrinking the surface of consequence is always permitted).
import { Hono } from 'hono'
import type { Bindings, Variables } from '../env'
import { parseJson, parseValue } from '../validation'
import { positiveIdSchema, ratchetPromoteBodySchema, ratchetDemoteBodySchema } from '../schemas'
import { userNow } from '../clock'
import { blocksForDate } from '../repositories'
import {
  ANCHOR_TARGET, HOLD_DAYS, cleanHoldDays, promotionVerdict, readRatchetState,
} from '../ratchet'

export function registerRatchetRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {

// The commander's view of his own load: what is mandatory, what waits in the deck,
// how long the current set has held, and whether the deck may hand one up.
app.get('/api/ratchet', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { date } = await userNow(DB, userId)
  const state = await readRatchetState(DB, userId)

  const all = (await DB.prepare(
    `SELECT id, title, start_time, end_time, category, days, weight, points, ratchet_tier
     FROM schedule_blocks WHERE user_id=? ORDER BY start_time, sort_order`,
  ).bind(userId).all()).results as any[]
  const mandatory = all.filter((b) => b.ratchet_tier === 'mandatory')
  const deck = all.filter((b) => b.ratchet_tier !== 'mandatory')

  const holdDays = await cleanHoldDays(
    DB, userId, date, (d) => blocksForDate(DB, userId, d),
  )
  const verdict = promotionVerdict(mandatory.length, holdDays, state, date)

  const events = (await DB.prepare(
    `SELECT block_id, event, occurred_on, reason FROM ratchet_events
     WHERE user_id=? ORDER BY id DESC LIMIT 20`,
  ).bind(userId).all()).results

  return c.json({
    anchorTarget: ANCHOR_TARGET,
    holdRequired: HOLD_DAYS,
    holdDays,
    mandatory,
    deck,
    deckCount: deck.length,
    needsAnchors: mandatory.length === 0,
    canPromote: verdict.allowed,
    promotionReason: verdict.reason,
    history: events,
    ...state,
  })
})

// Promote one block from the deck. The hold rule is enforced server-side; the client
// cannot talk its way past it.
app.post('/api/ratchet/promote', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { block_id } = await parseJson(c, ratchetPromoteBodySchema)
  const { date } = await userNow(DB, userId)

  const block = await DB.prepare(
    `SELECT id, ratchet_tier FROM schedule_blocks WHERE id=? AND user_id=?`,
  ).bind(block_id, userId).first<{ id: number; ratchet_tier: string }>()
  if (!block) return c.json({ error: 'not found' }, 404)
  if (block.ratchet_tier === 'mandatory') {
    return c.json({ error: 'ALREADY MANDATORY. This block already carries consequence.' }, 409)
  }

  const mandatoryCount = (await DB.prepare(
    `SELECT COUNT(*) AS n FROM schedule_blocks WHERE user_id=? AND ratchet_tier='mandatory'`,
  ).bind(userId).first<{ n: number }>())?.n ?? 0
  const state = await readRatchetState(DB, userId)
  const holdDays = await cleanHoldDays(DB, userId, date, (d) => blocksForDate(DB, userId, d))
  const verdict = promotionVerdict(mandatoryCount, holdDays, state, date)
  if (!verdict.allowed) {
    return c.json({ error: 'PROMOTION NOT EARNED', reason: verdict.reason, holdDays }, 409)
  }

  await DB.batch([
    DB.prepare(
      `UPDATE schedule_blocks SET ratchet_tier='mandatory' WHERE id=? AND user_id=?`,
    ).bind(block_id, userId),
    DB.prepare(
      `INSERT INTO ratchet_events (user_id, block_id, event, occurred_on, reason)
       VALUES (?,?,'promoted',?,?)`,
    ).bind(userId, block_id, date, verdict.reason),
    DB.prepare(
      `INSERT INTO ratchet_state (user_id, hold_started_on, last_promotion_on, updated_at)
       VALUES (?,?,?,datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         hold_started_on=excluded.hold_started_on,
         last_promotion_on=excluded.last_promotion_on,
         updated_at=datetime('now')`,
    ).bind(userId, date, date),
  ])
  return c.json({ ok: true, mandatoryCount: mandatoryCount + 1 })
})

// Send a block back to the deck. Always allowed: reducing what you owe is never
// punished, and the event is recorded so the pattern is visible later.
app.post('/api/ratchet/demote', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { block_id, reason } = await parseJson(c, ratchetDemoteBodySchema)
  const { date } = await userNow(DB, userId)
  const updated = await DB.prepare(
    `UPDATE schedule_blocks SET ratchet_tier='deck'
     WHERE id=? AND user_id=? AND ratchet_tier='mandatory'`,
  ).bind(block_id, userId).run()
  if (Number((updated.meta as any).changes) === 0) {
    return c.json({ error: 'not found' }, 404)
  }
  await DB.batch([
    DB.prepare(
      `INSERT INTO ratchet_events (user_id, block_id, event, occurred_on, reason)
       VALUES (?,?,'demoted',?,?)`,
    ).bind(userId, block_id, date, reason || 'Returned to the deck by choice.'),
    DB.prepare(
      `INSERT INTO ratchet_state (user_id, hold_started_on, last_demotion_on, updated_at)
       VALUES (?,?,?,datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         hold_started_on=excluded.hold_started_on,
         last_demotion_on=excluded.last_demotion_on,
         updated_at=datetime('now')`,
    ).bind(userId, date, date),
  ])
  return c.json({ ok: true })
})
}
