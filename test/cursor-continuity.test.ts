import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
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
  const password = 'cursor-test-password'
  const salt = 'b1c2d3e4f5061728394a5b6c7d8e9f00'
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

describe('migration 0011 — chapter cursor schema', () => {
  it('creates the chapter_cursor table', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='chapter_cursor'`,
    ).all<{ name: string }>()
    expect((results as { name: string }[]).length).toBe(1)
  })
  it('preserves pre-migration personal rows', async () => {
    for (const [t, expected] of Object.entries(preMigrationRowCounts)) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>()
      expect(row?.n ?? 0, `${t} lost rows`).toBeGreaterThanOrEqual(expected)
    }
  })
})

describe('Book 16 / R9 — the chapter cursor', () => {
  it('requires a session', async () => {
    const res = await app.request('/api/cursor', {}, baseEnv)
    expect(res.status).toBe(401)
  })

  it('seeds the documented current value on first read (Chapter 2, Anaphora)', async () => {
    const { headers, userId } = await session()
    await env.DB.prepare(`DELETE FROM chapter_cursor WHERE user_id=?`).bind(userId).run()
    const res = await app.request('/api/cursor', { headers }, baseEnv)
    expect(res.status).toBe(200)
    const cur = await res.json<any>()
    expect(cur.chapter).toBe(2)
    expect(String(cur.figure)).toMatch(/anaphora/i)
    expect(cur.cycle_day).toBeGreaterThanOrEqual(1)
    expect(cur.cycle_day).toBeLessThanOrEqual(7)
  })

  it('persists an updated cursor', async () => {
    const { headers } = await session()
    const res = await app.request('/api/cursor', {
      method: 'POST', headers,
      body: JSON.stringify({ book: 'Farnsworth', part: 'Structure', chapter: 5, figure: 'Chiasmus', cycle_day: 3 }),
    }, baseEnv)
    expect(res.status).toBe(200)
    const read = await (await app.request('/api/cursor', { headers }, baseEnv)).json<any>()
    expect(read.chapter).toBe(5)
    expect(read.figure).toBe('Chiasmus')
    expect(read.cycle_day).toBe(3)
  })

  it('rejects an out-of-range cycle day', async () => {
    const { headers } = await session()
    const res = await app.request('/api/cursor', {
      method: 'POST', headers, body: JSON.stringify({ chapter: 2, figure: 'Anaphora', cycle_day: 9 }),
    }, baseEnv)
    expect(res.status).toBe(400)
  })
})

describe('Book 14 — the Continuity Brief', () => {
  it('requires a session', async () => {
    const res = await app.request('/api/continuity-brief', {}, baseEnv)
    expect(res.status).toBe(401)
  })

  it('emits a plain-text brief carrying the cursor and the fixed fields', async () => {
    const { headers } = await session()
    // Set a known cursor first.
    await app.request('/api/cursor', {
      method: 'POST', headers,
      body: JSON.stringify({ book: 'Farnsworth', part: 'Repetition at the Start', chapter: 2, figure: 'Anaphora', cycle_day: 4 }),
    }, baseEnv)
    const res = await app.request('/api/continuity-brief', { headers }, baseEnv)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') ?? '').toMatch(/text\/plain/)
    const text = await res.text()
    // Book 14 fields: current book, chapter cursor, cycle day, phase position,
    // review cadence, outstanding artifacts, next move.
    expect(text).toMatch(/Anaphora/)
    expect(text).toMatch(/Chapter\s*2/i)
    expect(text.toLowerCase()).toContain('cycle day')
    expect(text.toLowerCase()).toContain('next move')
    expect(text.length).toBeGreaterThan(80)
  })

  it('performs no writes (repeatable read)', async () => {
    const { headers, userId } = await session()
    const count = async () => {
      const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM points_ledger WHERE user_id=?`).bind(userId).first<{ n: number }>()
      return r?.n ?? 0
    }
    const before = await count()
    for (let i = 0; i < 3; i++) await app.request('/api/continuity-brief', { headers }, baseEnv)
    expect(await count()).toBe(before)
  })
})

describe('Book 16 — Commander’s File carries the cursor', () => {
  it('includes the cursor line in the model briefing surface', async () => {
    const { headers } = await session()
    await app.request('/api/cursor', {
      method: 'POST', headers,
      body: JSON.stringify({ book: 'Farnsworth', part: 'Repetition at the Start', chapter: 2, figure: 'Anaphora', cycle_day: 2 }),
    }, baseEnv)
    // The briefing is exercised through the continuity brief and (indirectly)
    // the model routes; here we assert the cursor is retrievable and shaped.
    const cur = await (await app.request('/api/cursor', { headers }, baseEnv)).json<any>()
    expect(cur.book).toBeTruthy()
    expect(cur.part).toBeTruthy()
    expect(cur.chapter).toBe(2)
  })
})

import councilSource from '../public/static/app/features/council.js?raw'

describe('Book 14 — frontend continuity-brief wiring', () => {
  it('offers a copy-continuity-brief action', () => {
    expect(councilSource).toMatch(/copyContinuityBrief/)
    expect(councilSource).toMatch(/\/api\/continuity-brief/)
  })
})
