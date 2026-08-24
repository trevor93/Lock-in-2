import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { runSameDayEnforcement } from '../src/enforcement'

// Book 17's test matrix names "grace period" as its own enforcement row, and until
// this file nothing varied it. `grace_minutes` was read at src/enforcement.ts and
// defaulted to 30, but no test ever set it, so the whole configurable half of the
// window-close rule was unexercised: a change to the arithmetic, the unit, or the
// fallback would have passed the entire suite.
//
// The window close is the single most consequential automatic write in the
// application - it is what turns silence into a record - so the boundary it uses
// has to be pinned from both sides: inside the grace nothing happens, past it the
// block becomes `unreported`.
//
// One fixture note that is a fact about the schema, not a preference: `settings`
// was created with `key TEXT PRIMARY KEY` in 0001, and 0005 only ADDs `user_id`
// plus a NON-unique index. A settings key is therefore globally unique across
// owners - two owner rows cannot each hold `grace_minutes`. So this file uses one
// owner and rewrites the single row between cases, and gives each case its own
// date so the log writes never collide.

let userId = 0

async function owner(): Promise<number> {
  if (userId) return userId
  const r = await env.DB.prepare(
    `INSERT INTO users (password_hash, password_salt, role) VALUES (?,?,'owner')`,
  ).bind('grace-hash', 'grace-salt').run()
  userId = Number(r.meta.last_row_id)
  return userId
}

// `null` means "no row at all", which is what the unconfigured case must look like.
async function setGrace(value: string | null): Promise<void> {
  await env.DB.prepare(`DELETE FROM settings WHERE key='grace_minutes'`).run()
  if (value === null) return
  await env.DB.prepare(
    `INSERT INTO settings (user_id, key, value) VALUES (?,'grace_minutes',?)`,
  ).bind(userId, value).run()
}

async function mandatoryBlock(title: string, start: string, end: string): Promise<number> {
  const r = await env.DB.prepare(
    `INSERT INTO schedule_blocks
       (user_id, sort_order, start_time, end_time, title, category, days, weight, points, ratchet_tier)
     VALUES (?,?,?,?,?,'deepwork','mon,tue,wed,thu,fri,sat,sun',3,10,'mandatory')`,
  ).bind(userId, 10, start, end, title).run()
  return Number(r.meta.last_row_id)
}

async function statusOf(blockId: number, date: string): Promise<string | undefined> {
  const row = await env.DB.prepare(
    `SELECT status FROM block_logs WHERE block_id=? AND log_date=?`,
  ).bind(blockId, date).first<{ status: string }>()
  return row?.status
}

describe('B8.3/B17 the grace period is the boundary of the window close', () => {
  it('leaves the block alone while the grace period is still running', async () => {
    const date = '2026-07-15'
    await owner()
    await setGrace('60')
    const id = await mandatoryBlock('Still in grace', '09:00', '10:00')

    // 10:00 end + 60 minutes of grace = 11:00. At 10:30 the window is still open.
    await runSameDayEnforcement(env.DB, userId, date, '10:30')

    expect(await statusOf(id, date),
      'a block inside its grace period has not passed anything yet').toBeUndefined()
  })

  it('closes the window once the grace period has elapsed', async () => {
    const date = '2026-07-16'
    await owner()
    await setGrace('60')
    const id = await mandatoryBlock('Grace elapsed', '09:00', '10:00')

    await runSameDayEnforcement(env.DB, userId, date, '11:01')

    expect(await statusOf(id, date)).toBe('unreported')
  })

  it('honours a grace period of zero as zero, not as the default', async () => {
    const date = '2026-07-17'
    await owner()
    await setGrace('0')
    const id = await mandatoryBlock('No grace at all', '09:00', '10:00')

    // One minute past the end. With the 30-minute default this block would survive.
    await runSameDayEnforcement(env.DB, userId, date, '10:01')

    expect(await statusOf(id, date),
      'a commander who set the grace to zero asked for zero').toBe('unreported')
  })

  it('applies the 30-minute default when no grace period is configured', async () => {
    const date = '2026-07-18'
    await owner()
    await setGrace(null)
    const id = await mandatoryBlock('Default grace', '09:00', '10:00')

    await runSameDayEnforcement(env.DB, userId, date, '10:20')
    expect(await statusOf(id, date),
      'the documented default is 30 minutes, so 10:20 is still inside it').toBeUndefined()

    await runSameDayEnforcement(env.DB, userId, date, '10:31')
    expect(await statusOf(id, date)).toBe('unreported')
  })

  it('falls back to the default rather than closing every window when the stored value is not a number', async () => {
    // A non-numeric grace makes `Number(...)` NaN, and every comparison against NaN is
    // false - so the "still inside the window" guard never fires and EVERY block on
    // the day is written `unreported` at any hour, including blocks that have not
    // started. One corrupt settings row silently converts the honesty engine into a
    // machine that cancels the whole day.
    const date = '2026-07-19'
    await owner()
    await setGrace('not-a-number')
    const id = await mandatoryBlock('Corrupt grace', '09:00', '10:00')

    await runSameDayEnforcement(env.DB, userId, date, '09:30')

    expect(await statusOf(id, date),
      'a block that has not even reached its end time must never be closed').toBeUndefined()
  })
})
