import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'

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
  const password = 'audit-fixes-password'
  const salt = 'a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash(password, salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
  }, baseEnv)
  const cookie = res.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await res.json<{ csrfToken: string }>()
  const owner = await env.DB.prepare(`SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`).first<{ id: number }>()
  return { userId: owner!.id, headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken } }
}

describe('Book 5.3/6 — no client-controlled future-dated scoring', () => {
  it('clamps a future intel log_date to today so points never land in the future', async () => {
    const { headers, userId } = await session()
    const state = await (await app.request('/api/state', { headers }, baseEnv)).json<{ date: string }>()
    const today = state.date

    const res = await app.request('/api/intel', {
      method: 'POST', headers,
      body: JSON.stringify({ domain: 'other', title: 'FUTURE FIXTURE', log_date: '2099-12-31' }),
    }, baseEnv)
    expect(res.status).toBe(200)

    // No intel row or points may exist beyond today.
    const future = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM captures WHERE kind='intel' AND user_id=? AND log_date > ?`,
    ).bind(userId, today).first<{ n: number }>()
    expect(future?.n, 'a future-dated intel entry was written').toBe(0)

    const futurePts = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM points_ledger WHERE user_id=? AND log_date > ? AND ref_type='intel'`,
    ).bind(userId, today).first<{ n: number }>()
    expect(futurePts?.n, 'intel points landed on a future day').toBe(0)

    // The entry still landed (clamped to today), so the record is not lost.
    const landed = await env.DB.prepare(
      `SELECT log_date FROM captures WHERE kind='intel' AND user_id=? AND title='FUTURE FIXTURE' ORDER BY id DESC LIMIT 1`,
    ).bind(userId).first<{ log_date: string }>()
    expect(landed?.log_date).toBe(today)

    await env.DB.prepare(`DELETE FROM captures WHERE kind='intel' AND user_id=? AND title='FUTURE FIXTURE'`).bind(userId).run()
  })

  it('still allows honest back-dating of an intel entry', async () => {
    const { headers, userId } = await session()
    const res = await app.request('/api/intel', {
      method: 'POST', headers,
      body: JSON.stringify({ domain: 'other', title: 'PAST FIXTURE', log_date: '2026-01-05' }),
    }, baseEnv)
    expect(res.status).toBe(200)
    const landed = await env.DB.prepare(
      `SELECT log_date FROM captures WHERE kind='intel' AND user_id=? AND title='PAST FIXTURE' ORDER BY id DESC LIMIT 1`,
    ).bind(userId).first<{ log_date: string }>()
    expect(landed?.log_date).toBe('2026-01-05')
    await env.DB.prepare(`DELETE FROM captures WHERE kind='intel' AND user_id=? AND title='PAST FIXTURE'`).bind(userId).run()
  })
})

describe('Book 4 — in-app scoring changelog', () => {
  it('requires a session', async () => {
    const res = await app.request('/api/changelog', {}, baseEnv)
    expect(res.status).toBe(401)
  })

  it('exposes dated scoring-rule changes so the rules never change silently', async () => {
    const { headers } = await session()
    const res = await app.request('/api/changelog', { headers }, baseEnv)
    expect(res.status).toBe(200)
    const entries = await res.json<Array<{ date: string; change: string }>>()
    expect(Array.isArray(entries)).toBe(true)
    expect(entries.length).toBeGreaterThanOrEqual(3)
    for (const e of entries) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(typeof e.change).toBe('string')
      expect(e.change.length).toBeGreaterThan(0)
    }
    // The Minimum Viable Recovery scoring change must be recorded.
    expect(entries.some((e) => /recovery/i.test(e.change))).toBe(true)
  })
})
