import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import { runSameDayEnforcement } from '../src/enforcement'
import { dayAdherence } from '../src/scoring'
import {
  MISS_CAUSES, CORRECTIONS, causeCarriesConsequence,
  hasLanded, isPartial, isExcusedFromScoring,
} from '../src/block-status'

// Book 8.3 — ten honest block states, and the rule that a block is never
// auto-cancelled merely because its window passed: it becomes `unreported`, a data
// state carrying a prompt, not a penalty.
// Book 8.4 — every miss names a cause before it can be rescheduled, and the
// correction follows the cause, not the penalty.

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
  const salt = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash('miss-cause-pw', salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'miss-cause-pw' }),
  }, baseEnv)
  expect(res.status).toBe(200)
  const cookie = res.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await res.json<{ csrfToken: string }>()
  const owner = await env.DB.prepare(`SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`).first<{ id: number }>()
  return { cookie, csrf: csrfToken, userId: owner!.id }
}
function post(path: string, s: { cookie: string; csrf: string }, body: unknown) {
  return app.request(path, {
    method: 'POST', headers: { Cookie: s.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf },
    body: JSON.stringify(body),
  }, baseEnv)
}
async function mandatoryBlock(userId: number, title: string, start: string, end: string): Promise<number> {
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

describe('B8.3 the ten states, and what each means for scoring', () => {
  it('counts a completed_late block as landed and excuses a displaced one entirely', () => {
    expect(hasLanded('completed')).toBe(true)
    expect(hasLanded('completed_late'), 'late is still done').toBe(true)
    expect(hasLanded('done'), 'the legacy synonym still lands').toBe(true)
    expect(hasLanded('unreported')).toBe(false)
    expect(isPartial('partial')).toBe(true)
    expect(isExcusedFromScoring('displaced_by_priority'), 'no moral weight').toBe(true)
    expect(isExcusedFromScoring('rescheduled'), 'moved, not owed here').toBe(true)
    expect(isExcusedFromScoring('missed')).toBe(false)
  })

  it('a displaced block leaves the denominator instead of dragging the day down', () => {
    const landed = { id: 1, title: 'a', start_time: '06:00', weight: 3, ratchet_tier: 'mandatory', log_status: 'completed' }
    const displaced = { id: 2, title: 'b', start_time: '09:00', weight: 3, ratchet_tier: 'mandatory', log_status: 'displaced_by_priority' }
    const unreported = { id: 3, title: 'c', start_time: '11:00', weight: 3, ratchet_tier: 'mandatory', log_status: 'unreported' }
    expect(dayAdherence([landed, displaced]).pct, 'displacement must not cost adherence').toBe(100)
    // An unreported block, by contrast, is simply not yet landed.
    expect(dayAdherence([landed, unreported]).pct).toBe(50)
  })
})

describe('B8.3 the window close leaves `unreported`, with a prompt and no penalty', () => {
  it('writes unreported (never auto-cancelled) and files a zero-point prompt', async () => {
    const s = await login()
    const date = '2026-08-20'
    const id = await mandatoryBlock(s.userId, 'Deep work', '09:00', '10:30')
    await env.DB.prepare(`DELETE FROM honesty_flags WHERE user_id=?`).bind(s.userId).run()
    const before = await env.DB.prepare(
      `SELECT COALESCE(SUM(points),0) AS p FROM points_ledger WHERE user_id=? AND log_date=?`,
    ).bind(s.userId, date).first<{ p: number }>()

    // Deterministic clock: the window (plus grace) has passed.
    await runSameDayEnforcement(env.DB, s.userId, date, '23:00')

    expect(await statusOf(id, date), 'the block must become unreported, not missed').toBe('unreported')
    const flag = await env.DB.prepare(
      `SELECT flag_type, severity, message FROM honesty_flags
       WHERE user_id=? AND flag_date=? AND ref_id=? ORDER BY id DESC LIMIT 1`,
    ).bind(s.userId, date, id).first<{ flag_type: string; severity: string; message: string }>()
    expect(flag?.flag_type).toBe('unreported_block')
    expect(flag?.severity, 'a prompt, not a verdict').toBe('attention')
    expect(flag?.message).toContain('This block passed without a status')

    const after = await env.DB.prepare(
      `SELECT COALESCE(SUM(points),0) AS p FROM points_ledger WHERE user_id=? AND log_date=?`,
    ).bind(s.userId, date).first<{ p: number }>()
    expect(after?.p, 'unreported carries a prompt, not a penalty').toBe(before?.p ?? 0)
  })
})

describe('B8.4 the cause comes before the reschedule, and the correction follows the cause', () => {
  it('publishes the eleven-cause taxonomy with its corrections', async () => {
    const s = await login()
    const res = await app.request('/api/miss-causes', { headers: { Cookie: s.cookie } }, baseEnv)
    expect(res.status).toBe(200)
    const causes = await res.json<Array<{ cause: string; action: string; escalates: boolean }>>()
    expect(causes.length).toBe(MISS_CAUSES.length)
    expect(causes.map((x) => x.cause).sort()).toEqual([...MISS_CAUSES].sort())
    for (const entry of causes) expect(entry.action.length).toBeGreaterThan(10)
    expect(causes.find((x) => x.cause === 'avoidance')?.escalates, 'only avoidance escalates').toBe(true)
  })

  it('refuses to set a status on an unreported block until a cause is recorded', async () => {
    const s = await login()
    const today = (await (await app.request('/api/state', { headers: { Cookie: s.cookie } }, baseEnv)).json<any>()).date
    const id = await mandatoryBlock(s.userId, 'Needs a cause', '05:00', '05:30')
    await env.DB.prepare(
      `INSERT INTO block_logs (user_id, block_id, log_date, status, note, completed_at)
       VALUES (?,?,?,'unreported','window closed',datetime('now'))`,
    ).bind(s.userId, id, today).run()

    const refused = await post(`/api/blocks/${id}/log`, s, { status: 'done' })
    expect(refused.status).toBe(409)
    const body = await refused.json<any>()
    expect(body.needsCause).toBe(true)
    expect(body.error).toContain('Record what caused the miss')

    // Once the cause exists, the honest status can be set.
    expect((await post(`/api/blocks/${id}/cause`, s, { cause: 'low_energy' })).status).toBe(200)
    const allowed = await post(`/api/blocks/${id}/log`, s, { status: 'partial' })
    expect(allowed.status).toBe(200)
  })

  it('repairs the record for a forgotten log — the work happened, and it costs nothing', async () => {
    const s = await login()
    const date = '2026-08-18'
    const id = await mandatoryBlock(s.userId, 'Forgotten', '07:00', '08:00')
    const before = await env.DB.prepare(
      `SELECT COALESCE(SUM(points),0) AS p FROM points_ledger WHERE user_id=? AND log_date=?`,
    ).bind(s.userId, date).first<{ p: number }>()

    const res = await post(`/api/blocks/${id}/cause`, s, { cause: 'forgotten_log', date })
    expect(res.status).toBe(200)
    const body = await res.json<any>()
    expect(body.statusSetTo).toBe('completed_late')
    expect(body.pointsApplied, 'repairing a record must not cost points').toBe(0)
    expect(await statusOf(id, date)).toBe('completed_late')
    const after = await env.DB.prepare(
      `SELECT COALESCE(SUM(points),0) AS p FROM points_ledger WHERE user_id=? AND log_date=?`,
    ).bind(s.userId, date).first<{ p: number }>()
    expect(after?.p).toBe(before?.p ?? 0)
  })

  it('marks a higher priority as displaced, with no moral weight', async () => {
    const s = await login()
    const date = '2026-08-17'
    const id = await mandatoryBlock(s.userId, 'Displaced', '13:00', '14:00')
    const res = await post(`/api/blocks/${id}/cause`, s, { cause: 'wrong_priority', date })
    const body = await res.json<any>()
    expect(body.statusSetTo).toBe('displaced_by_priority')
    expect(body.pointsApplied, 'a genuine displacement is not a failure').toBe(0)
    expect(causeCarriesConsequence('wrong_priority')).toBe(false)
    expect(CORRECTIONS.wrong_priority.dimension).toBe('priority')
  })

  it('applies the ordinary consequence for a genuine miss, and returns the correction', async () => {
    const s = await login()
    const date = '2026-08-16'
    const id = await mandatoryBlock(s.userId, 'Too long', '15:00', '18:00')
    const res = await post(`/api/blocks/${id}/cause`, s, {
      cause: 'unrealistic_duration', note: 'Three hours was never real.', date,
    })
    const body = await res.json<any>()
    expect(body.pointsApplied).toBe(-5)
    expect(body.correction.dimension).toBe('duration')
    expect(body.correction.action).toContain('Reduce or split')
    // The correction acts on the schedule, not on his character.
    expect(body.correction.action).not.toMatch(/lazy|weak|failure|discipline problem/i)
  })

  it('escalates repeated avoidance into an investigation, never into more points', async () => {
    const s = await login()
    await env.DB.prepare(`DELETE FROM honesty_flags WHERE user_id=? AND flag_type='avoidance_investigation'`).bind(s.userId).run()
    const dates = ['2026-08-10', '2026-08-11', '2026-08-12']
    let last: any = null
    for (const date of dates) {
      const id = await mandatoryBlock(s.userId, `Avoided ${date}`, '19:00', '20:00')
      last = await (await post(`/api/blocks/${id}/cause`, s, { cause: 'avoidance', date })).json<any>()
    }
    expect(last.investigation, 'the third avoidance opens an investigation').toBeTruthy()
    expect(last.investigation).toContain('investigation, not a scoring matter')
    const flag = await env.DB.prepare(
      `SELECT severity FROM honesty_flags WHERE user_id=? AND flag_type='avoidance_investigation' ORDER BY id DESC LIMIT 1`,
    ).bind(s.userId).first<{ severity: string }>()
    expect(flag?.severity).toBe('attention')
    const cost = await env.DB.prepare(
      `SELECT COALESCE(SUM(points),0) AS p FROM points_ledger WHERE user_id=? AND reason LIKE 'Avoidance recorded three times%'`,
    ).bind(s.userId).first<{ p: number }>()
    expect(cost?.p, 'an investigation costs no points').toBe(0)
  })

  it('records one diagnosis per block per day, append-only', async () => {
    const s = await login()
    const date = '2026-08-09'
    const id = await mandatoryBlock(s.userId, 'Once only', '21:00', '21:30')
    expect((await post(`/api/blocks/${id}/cause`, s, { cause: 'interruption', date })).status).toBe(200)
    const second = await post(`/api/blocks/${id}/cause`, s, { cause: 'avoidance', date })
    const body = await second.json<any>()
    expect(body.alreadyRecorded, 'a day gets one honest diagnosis').toBe(true)
    expect(body.cause, 'the first record stands').toBe('interruption')

    let refused = false
    try {
      await env.DB.prepare(`DELETE FROM block_miss_causes WHERE block_id=?`).bind(id).run()
    } catch (e: any) { refused = /MISS_CAUSE_APPEND_ONLY/.test(String(e?.message || e)) }
    expect(refused, 'a diagnosis could be deleted').toBe(true)
  })
})
