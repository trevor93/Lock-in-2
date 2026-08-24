import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { runHonestyEngine, BLOCK_VERDICT_FLAG_TYPES } from '../src/enforcement'

// Book 8.4 — "The correction follows the cause, not the penalty." A miss that has
// been diagnosed has already drawn its consequence: src/routes/miss-cause.ts files
// `missed_block_diagnosed` and takes -5, once, for the mandatory set only, and only
// when the cause is a genuine miss.
//
// The overnight engine then ran over the same day and filed `missed_block` at -10 on
// top of it, because its skip list named exactly one status - 'missed', the one the
// pre-Book-8.3 engine used to write - and a diagnosed block is still `unreported`.
// So the same block cost -15 for one miss, and the arithmetic ran the wrong way
// round: staying silent cost -10, while recording the cause honestly cost -15.
// Book 8.4's whole point is that the honest answer is the cheaper path.
//
// The daily cap (Book 8.5) hid this in casual use: on a full bad day the total is
// pinned at -30 either way, so the double charge only shows when the day has room.
// A bound that hides a bug is not a fix.

async function owner(label: string): Promise<number> {
  const r = await env.DB.prepare(
    `INSERT INTO users (password_hash, password_salt, role) VALUES (?,?,'owner')`,
  ).bind(`${label}-h`, `${label}-s`).run()
  return Number(r.meta.last_row_id)
}

// Each case gets its OWN owner row: the Book 8.5 daily penalty cap is shared per
// (user, day), so a shared owner would absorb the very difference being measured.
// It also gets its own date, because day_summary is keyed on summary_date alone.
async function fixture(label: string, today: string): Promise<number> {
  const userId = await owner(label)
  await env.DB.prepare(`DELETE FROM settings WHERE key='start_date'`).run()
  await env.DB.prepare(
    `INSERT INTO settings (user_id, key, value) VALUES (?,'start_date','2026-01-01')`,
  ).bind(userId).run()
  // The penalty is bounded by the ledger floor, so there has to be a balance to take
  // from - otherwise every case reads -0 and the test would pass on a floor, not a rule.
  await env.DB.prepare(
    `INSERT INTO points_ledger (user_id, log_date, points, reason) VALUES (?,?,500,'audit fixture balance')`,
  ).bind(userId, today).run()
  return userId
}

async function block(userId: number, title: string): Promise<number> {
  const r = await env.DB.prepare(
    `INSERT INTO schedule_blocks
       (user_id, sort_order, start_time, end_time, title, category, days, weight, points, ratchet_tier)
     VALUES (?,10,'09:00','10:00',?,'deepwork','mon,tue,wed,thu,fri,sat,sun',3,10,'mandatory')`,
  ).bind(userId, title).run()
  return Number(r.meta.last_row_id)
}

async function logAs(userId: number, blockId: number, date: string, status: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO block_logs (user_id, block_id, log_date, status, completed_at)
     VALUES (?,?,?,?,datetime('now'))`,
  ).bind(userId, blockId, date, status).run()
}

/** What this ONE block cost on this ONE day - flag-attributed points only. */
async function blockCost(userId: number, date: string, blockId: number): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COALESCE(SUM(points),0) AS p FROM points_ledger
     WHERE user_id=? AND log_date=? AND ref_type='flag' AND ref_id=? AND points<0`,
  ).bind(userId, date, blockId).first<{ p: number }>()
  return r?.p ?? 0
}
/**
 * The VERDICT flags standing against this block on this day. Structural flags are
 * filtered out deliberately: a fixture block that was absent on the two preceding
 * days is genuinely three misses deep, so `load_reduction` and `ratchet_demotion`
 * are correct here and are not what is being measured.
 */
async function verdicts(userId: number, date: string, blockId: number): Promise<string[]> {
  const r = await env.DB.prepare(
    `SELECT flag_type FROM honesty_flags
     WHERE user_id=? AND flag_date=? AND ref_type='block' AND ref_id=? ORDER BY flag_type`,
  ).bind(userId, date, blockId).all()
  return r.results
    .map((x: any) => String(x.flag_type))
    .filter((t) => BLOCK_VERDICT_FLAG_TYPES.includes(t))
}

/**
 * Exactly what POST /api/blocks/:id/cause leaves behind for a consequence-carrying
 * cause on a mandatory block: the append-only diagnosis row, the flag, and one -5
 * charge attributed to it. The diagnosis row is the part that matters — it is the
 * record the overnight engine must read to know a consequence already landed.
 */
