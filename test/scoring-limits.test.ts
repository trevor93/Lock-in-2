import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { boundedPenalty, DAILY_PENALTY_CAP, LEDGER_FLOOR } from '../src/scoring-limits'
import { addFlag, runHonestyEngine } from '../src/enforcement'
import { addDays } from '../src/time'

// Book 8.5 — the rules that keep the ledger honest instead of punitive:
// "A hard cap on daily penalties." "A floor on the ledger so it cannot spiral."
// "Load reduction on the third consecutive miss." "The rank ladder is cut."

async function owner(): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
  ).first<{ id: number }>()
  return row!.id
}
async function balance(userId: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(points),0) AS p FROM points_ledger WHERE user_id=?`,
  ).bind(userId).first<{ p: number }>()
  return row?.p ?? 0
}
async function penaltiesOn(userId: number, date: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(points),0) AS p FROM points_ledger
     WHERE user_id=? AND log_date=? AND points < 0`,
  ).bind(userId, date).first<{ p: number }>()
  return row?.p ?? 0
}

describe('B8.5 the bounds, as pure arithmetic', () => {
  it('never lets one day subtract more than the cap', () => {
    const first = boundedPenalty(-20, 0, 1000)
    expect(first.penalty).toBe(-20)
    expect(first.cappedByDay).toBe(false)
    // 20 already taken today: only the remainder of the cap is available.
    const second = boundedPenalty(-20, -20, 1000)
    expect(second.penalty).toBe(-(DAILY_PENALTY_CAP - 20))
    expect(second.cappedByDay).toBe(true)
    // Cap exhausted: nothing further is subtracted.
    expect(boundedPenalty(-10, -DAILY_PENALTY_CAP, 1000).penalty).toBe(0)
  })

  it('never pushes the ledger below the floor', () => {
    const atFloor = boundedPenalty(-10, 0, LEDGER_FLOOR)
    expect(atFloor.penalty, 'at the floor a penalty costs nothing further').toBe(0)
    expect(atFloor.cappedByFloor).toBe(true)
    // Only the distance to the floor may be taken.
    const near = boundedPenalty(-10, 0, LEDGER_FLOOR + 4)
    expect(near.penalty).toBe(-4)
    expect(near.cappedByFloor).toBe(true)
  })

  it('leaves rewards alone and never turns a penalty into a gain', () => {
    expect(boundedPenalty(25, -DAILY_PENALTY_CAP, LEDGER_FLOOR).penalty, 'a reward is not bounded').toBe(25)
    for (const spent of [0, -10, -DAILY_PENALTY_CAP]) {
      for (const total of [0, 5, 500]) {
        expect(boundedPenalty(-15, spent, total).penalty).toBeLessThanOrEqual(0)
      }
    }
  })
})

describe('B8.5 the bounds, applied by the flag writer', () => {
  it('caps what a single day can cost, however many flags fire', async () => {
    const userId = await owner()
    const date = '2026-07-01'
    await env.DB.prepare(`DELETE FROM points_ledger WHERE user_id=? AND log_date=?`).bind(userId, date).run()
    await env.DB.prepare(`DELETE FROM honesty_flags WHERE user_id=? AND flag_date=?`).bind(userId, date).run()
    // Give him a large balance so the floor is not what bites here.
    await env.DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason) VALUES (?,?,?,?)`,
    ).bind(userId, '2026-06-01', 1000, 'fixture balance').run()

    for (let i = 0; i < 12; i++) {
      await addFlag(env.DB, userId, date, `cap_probe_${i}`, 'warn', `Probe ${i}.`, -12, 'block', 900 + i)
    }
    const spent = await penaltiesOn(userId, date)
    expect(Math.abs(spent), 'a day cannot cost more than the cap').toBeLessThanOrEqual(DAILY_PENALTY_CAP)

    // The FLAGS are all still on the record — only the cost is bounded.
    const flags = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM honesty_flags WHERE user_id=? AND flag_date=? AND flag_type LIKE 'cap_probe_%'`,
    ).bind(userId, date).first<{ n: number }>()
    expect(flags?.n, 'the record never softens, only the cost').toBe(12)
    // And the message says plainly why nothing more was subtracted.
    const noted = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM points_ledger
       WHERE user_id=? AND log_date=? AND reason LIKE '%Daily penalty cap%'`,
    ).bind(userId, date).first<{ n: number }>()
    expect(noted?.n).toBeGreaterThan(0)
  })

  it('stops at the floor so the ledger cannot spiral', async () => {
    const userId = await owner()
    const date = '2026-07-02'
    // Reset the ledger to exactly the floor.
    await env.DB.prepare(`DELETE FROM points_ledger WHERE user_id=?`).bind(userId).run()
    expect(await balance(userId)).toBe(LEDGER_FLOOR)

    await addFlag(env.DB, userId, date, 'floor_probe', 'serious', 'At the floor.', -25, 'block', 950)
    expect(await balance(userId), 'the balance may not go below the floor').toBe(LEDGER_FLOOR)

    // With a small balance, only the distance to the floor is taken.
    await env.DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason) VALUES (?,?,?,?)`,
    ).bind(userId, date, 6, 'small balance').run()
    await addFlag(env.DB, userId, date, 'floor_probe_2', 'serious', 'Near the floor.', -25, 'block', 951)
    expect(await balance(userId)).toBe(LEDGER_FLOOR)
  })
})

