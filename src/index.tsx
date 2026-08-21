import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { setSecurityHeaders } from './security-headers'
import { addDays, dowOf, isoWeekKey } from './time'
import { dayAdherence } from './scoring'
import type { Bindings, Variables } from './env'
import { bufToHex, randHex, sha256, csrfToken, pbkdf2, timingSafeEq } from './crypto'
import { MANIFEST, SERVICE_WORKER, SHELL_HTML } from './renderer'
import { getSetting, setSetting, blocksForDate } from './repositories'
import { computeStreak } from './streak'
import { type ChapterCursor, readChapterCursor } from './cursor'
import { hermesBriefing, continuityBrief } from './commanders-file'
import { callModel, fencedModelData, EXTERNAL_MESSAGE_PREFIX, modelAudit, modelBaseURL } from './ai'
import { flagExists, addFlag, writeDaySummary, runEnforcement } from './enforcement'
import { userNow, safeDate } from './clock'
import { type SessionRecord, sessionCookie, findSession, sessionValid, revokePresentedSession, issueSession, ownerUser } from './auth'
import { isNonePlausible, altGate, recordAltExplanation, requestId, auditEvent, withIdempotency } from './request-support'
import { ensureUnlocks, ensureCards } from './curriculum'
import { buildState } from './state'
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
import { RequestValidationError, validationFailed, parseJson, parseEmptyBody, parseValue } from './validation'

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
import {
  positiveIdSchema,
  chapterIndexSchema,
  dateSchema,
  timeSchema,
  optionalText,
  optionalTrimmedText,
  requiredTrimmedText,
  optionalDate,
  gradeSchema,
  blockStatusSchema,
  loadReductionReasonSchema,
  predictionOutcomeSchema,
  responseCategorySchema,
  tongueModeSchema,
  intelDomainSchema,
  intelVerdictSchema,
  bookStatusSchema,
  hermesRoleSchema,
  passwordBodySchema,
  tickBodySchema,
  recoveryBodySchema,
  catchupBodySchema,
  blockLogBodySchema,
  appealBodySchema,
  loadReductionBodySchema,
  predictionBodySchema,
  predictionResolutionBodySchema,
  debriefBodySchema,
  unitStepBodySchema,
  maximBodySchema,
  myWordsBodySchema,
  cardReviewBodySchema,
  tongueBodySchema,
  tongueReviewBodySchema,
  tongueExamBodySchema,
  lawCheckBodySchema,
  captureHeatSchema,
  intelBodySchema,
  agentIntelBodySchema,
  intelVerdictBodySchema,
  bookProgressBodySchema,
  MODEL_USER_INPUT_CHARS,
  MODEL_TOTAL_INPUT_CHARS,
  hermesBodySchema,
  councilBodySchema,
  agentDebriefBodySchema,
  agentBlockLogBodySchema,
  agentMessageBodySchema,
} from './schemas'

const AGENT_SCOPES = [
  'briefing:read',
  'blocks:read',
  'blocks:write',
  'debriefs:read',
  'debriefs:write',
  'intel:read',
  'intel:write',
  'hermes:write',
  'export:read',
] as const
const DEFAULT_AGENT_SCOPES = AGENT_SCOPES.filter(
  (scope) => scope !== 'export:read',
)
const agentScopeSchema = z.enum(AGENT_SCOPES)
const agentCredentialBodySchema = z.strictObject({
  deviceLabel: requiredTrimmedText(1, 100),
  scopes: z.array(agentScopeSchema).min(1).max(AGENT_SCOPES.length)
    .refine((scopes) => new Set(scopes).size === scopes.length)
    .optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
})

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

type AgentCredentialRecord = {
  id: number
  user_id: number
  scopes: string
  expires_at: string
  revoked_at: string | null
  rate_window_started_at: string | null
  rate_window_count: number
}

const AGENT_RATE_LIMIT = 60
const AGENT_RATE_WINDOW_SECONDS = 60

