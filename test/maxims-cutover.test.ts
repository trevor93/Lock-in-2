import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import { preMigrationRowCounts } from './setup'

// Book 7 table unification — maxims cutover (migration 0013 + route switch).
// Proves the flashcards SR rows were remapped onto captures(id) with zero loss,
// the backup is retained, and the maxim routes now read/write captures while the
// flashcard linkage and card queue keep working.

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
  const salt = '0011223344556677889900aabbccddee'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash('maxims-cutover-pw', salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'maxims-cutover-pw' }),
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

describe('B7 migration 0013 — flashcards remap onto captures', () => {
  it('retained a full pre-migration backup of the SR state', async () => {
    expect(await count(
      `SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='table' AND name='flashcards_pre0013_backup'`,
    )).toBe(1)
    expect(await count(`SELECT COUNT(*) AS n FROM flashcards_pre0013_backup`))
      .toBe(preMigrationRowCounts['flashcards'])
  })

  it('preserved every flashcard row (no SR state lost)', async () => {
    expect(await count(`SELECT COUNT(*) AS n FROM flashcards`))
      .toBe(preMigrationRowCounts['flashcards'])
  })

  it('remapped every flashcard onto a real maxim capture (no orphans)', async () => {
    const orphans = await count(
      `SELECT COUNT(*) AS n FROM flashcards f
       LEFT JOIN captures c ON c.id=f.maxim_id AND c.kind='maxim'
       WHERE c.id IS NULL`,
    )
    expect(orphans, 'a flashcard points at a non-maxim / missing capture').toBe(0)
  })

  it('enforces the new FK: a flashcard cannot point at a non-existent capture', async () => {
    let rejected = false
    try {
      await env.DB.prepare(`INSERT INTO flashcards (user_id, maxim_id) VALUES (1, 99999999)`).run()
    } catch (e: any) { rejected = /FOREIGN KEY|constraint/i.test(String(e?.message || e)) }
    expect(rejected).toBe(true)
  })
})

describe('B7 maxims routes now read/write captures', () => {
  it('GET /api/maxims returns maxims from captures', async () => {
    const s = await login()
    const res = await app.request('/api/maxims', { headers: { Cookie: s.cookie } }, baseEnv)
    expect(res.status).toBe(200)
    const rows = await res.json<Array<{ id: number; principle: string }>>()
    expect(Array.isArray(rows)).toBe(true)
    // The fixture maxim was backfilled into captures and should surface here.
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].principle, 'maxim fields not projected from captures').toBeTruthy()
  })

  it('POST /api/maxims writes to captures (not the frozen legacy table) and seeds a due card', async () => {
    const s = await login()
    const maximsBefore = await count(`SELECT COUNT(*) AS n FROM maxims`)
    const capturesBefore = await count(`SELECT COUNT(*) AS n FROM captures WHERE kind='maxim'`)

    const created = await post('/api/maxims', s, {
      source: 'Musashi', principle: 'Do nothing that is of no use.',
      naive_reading: 'skip busywork', master_reading: 'every act must serve the aim',
    })
    expect([200, 201]).toContain(created.status)
    const { id } = await created.json<{ id: number }>()

    expect(await count(`SELECT COUNT(*) AS n FROM captures WHERE kind='maxim'`), 'not written to captures')
      .toBe(capturesBefore + 1)
    expect(await count(`SELECT COUNT(*) AS n FROM maxims`), 'legacy maxims table must stay frozen')
      .toBe(maximsBefore)
    // A flashcard was seeded against the new capture id and is due today.
    expect(await count(`SELECT COUNT(*) AS n FROM flashcards WHERE maxim_id=?`, id)).toBe(1)

    const due = await app.request('/api/cards/due', { headers: { Cookie: s.cookie } }, baseEnv)
    const cards = await due.json<Array<{ maxim_id: number; principle: string }>>()
    const mine = cards.find((card) => card.maxim_id === id)
    expect(mine, 'new maxim card not surfaced in the due queue').toBeTruthy()
    expect(mine!.principle).toBe('Do nothing that is of no use.')
  })

  it('POST /api/maxims/:id/my-words updates the capture row', async () => {
    const s = await login()
    const created = await post('/api/maxims', s, {
      source: 'Stoic', principle: 'Amor fati.', naive_reading: 'accept', master_reading: 'will it',
    })
    const { id } = await created.json<{ id: number }>()
    const upd = await post(`/api/maxims/${id}/my-words`, s, { my_words: 'love what is' })
    expect(upd.status).toBe(200)
    const row = await env.DB.prepare(
      `SELECT my_words FROM captures WHERE id=? AND kind='maxim'`,
    ).bind(id).first<{ my_words: string }>()
    expect(row?.my_words).toBe('love what is')
  })
})
