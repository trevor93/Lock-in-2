import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import { preMigrationRowCounts } from './setup'

// Book 7 table unification — responses cutover (migration 0015 + route switch).
// Proves the SR rows were remapped onto capture ids with no loss, tongue_reviews
// dropped its responses FK (so new reviews log a capture id) with a retained
// backup, and the tongue routes now write response content to captures and SR
// state to review_items rather than the frozen legacy tables.

const baseEnv = {
  DB: env.DB, OPENAI_API_KEY: '', OPENAI_BASE_URL: 'https://model.invalid',
  OPENAI_ALLOWED_BASE_URLS: 'https://model.invalid',
}
async function count(sql: string, ...b: unknown[]): Promise<number> {
  const r = await env.DB.prepare(sql).bind(...b).first<{ n: number }>()
  return r?.n ?? 0
}
async function passwordHash(pw: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256)
  return [...new Uint8Array(bits)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
async function login(): Promise<{ cookie: string; csrf: string }> {
  const salt = '13579bdf02468ace13579bdf02468ace'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash('responses-cutover-pw', salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'responses-cutover-pw' }),
  }, baseEnv)
  const cookie = res.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await res.json<{ csrfToken: string }>()
  return { cookie, csrf: csrfToken }
}
function post(path: string, s: { cookie: string; csrf: string }, body: unknown) {
  return app.request(path, {
    method: 'POST', headers: { Cookie: s.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf },
    body: JSON.stringify(body),
  }, baseEnv)
}

describe('B7 migration 0015 — responses cutover integrity', () => {
  it('remapped every response SR row onto a real response capture (no orphans)', async () => {
    const orphans = await count(
      `SELECT COUNT(*) AS n FROM review_items ri
       LEFT JOIN captures c ON c.id=ri.item_id AND c.kind='response'
       WHERE ri.kind='response' AND c.id IS NULL`,
    )
    expect(orphans, 'a response review_item points at a missing/non-response capture').toBe(0)
    // The backfilled SR count is preserved (one review_item per legacy response_srs row).
    expect(await count(`SELECT COUNT(*) AS n FROM review_items WHERE kind='response'`))
      .toBe(preMigrationRowCounts['response_srs'])
  })

  it('retained a tongue_reviews backup and dropped the responses FK', async () => {
    expect(await count(
      `SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='table' AND name='tongue_reviews_pre0015_backup'`,
    )).toBe(1)
    expect(await count(`SELECT COUNT(*) AS n FROM tongue_reviews_pre0015_backup`))
      .toBe(preMigrationRowCounts['tongue_reviews'])
    // A tongue_review can now be logged against a capture id that is not a
    // responses.id — impossible while the old FK to responses stood.
    const owner = await env.DB.prepare(`SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`).first<{ id: number }>()
    const cap = await env.DB.prepare(
      `INSERT INTO captures (user_id, kind, situation, trigger_q, response) VALUES (?,'response','s','t','r')`,
    ).bind(owner!.id).run()
    const write = await env.DB.prepare(
      `INSERT INTO tongue_reviews (user_id, response_id, review_date, mode, grade) VALUES (?,?,?,?,?)`,
    ).bind(owner!.id, Number(cap.meta.last_row_id), '2026-08-20', 'recall', 2).run()
    expect(Number((write.meta as any).changes)).toBe(1)
  })
})

describe('B7 tongue routes now use captures + review_items', () => {
  it('POST /api/tongue writes content to captures and SR to review_items (legacy tables frozen)', async () => {
    const s = await login()
    const respBefore = await count(`SELECT COUNT(*) AS n FROM responses`)
    const srsBefore = await count(`SELECT COUNT(*) AS n FROM response_srs`)
    const capBefore = await count(`SELECT COUNT(*) AS n FROM captures WHERE kind='response'`)
    const riBefore = await count(`SELECT COUNT(*) AS n FROM review_items WHERE kind='response'`)

    const created = await post('/api/tongue', s, {
      situation: 'a cold open', trigger_q: 'so, what do you do?',
      response: 'I ask what they already decided.', category: 'wit',
    })
    expect([200, 201]).toContain(created.status)
    const { id } = await created.json<{ id: number }>()

    expect(await count(`SELECT COUNT(*) AS n FROM captures WHERE kind='response'`)).toBe(capBefore + 1)
    expect(await count(`SELECT COUNT(*) AS n FROM review_items WHERE kind='response'`)).toBe(riBefore + 1)
    expect(await count(`SELECT COUNT(*) AS n FROM responses`), 'legacy responses frozen').toBe(respBefore)
    expect(await count(`SELECT COUNT(*) AS n FROM response_srs`), 'legacy response_srs frozen').toBe(srsBefore)
    // The SR row is keyed by the new capture id.
    expect(await count(`SELECT COUNT(*) AS n FROM review_items WHERE kind='response' AND item_id=?`, id)).toBe(1)

    const list = await app.request('/api/tongue', { headers: { Cookie: s.cookie } }, baseEnv)
    const rows = await list.json<Array<{ id: number; response: string }>>()
    expect(rows.find((r) => r.id === id)?.response).toBe('I ask what they already decided.')
  })

  it('exam submit writes to the unified exams table, not the frozen tongue_exams', async () => {
    const s = await login()
    const examsBefore = await count(`SELECT COUNT(*) AS n FROM exams WHERE kind='tongue'`)
    const legacyBefore = await count(`SELECT COUNT(*) AS n FROM tongue_exams`)
    const res = await post('/api/tongue/exam/submit', s, { total: 4, correct: 4, date: '2026-08-20' })
    expect(res.status).toBe(200)
    expect(await count(`SELECT COUNT(*) AS n FROM exams WHERE kind='tongue'`)).toBe(examsBefore + 1)
    expect(await count(`SELECT COUNT(*) AS n FROM tongue_exams`), 'legacy tongue_exams frozen').toBe(legacyBefore)
  })
})
