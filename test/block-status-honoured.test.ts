import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import { runHonestyEngine } from '../src/enforcement'
import { hasLanded, isPartial } from '../src/block-status'

// Book 8.3 names ten block states, and `src/schemas.ts` accepts all ten on
// POST /api/blocks/:id/log and POST /api/agent/v1/block-log. This file asserts the
// taxonomy is honoured by the paths that MOVE POINTS and DETECT ABSENCE, not only by
// the helpers in src/block-status.ts.
//
// The gap this file was written against: those paths compared against the legacy pair
// 'done' / 'partial' literally, so a block logged `completed` — a status the API
// accepts and the doctrine names first — earned nothing, and a day of `completed_late`
// work read as a dark day and offered him the re-entry door he did not need. Neither
// failure produces an error; the number is simply wrong, which is the kind of defect
// the honesty engine exists to make impossible.

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
  ).bind(await passwordHash('block-status-pw', salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'block-status-pw' }),
  }, baseEnv)
  expect(res.status).toBe(200)
  const cookie = res.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await res.json<{ csrfToken: string }>()
  const owner = await env.DB.prepare(`SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`).first<{ id: number }>()
  return { cookie, csrf: csrfToken, userId: owner!.id }
}
function post(path: string, s: { cookie: string; csrf: string }, body?: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { Cookie: s.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf },
    body: JSON.stringify(body ?? {}),
  }, baseEnv)
}

