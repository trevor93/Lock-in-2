import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../src/index'
import { preMigrationRowCounts } from './setup'

const baseEnv = {
  DB: env.DB,
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: 'https://model.invalid',
  OPENAI_ALLOWED_BASE_URLS: 'https://model.invalid',
}

async function passwordHash(password: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256)
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function session(): Promise<{ headers: Record<string, string>; userId: number }> {
  const password = 'recovery-test-password'
  const salt = '0a1b2c3d4e5f60718293a4b5c6d7e8f9'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash(password, salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
  }, baseEnv)
  expect(res.status).toBe(200)
  const cookie = res.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await res.json<{ csrfToken: string }>()
  const owner = await env.DB.prepare(`SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`).first<{ id: number }>()
  return { userId: owner!.id, headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken } }
}

beforeEach(async () => {
  const owner = await env.DB.prepare(`SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`).first<{ id: number }>()
  if (!owner) return
  for (const t of ['recovery_actions', 'catchup_sessions']) {
    try { await env.DB.prepare(`DELETE FROM ${t} WHERE user_id=?`).bind(owner.id).run() } catch (_) {}
  }
  // Clear any start_date / timezone the tests set, so cases stay independent.
  await env.DB.prepare(`DELETE FROM settings WHERE user_id=? AND key='start_date'`).bind(owner.id).run()
})

describe('migration 0009 — recovery + catchup schema', () => {
  it('adds mvr_held to day_summary', async () => {
    const { results } = await env.DB.prepare(`SELECT name FROM pragma_table_info('day_summary')`).all<{ name: string }>()
    expect((results as { name: string }[]).map((r) => r.name)).toContain('mvr_held')
  })

  it('creates recovery_actions and catchup_sessions', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('recovery_actions','catchup_sessions') ORDER BY name`,
    ).all<{ name: string }>()
    expect((results as { name: string }[]).map((r) => r.name)).toEqual(['catchup_sessions', 'recovery_actions'])
  })

  it('keeps catchup_sessions append-only', async () => {
    const { userId } = await session()
    await env.DB.prepare(
      `INSERT INTO catchup_sessions (user_id, trigger_type, days_absent) VALUES (?,'manual',0)`,
    ).bind(userId).run()
    const row = await env.DB.prepare(`SELECT id FROM catchup_sessions WHERE user_id=? ORDER BY id DESC LIMIT 1`).bind(userId).first<{ id: number }>()
    await expect(
      env.DB.prepare(`UPDATE catchup_sessions SET mechanism='x' WHERE id=?`).bind(row!.id).run(),
    ).rejects.toThrow(/CATCHUP_APPEND_ONLY/)
    await expect(
      env.DB.prepare(`DELETE FROM catchup_sessions WHERE id=?`).bind(row!.id).run(),
    ).rejects.toThrow(/CATCHUP_APPEND_ONLY/)
  })

  it('enforces one recovery action per owner per day', async () => {
    const { userId } = await session()
    const ins = () => env.DB.prepare(
      `INSERT OR IGNORE INTO recovery_actions (user_id, action_date, action_text) VALUES (?, '2026-08-10', 'walked once')`,
    ).bind(userId).run()
    const a = await ins(); const b = await ins()
    expect((a.meta as any).changes).toBe(1)
    expect((b.meta as any).changes).toBe(0)
  })

  it('preserves pre-migration personal rows', async () => {
    for (const [t, expected] of Object.entries(preMigrationRowCounts)) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>()
      expect(row?.n ?? 0, `${t} lost rows`).toBeGreaterThanOrEqual(expected)
    }
  })
})

describe('Book 8.2 — Minimum Viable Recovery scoring', () => {
  it('requires a session', async () => {
    const res = await app.request('/api/recovery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, baseEnv)
    expect(res.status).toBe(401)
  })

  it('lets a logged recovery action make a breach day survive the streak', async () => {
    const { headers, userId } = await session()
    const y = '2026-08-18'
    await env.DB.prepare(
      `INSERT OR REPLACE INTO day_summary (user_id, summary_date, adherence_pct, victory, mvd_held, mvr_held, finalized)
       VALUES (?,?,0,0,0,0,1)`,
    ).bind(userId, y).run()

    const res = await app.request('/api/recovery', {
      method: 'POST', headers, body: JSON.stringify({ date: y, action: 'Made the bed and wrote one line. Agency restored.' }),
    }, baseEnv)
    expect(res.status).toBe(200)

    const row = await env.DB.prepare(
      `SELECT mvr_held FROM day_summary WHERE user_id=? AND summary_date=?`,
    ).bind(userId, y).first<{ mvr_held: number }>()
    expect(row?.mvr_held, 'recovery did not mark the day as survived').toBe(1)

    const action = await env.DB.prepare(
      `SELECT action_text FROM recovery_actions WHERE user_id=? AND action_date=?`,
    ).bind(userId, y).first<{ action_text: string }>()
    expect(action?.action_text).toContain('Agency restored')
  })

  it('treats MVR as survival, never as a manufactured victory', async () => {
    const { headers, userId } = await session()
    const y = '2026-08-17'
    await env.DB.prepare(
      `INSERT OR REPLACE INTO day_summary (user_id, summary_date, adherence_pct, victory, mvd_held, mvr_held, finalized)
       VALUES (?,?,0,0,0,0,1)`,
    ).bind(userId, y).run()
    await app.request('/api/recovery', {
      method: 'POST', headers, body: JSON.stringify({ date: y, action: 'one small restoring act' }),
    }, baseEnv)
    const row = await env.DB.prepare(
      `SELECT victory, mvr_held FROM day_summary WHERE user_id=? AND summary_date=?`,
    ).bind(userId, y).first<{ victory: number; mvr_held: number }>()
    expect(row?.victory, 'recovery must not become a victory').toBe(0)
    expect(row?.mvr_held).toBe(1)
  })

  it('is idempotent for the same day', async () => {
    const { headers, userId } = await session()
    const y = '2026-08-16'
    await env.DB.prepare(
      `INSERT OR REPLACE INTO day_summary (user_id, summary_date, adherence_pct, victory, mvd_held, mvr_held, finalized) VALUES (?,?,0,0,0,0,1)`,
    ).bind(userId, y).run()
    await app.request('/api/recovery', { method: 'POST', headers, body: JSON.stringify({ date: y, action: 'first' }) }, baseEnv)
    await app.request('/api/recovery', { method: 'POST', headers, body: JSON.stringify({ date: y, action: 'second' }) }, baseEnv)
    const n = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM recovery_actions WHERE user_id=? AND action_date=?`,
    ).bind(userId, y).first<{ n: number }>()
    expect(n?.n).toBe(1)
  })
})

