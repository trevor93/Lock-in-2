import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'

// Book 7 SM-2 -> FSRS runtime switch. Migration 0016 backfilled FSRS state onto
// existing review_items; the tongue review handler now schedules with FSRS and
// records stability/difficulty/last_review. (Scheduling PROPERTIES are covered by
// test/fsrs.test.ts and test/tongue-review.test.ts.)

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
  const salt = '2468ace02468ace02468ace02468ace0'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash('fsrs-wiring-pw', salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'fsrs-wiring-pw' }),
  }, baseEnv)
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

describe('B7 SM-2 -> FSRS wiring', () => {
  it('migration 0016 backfilled FSRS state onto every response review_item', async () => {
    const missing = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM review_items
       WHERE kind='response' AND (stability IS NULL OR difficulty IS NULL)`,
    ).first<{ n: number }>()
    expect(missing?.n, 'a response review_item was left without FSRS state').toBe(0)
    // Difficulty is a real 1..10 value.
    const bad = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM review_items
       WHERE kind='response' AND (difficulty < 1 OR difficulty > 10 OR stability <= 0)`,
    ).first<{ n: number }>()
    expect(bad?.n).toBe(0)
  })

  it('a review records FSRS state (stability/difficulty/last_review) and schedules forward', async () => {
    const s = await login()
    const created = await post('/api/tongue', s, {
      situation: 'ctx', trigger_q: 'q?', response: 'the line', category: 'wit',
    })
    const { id } = await created.json<{ id: number }>()

    const review = await post(`/api/tongue/${id}/review`, s, { grade: 2, mode: 'recall' })
    expect(review.status).toBe(200)
    const { next_due } = await review.json<{ next_due: string }>()

    const row = await env.DB.prepare(
      `SELECT stability, difficulty, last_review, due_date FROM review_items
       WHERE kind='response' AND item_id=? AND user_id=?`,
    ).bind(id, s.userId).first<{ stability: number; difficulty: number; last_review: string; due_date: string }>()
    expect(row?.stability, 'stability not written').toBeGreaterThan(0)
    expect(row?.difficulty).toBeGreaterThanOrEqual(1)
    expect(row?.difficulty).toBeLessThanOrEqual(10)
    expect(row?.last_review, 'last_review not stamped').toBeTruthy()
    const today = new Date().toISOString().slice(0, 10)
    expect(next_due > today, 'a solid recall should schedule beyond today').toBe(true)
    expect(row?.due_date).toBe(next_due)
  })
})
