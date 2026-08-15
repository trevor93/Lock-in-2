import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../src/index'

const MUTATING_SQL = /^(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|VACUUM|REINDEX|PRAGMA\s+(?!table_info\b|table_xinfo\b|index_list\b|index_info\b|foreign_key_list\b))/i
const GET_ROUTES = [
  '/api/state',
  '/api/appeals',
  '/api/predictions',
  '/api/predictions/calibration',
  '/api/debriefs',
  '/api/campaign',
  '/api/maxims',
  '/api/cards/due',
  '/api/flags/history',
  '/api/tongue',
  '/api/tongue/due',
  '/api/tongue/exam',
  '/api/tongue/stats',
  '/api/laws',
  '/api/rewards',
  '/api/stats',
  '/api/intel',
  '/api/library',
  '/calendar.ics',
  '/api/hermes/history',
  '/api/agent/token',
  '/api/agent/v1/briefing',
  '/api/agent/v1/pending',
  '/api/agent/v1/debriefs',
  '/api/agent/v1/intel',
  '/api/agent/v1/intel/read',
  '/api/agent/v1/export',
] as const

function recordWrites(DB: D1Database) {
  const writes: string[] = []
  const instrumented = new Proxy(DB, {
    get(target, property, receiver) {
      if (property === 'prepare') {
        return (sql: string) => {
          if (MUTATING_SQL.test(sql.trim())) writes.push(sql.trim())
          return target.prepare(sql)
        }
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as D1Database
  return { DB: instrumented, writes }
}

async function seedReadCoverage() {
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('timezone', 'Africa/Nairobi')`),
    env.DB.prepare(`INSERT OR IGNORE INTO phases (id, sort_order, code, title, subtitle, track) VALUES (9901, 9901, 'TEST', 'Test phase', '', 'test')`),
    env.DB.prepare(`INSERT OR IGNORE INTO units (id, phase_id, sort_order, title) VALUES (9901, 9901, 1, 'Test unit')`),
    env.DB.prepare(`INSERT OR IGNORE INTO maxims (id, source, principle, naive_reading, master_reading) VALUES (9901, 'test', 'test', 'test', 'test')`),
  ])
  await env.DB.prepare(`DELETE FROM unit_progress WHERE unit_id=9901`).run()
  await env.DB.prepare(`DELETE FROM flashcards WHERE maxim_id=9901`).run()
}

function requestFor(path: string, method: 'GET' | 'HEAD', cookie: string) {
  const headers = new Headers()
  if (path.startsWith('/api/') || path === '/calendar.ics') {
    headers.set('Cookie', cookie)
  }
  return new Request(`https://warroom.test${path}`, { method, headers })
}

async function passwordHash(password: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((hex) => Number.parseInt(hex, 16)))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    key,
    256,
  )
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function authenticatedCookie(DB: D1Database): Promise<string> {
  const password = 'test-password-only'
  const salt = '00112233445566778899aabbccddeeff'
  await DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash(password, salt), salt).run()
  const response = await app.request(
    '/api/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    },
    { DB, OPENAI_API_KEY: '', OPENAI_BASE_URL: 'https://model.invalid' },
  )
  expect(response.status).toBe(200)
  const setCookie = response.headers.get('set-cookie')
  expect(setCookie).toBeTruthy()
  return setCookie!.split(';', 1)[0]
}

beforeEach(seedReadCoverage)

describe('GET and HEAD safety', () => {
  it('keeps repeated crawler GET and HEAD requests to state free of writes and penalties', async () => {
    const { DB, writes } = recordWrites(env.DB)
    const cookie = await authenticatedCookie(DB)
    writes.length = 0

    for (const method of ['GET', 'HEAD'] as const) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await app.fetch(
          requestFor('/api/state', method, cookie),
          { DB, OPENAI_API_KEY: '', OPENAI_BASE_URL: 'https://model.invalid' },
        )
        expect(response.status).toBe(200)
      }
    }

    expect(writes).toEqual([])
  })

  it('keeps every private GET and HEAD route free of D1 writes', async () => {
    const { DB, writes } = recordWrites(env.DB)
    const cookie = await authenticatedCookie(DB)
    const violations: string[] = []
    writes.length = 0

    for (const method of ['GET', 'HEAD'] as const) {
      for (const path of GET_ROUTES) {
        const before = writes.length
        const response = await app.fetch(
          requestFor(path, method, cookie),
          { DB, OPENAI_API_KEY: '', OPENAI_BASE_URL: 'https://model.invalid' },
        )
        expect(response.status, `${method} ${path}`).toBeLessThan(500)
        for (const sql of writes.slice(before)) violations.push(`${method} ${path}: ${sql}`)
      }
    }

    expect(violations).toEqual([])
  })
})
