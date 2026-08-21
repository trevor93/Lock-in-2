// Book 8.4 — MISS DIAGNOSIS. "Every miss demands a cause before it can be
// rescheduled... The correction follows the cause, not the penalty."
//
// The window close (Book 8.3) leaves a block `unreported` with a prompt and no
// penalty. This is where the commander answers it. Recording a cause does three
// things: it fixes the block's honest status, it returns the ONE correction that
// would prevent the next miss, and only then does it apply the ordinary consequence —
// and only when the cause is a genuine miss. A repaired log, a real emergency and a
// genuine displacement cost nothing, because in those cases the work either happened
// or was rightly displaced.
//
// Repeated avoidance is the single cause that escalates, and it escalates into
// investigation, never into points.
import { Hono } from 'hono'
import type { Bindings, Variables } from '../env'
import { parseJson, parseValue } from '../validation'
import { positiveIdSchema, missCauseBodySchema } from '../schemas'
import { safeDate } from '../clock'
import { addFlag } from '../enforcement'
import { withIdempotency } from '../request-support'
import { blocksForDate } from '../repositories'
import { CORRECTIONS, causeCarriesConsequence, type MissCause } from '../block-status'
import { penalisedBlocks } from '../ratchet'

export function registerMissCauseRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {

// The taxonomy itself, so the interface never invents a cause of its own.
app.get('/api/miss-causes', (c) =>
  c.json(Object.entries(CORRECTIONS).map(([cause, correction]) => ({
    cause,
    dimension: correction.dimension,
    action: correction.action,
    escalates: !!correction.escalates,
  }))))

// Record why a block was missed. Until this exists for the day, the block cannot be
// rescheduled (the reschedule route checks for it).
app.post('/api/blocks/:id/cause', async (c) => withIdempotency(c, 'block:cause', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  const { cause, note, date } = await parseJson(c, missCauseBodySchema)
  const day = await safeDate(DB, date, userId)

  const blocks = await blocksForDate(DB, userId, day)
  const block = blocks.find((b: any) => b.id === id)
  if (!block) return c.json({ error: 'not found' }, 404)

  const correction = CORRECTIONS[cause as MissCause]
  // One diagnosis per block per day: the UNIQUE index is the arbiter, so a double
  // submission cannot create a second, contradictory record of the same day.
  const claim = await DB.prepare(
    `INSERT OR IGNORE INTO block_miss_causes (user_id, block_id, log_date, cause, correction, note)
     VALUES (?,?,?,?,?,?)`,
  ).bind(userId, id, day, cause, correction.dimension, note || null).run()
  const firstRecord = Number((claim.meta as any).changes) === 1
  if (!firstRecord) {
    const existing = await DB.prepare(
      `SELECT cause, correction, note FROM block_miss_causes
       WHERE user_id=? AND block_id=? AND log_date=?`,
    ).bind(userId, id, day).first<any>()
    return c.json({
      ok: true, alreadyRecorded: true, cause: existing?.cause,
      correction: CORRECTIONS[(existing?.cause || cause) as MissCause],
    })
  }

  // The cause fixes the honest status where Book 8.4 names one: a forgotten log
  // becomes completed_late (the work happened), a genuine displacement or emergency
  // becomes displaced_by_priority (no moral weight).
  if (correction.status) {
    await DB.prepare(
      `INSERT INTO block_logs (user_id, block_id, log_date, status, note, completed_at)
       VALUES (?,?,?,?,?,datetime('now'))
       ON CONFLICT(block_id, log_date) DO UPDATE SET
         status=excluded.status, note=excluded.note, completed_at=excluded.completed_at
       WHERE block_logs.user_id=excluded.user_id`,
    ).bind(userId, id, day, correction.status, `Cause recorded: ${cause}.`).run()
  }

  // The ordinary consequence now lands — and only now, and only for the mandatory
  // set, and only when the cause is a genuine miss.
  let consequence = 0
  const mandatory = new Set(penalisedBlocks(blocks).map((b: any) => b.id))
  if (mandatory.has(id) && causeCarriesConsequence(cause as MissCause)) {
    consequence = -5
    await addFlag(DB, userId, day, 'missed_block_diagnosed', 'warn',
      `[Block #${id}] MISS RECORDED: "${block.title}" — cause: ${cause.replace(/_/g, ' ')}. ${correction.action} -5 pts.`,
      consequence, 'block', id)
  }

  // Repeated avoidance escalates into investigation, never into more points lost.
  let investigation: string | null = null
  if (correction.escalates) {
    const recent = await DB.prepare(
      `SELECT COUNT(*) AS n FROM block_miss_causes
       WHERE user_id=? AND cause='avoidance' AND log_date >= date(?, '-14 days')`,
    ).bind(userId, day).first<{ n: number }>()
    if ((recent?.n ?? 0) >= 3) {
      investigation = 'Avoidance recorded three times in fourteen days. This is now an investigation, not a scoring matter: name the specific thing you are avoiding and what it would cost to face it once.'
      await addFlag(DB, userId, day, 'avoidance_investigation', 'attention', investigation, 0, 'block', id)
    }
  }

  return c.json({
    ok: true,
    cause,
    correction,
    statusSetTo: correction.status ?? null,
    pointsApplied: consequence,
    investigation,
  })
}))
}