function coarseNetwork(value: string | undefined): string | null {
  if (!value) return null
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number)
    return octets.every((octet) => octet >= 0 && octet <= 255)
      ? `${octets[0]}.${octets[1]}.${octets[2]}.0/24`
      : null
  }

  const halves = value.toLowerCase().split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if (halves.length === 1 && left.length !== 8) return null
  const missing = 8 - left.length - right.length
  if (missing < (halves.length === 2 ? 1 : 0)) return null
  const groups = [
    ...left,
    ...Array(missing).fill('0'),
    ...right,
  ]
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[a-f0-9]{1,4}$/.test(group))
  ) return null
  return `${groups.slice(0, 3).map((group) =>
    Number.parseInt(group, 16).toString(16)).join(':')}::/48`
}

function agentRequestMetadata(c: any): {
  method: string
  country: string | null
  network: string | null
} {
  const country = c.req.header('cf-ipcountry')?.trim().toUpperCase() || null
  return {
    method: c.req.method.toUpperCase(),
    country: country && /^[A-Z]{2}$/.test(country) ? country : null,
    network: coarseNetwork(c.req.header('cf-connecting-ip')),
  }
}

async function agentCredentialEvent(
  c: any,
  credentialId: number,
  userId: number,
  eventType: 'issued' | 'used' | 'revoked' | 'scope_denied' | 'rate_limited',
  route?: string,
): Promise<void> {
  const metadata = agentRequestMetadata(c)
  await c.env.DB.prepare(
    `INSERT INTO agent_credential_events
       (user_id, credential_id, event_type, request_method, request_route,
        request_country, request_network)
     VALUES (?,?,?,?,?,?,?)`,
  ).bind(
    userId,
    credentialId,
    eventType,
    route ? metadata.method : null,
    route ?? null,
    route ? metadata.country : null,
    route ? metadata.network : null,
  ).run()
}

async function consumeAgentRateLimit(
  c: any,
  credential: AgentCredentialRecord,
): Promise<boolean> {
  const consumed = await c.env.DB.prepare(
    `UPDATE agent_credentials
     SET rate_window_started_at=CASE
           WHEN rate_window_started_at IS NULL
             OR unixepoch(rate_window_started_at) <=
                unixepoch('now') - ?
           THEN datetime('now')
           ELSE rate_window_started_at
         END,
         rate_window_count=CASE
           WHEN rate_window_started_at IS NULL
             OR unixepoch(rate_window_started_at) <=
                unixepoch('now') - ?
           THEN 1
           ELSE rate_window_count + 1
         END
     WHERE id=? AND revoked_at IS NULL
       AND (
         rate_window_started_at IS NULL
         OR unixepoch(rate_window_started_at) <= unixepoch('now') - ?
         OR rate_window_count < ?
       )`,
  ).bind(
    AGENT_RATE_WINDOW_SECONDS,
    AGENT_RATE_WINDOW_SECONDS,
    credential.id,
    AGENT_RATE_WINDOW_SECONDS,
    AGENT_RATE_LIMIT,
  ).run()
  return Number((consumed.meta as any).changes) === 1
}

async function authenticateAgent(c: any): Promise<Response | null> {
  const raw = c.req.header('x-agent-token') || ''
  if (!raw || !raw.startsWith('wr_agent_v1_')) {
    return c.json({ error: 'INVALID AGENT CREDENTIAL' }, 401)
  }
  const tokenHash = await sha256(raw)
  const credential = await c.env.DB.prepare(
    `SELECT id, user_id, scopes, expires_at, revoked_at,
            rate_window_started_at, rate_window_count
     FROM agent_credentials
     WHERE token_hash=? AND revoked_at IS NULL
       AND unixepoch(expires_at) > unixepoch('now')`,
  ).bind(tokenHash).first() as AgentCredentialRecord | null
  if (!credential) return c.json({ error: 'INVALID AGENT CREDENTIAL' }, 401)
  const route = c.get('agentRoute')
  if (!(await consumeAgentRateLimit(c, credential))) {
    await agentCredentialEvent(
      c, credential.id, credential.user_id, 'rate_limited', route,
    )
    c.header('Retry-After', String(AGENT_RATE_WINDOW_SECONDS))
    return c.json({ error: 'AGENT RATE LIMIT EXCEEDED' }, 429)
  }
  let scopes: string[]
  try {
    scopes = JSON.parse(credential.scopes)
  } catch (_) {
    return c.json({ error: 'INVALID AGENT CREDENTIAL' }, 401)
  }
  c.set('userId', credential.user_id)
  c.set('agentCredentialId', credential.id)
  c.set('agentScopes', scopes)
  const metadata = agentRequestMetadata(c)
  await c.env.DB.prepare(
    `UPDATE agent_credentials
     SET last_used_at=datetime('now'), last_request_method=?,
         last_request_route=?, last_request_country=?, last_request_network=?
     WHERE id=? AND revoked_at IS NULL`,
  ).bind(
    metadata.method, route, metadata.country, metadata.network, credential.id,
  ).run()
  await agentCredentialEvent(c, credential.id, credential.user_id, 'used', route)
  return null
}

