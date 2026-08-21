import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { bodyLimit } from 'hono/body-limit'
import { setSecurityHeaders } from './security-headers'
import { addDays, dowOf, isoWeekKey } from './time'
import { dayAdherence } from './scoring'
import type { Bindings, Variables } from './env'
import { csrfToken, timingSafeEq } from './crypto'
import { MANIFEST, SERVICE_WORKER, SHELL_HTML } from './renderer'
import { getSetting, setSetting, blocksForDate } from './repositories'
import { userNow, safeDate } from './clock'
import { sessionCookie, findSession, sessionValid, revokePresentedSession, issueSession, ownerUser } from './auth'
import { registerAgentV1Routes } from './routes/agent-v1'
import { registerHermesRoutes } from './routes/hermes'
import { registerIntelLibraryRoutes } from './routes/intel-library'
import { registerTongueRoutes } from './routes/tongue'
import { registerLearnRoutes } from './routes/learn'
import { registerRecoveryRoutes } from './routes/recovery'
import { registerCursorRoutes } from './routes/cursor'
import { registerDayRoutes } from './routes/day'
import { registerEconomyRoutes } from './routes/economy'
import { registerAuthRoutes } from './routes/auth'
import { agentRoute, AGENT_V1_PATHS, authenticateAgent, agentCredentialEvent } from './agent-auth'
import { registerAgentCredentialRoutes } from './routes/agent-credentials'
import { registerCalendarRoutes } from './routes/calendar'
import { registerPushRoutes } from './routes/push'
import { registerRatchetRoutes } from './routes/ratchet'
import { registerMissCauseRoutes } from './routes/miss-cause'
import { RequestValidationError, validationFailed } from './validation'

// Bindings/Variables extracted to ./env (Book 7).


const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

function privatePath(path: string): boolean {
  return path.startsWith('/api/') || path.startsWith('/internal/') || path === '/calendar.ics'
}

function allowedOrigins(c: any): Set<string> {
  const configured = String(c.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin: string) => origin.trim())
    .filter(Boolean)
  return new Set([new URL(c.req.url).origin, ...configured])
}

// Security headers + CSP extracted to ./security-headers (Book 7).

// Private responses never enter caches. Browser requests carrying an Origin must
// match this deployment or an explicit allowlist; non-browser bridge requests do
// not send Origin and continue to authenticate with X-Agent-Token.
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  setSecurityHeaders(c)
  if (!privatePath(path)) {
    await next()
    setSecurityHeaders(c)
    return
  }

  c.header('Cache-Control', 'no-store')
  const origin = c.req.header('origin')
  if (origin && !allowedOrigins(c).has(origin)) {
    return c.json({ error: 'ORIGIN NOT ALLOWED' }, 403)
  }

  const method = c.req.method.toUpperCase()
  if (method === 'OPTIONS') {
    const requestedHeaders = (c.req.header('access-control-request-headers') || '')
      .split(',')
      .map((header: string) => header.trim().toLowerCase())
      .filter(Boolean)
    const allowedHeaders = new Set([
      'content-type', 'x-csrf-token', 'x-request-id',
    ])
    if (requestedHeaders.some((header: string) => !allowedHeaders.has(header))) {
      return c.json({ error: 'CORS PREFLIGHT NOT ALLOWED' }, 403)
    }
    c.header('Access-Control-Allow-Origin', origin || new URL(c.req.url).origin)
    c.header('Access-Control-Allow-Credentials', 'true')
    c.header('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS')
    c.header('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, X-Request-Id')
    c.header('Access-Control-Max-Age', '600')
    c.header('Vary', 'Origin', { append: true })
    c.header('Vary', 'Access-Control-Request-Headers', { append: true })
    return c.body(null, 204)
  }
  const unsafe = !['GET', 'HEAD'].includes(method)
  const rawSession = getCookie(c, 'wr_session')
  const isPasswordEntry = path === '/api/auth/setup' || path === '/api/auth/login'
  const isAgentCredentialRequest = path.startsWith('/api/agent/v1/') &&
    !!c.req.header('x-agent-token')
  if (unsafe && path.startsWith('/api/') && rawSession && !isPasswordEntry && !isAgentCredentialRequest) {
    const supplied = c.req.header('x-csrf-token') || ''
    const expected = await csrfToken(rawSession)
    if (!supplied || !timingSafeEq(supplied, expected)) {
      return c.json({ error: 'CSRF VALIDATION FAILED' }, 403)
    }
  }

  await next()
  setSecurityHeaders(c)
  c.header('Cache-Control', 'no-store')
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin)
    c.header('Access-Control-Allow-Credentials', 'true')
    c.header('Vary', 'Origin', { append: true })
  }
})

app.use(
  '/api/*',
  bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => c.json({ error: 'PAYLOAD TOO LARGE' }, 413),
  }),
)
app.use(
  '/internal/*',
  bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => c.json({ error: 'PAYLOAD TOO LARGE' }, 413),
  }),
)

// Request validation extracted to ./validation (Book 7).

app.onError((error, c) => {
  if (error instanceof RequestValidationError) return validationFailed(c)
  console.error(error)
  return c.json({ error: 'INTERNAL SERVER ERROR' }, 500)
})

// Request-time support (alt-gate, request-id, audit, idempotency) extracted to ./request-support (Book 7).

// Schemas extracted to ./schemas (Book 7).

