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
  const password = 'altgate-test-password'
  const salt = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'
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
  try { await env.DB.prepare(`DELETE FROM alternative_explanations WHERE user_id=?`).bind(owner.id).run() } catch (_) {}
  await env.DB.prepare(`DELETE FROM intel_entries WHERE user_id=? AND title LIKE '%GATE FIXTURE%'`).bind(owner.id).run()
})

describe('migration 0010 — alternative-explanation gate schema', () => {
  it('adds heat and alternative_explanation to intel_entries', async () => {
    const { results } = await env.DB.prepare(`SELECT name FROM pragma_table_info('intel_entries')`).all<{ name: string }>()
    const names = (results as { name: string }[]).map((r) => r.name)
    expect(names).toContain('heat')
    expect(names).toContain('alternative_explanation')
  })

  it('creates an append-only alternative_explanations ledger', async () => {
    const { userId } = await session()
    await env.DB.prepare(
      `INSERT INTO alternative_explanations (user_id, entity_type, text) VALUES (?, 'capture', 'they were probably just tired')`,
    ).bind(userId).run()
    const row = await env.DB.prepare(`SELECT id FROM alternative_explanations WHERE user_id=? ORDER BY id DESC LIMIT 1`).bind(userId).first<{ id: number }>()
    await expect(
      env.DB.prepare(`UPDATE alternative_explanations SET text='x' WHERE id=?`).bind(row!.id).run(),
    ).rejects.toThrow(/ALT_EXPLANATION_APPEND_ONLY/)
    await expect(
      env.DB.prepare(`DELETE FROM alternative_explanations WHERE id=?`).bind(row!.id).run(),
    ).rejects.toThrow(/ALT_EXPLANATION_APPEND_ONLY/)
  })

  it('blocks a non-calm capture with no alternative_explanation at the schema', async () => {
    const { userId } = await session()
    await expect(
      env.DB.prepare(
        `INSERT INTO intel_entries (user_id, log_date, domain, title, heat)
         VALUES (?, '2026-08-10', 'other', 'GATE FIXTURE hot', 'baited')`,
      ).bind(userId).run(),
    ).rejects.toThrow(/ALT_EXPLANATION_REQUIRED/)
  })

  it('allows a calm capture with no alternative_explanation', async () => {
    const { userId } = await session()
    const r = await env.DB.prepare(
      `INSERT INTO intel_entries (user_id, log_date, domain, title, heat)
       VALUES (?, '2026-08-10', 'other', 'GATE FIXTURE calm', 'calm')`,
    ).bind(userId).run()
    expect((r.meta as any).changes).toBe(1)
  })

  it('allows a non-calm capture that carries an alternative_explanation', async () => {
    const { userId } = await session()
    const r = await env.DB.prepare(
      `INSERT INTO intel_entries (user_id, log_date, domain, title, heat, alternative_explanation)
       VALUES (?, '2026-08-10', 'other', 'GATE FIXTURE ok', 'proud', 'I may just be pattern-matching on one remark.')`,
    ).bind(userId).run()
    expect((r.meta as any).changes).toBe(1)
  })

  it('preserves pre-migration personal rows', async () => {
    for (const [t, expected] of Object.entries(preMigrationRowCounts)) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>()
      expect(row?.n ?? 0, `${t} lost rows`).toBeGreaterThanOrEqual(expected)
    }
  })
})

describe('Book 13.2 — the gate through POST /api/intel', () => {
  it('rejects a heated capture with no alternative explanation (400)', async () => {
    const { headers } = await session()
    const res = await app.request('/api/intel', {
      method: 'POST', headers,
      body: JSON.stringify({ domain: 'other', title: 'GATE FIXTURE hot', heat: 'baited' }),
    }, baseEnv)
    expect(res.status).toBe(400)
  })

  it('accepts a heated capture with an alternative explanation and logs it', async () => {
    const { headers, userId } = await session()
    const res = await app.request('/api/intel', {
      method: 'POST', headers,
      body: JSON.stringify({
        domain: 'other', title: 'GATE FIXTURE hot ok', heat: 'baited',
        alternative_explanation: 'He might have been rushed, not dismissive.',
      }),
    }, baseEnv)
    expect(res.status).toBe(200)
    const led = await env.DB.prepare(
      `SELECT text, none_plausible FROM alternative_explanations WHERE user_id=? ORDER BY id DESC LIMIT 1`,
    ).bind(userId).first<{ text: string; none_plausible: number }>()
    expect(led?.text).toContain('rushed')
    expect(led?.none_plausible).toBe(0)
  })

  it('accepts a calm capture with no alternative explanation', async () => {
    const { headers } = await session()
    const res = await app.request('/api/intel', {
      method: 'POST', headers,
      body: JSON.stringify({ domain: 'other', title: 'GATE FIXTURE calm', heat: 'calm' }),
    }, baseEnv)
    expect(res.status).toBe(200)
  })

  it('counts "none plausible" as the paranoia tell', async () => {
    const { headers, userId } = await session()
    for (const alt of ['None plausible', 'none plausible.', 'none']) {
      await app.request('/api/intel', {
        method: 'POST', headers,
        body: JSON.stringify({ domain: 'other', title: 'GATE FIXTURE np', heat: 'afraid', alternative_explanation: alt }),
      }, baseEnv)
    }
    const n = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM alternative_explanations WHERE user_id=? AND none_plausible=1`,
    ).bind(userId).first<{ n: number }>()
    expect(n?.n).toBeGreaterThanOrEqual(3)
  })

  it('surfaces the running counts in /api/stats so the operator can see the tell', async () => {
    const { headers } = await session()
    await app.request('/api/intel', {
      method: 'POST', headers,
      body: JSON.stringify({ domain: 'other', title: 'GATE FIXTURE tell', heat: 'baited', alternative_explanation: 'none plausible' }),
    }, baseEnv)
    const res = await app.request('/api/stats', { headers }, baseEnv)
    const stats = await res.json<any>()
    expect(stats).toHaveProperty('alternativeExplanations')
    expect(stats.alternativeExplanations).toHaveProperty('total')
    expect(stats.alternativeExplanations).toHaveProperty('nonePlausible')
    expect(stats.alternativeExplanations.nonePlausible).toBeGreaterThanOrEqual(1)
  })
})