describe('B8.5 load reduction lands on the third consecutive miss', () => {
  async function mandatory(userId: number, title: string): Promise<number> {
    const r = await env.DB.prepare(
      `INSERT INTO schedule_blocks
         (user_id, sort_order, start_time, end_time, title, category, days, weight, points, ratchet_tier)
       VALUES (?,?,?,?,?,'deepwork','mon,tue,wed,thu,fri,sat,sun',3,10,'mandatory')`,
    ).bind(userId, 20, '08:00', '09:00', title).run()
    return Number(r.meta.last_row_id)
  }

  it('does not reduce load after two misses, and does after three', async () => {
    const userId = await owner()
    const today = '2026-07-10'
    const [y1, y2, y3] = [addDays(today, -1), addDays(today, -2), addDays(today, -3)]
    await env.DB.prepare(
      `INSERT INTO settings (user_id, key, value) VALUES (?, 'start_date', '2026-01-01')
       ON CONFLICT DO NOTHING`,
    ).bind(userId).run().catch(() => {})
    await env.DB.prepare(`DELETE FROM load_reductions WHERE user_id=?`).bind(userId).run()

    // Two misses only: the block landed on y3.
    const two = await mandatory(userId, 'Two misses')
    await env.DB.prepare(
      `INSERT INTO block_logs (user_id, block_id, log_date, status, completed_at)
       VALUES (?,?,?,'completed',datetime('now'))`,
    ).bind(userId, two, y3).run()

    // Three misses: never logged at all.
    const three = await mandatory(userId, 'Three misses')

    await env.DB.prepare(`DELETE FROM day_summary WHERE user_id=? AND summary_date=?`).bind(userId, y1).run()
    await runHonestyEngine(env.DB, userId, today)

    const twoReduced = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM load_reductions WHERE user_id=? AND block_id=?`,
    ).bind(userId, two).first<{ n: number }>()
    expect(twoReduced?.n, 'two misses draw the diagnosis prompt, not load reduction').toBe(0)

    const threeReduced = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM load_reductions WHERE user_id=? AND block_id=?`,
    ).bind(userId, three).first<{ n: number }>()
    expect(threeReduced?.n, 'the third consecutive miss reduces the load').toBe(1)

    const flag = await env.DB.prepare(
      `SELECT message FROM honesty_flags
       WHERE user_id=? AND flag_type='load_reduction' AND ref_id=?`,
    ).bind(userId, three).first<{ message: string }>()
    expect(flag?.message).toContain('THREE MISSES IN A ROW')
    // Load reduction is a schedule correction, not a punishment.
    const cost = await env.DB.prepare(
      `SELECT COALESCE(SUM(points),0) AS p FROM points_ledger
       WHERE user_id=? AND reason LIKE '%THREE MISSES IN A ROW%'`,
    ).bind(userId).first<{ p: number }>()
    expect(cost?.p, 'load reduction never stacks a penalty').toBe(0)
  })
})
