import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import appSource from '../src/index.tsx?raw'
// Routes relocated into route modules (Book 7) are scanned too, so the
// exhaustive denial gate keeps covering every route wherever it now lives.
import agentV1Source from '../src/routes/agent-v1.ts?raw'
import hermesRoutesSource from '../src/routes/hermes.ts?raw'
import intelLibrarySource from '../src/routes/intel-library.ts?raw'
import tongueRoutesSource from '../src/routes/tongue.ts?raw'
import learnRoutesSource from '../src/routes/learn.ts?raw'
import recoveryRoutesSource from '../src/routes/recovery.ts?raw'
import cursorRoutesSource from '../src/routes/cursor.ts?raw'
import dayRoutesSource from '../src/routes/day.ts?raw'
const allRouteSources = [appSource, agentV1Source, hermesRoutesSource, intelLibrarySource, tongueRoutesSource, learnRoutesSource, recoveryRoutesSource, cursorRoutesSource, dayRoutesSource].join(String.fromCharCode(10))

const baseEnv = {
  DB: env.DB,
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: 'https://model.invalid',
  OPENAI_ALLOWED_BASE_URLS: 'https://model.invalid',
}

// Routes that are unauthenticated BY DESIGN. Everything else that matches
// privatePath() must deny an anonymous caller.
const OPEN_BY_DESIGN = new Set([
  '/api/auth/setup',   // first-open password creation
  '/api/auth/login',   // password entry
  '/api/auth/status',  // "is a password set?" — reveals no personal data
  // Logout revokes whatever session was presented, clears the cookie and
  // always answers ok. Answering 401 instead would disclose whether a session
  // was valid and would break idempotent logout. It reads no personal data;
  // the dedicated test below pins that behaviour.
  '/api/auth/logout',
])

type Route = { method: string; path: string }

// Derive the route table from the source itself. A route added later is
// covered automatically instead of quietly escaping this gate.
function declaredRoutes(): Route[] {
  const routes: Route[] = []
  const pattern = /app\.(get|post|put|delete)\('([^']+)'/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(allRouteSources)) !== null) {
    routes.push({ method: match[1].toUpperCase(), path: match[2] })
  }
  return routes
}

function isPrivate(path: string): boolean {
  return path.startsWith('/api/') ||
    path.startsWith('/internal/') ||
    path === '/calendar.ics'
}

// Substitute concrete values for path parameters so routing resolves and the
// auth boundary — not a 404 — is what answers.
function concrete(path: string): string {
  return path
    .replace(/:maximId/g, '1')
    .replace(/:bookId/g, 'art_of_war')
    .replace(/:idx/g, '0')
    .replace(/:id/g, '1')
}

const privateRoutes = declaredRoutes().filter(
  (r) => isPrivate(r.path) && !OPEN_BY_DESIGN.has(r.path),
)
const browserRoutes = privateRoutes.filter(
  (r) => !r.path.startsWith('/api/agent/v1/') && !r.path.startsWith('/internal/'),
)
const agentRoutes = privateRoutes.filter((r) => r.path.startsWith('/api/agent/v1/'))
const internalRoutes = privateRoutes.filter((r) => r.path.startsWith('/internal/'))

async function callAnonymously(route: Route, headers: Record<string, string> = {}) {
  const init: RequestInit = { method: route.method, headers }
  if (!['GET', 'HEAD'].includes(route.method)) {
    init.body = '{}'
    init.headers = { 'Content-Type': 'application/json', ...headers }
  }
  return app.request(concrete(route.path), init, baseEnv)
}

// A denial is 401/403. A 404 would mean the route never resolved, so the test
// would prove nothing about the auth boundary.
const DENIED = [401, 403]