async function diagnosed(userId: number, blockId: number, date: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO block_miss_causes (user_id, block_id, log_date, cause, correction, note)
     VALUES (?,?,?,'low_energy','timing',NULL)`,
  ).bind(userId, blockId, date).run()
  await env.DB.prepare(
    `INSERT INTO honesty_flags (user_id, flag_date, flag_type, severity, message, ref_type, ref_id)
     VALUES (?,?,'missed_block_diagnosed','warn','MISS RECORDED: cause low energy. -5 pts.','block',?)`,
  ).bind(userId, date, blockId).run()
  await env.DB.prepare(
    `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type, ref_id)
     VALUES (?,?,-5,'MISS RECORDED: cause low energy. -5 pts.','flag',?)`,
  ).bind(userId, date, blockId).run()
}

describe('B8.4 a diagnosed miss is charged once, and the honest path is never the dearer one', () => {
  it('does not re-charge a block whose recorded cause already took its consequence', async () => {
    const today = '2026-05-20'; const y1 = '2026-05-19'
    const userId = await fixture('diagnosed-once', today)
    const id = await block(userId, 'Diagnosed miss')
    await logAs(userId, id, y1, 'unreported')
    await diagnosed(userId, id, y1)

    await runHonestyEngine(env.DB, userId, today)

    expect(await verdicts(userId, y1, id),
      'the diagnosis is the record of this miss - the engine must not file a second verdict')
      .toEqual(['missed_block_diagnosed'])
    expect(await blockCost(userId, y1, id),
      'Book 8.4: one miss, one consequence - the cause decided it, and it was -5').toBe(-5)
  })

  it('charges an undiagnosed unreported block the ordinary unlogged rate', async () => {
    // The control. Without this the fix above could simply have stopped charging
    // anything, and nothing would have noticed.
    const today = '2026-05-24'; const y1 = '2026-05-23'
    const userId = await fixture('undiagnosed', today)
    const id = await block(userId, 'Never answered')
    await logAs(userId, id, y1, 'unreported')

    await runHonestyEngine(env.DB, userId, today)

    expect(await verdicts(userId, y1, id)).toEqual(['missed_block'])
    expect(await blockCost(userId, y1, id),
      'silence still costs the full unlogged rate').toBe(-10)
  })

  it('never makes recording the cause more expensive than staying silent', async () => {
    // The invariant, stated as the doctrine states it. This is the assertion that
    // would have caught the defect on the day it was written, without anyone having
    // to guess which flag types collide.
    const silentToday = '2026-05-28'; const silentY1 = '2026-05-27'
    const honestToday = '2026-06-01'; const honestY1 = '2026-05-31'

    const silentUser = await fixture('silent-path', silentToday)
    const silentBlock = await block(silentUser, 'Said nothing')
    await logAs(silentUser, silentBlock, silentY1, 'unreported')
    await runHonestyEngine(env.DB, silentUser, silentToday)
    const silentCost = await blockCost(silentUser, silentY1, silentBlock)

    const honestUser = await fixture('honest-path', honestToday)
    const honestBlock = await block(honestUser, 'Recorded the cause')
    await logAs(honestUser, honestBlock, honestY1, 'unreported')
    await diagnosed(honestUser, honestBlock, honestY1)
    await runHonestyEngine(env.DB, honestUser, honestToday)
    const honestCost = await blockCost(honestUser, honestY1, honestBlock)

    expect(honestCost).toBeGreaterThan(silentCost)
  })
})

describe('B8.1/B8.3 a block reported `missed` still answers to the mandatory set', () => {
  it('files the ordinary verdict on a block the commander reported as missed', async () => {
    // The skip that produced the double charge also carried a second defect in the
    // other direction. It read `log_status !== 'missed'` because, before Book 8.3, the
    // same-day engine wrote 'missed' AND charged for it live - so the overnight engine
    // stepping over that status was correct. 2c07344 changed the window close to write
    // `unreported` and to charge nothing at all, and nothing writes 'missed'
    // automatically any more: it is now only what the commander says himself.
    //
    // The stale skip therefore made `missed` the one not-landed status that cost
    // nothing overnight, while silence cost -10 - the opposite of Book 8.1, which puts
    // consequence on the mandatory set. The rule is the same one Book 8.4 states: the
    // consequence follows from whether one was already taken, not from the spelling.
    const today = '2026-06-05'; const y1 = '2026-06-04'
    const userId = await fixture('reported-missed', today)
    const id = await block(userId, 'Reported missed')
    await logAs(userId, id, y1, 'missed')

    await runHonestyEngine(env.DB, userId, today)

    expect(await verdicts(userId, y1, id),
      'a mandatory block that did not happen is on the record').toEqual(['missed_block'])
    expect(await blockCost(userId, y1, id),
      'no cause was recorded, so it costs what an unlogged window costs').toBe(-10)
  })
})