function get(path: string, s: { cookie: string }) {
  return app.request(path, { headers: { Cookie: s.cookie } }, baseEnv)
}
async function block(
  userId: number, title: string, start: string, end: string,
  category = 'deepwork', points = 10, tier = 'mandatory',
): Promise<number> {
  const r = await env.DB.prepare(
    `INSERT INTO schedule_blocks
       (user_id, sort_order, start_time, end_time, title, category, days, weight, points, ratchet_tier)
     VALUES (?,?,?,?,?,?,'mon,tue,wed,thu,fri,sat,sun',3,?,?)`,
  ).bind(userId, 40, start, end, title, category, points, tier).run()
  return Number(r.meta.last_row_id)
}
async function ledgerFor(userId: number, blockId: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(points),0) AS p FROM points_ledger
     WHERE user_id=? AND ref_type='block' AND ref_id=?`,
  ).bind(userId, blockId).first<{ p: number }>()
  return row?.p ?? 0
}
async function serverDate(s: { cookie: string }): Promise<string> {
  return (await (await get('/api/state', s)).json<{ date: string }>()).date
}
function shiftDays(date: string, n: number): string {
  return new Date(new Date(date + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10)
}
/** Clear the trailing window so an inherited log cannot decide the assertion. */
async function darkenWindow(userId: number, today: string, days: number) {
  for (let i = 1; i <= days; i++) {
    const d = shiftDays(today, -i)
    await env.DB.prepare(`DELETE FROM block_logs WHERE user_id=? AND log_date=?`).bind(userId, d).run()
    await env.DB.prepare(`DELETE FROM debriefs WHERE user_id=? AND log_date=?`).bind(userId, d).run()
  }
}

describe('B8.3 the doctrinal statuses move points, not only the legacy pair', () => {
  it('credits `completed` with the block points in full', async () => {
    const s = await login()
    const id = await block(s.userId, 'Doctrinal completed', '05:10', '05:40')
    expect((await post(`/api/blocks/${id}/log`, s, { status: 'completed' })).status).toBe(200)
    expect(await ledgerFor(s.userId, id),
      'a block logged `completed` — the status the doctrine names first — must earn its points').toBe(10)
  })

  it('credits `completed_late` in full, recorded late but not unpaid', async () => {
    const s = await login()
    const id = await block(s.userId, 'Doctrinal late', '05:15', '05:45')
    expect((await post(`/api/blocks/${id}/log`, s, { status: 'completed_late' })).status).toBe(200)
    expect(await ledgerFor(s.userId, id),
      'Book 8.3: completed_late is full credit, recorded late').toBe(10)
    expect(hasLanded('completed_late')).toBe(true)
  })

  it('refunds the credit when a `completed` block is reverted to a miss', async () => {
    const s = await login()
    const id = await block(s.userId, 'Doctrinal reverted', '05:20', '05:50')
    await post(`/api/blocks/${id}/log`, s, { status: 'completed' })
    expect(await ledgerFor(s.userId, id)).toBe(10)
    expect((await post(`/api/blocks/${id}/log`, s, { status: 'unreported' })).status).toBe(200)
    expect(await ledgerFor(s.userId, id),
      'a revert must refund what the earlier status paid, whichever spelling paid it').toBe(0)
  })

  it('pays half for `partial`, unchanged', async () => {
    const s = await login()
    const id = await block(s.userId, 'Doctrinal partial', '05:25', '05:55', 'deepwork', 9)
    await post(`/api/blocks/${id}/log`, s, { status: 'partial' })
    expect(await ledgerFor(s.userId, id), 'half credit, rounded up').toBe(5)
    expect(isPartial('partial')).toBe(true)
  })

  it('pays nothing for a status that did not land', async () => {
    const s = await login()
    const id = await block(s.userId, 'Doctrinal canceled', '05:30', '05:59')
    await post(`/api/blocks/${id}/log`, s, { status: 'intentionally_canceled' })
    expect(await ledgerFor(s.userId, id),
      'an honest cancellation is not a completion — it earns nothing').toBe(0)
  })
})

describe('B8.3 absence detection reads the whole taxonomy', () => {
  it('does not offer the re-entry door for a day of `completed` work', async () => {
    const s = await login()
    const today = await serverDate(s)
    await darkenWindow(s.userId, today, 4)
    const id = await block(s.userId, 'Yesterday landed', '06:00', '06:30')
    await env.DB.prepare(
      `INSERT INTO block_logs (user_id, block_id, log_date, status, completed_at)
       VALUES (?,?,?,'completed',datetime('now'))`,
    ).bind(s.userId, id, shiftDays(today, -1)).run()
    const state = await (await get('/api/state', s)).json<{ needsCatchup: boolean }>()
    expect(state.needsCatchup,
      'a day of completed work is not a dark day, and he is not offered a door he does not need').toBe(false)
  })

  it('counts a `completed_late` day as present in /api/catchup', async () => {
    const s = await login()
    const today = await serverDate(s)
    await darkenWindow(s.userId, today, 5)
    const id = await block(s.userId, 'Yesterday late', '06:35', '07:05')
    await env.DB.prepare(
      `INSERT INTO block_logs (user_id, block_id, log_date, status, completed_at)
       VALUES (?,?,?,'completed_late',datetime('now'))`,
    ).bind(s.userId, id, shiftDays(today, -1)).run()
    const body = await (await post('/api/catchup', s, {})).json<{ days_absent: number }>()
    expect(body.days_absent,
      'work logged late is still work: yesterday was not an absent day').toBe(0)
  })
})

describe('B8.3 the category breakdown counts doctrinal completions', () => {
  it('reports a `completed` block as done in the 7-day breakdown', async () => {
    const s = await login()
    const today = await serverDate(s)
    const id = await block(s.userId, 'Category probe', '07:10', '07:40', 'auditprobe')
    await env.DB.prepare(
      `INSERT INTO block_logs (user_id, block_id, log_date, status, completed_at)
       VALUES (?,?,?,'completed',datetime('now'))
       ON CONFLICT(block_id, log_date) DO UPDATE SET status='completed'`,
    ).bind(s.userId, id, shiftDays(today, -2)).run()
    const stats = await (await get('/api/stats', s)).json<{ categories: any[] }>()
    const row = stats.categories.find((r) => r.category === 'auditprobe')
    expect(row, 'the probe category must appear at all').toBeTruthy()
    expect(Number(row.done),
      'the breakdown must count `completed`, not only the legacy `done`').toBe(1)
  })
})

describe('B8.3/B17 an honest cancellation is not an unlogged miss', () => {
  it('files `intentionally_canceled` as the honest path, at the milder cost', async () => {
    // On its own owner row: the Book 8.5 daily penalty cap is shared across the day, so
    // the fixtures above would absorb this block's cost and hide what is being measured.
    const r = await env.DB.prepare(
      `INSERT INTO users (password_hash, password_salt, role)
       VALUES ('cancel-probe-hash','cancel-probe-salt','owner')`,
    ).run()
    const userId = Number(r.meta.last_row_id)
    const today = '2026-06-15'
    const y1 = '2026-06-14'
    await env.DB.prepare(`INSERT INTO settings (user_id, key, value) VALUES (?, 'start_date', '2026-01-01')`)
      .bind(userId).run()
    // The penalty is bounded by the ledger floor, so there must be a balance to take from.
    await env.DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason) VALUES (?,?,?,?)`,
    ).bind(userId, today, 200, 'audit fixture balance').run()

    const id = await block(userId, 'Honestly cancelled', '07:45', '08:15')
    await env.DB.prepare(
      `INSERT INTO block_logs (user_id, block_id, log_date, status, completed_at)
       VALUES (?,?,?,'intentionally_canceled',datetime('now'))`,
    ).bind(userId, id, y1).run()

    await runHonestyEngine(env.DB, userId, today)

    const flag = await env.DB.prepare(
      `SELECT severity, message FROM honesty_flags
       WHERE user_id=? AND flag_date=? AND flag_type='missed_block' AND ref_id=?`,
    ).bind(userId, y1, id).first<{ severity: string; message: string }>()
    expect(flag, 'the cancellation is still recorded — nothing is pretended away').toBeTruthy()
    expect(flag!.severity,
      'Book 17: intentionally_canceled is the honest path, not the harsher unlogged one').toBe('warn')
    expect(flag!.message,
      'a block he honestly cancelled was never unlogged').not.toContain('UNLOGGED')
    const cost = await env.DB.prepare(
      `SELECT COALESCE(SUM(points),0) AS p FROM points_ledger
       WHERE user_id=? AND log_date=? AND ref_type='flag' AND ref_id=?`,
    ).bind(userId, y1, id).first<{ p: number }>()
    expect(cost?.p,
      'the honest cancellation costs 5, not the 10 an unlogged window costs').toBe(-5)
  })
})
