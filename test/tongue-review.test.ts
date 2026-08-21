import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'

// Book 7 — behavioural net for the Tongue spaced-repetition review flow. This
// gap existed: no test drove capture -> due-queue -> grade -> reschedule. It
// asserts scheduling PROPERTIES via the API response (next_due / mastery), not
// the response_srs columns, so it survives the SM-2 -> FSRS switch: success
// pushes the next review out, repeated success widens the gap, a lapse pulls it
// back in, and a not-due card is refused.

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

async function login(): Promise<{ cookie: string; csrf: string; userId: number }> {
  const password = 'tongue-review-test-password'
  const salt = 'aabbccddeeff00112233445566778899'
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
  return { cookie, csrf: csrfToken, userId: owner!.id }
}

function post(path: string, s: { cookie: string; csrf: string }, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { Cookie: s.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf },
    body: JSON.stringify(body),
  }, baseEnv)
}

// Simulate the passage of time by making the card due in the past. Book 7: the
// SR state now lives in review_items (kind='response', item_id = the capture id).
async function makeDue(userId: number, responseId: number) {
  await env.DB.prepare(
    `UPDATE review_items SET due_date='2000-01-01' WHERE kind='response' AND item_id=? AND user_id=?`,
  ).bind(responseId, userId).run()
}

describe('B7 Tongue review scheduling', () => {
  async function capture(s: { cookie: string; csrf: string }): Promise<number> {
    const res = await post('/api/tongue', s, {
      situation: 'a hallway ambush', trigger_q: 'So what do you actually do?',
      response: 'I let the silence work, then name the real question.', category: 'wit',
    })
    expect([200, 201]).toContain(res.status)
    const { id } = await res.json<{ id: number }>()
    return id
  }

  it('a freshly captured line is due immediately and appears in the drill queue', async () => {
    const s = await login()
    const id = await capture(s)
    const due = await app.request('/api/tongue/due', { headers: { Cookie: s.cookie } }, baseEnv)
    expect(due.status).toBe(200)
    const cards = await due.json<Array<{ id: number; drill_mode: string }>>()
    const mine = cards.find((c) => c.id === id)
    expect(mine, 'new card not surfaced as due').toBeTruthy()
    expect(mine!.drill_mode, 'drill queue must assign a mode').toBeTruthy()
  })

  it('success pushes the next review into the future; repeated success widens the gap; a lapse pulls it back', async () => {
    const s = await login()
    const id = await capture(s)

    const first = await post(`/api/tongue/${id}/review`, s, { grade: 2, mode: 'recall' })
    expect(first.status).toBe(200)
    const r1 = await first.json<{ ok: boolean; next_due: string }>()
    expect(r1.ok).toBe(true)
    const today = new Date().toISOString().slice(0, 10)
    expect(r1.next_due > today, 'a solid recall should schedule beyond today').toBe(true)

    await makeDue(s.userId, id)
    const second = await post(`/api/tongue/${id}/review`, s, { grade: 2, mode: 'recall' })
    const r2 = await second.json<{ next_due: string }>()
    expect(r2.next_due > r1.next_due, 'a second solid recall should widen the interval').toBe(true)

    await makeDue(s.userId, id)
    const lapsed = await post(`/api/tongue/${id}/review`, s, { grade: 0, mode: 'recall' })
    const rL = await lapsed.json<{ next_due: string }>()
    expect(rL.next_due < r2.next_due, 'a blank (lapse) must reschedule sooner than the prior success').toBe(true)
  })

  it('refuses to review a card that is not yet due (schedule is enforced)', async () => {
    const s = await login()
    const id = await capture(s)
    await env.DB.prepare(
      `UPDATE review_items SET due_date='2999-01-01' WHERE kind='response' AND item_id=? AND user_id=?`,
    ).bind(id, s.userId).run()
    const res = await post(`/api/tongue/${id}/review`, s, { grade: 2, mode: 'recall' })
    expect(res.status).toBe(409)
  })
})
