import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../src/index'
import appSource from '../src/index.tsx?raw'
import agentV1Source from '../src/routes/agent-v1.ts?raw'
import hermesSource from '../src/routes/hermes.ts?raw'
import intelLibrarySource from '../src/routes/intel-library.ts?raw'
import tongueSource from '../src/routes/tongue.ts?raw'
import learnSource from '../src/routes/learn.ts?raw'
import recoverySource from '../src/routes/recovery.ts?raw'
import cursorSource from '../src/routes/cursor.ts?raw'
import daySource from '../src/routes/day.ts?raw'
import economySource from '../src/routes/economy.ts?raw'
import authSource from '../src/routes/auth.ts?raw'
import agentCredentialsSource from '../src/routes/agent-credentials.ts?raw'
import calendarSource from '../src/routes/calendar.ts?raw'
import pushSource from '../src/routes/push.ts?raw'
import ratchetSource from '../src/routes/ratchet.ts?raw'
import missCauseSource from '../src/routes/miss-cause.ts?raw'
import readingSource from '../src/routes/reading.ts?raw'
import masterySource from '../src/routes/mastery.ts?raw'
import principlesSource from '../src/routes/principles.ts?raw'
import rhetoricSource from '../src/routes/rhetoric.ts?raw'
import rhetoricLabSource from '../src/routes/rhetoric-lab.ts?raw'

const FIXTURE_ANCHOR = 'get_read_only:1:1'
const FIXTURE_COPIA_ID = 9901

const MUTATING_SQL = /^(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|VACUUM|REINDEX|PRAGMA\s+(?!table_info\b|table_xinfo\b|index_list\b|index_info\b|foreign_key_list\b))/i
// Book 17's GET-safety gate has to be exhaustive, so the route list is derived
// from the route sources rather than hand-maintained. A hardcoded list stops
// covering new ground the moment a module is added, which is exactly how the
// rhetoric routes escaped it.
const allRouteSources = [appSource, agentV1Source, hermesSource, intelLibrarySource, tongueSource, learnSource, recoverySource, cursorSource, daySource, economySource, authSource, agentCredentialsSource, calendarSource, pushSource, ratchetSource, missCauseSource, readingSource, masterySource, principlesSource, rhetoricSource, rhetoricLabSource].join(String.fromCharCode(10))

function declaredGetRoutes(): string[] {
  const paths = new Set<string>()
  const pattern = /app\.get\('([^']+)'/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(allRouteSources)) !== null) {
    const path = match[1]
    if (path.startsWith('/api/') || path.startsWith('/internal/') || path === '/calendar.ics') {
      paths.add(path)
    }
  }
  return [...paths]
}

// Concrete values for path parameters so routing resolves and the handler
// actually runs against a real row. A 404 would exercise nothing, so the
// values below are ones the migrations or seedReadCoverage() guarantee exist.
// :slug means a different namespace per route, so those paths are named
// explicitly rather than sharing one substitution.
const EXPLICIT_PATHS: Record<string, string> = {
  '/api/principles/:slug': '/api/principles/deception_controlled_revelation',
  '/api/concepts/:slug': '/api/concepts/sunzi_dao',
  '/api/cloze/:anchor': `/api/cloze/${FIXTURE_ANCHOR}`,
  '/api/rhetoric/copia/:id': `/api/rhetoric/copia/${FIXTURE_COPIA_ID}`,
}

function concrete(path: string): string {
  if (EXPLICIT_PATHS[path]) return EXPLICIT_PATHS[path]
  return path
    .replace(/:bookId/g, 'art_of_war')
    .replace(/:chapterIdx/g, '0')
    .replace(/:maximId/g, '9901')
    .replace(/:kind/g, 'unit')
    .replace(/:slug/g, 'anaphora')
    .replace(/:idx/g, '0')
    .replace(/:id/g, '1')
}

const GET_ROUTES = declaredGetRoutes().map(concrete)

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

  // Fixtures for the parameterised GETs. Without a real row behind them those
  // handlers answer 404 and the write check covers routing instead of the
  // handler, which is exactly the hole this gate exists to close.
  const owner = await env.DB.prepare(`SELECT id FROM users WHERE role='owner'`).first<any>()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO sources (id, title, author, original_language, first_published)
       VALUES ('get_read_only', 'Read-only fixture', 'fixture', 'en', '2026')`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO source_editions (id, source_id, translation_status, completeness)
       VALUES ('get_read_only:fixture', 'get_read_only', 'public_domain', 'excerpt')`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO source_sections
         (anchor, edition_id, chapter_idx, chapter_title, paragraph_idx, text, word_count)
       VALUES (?, 'get_read_only:fixture', 1, 'Fixture', 1,
               'A short fixture passage with enough words in it to make a cloze deletion possible.', 15)`,
    ).bind(FIXTURE_ANCHOR),
    env.DB.prepare(
      `INSERT OR IGNORE INTO copia_sessions (id, user_id, figure_slug, seed_sentence, occurred_on)
       VALUES (?, ?, 'anaphora', 'The fixture sentence.', '2026-08-23')`,
    ).bind(FIXTURE_COPIA_ID, owner?.id ?? 1),
  ])
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
  it('derived a non-trivial GET route table', () => {
    // A floor, so a future refactor that stops matching routes fails loudly
    // instead of quietly checking nothing.
    expect(GET_ROUTES.length).toBeGreaterThanOrEqual(60)
    expect(GET_ROUTES.some((path) => path.startsWith('/api/rhetoric/'))).toBe(true)
    expect(GET_ROUTES.some((path) => path.startsWith('/api/lab/'))).toBe(true)
  })

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
    const notFound: string[] = []
    writes.length = 0

    for (const method of ['GET', 'HEAD'] as const) {
      for (const path of GET_ROUTES) {
        const before = writes.length
        const response = await app.fetch(
          requestFor(path, method, cookie),
          { DB, OPENAI_API_KEY: '', OPENAI_BASE_URL: 'https://model.invalid' },
        )
        // A crash would mean the handler never really ran, so the write check
        // below would prove nothing. 503 is excluded from that rule: the push
        // routes answer 503 deliberately when no VAPID key is configured, which
        // is a real answer from a handler that ran, not a failure.
        expect(response.status === 503 || response.status < 500, `${method} ${path} -> ${response.status}`).toBe(true)
        if (response.status === 404) notFound.push(`${method} ${path}`)
        for (const sql of writes.slice(before)) violations.push(`${method} ${path}: ${sql}`)
      }
    }

    expect(violations).toEqual([])
    // Every derived path must resolve to a handler. A 404 would mean the write
    // check ran against routing, not against the handler it claims to cover.
    expect(notFound).toEqual([])
  })
})