describe('B5.8.1 exhaustive private-route denial', () => {
  it('found a non-trivial route table to check', () => {
    expect(browserRoutes.length).toBeGreaterThanOrEqual(45)
    expect(agentRoutes.length).toBeGreaterThanOrEqual(9)
    expect(internalRoutes.length).toBeGreaterThanOrEqual(1)
  })

  it('denies every browser route without a session', async () => {
    const offenders: string[] = []
    for (const route of browserRoutes) {
      const response = await callAnonymously(route)
      if (!DENIED.includes(response.status)) {
        offenders.push(`${route.method} ${route.path} -> ${response.status}`)
      }
    }
    expect(offenders, 'these private routes answered an anonymous caller').toEqual([])
  })

  it('denies every browser route when the session cookie is forged', async () => {
    const offenders: string[] = []
    for (const route of browserRoutes) {
      const response = await callAnonymously(route, {
        Cookie: 'wr_session=forged-opaque-value-that-was-never-issued',
      })
      if (!DENIED.includes(response.status)) {
        offenders.push(`${route.method} ${route.path} -> ${response.status}`)
      }
    }
    expect(offenders, 'a forged cookie was accepted').toEqual([])
  })

  it('denies every agent route without a credential', async () => {
    const offenders: string[] = []
    for (const route of agentRoutes) {
      const response = await callAnonymously(route)
      if (!DENIED.includes(response.status)) {
        offenders.push(`${route.method} ${route.path} -> ${response.status}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('denies every agent route when the credential is forged', async () => {
    const offenders: string[] = []
    for (const route of agentRoutes) {
      const response = await callAnonymously(route, {
        'X-Agent-Token': 'forged-agent-token-never-issued-by-this-server',
      })
      if (!DENIED.includes(response.status)) {
        offenders.push(`${route.method} ${route.path} -> ${response.status}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('denies the internal job path to an anonymous caller', async () => {
    for (const route of internalRoutes) {
      const response = await callAnonymously(route)
      expect(DENIED, `${route.method} ${route.path}`).toContain(response.status)
    }
  })

  it('rejects an agent credential presented in the query string', async () => {
    // Query-string tokens leak through logs and referrers; header-only is the rule.
    for (const route of agentRoutes) {
      const response = await app.request(
        `${concrete(route.path)}?token=anything`,
        { method: route.method, headers: { 'Content-Type': 'application/json' }, body: '{}' },
        baseEnv,
      )
      expect(DENIED, `${route.path} accepted a query-string token`)
        .toContain(response.status)
    }
  })

  it('leaks no personal data in any denial body', async () => {
    for (const route of [...browserRoutes, ...agentRoutes]) {
      const response = await callAnonymously(route)
      const body = await response.text()
      expect(body.length, `${route.path} returned a large denial body`)
        .toBeLessThan(400)
      expect(body).not.toMatch(/password_hash|password_salt|token_hash|sqlite|SQLITE/i)
    }
  })

  it('answers logout without disclosing whether a session existed', async () => {
    const anonymous = await app.request(
      '/api/auth/logout',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      baseEnv,
    )
    expect(anonymous.status).toBe(200)
    const body = await anonymous.text()
    expect(body.length).toBeLessThan(200)
    expect(body).not.toMatch(/user|session_id|hash/i)
  })
})

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

async function login(): Promise<{ cookie: string; csrf: string; userId: number }> {
  const password = 'route-denial-test-password'
  const salt = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'
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
  return { cookie, csrf: csrfToken, userId: owner!.id }
}

describe('B5.8 session lifecycle', () => {
  it('accepts a valid session and rejects it after logout', async () => {
    const { cookie, csrf } = await login()
    const before = await app.request(
      '/api/state', { headers: { Cookie: cookie } }, baseEnv,
    )
    expect(before.status).toBe(200)

    const out = await app.request(
      '/api/auth/logout',
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: '{}',
      },
      baseEnv,
    )
    expect(out.status).toBe(200)

    const after = await app.request(
      '/api/state', { headers: { Cookie: cookie } }, baseEnv,
    )
    expect(after.status, 'a revoked session still worked').toBe(401)
  })

  it('rejects an expired session', async () => {
    const { cookie } = await login()
    // Expire it in the database exactly as the passage of time would.
    await env.DB.prepare(
      `UPDATE sessions SET expires_at=datetime('now','-1 day')
       WHERE revoked_at IS NULL`,
    ).run()
    const response = await app.request(
      '/api/state', { headers: { Cookie: cookie } }, baseEnv,
    )
    expect(response.status).toBe(401)
  })

  it('stores no raw session value — only its hash', async () => {
    const { cookie } = await login()
    const raw = cookie.split('=')[1]
    expect(raw.length).toBeGreaterThan(16)
    const hit = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM sessions WHERE token_hash=?`,
    ).bind(raw).first<{ n: number }>()
    expect(hit?.n, 'the raw session value was stored verbatim').toBe(0)
  })
})

describe('B5.8 agent credential enforcement', () => {
  async function issue(scopes: string[]): Promise<string> {
    const { cookie, csrf } = await login()
    const response = await app.request(
      '/api/agent/credentials',
      {
        method: 'POST',
        headers: {
          Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({
          deviceLabel: `denial-${scopes.join('-')}`.slice(0, 100),
          scopes,
        }),
      },
      baseEnv,
    )
    expect([200, 201]).toContain(response.status)
    const { token } = await response.json<{ token: string }>()
    return token
  }

  async function agentCall(path: string, token: string, body: unknown = {}) {
    return app.request(
      path,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Agent-Token': token },
        body: JSON.stringify(body),
      },
      baseEnv,
    )
  }

  it('enforces scope: a read-only credential cannot write', async () => {
    const token = await issue(['intel:read'])
    const read = await agentCall('/api/agent/v1/intel/read', token)
    expect(read.status).toBe(200)
    const write = await agentCall('/api/agent/v1/intel', token, {
      domain: 'other', title: 'scope probe',
    })
    expect(write.status, 'intel:read was allowed to write').toBe(403)
  })

  it('separates export scope from the default bridge grant', async () => {
    const token = await issue(['briefing:read'])
    const denied = await agentCall('/api/agent/v1/export', token)
    expect(denied.status).toBe(403)
  })

  it('denies a revoked credential', async () => {
    const token = await issue(['briefing:read'])
    expect((await agentCall('/api/agent/v1/briefing', token)).status).toBe(200)
    await env.DB.prepare(
      `UPDATE agent_credentials SET revoked_at=datetime('now')
       WHERE revoked_at IS NULL`,
    ).run()
    expect((await agentCall('/api/agent/v1/briefing', token)).status).toBe(401)
  })

  it('denies an expired credential', async () => {
    const token = await issue(['briefing:read'])
    await env.DB.prepare(
      `UPDATE agent_credentials SET expires_at=datetime('now','-1 day')
       WHERE revoked_at IS NULL`,
    ).run()
    expect((await agentCall('/api/agent/v1/briefing', token)).status).toBe(401)
  })

  it('never stores the raw credential', async () => {
    const token = await issue(['briefing:read'])
    const hit = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM agent_credentials WHERE token_hash=?`,
    ).bind(token).first<{ n: number }>()
    expect(hit?.n, 'the raw agent credential was stored verbatim').toBe(0)
  })
})