const TAXONOMY = [
  'unrealistic duration', 'overpacked schedule', 'low energy', 'interruption',
  'unclear next action', 'avoidance', 'insufficient preparation', 'wrong priority',
  'forgotten log', 'emergency', 'technology failure',
]

describe('Book 8.6 — /catchup re-entry protocol', () => {
  it('requires a session', async () => {
    const res = await app.request('/api/catchup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, baseEnv)
    expect(res.status).toBe(401)
  })

  it('returns the six protocol parts in the fixed order', async () => {
    const { headers } = await session()
    const res = await app.request('/api/catchup', { method: 'POST', headers, body: '{}' }, baseEnv)
    expect(res.status).toBe(200)
    const body = await res.json<any>()
    expect(body).toHaveProperty('missed')
    expect(body).toHaveProperty('mechanism')
    expect(body).toHaveProperty('do_not')
    expect(body).toHaveProperty('minimum_viable_recovery')
    expect(body).toHaveProperty('structural_patch')
    expect(body).toHaveProperty('keystone')
    expect(TAXONOMY).toContain(body.mechanism)
  })

  it('never prescribes backlog, punitive make-up, or self-critical logging', async () => {
    const { headers } = await session()
    const res = await app.request('/api/catchup', { method: 'POST', headers, body: '{}' }, baseEnv)
    const body = await res.json<{ do_not: string[]; minimum_viable_recovery: string; keystone: any }>()
    const forbidden = /backlog|make[- ]?up|catch up on everything|punish|self-critical|shame/i
    expect(Array.isArray(body.do_not)).toBe(true)
    expect(forbidden.test(body.minimum_viable_recovery), 'MVR prescribed make-up load').toBe(false)
    expect(forbidden.test(JSON.stringify(body.keystone)), 'keystone prescribed make-up load').toBe(false)
  })

  it('emits a keystone with a start time, environment, and first physical action', async () => {
    const { headers } = await session()
    const res = await app.request('/api/catchup', { method: 'POST', headers, body: '{}' }, baseEnv)
    const { keystone } = await res.json<{ keystone: any }>()
    expect(keystone.start_time).toMatch(/^\d{2}:\d{2}$/)
    expect(typeof keystone.environment).toBe('string')
    expect(keystone.environment.length).toBeGreaterThan(0)
    expect(typeof keystone.first_physical_action).toBe('string')
    expect(keystone.first_physical_action.length).toBeGreaterThan(0)
  })

  it('records the run in catchup_sessions', async () => {
    const { headers, userId } = await session()
    await app.request('/api/catchup', { method: 'POST', headers, body: '{}' }, baseEnv)
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM catchup_sessions WHERE user_id=?`).bind(userId).first<{ n: number }>()
    expect(n?.n).toBeGreaterThanOrEqual(1)
  })

  it('runs the 5-question diagnostic only when absence exceeds fourteen days', async () => {
    const { headers } = await session()
    const res = await app.request('/api/catchup', {
      method: 'POST', headers, body: JSON.stringify({ days_absent_override: 20 }),
    }, baseEnv)
    const body = await res.json<{ diagnostic: unknown[]; reseat_level: number | null }>()
    expect(Array.isArray(body.diagnostic), 'no diagnostic after long absence').toBe(true)
    expect((body.diagnostic as unknown[]).length).toBe(5)
  })

  it('omits the diagnostic for a short absence', async () => {
    const { headers } = await session()
    const res = await app.request('/api/catchup', {
      method: 'POST', headers, body: JSON.stringify({ days_absent_override: 2 }),
    }, baseEnv)
    const body = await res.json<{ diagnostic: unknown }>()
    expect(body.diagnostic).toBeNull()
  })
})
