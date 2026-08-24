import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import { BLOCK_VERDICT_FLAG_TYPES, BLOCK_STRUCTURAL_FLAG_TYPES } from '../src/enforcement'
import enforcementSrc from '../src/enforcement.ts?raw'
import missCauseSrc from '../src/routes/miss-cause.ts?raw'

// Book 8.5 — "One priced appeal token per week, logged and visible in pattern
// analysis." A granted appeal reopens the window, refunds the penalty, and clears
// the flag that says the block failed that day.
//
// The flag half of that was dead. The route acknowledged `flag_type='missed_live'`,
// which was the type the pre-Book-8.3 engine filed; 2c07344 replaced it with
// `unreported_block` and left the UPDATE behind. `missed_live` had no other
// reference anywhere in src/, test/ or public/, so the UPDATE could never match a
// row: the appeal refunded the points and left the accusation standing in the
// commander's unacknowledged list forever, with no way to clear it.
//
// This is the same failure as every other one this audit found - a hand-written
// list of statuses or types that stopped being true when something was renamed - so
// the fix is the same shape: one exported list, and a test that walks the source to
// prove no filing site has drifted away from it.

const baseEnv = {
  DB: env.DB, OPENAI_API_KEY: '', OPENAI_BASE_URL: 'https://model.invalid',
  OPENAI_ALLOWED_BASE_URLS: 'https://model.invalid',
}
async function passwordHash(pw: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256)
  return [...new Uint8Array(bits)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
async function login(): Promise<{ cookie: string; csrf: string; userId: number }> {
  const salt = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash('appeal-flag-pw', salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'appeal-flag-pw' }),
  }, baseEnv)
  expect(res.status).toBe(200)
  const cookie = res.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await res.json<{ csrfToken: string }>()
  const owner = await env.DB.prepare(`SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`).first<{ id: number }>()
  return { cookie, csrf: csrfToken, userId: owner!.id }
}
function post(path: string, s: { cookie: string; csrf: string }, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { Cookie: s.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf },
    body: JSON.stringify(body),
  }, baseEnv)
}
const REASON =
  'I set this block to missed myself and then found I could not touch it again, so I am spending the '
  + 'week token to reopen it. What actually happened is that the afternoon went to a family matter I '
  + 'refuse to write down as anything other than what it was.'

async function block(userId: number, title: string, start: string, end: string): Promise<number> {
  const r = await env.DB.prepare(
    `INSERT INTO schedule_blocks
       (user_id, sort_order, start_time, end_time, title, category, days, weight, points, ratchet_tier)
     VALUES (?,?,?,?,?,'deepwork','mon,tue,wed,thu,fri,sat,sun',3,10,'mandatory')`,
  ).bind(userId, 10, start, end, title).run()
  return Number(r.meta.last_row_id)
}

describe('B8.5 a granted appeal clears the flags it refunded', () => {
  it('acknowledges every flag that accused the block on the reopened day', async () => {
    const s = await login()
    const today = (await (await app.request('/api/state', { headers: { Cookie: s.cookie } }, baseEnv)).json<any>()).date
    const day = new Date(`${today}T00:00:00Z`)
    day.setUTCDate(day.getUTCDate() - 1)
    const blockDate = day.toISOString().slice(0, 10)

    const id = await block(s.userId, 'Appealed window', '14:00', '15:30')
    await env.DB.prepare(
      `INSERT INTO block_logs (user_id, block_id, log_date, status, note, completed_at)
       VALUES (?,?,?,'missed','set by hand',datetime('now'))`,
    ).bind(s.userId, id, blockDate).run()
    // Every flag type that can genuinely stand against one block on one day: the
    // window closed unreported, a cause was then recorded, and the overnight engine
    // filed the day's miss. All three accuse the same block on the same date.
    for (const type of BLOCK_VERDICT_FLAG_TYPES) {
      await env.DB.prepare(
        `INSERT INTO honesty_flags (user_id, flag_date, flag_type, severity, message, ref_type, ref_id)
         VALUES (?,?,?,'warn',?, 'block', ?)`,
      ).bind(s.userId, blockDate, type, `fixture: ${type}`, id).run()
    }
    await env.DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type, ref_id)
       VALUES (?,?,-10,'fixture penalty','flag',?)`,
    ).bind(s.userId, blockDate, id).run()
    await env.DB.prepare(`DELETE FROM appeals WHERE user_id=?`).bind(s.userId).run()

    const res = await post('/api/appeals', s, { block_id: id, block_date: blockDate, reason: REASON })
    expect(res.status).toBe(200)
    const body = await res.json<{ ok: boolean; refunded: number }>()
    expect(body.refunded, 'the penalty is refunded in full').toBe(10)

    const open = await env.DB.prepare(
      `SELECT flag_type FROM honesty_flags
       WHERE user_id=? AND flag_date=? AND ref_type='block' AND ref_id=? AND acknowledged=0`,
    ).bind(s.userId, blockDate, id).all()
    expect(open.results.map((r: any) => r.flag_type),
      'a reopened window leaves no standing accusation behind').toEqual([])

    const reopened = await env.DB.prepare(
      `SELECT status FROM block_logs WHERE user_id=? AND block_id=? AND log_date=?`,
    ).bind(s.userId, id, blockDate).first<{ status: string }>()
    expect(reopened?.status, 'the window is open again').toBe('pending')
  })

  it('names every block-scoped flag type exactly once, so a rename cannot orphan one', async () => {
    // The drift guard. `missed_live` went stale because the engine renamed its flag
    // and the appeal's UPDATE was a hand-written literal nobody re-read. This walks
    // the source instead: every addFlag call that files against a block must use a
    // type this module classifies, either as a verdict an appeal clears or as one of
    // the named exemptions.
    // Each call is delimited by the next one, so a type can never be attributed to a
    // ref_type that belongs to a different call - which is how a first attempt at this
    // guard read `missed_debrief` (a day-scoped flag) as block-scoped.
    const filed = new Set<string>()
    for (const src of [enforcementSrc, missCauseSrc]) {
      for (const call of src.split('addFlag(').slice(1)) {
        if (!/'block',/.test(call)) continue
        const type = call.match(/'([a-z_]+)'/)
        if (type) filed.add(type[1])
      }
    }
    expect(filed.size, 'the walk must actually find the filing sites').toBeGreaterThanOrEqual(5)
    const classified = new Set<string>([...BLOCK_VERDICT_FLAG_TYPES, ...BLOCK_STRUCTURAL_FLAG_TYPES])
    for (const type of filed) {
      expect(classified.has(type),
        `${type} is filed against a block but classified nowhere - decide whether an appeal clears it`).toBe(true)
    }
    for (const type of classified) {
      expect(filed.has(type), `${type} is classified but nothing files it - it is a dead literal`).toBe(true)
    }
  })
})