// Agent scopes + credential body schema live in ./agent-auth (imported).

// ============ SERVER CLOCK (single source of truth) ============
// The commander's timezone is captured ONCE (settings.timezone). After that the
// SERVER derives date+time — the client can never time-travel the engines.
// getSetting/setSetting extracted to ./repositories (Book 7).
// userNow/safeDate extracted to ./clock (Book 7).

// ============ AUTH (durable users + hashed, revocable sessions) ============
// Session helpers (SESSION_DAYS, sessionCookie, findSession, sessionValid,
// revokePresentedSession, issueSession, ownerUser) live in ./auth (imported).



// Auth routes (the only unauthenticated API surface) registered from ./routes/auth (Book 7).
registerAuthRoutes(app)


// -- global API guard --
// /api/auth/*                   → open (it IS the gate)
// /api/agent/credentials*       → durable owner session only
// /api/agent/v1/*               → scoped hashed agent credential only
// unversioned /api/agent/*      → retired
// everything else /api/*       → durable owner session required
app.use('/api/*', async (c, next) => {
  const p = new URL(c.req.url).pathname
  if (p.startsWith('/api/auth/')) return next()
  if (p === '/api/agent/credentials' ||
      /^\/api\/agent\/credentials\/[^/]+\/revoke$/.test(p) ||
      p === '/api/agent/token' || p === '/api/agent/token/rotate') {
    if (!(await sessionValid(c))) return c.json({ error: 'AUTH REQUIRED' }, 401)
    return next()
  }
  if (p.startsWith('/api/agent/v1/')) {
    const route = agentRoute(c.req.method, p)
    if (!route) {
      return c.json(
        { error: AGENT_V1_PATHS.has(p) ? 'METHOD NOT ALLOWED' : 'AGENT ROUTE NOT FOUND' },
        AGENT_V1_PATHS.has(p) ? 405 : 404,
      )
    }
    c.set('agentRoute', route.route)
    const denied = await authenticateAgent(c)
    if (denied) return denied
    if (!c.get('agentScopes').includes(route.scope)) {
      await agentCredentialEvent(
        c,
        c.get('agentCredentialId'),
        c.get('userId'),
        'scope_denied',
        route.route,
      )
      return c.json({
        error: 'AGENT SCOPE REQUIRED', requiredScope: route.scope,
      }, 403)
    }
    return next()
  }
  if (p.startsWith('/api/agent/')) {
    return c.json({
      error: 'AGENT API VERSION RETIRED. Use /api/agent/v1.',
    }, 410)
  }
  if (!(await sessionValid(c))) return c.json({ error: 'AUTH REQUIRED' }, 401)
  return next()
})

// DOWS/dowOf/addDays/isoWeekKey extracted to ./time (Book 7).


// blocksForDate extracted to ./repositories (Book 7).

// WEIGHTED ADHERENCE — CORE(3) / STANDARD(1) / CONTEXT(0).
// adherence = Σ(weight × credit) / Σ(weight) over non-zero-weight blocks.
// Missing a meal no longer equals missing deep work. Context blocks are
// visible but unscored and unpenalized.
// dayAdherence extracted to ./scoring (Book 7).

// Structured flag identity — no more message-LIKE matching.
// Honesty/enforcement service extracted to ./enforcement (Book 7).

// Daily-flow routes (state, tick, blocks, appeals, load, predictions, debrief) registered from ./routes/day (Book 7).
registerDayRoutes(app)
registerRecoveryRoutes(app)
registerCursorRoutes(app)


// Learning routes (campaign, maxims, cards, flags) registered from ./routes/learn (Book 7).
registerLearnRoutes(app)



// THE TONGUE routes registered from ./routes/tongue (Book 7).
registerTongueRoutes(app)

// Economy/insights routes (laws, rewards, changelog, stats) registered from ./routes/economy (Book 7).
registerEconomyRoutes(app)


// LIFE INTEL + library routes registered from ./routes/intel-library (Book 7).
registerIntelLibraryRoutes(app)

// ============ CALENDAR EXPORT (.ics — device-native alarms) ============
// Calendar (.ics) route registered from ./routes/calendar (Book 7).
registerCalendarRoutes(app)

// Alarms: Web Push subscribe/preferences + the internal Cron entry (Book 7).
registerPushRoutes(app)

// The ratchet: mandatory set vs deck, promotion and demotion (Book 8.1).
registerRatchetRoutes(app)

// Miss diagnosis: the cause taxonomy and the correction it implies (Book 8.4).
registerMissCauseRoutes(app)

// COUNCIL/Hermes routes registered from ./routes/hermes (Book 7).
registerHermesRoutes(app)

// ============ HERMES BRIDGE — scoped external agent API ============
// genAgentToken extracted to ./agent-auth (Book 7).

// Agent credential routes registered from ./routes/agent-credentials (Book 7).
registerAgentCredentialRoutes(app)
// /api/agent/v1/* routes registered from ./routes/agent-v1 (Book 7).
registerAgentV1Routes(app)

// ============ PWA MANIFEST + SERVICE WORKER ============
app.get('/manifest.json', (c) => c.json(MANIFEST))

app.get('/sw.js', (c) =>
  new Response(SERVICE_WORKER, { headers: { 'Content-Type': 'application/javascript' } }))

// ============ SHELL ============
app.get('/', (c) => c.html(SHELL_HTML))

export default app