function agentRoute(
  method: string,
  path: string,
): { route: string; scope: typeof AGENT_SCOPES[number] } | null {
  const routes: Record<string, {
    route: string
    scope: typeof AGENT_SCOPES[number]
  }> = {
    'POST /api/agent/v1/briefing': {
      route: 'briefing:read', scope: 'briefing:read',
    },
    'POST /api/agent/v1/pending': {
      route: 'blocks:read', scope: 'blocks:read',
    },
    'POST /api/agent/v1/debriefs': {
      route: 'debriefs:read', scope: 'debriefs:read',
    },
    'POST /api/agent/v1/debrief': {
      route: 'debriefs:write', scope: 'debriefs:write',
    },
    'POST /api/agent/v1/intel/read': {
      route: 'intel:read', scope: 'intel:read',
    },
    'POST /api/agent/v1/intel': {
      route: 'intel:write', scope: 'intel:write',
    },
    'POST /api/agent/v1/block-log': {
      route: 'blocks:write', scope: 'blocks:write',
    },
    'POST /api/agent/v1/message': {
      route: 'hermes:message', scope: 'hermes:write',
    },
    'POST /api/agent/v1/export': {
      route: 'export:read', scope: 'export:read',
    },
  }
  return routes[`${method.toUpperCase()} ${path}`] ?? null
}

const AGENT_V1_PATHS = new Set([
  '/api/agent/v1/briefing',
  '/api/agent/v1/pending',
  '/api/agent/v1/debriefs',
  '/api/agent/v1/debrief',
  '/api/agent/v1/intel/read',
  '/api/agent/v1/intel',
  '/api/agent/v1/block-log',
  '/api/agent/v1/message',
  '/api/agent/v1/export',
])

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
app.use('/calendar.ics', async (c, next) => {
  if (!(await sessionValid(c))) return c.json({ error: 'AUTH REQUIRED' }, 401)
  return next()
})

app.get('/calendar.ics', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM schedule_blocks WHERE user_id=? ORDER BY start_time`,
  ).bind(c.get('userId')).all()
  const dayMap: Record<string, string> = { mon: 'MO', tue: 'TU', wed: 'WE', thu: 'TH', fri: 'FR', sat: 'SA', sun: 'SU' }
  let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WarRoom//LockIn//EN\r\nX-WR-CALNAME:War Room Schedule\r\n'
  for (const b of results as any[]) {
    const days = b.days.split(',').map((d: string) => dayMap[d.trim()]).filter(Boolean).join(',')
    const [sh, sm] = b.start_time.split(':'); const [eh, em] = b.end_time.split(':')
    ics += 'BEGIN:VEVENT\r\n'
    ics += `UID:warroom-block-${b.id}@lockin\r\n`
    ics += `DTSTART;TZID=Africa/Nairobi:20260101T${sh}${sm}00\r\n`
    ics += `DTEND;TZID=Africa/Nairobi:20260101T${eh}${em}00\r\n`
    ics += `RRULE:FREQ=WEEKLY;BYDAY=${days}\r\n`
    ics += `SUMMARY:${b.is_non_negotiable ? '🔒 ' : ''}${b.title.replace(/[,;]/g, ' ')}\r\n`
    ics += `DESCRIPTION:${(b.description || '').replace(/[,;\n]/g, ' ')}\r\n`
    ics += 'BEGIN:VALARM\r\nTRIGGER:-PT2M\r\nACTION:DISPLAY\r\nDESCRIPTION:War Room block starting\r\nEND:VALARM\r\n'
    ics += 'END:VEVENT\r\n'
  }
  ics += 'END:VCALENDAR\r\n'
  return new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="warroom.ics"' } })
})

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
