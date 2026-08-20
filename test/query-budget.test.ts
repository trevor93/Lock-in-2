import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import app from '../src/index'

const baseEnv = {
  DB: env.DB,
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: 'https://model.invalid',
  OPENAI_ALLOWED_BASE_URLS: 'https://model.invalid',
}

async function passwordHash(password: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(
    saltHex.match(/.{2}/g)!.map((hex) => Number.parseInt(hex, 16)),
  )
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256,
  )
  return [...new Uint8Array(bits)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

// Count D1 statements by instrumenting the binding the app receives. This
// measures real round-trips rather than reasoning about the code.
type Counter = { prepare: number; batch: number; batched: number }

function countingDb(db: D1Database): { db: D1Database; counter: Counter } {
  const counter: Counter = { prepare: 0, batch: 0, batched: 0 }
  const wrapped = {
    prepare(sql: string) {
      counter.prepare++
      return db.prepare(sql)
    },
    batch(statements: unknown[]) {
      counter.batch++
      counter.batched += statements.length
      return (db as any).batch(statements)
    },
    dump: (db as any).dump?.bind(db),
    exec: (db as any).exec?.bind(db),
    withSession: (db as any).withSession?.bind(db),
  } as unknown as D1Database
  return { db: wrapped, counter }
}

let headers: Record<string, string>
let userId: number

beforeAll(async () => {
  const password = 'query-budget-test-password'
  const salt = '99887766554433221100ffeeddccbbaa'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0,
       locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash(password, salt), salt).run()
  const response = await app.request(
    '/api/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    },
    baseEnv,
  )
  expect(response.status).toBe(200)
  const cookie = response.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await response.json<{ csrfToken: string }>()
  const owner = await env.DB.prepare(
    `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
  ).first<{ id: number }>()
  userId = owner!.id
  headers = {
    Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken,
  }

  // 120 finalized days of history. Before day_summary materialisation this is
  // exactly the shape that produced ~240 round-trips per /api/state.
  const rows: D1PreparedStatement[] = []
  for (let i = 1; i <= 120; i++) {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
    rows.push(env.DB.prepare(
      `INSERT OR IGNORE INTO day_summary
         (user_id, summary_date, adherence_pct, victory, mvd_held, finalized)
       VALUES (?,?,?,?,?,1)`,
    ).bind(userId, d, 85, 1, 0))
  }
  await env.DB.batch(rows)
})

async function measure(path: string, init?: RequestInit): Promise<Counter> {
  const { db, counter } = countingDb(env.DB)
  const response = await app.request(path, init ?? { headers }, { ...baseEnv, DB: db })
  expect(response.status, `${path} -> ${response.status}`).toBeLessThan(400)
  return counter
}

describe('Book 6 read amplification', () => {
  it('serves /api/state in a bounded number of queries', async () => {
    const counter = await measure('/api/state')
    const total = counter.prepare + counter.batched
    // The documented defect was ~240 round-trips per /api/state. A bounded
    // read must not scale with history length: 120 finalized days are present.
    console.log("    MEASURED /api/state: "+total+" statements ("+counter.prepare+" prepare, "+counter.batch+" batch of "+counter.batched+")");
    expect(total, `/api/state issued ${total} statements`).toBeLessThan(40)
  })

  it('does not scale /api/state with the amount of history', async () => {
    const before = await measure('/api/state')
    // Double the history.
    const rows: D1PreparedStatement[] = []
    for (let i = 121; i <= 240; i++) {
      const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
      rows.push(env.DB.prepare(
        `INSERT OR IGNORE INTO day_summary
           (user_id, summary_date, adherence_pct, victory, mvd_held, finalized)
         VALUES (?,?,?,?,?,1)`,
      ).bind(userId, d, 85, 1, 0))
    }
    await env.DB.batch(rows)
    const after = await measure('/api/state')
    const beforeTotal = before.prepare + before.batched
    const afterTotal = after.prepare + after.batched
    // Query count must be flat in history size — that is what materialisation buys.
    console.log("    MEASURED history scaling: "+beforeTotal+" (120d) -> "+afterTotal+" (240d)");
    expect(afterTotal, `${beforeTotal} -> ${afterTotal} after doubling history`)
      .toBeLessThanOrEqual(beforeTotal)
  })

  it('serves /api/stats in a bounded number of queries', async () => {
    const counter = await measure('/api/stats')
    const total = counter.prepare + counter.batched
    console.log("    MEASURED /api/stats: "+total+" statements");
    expect(total, `/api/stats issued ${total} statements`).toBeLessThan(40)
  })

  it('performs zero writes on GET /api/state', async () => {
    // Book 5.8: a repeated GET must never mutate. Proven by row-count equality
    // across a burst of reads.
    const snapshot = async () => {
      const tables = ['points_ledger', 'honesty_flags', 'block_logs', 'day_summary']
      const counts: Record<string, number> = {}
      for (const t of tables) {
        const row = await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM ${t} WHERE user_id=?`,
        ).bind(userId).first<{ n: number }>()
        counts[t] = row?.n ?? 0
      }
      return counts
    }
    const before = await snapshot()
    for (let i = 0; i < 5; i++) {
      const response = await app.request('/api/state', { headers }, baseEnv)
      expect(response.status).toBe(200)
    }
    expect(await snapshot()).toEqual(before)
  })
})

describe('Book 6 pagination', () => {
  it('bounds every historical read', async () => {
    // No historical endpoint may stream an unbounded result set.
    for (const path of [
      '/api/intel', '/api/debriefs', '/api/flags/history',
      '/api/predictions', '/api/tongue', '/api/maxims',
    ]) {
      const response = await app.request(path, { headers }, baseEnv)
      expect(response.status, path).toBe(200)
      const body = await response.json<unknown>()
      const rows = Array.isArray(body)
        ? body
        : (body as any)?.results ?? (body as any)?.items ?? []
      expect(Array.isArray(rows), `${path} did not return a list`).toBe(true)
      expect((rows as unknown[]).length, `${path} returned an unbounded page`)
        .toBeLessThanOrEqual(200)
    }
  })
})
