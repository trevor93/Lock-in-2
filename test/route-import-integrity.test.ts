import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import rhetoricSource from '../src/routes/rhetoric.ts?raw'
import rhetoricLabSource from '../src/routes/rhetoric-lab.ts?raw'

// Book 7 route-split integrity. Each case below exercises a handler branch that
// referenced a helper or schema the route module never imported. tsc caught them
// after the composition root was cleaned; the vitest+build gate never did, because
// esbuild is transpile-only and no prior test drove these exact branches. Left
// unfixed, each raises a ReferenceError that onError turns into a 500 — so the
// endpoint fails instead of doing its job. These tests pin the intended status and
// stand as the regression guard now that tsc --noEmit is part of the gate.

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

async function login(): Promise<{ cookie: string; csrf: string }> {
  const password = 'route-integrity-test-password'
  const salt = '1a2b3c4d5e6f70819293a4b5c6d7e8f9'
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
  return { cookie, csrf: csrfToken }
}

function post(path: string, session: { cookie: string; csrf: string }, body: unknown = {}) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: {
        Cookie: session.cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': session.csrf,
      },
      body: JSON.stringify(body),
    },
    baseEnv,
  )
}

describe('B7 route-module import integrity', () => {
  it('POST /api/tick with an invalid IANA zone answers 400, not a 500 (day.ts: RequestValidationError)', async () => {
    const session = await login()
    // The timezone-capture branch only runs while the zone is still unlocked.
    await env.DB.prepare(`DELETE FROM settings WHERE key='timezone_locked'`).run()
    const response = await post('/api/tick', session, { tz: 'Not/AReal_Zone' })
    expect(response.status).toBe(400)
  })

  it('POST /api/intel/:id/analyze reaches its handler and 404s a missing entry, not a 500 (hermes.ts: parseEmptyBody)', async () => {
    const session = await login()
    const response = await post('/api/intel/999999/analyze', session)
    expect(response.status).toBe(404)
  })

  it('POST /api/library/:bookId/chapter/:idx with an unknown book answers 400, not a 500 (intel-library.ts: RequestValidationError)', async () => {
    const session = await login()
    const response = await post('/api/library/not_a_real_book/chapter/0', session)
    expect(response.status).toBe(400)
  })

  it('POST /api/library/:bookId/chapter/:idx past the last chapter answers 400, not a 500 (intel-library.ts: RequestValidationError)', async () => {
    const session = await login()
    const response = await post('/api/library/art_of_war/chapter/999999', session)
    expect(response.status).toBe(400)
  })

  it('GET /api/tongue?category=<valid> answers 200, not a 500 (tongue.ts: responseCategorySchema)', async () => {
    const session = await login()
    const response = await app.request(
      '/api/tongue?category=wit', { headers: { Cookie: session.cookie } }, baseEnv,
    )
    expect(response.status).toBe(200)
  })

  it('GET /api/tongue?category=<invalid> answers 400, not a 500 (tongue.ts: responseCategorySchema)', async () => {
    const session = await login()
    const response = await app.request(
      '/api/tongue?category=not_a_category', { headers: { Cookie: session.cookie } }, baseEnv,
    )
    expect(response.status).toBe(400)
  })

  it('GET /api/tongue?q=<term> answers 200, not a 500 (tongue.ts: z)', async () => {
    const session = await login()
    const response = await app.request(
      '/api/tongue?q=hello', { headers: { Cookie: session.cookie } }, baseEnv,
    )
    expect(response.status).toBe(200)
  })
})

// The two newest and largest route modules sat outside this guard entirely. Rather
// than hand-pick branches, every route they declare is driven once with a
// well-formed session and an empty body. A missing import raises a ReferenceError
// that onError turns into a 500, so "never 500" is exactly the property this test
// needs — and it keeps covering routes added to those modules later.
function declaredRoutes(source: string): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = []
  const pattern = /app\.(get|post|put|delete)\('([^']+)'/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    routes.push({ method: match[1].toUpperCase(), path: match[2] })
  }
  return routes
}

function concrete(path: string): string {
  return path.replace(/:slug/g, 'anaphora').replace(/:id/g, '1')
}

const rhetoricRoutes = declaredRoutes(rhetoricSource)
const rhetoricLabRoutes = declaredRoutes(rhetoricLabSource)

describe('B7 route-module import integrity — the rhetoric modules', () => {
  it('found both route tables', () => {
    expect(rhetoricRoutes.length).toBeGreaterThanOrEqual(21)
    expect(rhetoricLabRoutes.length).toBeGreaterThanOrEqual(15)
  })

  for (const [label, routes] of [
    ['rhetoric.ts', rhetoricRoutes],
    ['rhetoric-lab.ts', rhetoricLabRoutes],
  ] as const) {
    it(`drives every ${label} route without a 500`, async () => {
      const session = await login()
      const crashes: string[] = []
      for (const route of routes) {
        const path = concrete(route.path)
        const response = route.method === 'GET'
          ? await app.request(path, { headers: { Cookie: session.cookie } }, baseEnv)
          : await post(path, session)
        // A 404 is a real answer here (the fixture row may not exist); a 500 is a
        // crash, and an unresolved route would 404 too, so the count above is what
        // proves the table is non-trivial.
        if (response.status >= 500) {
          crashes.push(`${route.method} ${route.path} -> ${response.status}`)
        }
      }
      expect(crashes, 'these handlers crashed').toEqual([])
    })
  }
})
