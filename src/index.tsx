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
const SESSION_DAYS = 30

// Crypto primitives extracted to ./crypto (Book 7).
function sessionCookie(c: any, token: string, maxAge = SESSION_DAYS * 24 * 3600): void {
  setCookie(c, 'wr_session', token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: true,
    path: '/',
    maxAge,
  })
}
async function findSession(c: any): Promise<SessionRecord | null> {
  const raw = getCookie(c, 'wr_session')
  if (!raw) return null
  const tokenHash = await sha256(raw)
  return (await c.env.DB.prepare(
    `SELECT id, user_id FROM sessions
     WHERE token_hash=? AND revoked_at IS NULL
       AND unixepoch(expires_at) > unixepoch('now')`,
  ).bind(tokenHash).first()) as SessionRecord | null
}
async function sessionValid(c: any): Promise<boolean> {
  const session = await findSession(c)
  if (!session) return false
  c.set('userId', session.user_id)
  return true
}
async function revokePresentedSession(c: any): Promise<void> {
  const raw = getCookie(c, 'wr_session')
  if (!raw) return
  await c.env.DB.prepare(
    `UPDATE sessions SET revoked_at=COALESCE(revoked_at, datetime('now')) WHERE token_hash=?`,
  ).bind(await sha256(raw)).run()
}
async function issueSession(c: any, userId: number, rotatedFromId?: number): Promise<string> {
  const token = randHex(32)
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toISOString()
  await c.env.DB.prepare(
    `INSERT INTO sessions (user_id, token_hash, expires_at, rotated_from_id)
     VALUES (?,?,?,?)`,
  ).bind(userId, await sha256(token), expiresAt, rotatedFromId ?? null).run()
  sessionCookie(c, token)
  return csrfToken(token)
}
async function ownerUser(DB: D1Database): Promise<{ id: number; password_hash: string; password_salt: string; failed_login_count: number; locked_until: string | null } | null> {
  return DB.prepare(
    `SELECT id, password_hash, password_salt, failed_login_count, locked_until
     FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
  ).first()
}

async function claimUnownedData(DB: D1Database, userId: number): Promise<void> {
  const tables = [
    'schedule_blocks', 'block_logs', 'debriefs', 'unit_progress', 'maxims',
    'flashcards', 'card_reviews', 'honesty_flags', 'points_ledger',
    'reward_redemptions', 'law_checks', 'settings', 'intel_entries',
    'book_progress', 'hermes_messages', 'responses', 'response_srs',
    'tongue_reviews', 'tongue_exams', 'day_summary', 'predictions',
    'appeals', 'load_reductions',
  ]
  await DB.batch(tables.map((table) =>
    DB.prepare(`UPDATE ${table} SET user_id=? WHERE user_id IS NULL`).bind(userId),
  ))
}

// -- auth endpoints (the ONLY unauthenticated API surface) --
app.get('/api/auth/status', async (c) => {
  const hasOwner = !!(await ownerUser(c.env.DB))
  const authed = hasOwner ? await sessionValid(c) : false
  const rawSession = authed ? getCookie(c, 'wr_session') : undefined
  return c.json({
    setup: hasOwner,
    authed,
    csrfToken: rawSession ? await csrfToken(rawSession) : undefined,
  })
})
app.post('/api/auth/setup', async (c) => {
  const DB = c.env.DB
  if (await ownerUser(DB)) return c.json({ error: 'Already set up. Log in.' }, 400)
  const { password } = await parseJson(c, passwordBodySchema)
  if (!password || password.length < 8) return c.json({ error: 'Password must be at least 8 characters. This gate protects everything.' }, 400)
  const salt = randHex(16)
  const hash = await pbkdf2(password, salt)
  const created = await DB.prepare(
    `INSERT INTO users (password_hash, password_salt, role) VALUES (?,?,'owner')`,
  ).bind(hash, salt).run()
  const userId = Number(created.meta.last_row_id)
  await claimUnownedData(DB, userId)
  const csrfToken = await issueSession(c, userId)
  return c.json({ ok: true, csrfToken })
})
app.post('/api/auth/login', async (c) => {
  const DB = c.env.DB
  const owner = await ownerUser(DB)
  if (!owner) return c.json({ error: 'Not set up yet.', setup: false }, 400)
  if (owner.locked_until && new Date(owner.locked_until).getTime() > Date.now()) {
    return c.json({ error: 'GATE SEALED. Too many failed attempts — wait 15 minutes. Patience is also discipline.' }, 429)
  }
  const { password } = await parseJson(c, passwordBodySchema)
  const attempt = await pbkdf2(password || '', owner.password_salt)
  if (!timingSafeEq(attempt, owner.password_hash)) {
    const failures = owner.failed_login_count + 1
    await DB.prepare(
      `UPDATE users SET failed_login_count=?, locked_until=CASE WHEN ?>=5 THEN datetime('now','+15 minutes') ELSE NULL END, updated_at=datetime('now') WHERE id=?`,
    ).bind(failures, failures, owner.id).run()
    return c.json({ error: 'Wrong password.' }, 401)
  }

  const presented = await findSession(c)
  await claimUnownedData(DB, owner.id)
  await DB.prepare(
    `UPDATE sessions SET revoked_at=COALESCE(revoked_at, datetime('now')) WHERE user_id=? AND revoked_at IS NULL`,
  ).bind(owner.id).run()
  await DB.prepare(
    `UPDATE users SET failed_login_count=0, locked_until=NULL, updated_at=datetime('now') WHERE id=?`,
  ).bind(owner.id).run()
  const csrfToken = await issueSession(c, owner.id, presented?.id)
  return c.json({ ok: true, csrfToken })
})
app.post('/api/auth/logout', async (c) => {
  await parseEmptyBody(c)
  await revokePresentedSession(c)
  deleteCookie(c, 'wr_session', { path: '/' })
  return c.json({ ok: true })
})

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

// ============ STATE (read-only heartbeat) + TICK (the engine crank) ============
// GET /api/state no longer mutates anything — engines run ONLY via POST /api/tick,
// with the SERVER's clock. A client can no longer time-travel penalties into existence.
// buildState extracted to ./state (Book 7).


// READ — no side effects, ever. Server clock, client clock ignored.
app.get('/api/state', async (c) => {
  const userId = c.get('userId')
  const { date, time } = await userNow(c.env.DB, userId)
  return c.json(await buildState(c.env.DB, userId, date, time))
})

// VERSION — the cheap "has anything changed?" probe that replaces polling.
// Book 6: the client refreshes on focus, after an action, and near a block
// boundary. When it does need to check, this costs a few indexed MAX() reads
// instead of a full /api/state build, and answers 304 when nothing moved.
app.get('/api/version', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { date, time } = await userNow(DB, userId)
  // Highest rowid + newest key per consequence-bearing table. Any write the UI
  // cares about moves at least one of these. day_summary is keyed by date, not
  // by an autoincrement id, so its marker is the newest summary_date plus a
  // row count (a re-finalised day updates in place without adding a row).
  const marks = await DB.batch([
    DB.prepare(
      `SELECT COALESCE(MAX(id),0) AS m FROM block_logs WHERE user_id=?`,
    ).bind(userId),
    DB.prepare(
      `SELECT COALESCE(MAX(id),0) AS m FROM points_ledger WHERE user_id=?`,
    ).bind(userId),
    DB.prepare(
      `SELECT COALESCE(MAX(id),0) AS m FROM honesty_flags WHERE user_id=?`,
    ).bind(userId),
    DB.prepare(
      `SELECT COALESCE(MAX(summary_date),'-') || ':' || COUNT(*) AS m
       FROM day_summary WHERE user_id=?`,
    ).bind(userId),
  ])
  const stamp = (marks as any[])
    .map((r) => String(r.results?.[0]?.m ?? 0))
    .join('.')
  // The civil date and the current minute are part of the version so a block
  // boundary or midnight rollover invalidates it even with no new writes.
  const version = `${date}T${time}-${stamp}`
  const etag = `W/"${version}"`

  if (c.req.header('if-none-match') === etag) {
    c.header('ETag', etag)
    return c.body(null, 304)
  }
  c.header('ETag', etag)
  return c.json({ version, date, time })
})

// CRANK — the ONLY place engines run. Server-derived date/time; future dates impossible.
app.post('/api/tick', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const body = await parseJson(c, tickBodySchema)
  // capture the commander's timezone once (first tick from the UI sends it)
  if (body.tz && !(await getSetting(DB, 'timezone_locked', userId))) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: body.tz })
      await setSetting(DB, 'timezone', body.tz, userId)
      await setSetting(DB, 'timezone_locked', '1', userId)
    } catch (_) {
      throw new RequestValidationError()
    }
  }
  const { date, time } = await runEnforcement(c.env.DB, userId)
  return c.json(await buildState(DB, userId, date, time))
})

// runEnforcement extracted to ./enforcement (Book 7).

// Cloudflare Pages has no native scheduled handler. A separately configured Cron
// Worker calls this POST with the shared secret; no client-supplied clock is read.
app.post('/internal/jobs/enforcement', async (c) => {
  const expected = c.env.ENFORCEMENT_JOB_SECRET
  const authorization = c.req.header('authorization') || ''
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!expected || !supplied || !timingSafeEq(supplied, expected)) {
    return c.json({ error: 'INVALID INTERNAL CREDENTIAL' }, 401)
  }
  await parseEmptyBody(c)

  const owners = (await c.env.DB.prepare(`SELECT id FROM users WHERE role='owner' ORDER BY id`).all()).results as Array<{ id: number }>
  const runs = []
  for (const owner of owners) runs.push(await runEnforcement(c.env.DB, owner.id))
  return c.json({ ok: true, runs })
})

// ============ RECOVERY & RE-ENTRY (Book 8.2 / 8.6) ============

// The 8.4 miss-diagnosis taxonomy, reused as the /catchup mechanism vocabulary.
const MISS_TAXONOMY = [
  'unrealistic duration', 'overpacked schedule', 'low energy', 'interruption',
  'unclear next action', 'avoidance', 'insufficient preparation', 'wrong priority',
  'forgotten log', 'emergency', 'technology failure',
] as const

// Consecutive days ending yesterday with no logged activity (a block
// done/partial, or a debrief). Bounded walk; the server owns the clock.
async function computeDaysAbsent(DB: D1Database, userId: number, today: string): Promise<number> {
  let absent = 0
  for (let i = 1; i <= 60; i++) {
    const d = addDays(today, -i)
    const act = await DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM block_logs WHERE user_id=? AND log_date=? AND status IN ('done','partial')) AS blocks,
         (SELECT COUNT(*) FROM debriefs WHERE user_id=? AND log_date=?) AS debriefs`,
    ).bind(userId, d, userId, d).first<{ blocks: number; debriefs: number }>()
    if ((act?.blocks ?? 0) > 0 || (act?.debriefs ?? 0) > 0) break
    absent++
  }
  return absent
}

// A likely cause from the taxonomy — named as a structural hypothesis, never a
// character verdict (Book R2 register). For this operator a multi-day stop is
// the documented overpacking failure (R14), not a moral one.
async function inferMechanism(
  DB: D1Database, userId: number, today: string, daysAbsent: number,
): Promise<typeof MISS_TAXONOMY[number]> {
  if (daysAbsent >= 3) return 'overpacked schedule'
  const y = addDays(today, -1)
  const blocks = await blocksForDate(DB, userId, y)
  if (blocks.length >= 6) return 'overpacked schedule'
  const coreMissed = blocks.some((b: any) =>
    (b.is_non_negotiable || (b.weight ?? 1) >= 3) &&
    b.log_status !== 'done' && b.log_status !== 'partial')
  if (coreMissed) return 'unclear next action'
  return 'low energy'
}

// What was actually missed, reported as fact and never rewritten. One entry per
// recent absent day, capped so the briefing stays short.
async function buildMissed(
  DB: D1Database, userId: number, today: string, daysAbsent: number,
): Promise<Array<{ date: string; unlogged_blocks: number; debrief_missed: boolean }>> {
  const out: Array<{ date: string; unlogged_blocks: number; debrief_missed: boolean }> = []
  const span = Math.min(Math.max(daysAbsent, 1), 7)
  for (let i = 1; i <= span; i++) {
    const d = addDays(today, -i)
    const blocks = await blocksForDate(DB, userId, d)
    const scored = blocks.filter((b: any) => (b.weight ?? 1) > 0)
    const unlogged = scored.filter((b: any) =>
      b.log_status !== 'done' && b.log_status !== 'partial').length
    const deb = await DB.prepare(
      `SELECT 1 AS d FROM debriefs WHERE user_id=? AND log_date=?`,
    ).bind(userId, d).first<{ d: number }>()
    out.push({ date: d, unlogged_blocks: unlogged, debrief_missed: !deb })
  }
  return out
}

// The single protected keystone for tomorrow, drawn from the operator's own
// CORE anchors so it is real, not invented.
async function buildKeystone(DB: D1Database, userId: number, today: string) {
  const t = addDays(today, 1)
  const blocks = await blocksForDate(DB, userId, t)
  const core = blocks
    .filter((b: any) => b.is_mvd || b.is_non_negotiable || (b.weight ?? 1) >= 3)
    .sort((a: any, b: any) => String(a.start_time).localeCompare(String(b.start_time)))
  const anchor = core[0] || blocks[0]
  return {
    action: anchor ? String(anchor.title) : 'One deep block',
    start_time: anchor && /^\d{2}:\d{2}$/.test(String(anchor.start_time)) ? String(anchor.start_time) : '06:00',
    environment: 'The room where you do focused work. Phone in another room.',
    first_physical_action: 'Sit down and open the material. Nothing more is required to begin.',
  }
}

// POST /api/recovery — log the single restoring action for a breach day; the
// day then survives the streak (Book 8.2). One per day, idempotent.
app.post('/api/recovery', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const body = await parseJson(c, recoveryBodySchema)
  const date = await safeDate(DB, body.date, userId)
  const claim = await DB.prepare(
    `INSERT OR IGNORE INTO recovery_actions (user_id, action_date, action_text)
     VALUES (?,?,?)`,
  ).bind(userId, date, body.action.trim()).run()
  // Re-materialise the day so mvr_held reflects the action (survival, not victory).
  await writeDaySummary(DB, userId, date, false)
  const streak = await computeStreak(DB, userId, (await userNow(DB, userId)).date)
  const rid = requestId(c)
  if (rid && (claim.meta as any).changes > 0) {
    await auditEvent(DB, {
      userId, actorType: 'user', requestId: rid,
      action: 'recovery.log', entityType: 'recovery_action', entityId: date,
      metadata: { date },
    })
  }
  return c.json({ ok: true, date, streak, already: (claim.meta as any).changes === 0 })
})

// POST /api/catchup — the re-entry protocol (Book 8.6), in fixed output order.
// Deterministic and offline-safe: it reads the record, it does not call a model.
app.post('/api/catchup', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const body = await parseJson(c, catchupBodySchema)
  const { date } = await userNow(DB, userId)
  const daysAbsent = body.days_absent_override ?? await computeDaysAbsent(DB, userId, date)
  const trigger: 'manual' | 'auto_zero_streak' = daysAbsent >= 3 ? 'auto_zero_streak' : 'manual'

  const missed = await buildMissed(DB, userId, date, daysAbsent)
  const mechanism = await inferMechanism(DB, userId, date, daysAbsent)
  const keystone = await buildKeystone(DB, userId, date)

  // What NOT to do — the recovery path never generates these (Book 8.6).
  const do_not = [
    'Do not reschedule the days you missed. Backlog is forgiven, not carried.',
    'Do not add extra load to compensate. There is no make-up debt.',
    'Do not write a self-critical entry. Record what happened, not a verdict on yourself.',
  ]

  const minimum_viable_recovery =
    'One action, right now, small enough to finish in ten minutes and close enough to a CORE anchor to count. Do it, then log it — that single act makes today a non-broken day.'

  // One structural change, matched to the mechanism (time/environment/cue/scope/support).
  const patchByMechanism: Record<string, { dimension: string; suggestion: string }> = {
    'overpacked schedule': { dimension: 'scope', suggestion: 'Cut the mandatory set to a single keystone until you hold it cleanly for seven days. The deck waits.' },
    'unclear next action': { dimension: 'cue', suggestion: 'Define the first physical action for the keystone the night before, written down, so starting needs no decision.' },
    'low energy': { dimension: 'time', suggestion: 'Move the keystone to your highest-energy hour and protect the hour before it.' },
  }
  const structural_patch = patchByMechanism[mechanism] ||
    { dimension: 'environment', suggestion: 'Remove the one friction that most reliably stops you starting.' }

  // Absence over fourteen days re-opens the five-question diagnostic and
  // re-seats the ratchet at whatever level it supports (Book 8.6).
  let diagnostic: string[] | null = null
  let reseat_level: number | null = null
  if (daysAbsent > 14) {
    diagnostic = [
      'Separate one fact from one interpretation in a recent situation.',
      'Map a choice you face by timing, terrain, options, and downside.',
      'Improve a flat sentence without overstating it.',
      'Write a calm, concise refusal to a request you should decline.',
      "Retrieve yesterday's concept from memory, without notes.",
    ]
    reseat_level = 1 // re-seat at the base ratchet: three anchors only
  }

  const protocol = {
    days_absent: daysAbsent,
    trigger,
    missed,
    mechanism,
    do_not,
    minimum_viable_recovery,
    structural_patch,
    keystone,
    diagnostic,
    reseat_level,
  }

  await DB.prepare(
    `INSERT INTO catchup_sessions
       (user_id, trigger_type, days_absent, missed_json, mechanism, mvr_prompt,
        structural_patch, keystone_json, diagnostic_json, reseat_level)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    userId, trigger, daysAbsent, JSON.stringify(missed), mechanism,
    minimum_viable_recovery, JSON.stringify(structural_patch),
    JSON.stringify(keystone), diagnostic ? JSON.stringify(diagnostic) : null,
    reseat_level,
  ).run()

  const rid = requestId(c)
  if (rid) {
    await auditEvent(DB, {
      userId, actorType: 'user', requestId: rid,
      action: 'catchup.run', entityType: 'catchup_session', entityId: date,
      metadata: { days_absent: daysAbsent, trigger, mechanism },
    })
  }
  return c.json(protocol)
})

// ============ BOOK 16 / R9 — THE CHAPTER CURSOR ============

const cursorBodySchema = z.strictObject({
  book: z.string().trim().min(1).max(200).optional(),
  part: z.string().trim().min(1).max(200).optional(),
  chapter: z.number().int().min(1).max(999).optional(),
  figure: z.string().trim().min(1).max(200).optional(),
  cycle_day: z.number().int().min(1).max(7).optional(),
})

// ChapterCursor/DEFAULT_CURSOR/readChapterCursor extracted to ./cursor (Book 7).

app.get('/api/cursor', async (c) => {
  const cur = await readChapterCursor(c.env.DB, c.get('userId'))
  return c.json(cur)
})

app.post('/api/cursor', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const b = await parseJson(c, cursorBodySchema)
  const cur = await readChapterCursor(DB, userId)   // read-only; default if unset
  const next: ChapterCursor = {
    book: b.book ?? cur.book,
    part: b.part ?? cur.part,
    chapter: b.chapter ?? cur.chapter,
    figure: b.figure ?? cur.figure,
    cycle_day: b.cycle_day ?? cur.cycle_day,
  }
  // Single upsert — the only place the cursor is persisted (a write route).
  await DB.prepare(
    `INSERT INTO chapter_cursor (user_id, book, part, chapter, figure, cycle_day, updated_at)
     VALUES (?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       book=excluded.book, part=excluded.part, chapter=excluded.chapter,
       figure=excluded.figure, cycle_day=excluded.cycle_day, updated_at=datetime('now')`,
  ).bind(userId, next.book, next.part, next.chapter, next.figure, next.cycle_day).run()
  const rid = requestId(c)
  if (rid) {
    await auditEvent(DB, {
      userId, actorType: 'user', requestId: rid,
      action: 'cursor.set', entityType: 'chapter_cursor', entityId: userId,
      before: cur, after: next,
    })
  }
  return c.json(next)
})

// ============ BOOK 14 — THE CONTINUITY BRIEF ============

// Plain-text session-continuity brief in the format the operator already keeps
// by hand. Second output mode of the Commander's File serialiser: it survives
// conversation compaction in any external tool. Read-only.
// continuityBrief extracted to ./commanders-file (Book 7).

app.get('/api/continuity-brief', async (c) => {
  const { date } = await userNow(c.env.DB, c.get('userId'))
  const text = await continuityBrief(c.env.DB, c.get('userId'), date)
  return c.body(text, 200, { 'Content-Type': 'text/plain; charset=utf-8' })
})


// ============ BLOCK LOGGING ============
// Date is SERVER-derived. You log the block you are living, not the day you wish.
app.post('/api/blocks/:id/log', async (c) => withIdempotency(c, 'block:log', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  const { status, note } = await parseJson(c, blockLogBodySchema)
  const { date } = await userNow(DB, userId)
  const block = await DB.prepare(
    `SELECT * FROM schedule_blocks WHERE id=? AND user_id=?`,
  ).bind(id, userId).first<any>()
  if (!block) return c.json({ error: 'no such block' }, 404)

  const prev = await DB.prepare(
    `SELECT * FROM block_logs WHERE block_id=? AND log_date=? AND user_id=?`,
  ).bind(id, date, userId).first<any>()
  // THE WINDOW RULE: a block auto-canceled by the enforcement engine is CLOSED.
  // The only exit is the weekly appeal token (which costs a permanent written reason).
  if (prev && prev.status === 'missed') {
    return c.json({ error: 'WINDOW CLOSED. "' + block.title + '" was auto-canceled unlogged — it cannot be reopened. The penalty stands. One appeal token per week exists, if you can face writing the reason.' }, 409)
  }

  // atomic: log + points transition in one batch
  const stmts: D1PreparedStatement[] = [
    DB.prepare(
      `INSERT INTO block_logs (user_id, block_id, log_date, status, note, completed_at)
       VALUES (?,?,?,?,?,datetime('now'))
       ON CONFLICT(block_id, log_date) DO UPDATE SET
         status=excluded.status, note=excluded.note, completed_at=excluded.completed_at
       WHERE block_logs.user_id=excluded.user_id`
    ).bind(userId, id, date, status, note || null)
  ]
  const prevEarned = prev && (prev.status === 'done' || prev.status === 'partial')
  const nowEarns = status === 'done' || status === 'partial'
  if (nowEarns && !prevEarned) {
    const p = status === 'done' ? block.points : Math.ceil(block.points / 2)
    stmts.push(DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type, ref_id)
       VALUES (?,?,?,?,?,?)`,
    ).bind(userId, date, p, `${status === 'done' ? 'Completed' : 'Partial'}: ${block.title} (+${p})`, 'block', id))
  } else if (!nowEarns && prevEarned) {
    const p = prev.status === 'done' ? block.points : Math.ceil(block.points / 2)
    stmts.push(DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type, ref_id)
       VALUES (?,?,?,?,?,?)`,
    ).bind(userId, date, -p, `Reverted: ${block.title} (-${p})`, 'block', id))
  }
  await DB.batch(stmts)
  await writeDaySummary(DB, userId, date, false)
  return c.json({ ok: true, date })
}))

// ============ APPEALS — one token per week, permanent reason ============
app.post('/api/appeals', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { block_id, block_date, reason } = await parseJson(c, appealBodySchema)
  const { date } = await userNow(DB, userId)
  if (!reason || String(reason).trim().length < 100) {
    return c.json({ error: 'THE REASON IS THE PRICE. Write at least 100 characters explaining exactly what happened — this goes on the permanent record.' }, 400)
  }
  if (!block_id || !block_date) return c.json({ error: 'block_id and block_date required' }, 400)
  if (block_date > date) return c.json({ error: 'Cannot appeal the future.' }, 400)
  if (block_date < addDays(date, -7)) return c.json({ error: 'Too late. Appeals reach back 7 days at most — old wounds stay closed.' }, 400)
  const log = await DB.prepare(
    `SELECT l.* FROM block_logs l JOIN schedule_blocks b ON b.id=l.block_id
     WHERE l.user_id=? AND b.user_id=? AND l.block_id=? AND l.log_date=?`,
  ).bind(userId, userId, block_id, block_date).first<any>()
  if (!log || log.status !== 'missed') return c.json({ error: 'That block was not auto-canceled. Appeals only reopen closed windows.' }, 400)
  const week = isoWeekKey(date)
  const used = await DB.prepare(
    `SELECT id FROM appeals WHERE user_id=? AND week_key=?`,
  ).bind(userId, week).first()
  if (used) return c.json({ error: 'APPEAL TOKEN SPENT. One per week — the next one arrives Monday.' }, 409)
  const ins = await DB.prepare(
    `INSERT OR IGNORE INTO appeals
       (user_id, appeal_date, block_id, block_date, reason, week_key)
     VALUES (?,?,?,?,?,?)`
  ).bind(userId, date, block_id, block_date, String(reason).trim(), week).run()
  if ((ins.meta as any).changes === 0) {
    return c.json({ error: 'APPEAL TOKEN SPENT. One per week — the next one arrives Monday.' }, 409)
  }
  // reopen the window: missed → pending, ack the flag, refund the penalty
  const pen = await DB.prepare(
    `SELECT COALESCE(SUM(points),0) p FROM points_ledger
     WHERE user_id=? AND log_date=? AND ref_type='flag' AND ref_id=? AND points<0`
  ).bind(userId, block_date, block_id).first<any>()
  const stmts: D1PreparedStatement[] = [
    DB.prepare(
      `UPDATE block_logs SET status='pending', note='REOPENED BY APPEAL ('||?||')'
       WHERE user_id=? AND block_id=? AND log_date=?`,
    ).bind(date, userId, block_id, block_date),
    DB.prepare(
      `UPDATE honesty_flags SET acknowledged=1
       WHERE user_id=? AND flag_date=? AND flag_type='missed_live'
         AND ref_type='block' AND ref_id=?`,
    ).bind(userId, block_date, block_id),
  ]
  if ((pen?.p ?? 0) < 0) {
    stmts.push(DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type, ref_id)
       VALUES (?,?,?,?,?,?)`,
    ).bind(userId, date, -pen.p, `APPEAL GRANTED: penalty refunded for reopened window (block #${block_id}, ${block_date}). The reason is on the permanent record.`, 'appeal', block_id))
  }
  await DB.batch(stmts)
  await writeDaySummary(DB, userId, block_date, false)
  return c.json({ ok: true, refunded: -(pen?.p ?? 0) })
})
app.get('/api/appeals', async (c) => {
  const userId = c.get('userId')
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, b.title FROM appeals a
     JOIN schedule_blocks b ON b.id=a.block_id AND b.user_id=a.user_id
     WHERE a.user_id=? ORDER BY a.created_at DESC LIMIT 50`
  ).bind(userId).all()
  return c.json(results)
})

// ============ LOAD REDUCTION — answer the why ============
app.post('/api/load-reductions/:id/answer', async (c) => {
  const userId = c.get('userId')
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  const { reason } = await parseJson(c, loadReductionBodySchema)
  const updated = await c.env.DB.prepare(
    `UPDATE load_reductions SET reason=?, answered_at=datetime('now') WHERE id=? AND user_id=?`,
  ).bind(reason, id, userId).run()
  if ((updated.meta as any).changes === 0) return c.json({ error: 'not found' }, 404)
  const advice: Record<string, string> = {
    wrong_time: 'Then MOVE it. Edit the block to the hour your energy actually supports it.',
    too_long: 'Then SHRINK it permanently. A 25-minute block done daily beats a 90-minute block done never.',
    wrong_prereq: 'Then fix the pipeline. What has to exist before this block can succeed? Schedule THAT.',
    dont_want_it: 'Then that is the real finding. Either recommit for a reason you actually believe, or delete it with honor. Zombie blocks corrupt the whole ledger.'
  }
  return c.json({ ok: true, advice: advice[reason] })
})

// ============ PREDICTION LOG — the calibration instrument ============
app.post('/api/predictions', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { claim, confidence, resolve_by, domain } =
    await parseJson(c, predictionBodySchema)
  const { date } = await userNow(DB, userId)
  if (resolve_by <= date) return c.json({ error: 'Resolution date must be in the future.' }, 400)
  const r = await DB.prepare(
    `INSERT INTO predictions (user_id, made_date, claim, confidence, resolve_by, domain)
     VALUES (?,?,?,?,?,?)`
  ).bind(userId, date, claim, confidence, resolve_by, domain || null).run()
  return c.json({ ok: true, id: r.meta.last_row_id })
})
app.get('/api/predictions', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM predictions WHERE user_id=?
     ORDER BY (outcome='unresolved') DESC, resolve_by ASC, id DESC LIMIT 200`,
  ).bind(c.get('userId')).all()
  return c.json(results)
})
app.post('/api/predictions/:id/resolve', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  const { outcome, note } = await parseJson(c, predictionResolutionBodySchema)
  const { date } = await userNow(DB, userId)
  const p = await DB.prepare(`SELECT * FROM predictions WHERE id=? AND user_id=?`)
    .bind(id, userId).first<any>()
  if (!p) return c.json({ error: 'not found' }, 404)
  if (p.outcome !== 'unresolved') return c.json({ error: 'Already resolved. The record does not get rewritten.' }, 409)
  await DB.prepare(`UPDATE predictions SET outcome=?, resolved_date=?, resolution_note=? WHERE id=? AND user_id=?`)
    .bind(outcome, date, note || null, p.id, userId).run()
  return c.json({ ok: true })
})
// Calibration report: Brier score, bucketed curve, plain-language bias
app.get('/api/predictions/calibration', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT confidence, outcome FROM predictions
     WHERE user_id=? AND outcome IN ('right','wrong')`
  ).bind(c.get('userId')).all()
  const rows = results as any[]
  if (!rows.length) return c.json({ n: 0, brier: null, buckets: [], verdict: 'No resolved predictions yet. Make claims. Date them. Grade them.' })
  let brier = 0
  const buckets: Record<string, { n: number; hits: number; confSum: number }> = {}
  for (const r of rows) {
    const p = r.confidence / 100, hit = r.outcome === 'right' ? 1 : 0
    brier += (p - hit) ** 2
    const bk = r.confidence < 60 ? '50-59' : r.confidence < 70 ? '60-69' : r.confidence < 80 ? '70-79' : r.confidence < 90 ? '80-89' : '90-99'
    ;(buckets[bk] ||= { n: 0, hits: 0, confSum: 0 })
    buckets[bk].n++; buckets[bk].hits += hit; buckets[bk].confSum += r.confidence
  }
  brier = brier / rows.length
  const curve = Object.entries(buckets).sort().map(([range, b]) => ({
    range, n: b.n, avgConfidence: Math.round(b.confSum / b.n), hitRate: Math.round((b.hits / b.n) * 100)
  }))
  // plain-language bias statement
  const gaps = curve.filter(b => b.n >= 3).map(b => b.avgConfidence - b.hitRate)
  const avgGap = gaps.length ? Math.round(gaps.reduce((a, g) => a + g, 0) / gaps.length) : 0
  let verdict: string
  if (!gaps.length) verdict = `Only ${rows.length} graded predictions — grade at least 3 per bucket before trusting the curve.`
  else if (avgGap >= 15) verdict = `OVERCONFIDENT by ~${avgGap} points: when you say ${curve[curve.length - 1].avgConfidence}%, reality delivers ${curve[curve.length - 1].hitRate}%. Your certainty is louder than your accuracy — shave ${avgGap} points off every gut number before acting on it.`
  else if (avgGap >= 7) verdict = `Mildly overconfident (~${avgGap} pts). Decent, but when the stakes are high, treat your "sure" as "probably".`
  else if (avgGap <= -10) verdict = `UNDERCONFIDENT by ~${-avgGap} points: you know more than you let yourself act on. Your hesitation is costing you moves you would have won.`
  else verdict = `WELL CALIBRATED (gap ~${avgGap} pts, Brier ${brier.toFixed(3)}). Your stated confidence is close to reality — rare. Keep grading.`
  return c.json({ n: rows.length, brier: Number(brier.toFixed(4)), buckets: curve, verdict })
})

// ============ DEBRIEF ============
app.post('/api/debrief', async (c) => withIdempotency(c, 'debrief:file', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const b = await parseJson(c, debriefBodySchema)
  const date = await safeDate(DB, b.date, userId) // clamp: no future debriefs
  const existing = await DB.prepare(
    `SELECT id FROM debriefs WHERE user_id=? AND log_date=?`,
  ).bind(userId, date).first<{ id: number }>()
  const values = [
    b.wins || null,
    b.breaks || null,
    b.tomorrow_targets || null,
    b.strategy_insight || null,
    b.mood || null,
    b.energy || null,
    b.sleep_time || null,
    b.wake_time || null,
    b.sleep_hours || null,
  ]
  if (existing) {
    await DB.prepare(
      `UPDATE debriefs SET wins=?, breaks=?, tomorrow_targets=?, strategy_insight=?,
       mood=?, energy=?, sleep_time=?, wake_time=?, sleep_hours=?
       WHERE id=? AND user_id=?`,
    ).bind(...values, existing.id, userId).run()
  } else {
    await DB.prepare(
      `INSERT INTO debriefs
         (user_id, log_date, wins, breaks, tomorrow_targets, strategy_insight,
          mood, energy, sleep_time, wake_time, sleep_hours)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(userId, date, ...values).run()
    await DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type)
       VALUES (?,?,?,?,?)`,
    ).bind(userId, date, 25, 'Night debrief filed. Intelligence report received. (+25)', 'debrief').run()
  }
  await writeDaySummary(DB, userId, date, false)
  return c.json({ ok: true })
}))

app.get('/api/debriefs', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM debriefs WHERE user_id=? ORDER BY log_date DESC LIMIT 60`,
  ).bind(c.get('userId')).all()
  return c.json(results)
})

// Learning routes (campaign, maxims, cards, flags) registered from ./routes/learn (Book 7).
registerLearnRoutes(app)



// THE TONGUE routes registered from ./routes/tongue (Book 7).
registerTongueRoutes(app)

// ============ LAWS ============
app.get('/api/laws', async (c) => {
  const userId = c.get('userId')
  const date = await safeDate(c.env.DB, c.req.query('date'), userId)
  const { results } = await c.env.DB.prepare(
    `SELECT l.*, lc.kept, lc.note FROM laws l
     LEFT JOIN law_checks lc ON lc.law_id=l.id AND lc.log_date=? AND lc.user_id=?
     ORDER BY l.sort_order`
  ).bind(date, userId).all()
  return c.json(results)
})
app.post('/api/laws/:id/check', async (c) => withIdempotency(c, 'law:check', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const lawId = parseValue(positiveIdSchema, c.req.param('id'))
  const { date, kept, note } = await parseJson(c, lawCheckBodySchema)
  const existing = await DB.prepare(
    `SELECT id FROM law_checks WHERE user_id=? AND law_id=? AND log_date=?`,
  ).bind(userId, lawId, date).first<{ id: number }>()
  if (existing) {
    await DB.prepare(
      `UPDATE law_checks SET kept=?, note=? WHERE id=? AND user_id=?`,
    ).bind(kept ? 1 : 0, note || null, existing.id, userId).run()
  } else {
    await DB.prepare(
      `INSERT INTO law_checks (user_id, law_id, log_date, kept, note) VALUES (?,?,?,?,?)`,
    ).bind(userId, lawId, date, kept ? 1 : 0, note || null).run()
  }
  return c.json({ ok: true })
}))

// ============ REWARDS ============
app.get('/api/rewards', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM rewards ORDER BY cost`).all()
  return c.json(results)
})
app.post('/api/rewards/:id/redeem', async (c) => withIdempotency(c, 'reward:redeem', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  await parseEmptyBody(c)
  const { date } = await userNow(DB, userId) // server clock
  const reward = await DB.prepare(`SELECT * FROM rewards WHERE id=?`).bind(id).first<any>()
  if (!reward) return c.json({ error: 'no reward' }, 404)
  // RACE-SAFE: the debit INSERT itself re-checks this owner's balance atomically.
  const debit = await DB.prepare(
    `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type, ref_id)
     SELECT ?, ?, ?, ?, 'reward', ?
     WHERE (SELECT COALESCE(SUM(points),0) FROM points_ledger WHERE user_id=?) >= ?`
  ).bind(userId, date, -reward.cost, `REWARD REDEEMED: ${reward.title} (-${reward.cost})`, id, userId, reward.cost).run()
  if ((debit.meta as any).changes === 0) {
    const pts = await DB.prepare(
      `SELECT COALESCE(SUM(points),0) as total FROM points_ledger WHERE user_id=?`,
    ).bind(userId).first<{ total: number }>()
    return c.json({ error: `NOT EARNED YET. You have ${pts?.total ?? 0} pts, this costs ${reward.cost}. Rewards are taken, not given. Back to work.` }, 400)
  }
  await DB.batch([
    DB.prepare(`UPDATE rewards SET redeemed_count=redeemed_count+1 WHERE id=?`).bind(id),
    DB.prepare(
      `INSERT INTO reward_redemptions (user_id, reward_id) VALUES (?,?)`,
    ).bind(userId, id),
  ])
  const rid = requestId(c)
  if (rid) {
    await auditEvent(DB, {
      userId, actorType: 'user', requestId: rid,
      action: 'reward.redeem', entityType: 'reward', entityId: id,
      after: { cost: reward.cost, log_date: date },
    })
  }
  return c.json({ ok: true })
}))

// ============ STATS ============
// ============ SCORING CHANGELOG (Book 4) ============
// "Every behavioural change to scoring ships with a one-line entry in a
// changelog visible inside the application — the operator must be able to see
// when the rules of his own game changed." Static, honest, newest first.
const SCORING_CHANGELOG: Array<{ date: string; change: string }> = [
  { date: '2026-08-20', change: 'Minimum Viable Recovery: on a declared breach day, one logged restoring action makes the day survive the streak — survival, never a victory.' },
  { date: '2026-08-20', change: 'Alternative-explanation brake: a capture logged with non-calm heat now requires a written alternative explanation; a rising "none plausible" count is surfaced as the paranoia tell.' },
  { date: '2026-08-20', change: 'Duplicate delivery of the same request (retries, double-taps) can no longer create a second consequence; enforcement run twice awards once.' },
  { date: '2026-08-12', change: 'Reforge wave 1: weighted adherence (CORE 3 / STANDARD 1 / CONTEXT 0), the Minimum Viable Day HELD-THE-LINE bonus, load reduction on repeated misses, delta scoring against your trailing 14-day median, and the weekly appeal token.' },
]

app.get('/api/changelog', async (c) => {
  return c.json(SCORING_CHANGELOG)
})

app.get('/api/stats', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const date = await safeDate(DB, c.req.query('date'), userId)
  // 14-day strip straight from day_summary (2 queries, not 28+)
  const from14 = addDays(date, -13)
  const sumRows = (await DB.prepare(
    `SELECT * FROM day_summary WHERE user_id=? AND summary_date BETWEEN ? AND ?`
  ).bind(userId, from14, date).all()).results as any[]
  const debRows = (await DB.prepare(
    `SELECT log_date, sleep_hours, mood, energy FROM debriefs
     WHERE user_id=? AND log_date BETWEEN ? AND ?`
  ).bind(userId, from14, date).all()).results as any[]
  const sumBy = new Map(sumRows.map(r => [r.summary_date, r]))
  const debBy = new Map(debRows.map(r => [r.log_date, r]))
  const days = [] as any[]
  for (let i = 13; i >= 0; i--) {
    const d = addDays(date, -i)
    const s = sumBy.get(d), deb = debBy.get(d)
    // today (or an unmaterialized day) falls back to live computation once
    let pct = s?.adherence_pct ?? null, done = s?.blocks_done ?? 0, total = s?.blocks_total ?? 0, mvd = !!s?.mvd_held
    if (pct === null && d === date) {
      const adh = dayAdherence(await blocksForDate(DB, userId, d))
      pct = adh.pct; done = Math.round(adh.done); total = adh.total; mvd = adh.mvdHeld
    }
    days.push({ date: d, pct: pct ?? 0, done, total, mvdHeld: mvd, sleep: deb?.sleep_hours ?? null, mood: deb?.mood ?? null, energy: deb?.energy ?? null, debrief: !!deb })
  }
  // category breakdown last 7 days
  const from = addDays(date, -6)
  const { results: catRows } = await DB.prepare(
    `SELECT b.category, COUNT(*) as total,
            SUM(CASE WHEN l.status='done' THEN 1 WHEN l.status='partial' THEN 0.5 ELSE 0 END) as done
     FROM block_logs l JOIN schedule_blocks b ON b.id=l.block_id AND b.user_id=l.user_id
     WHERE l.user_id=? AND l.log_date BETWEEN ? AND ? GROUP BY b.category`
  ).bind(userId, from, date).all()
  const ledger = (await DB.prepare(
    `SELECT * FROM points_ledger WHERE user_id=? ORDER BY created_at DESC LIMIT 40`,
  ).bind(userId).all()).results
  const unitStats = await DB.prepare(
    `SELECT COUNT(*) as total, SUM(CASE WHEN status='complete' THEN 1 ELSE 0 END) as complete
     FROM unit_progress WHERE user_id=?`,
  ).bind(userId).first<any>()
  const cardStats = await DB.prepare(
    `SELECT COUNT(*) as reviews, AVG(grade) as avg_grade FROM card_reviews WHERE user_id=?`,
  ).bind(userId).first<any>()
  const flagCounts = (await DB.prepare(
    `SELECT flag_type, COUNT(*) as n FROM honesty_flags WHERE user_id=? GROUP BY flag_type`,
  ).bind(userId).all()).results
  const streak = await computeStreak(DB, userId, date)
  const pts = await DB.prepare(
    `SELECT COALESCE(SUM(points),0) as total FROM points_ledger WHERE user_id=?`,
  ).bind(userId).first<{ total: number }>()

  // ── MEDALS (war decorations, computed live — earned, never given) ──
  const debriefCount = (await DB.prepare(
    `SELECT COUNT(*) as n FROM debriefs WHERE user_id=?`,
  ).bind(userId).first<any>())?.n ?? 0
  const chaptersDone = (await DB.prepare(
    `SELECT COUNT(*) as n FROM book_progress WHERE user_id=? AND status='done'`,
  ).bind(userId).first<any>())?.n ?? 0
  const booksDone = (await DB.prepare(
    `SELECT COUNT(*) as n FROM (
       SELECT book_id, COUNT(*) c FROM book_progress
       WHERE user_id=? AND status='done' GROUP BY book_id HAVING c >= 12
     )`,
  ).bind(userId).first<any>())?.n ?? 0
  const intelCount = (await DB.prepare(
    `SELECT COUNT(*) as n FROM intel_entries WHERE user_id=?`,
  ).bind(userId).first<any>())?.n ?? 0
  const examsPassed = (await DB.prepare(
    `SELECT COUNT(*) as n FROM unit_progress up JOIN units u ON u.id=up.unit_id
     WHERE up.user_id=? AND u.is_exam=1 AND up.status='complete'`,
  ).bind(userId).first<any>())?.n ?? 0
  const earlyWakes = (await DB.prepare(
    `SELECT COUNT(*) as n FROM debriefs
     WHERE user_id=? AND wake_time IS NOT NULL AND wake_time <= '06:00'`,
  ).bind(userId).first<any>())?.n ?? 0
  const victoryDays = days.filter(d => d.pct >= 80 && d.debrief).length
  const reviews = cardStats?.reviews ?? 0
  const unitsWon = unitStats?.complete ?? 0
  const totalFlags = (flagCounts as any[]).reduce((a: number, f: any) => a + f.n, 0)
  const medals = [
    { id: 'first_blood',   icon: 'fa-droplet',        title: 'FIRST BLOOD',        desc: 'Complete your first block',            earned: (pts?.total ?? 0) !== 0 || debriefCount > 0 || unitsWon > 0 },
    { id: 'scribe',        icon: 'fa-feather-pointed', title: 'THE SCRIBE',        desc: 'File 7 night debriefs',                earned: debriefCount >= 7,  prog: Math.min(debriefCount, 7),  goal: 7 },
    { id: 'chronicler',    icon: 'fa-scroll',          title: 'CHRONICLER',        desc: 'File 30 night debriefs',               earned: debriefCount >= 30, prog: Math.min(debriefCount, 30), goal: 30 },
    { id: 'week_of_iron',  icon: 'fa-fire',            title: 'WEEK OF IRON',      desc: '7-day victory streak',                 earned: streak >= 7,  prog: Math.min(streak, 7),  goal: 7 },
    { id: 'month_of_steel',icon: 'fa-fire-flame-curved',title:'MONTH OF STEEL',    desc: '30-day victory streak',                earned: streak >= 30, prog: Math.min(streak, 30), goal: 30 },
    { id: 'dawn_raider',   icon: 'fa-sun',             title: 'DAWN RAIDER',       desc: 'Wake by 06:00 ten times',              earned: earlyWakes >= 10, prog: Math.min(earlyWakes, 10), goal: 10 },
    { id: 'first_conquest',icon: 'fa-flag',            title: 'FIRST CONQUEST',    desc: 'Conquer your first campaign unit',     earned: unitsWon >= 1 },
    { id: 'strategist',    icon: 'fa-chess-knight',    title: 'STRATEGIST',        desc: 'Conquer 10 campaign units',            earned: unitsWon >= 10, prog: Math.min(unitsWon, 10), goal: 10 },
    { id: 'gatekeeper',    icon: 'fa-shield-halved',   title: 'GATEKEEPER',        desc: 'Pass an integration exam',             earned: examsPassed >= 1 },
    { id: 'bookworm',      icon: 'fa-book-open',       title: 'DEEP READER',       desc: 'Conquer 25 real chapters',             earned: chaptersDone >= 25, prog: Math.min(chaptersDone, 25), goal: 25 },
    { id: 'librarian',     icon: 'fa-crown',           title: 'MASTER OF TEXTS',   desc: 'Finish a complete book',               earned: booksDone >= 1 },
    { id: 'drillmaster',   icon: 'fa-layer-group',     title: 'DRILLMASTER',       desc: '100 flashcard reviews',                earned: reviews >= 100, prog: Math.min(reviews, 100), goal: 100 },
    { id: 'spymaster',     icon: 'fa-user-secret',     title: 'SPYMASTER',         desc: 'File 15 life-intel entries',           earned: intelCount >= 15, prog: Math.min(intelCount, 15), goal: 15 },
    { id: 'clean_record',  icon: 'fa-scale-balanced',  title: 'CLEAN RECORD',      desc: '14 days, zero honesty flags, 5+ victory days', earned: totalFlags === 0 && victoryDays >= 5 },
    { id: 'sovereign',     icon: 'fa-dragon',          title: 'SOVEREIGN',         desc: 'Reach 10,000 points',                  earned: (pts?.total ?? 0) >= 10000, prog: Math.min(Math.max(pts?.total ?? 0, 0), 10000), goal: 10000 },
  ]

  // Book 13.2 — the brake counts. A rising nonePlausible is the paranoia tell,
  // surfaced here so the operator can actually see it.
  const altCounts = await DB.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(none_plausible),0) AS none_plausible
     FROM alternative_explanations WHERE user_id=?`,
  ).bind(userId).first<{ total: number; none_plausible: number }>()

  return c.json({
    days, categories: catRows, ledger, unitStats, cardStats, flagCounts,
    streak, points: pts?.total ?? 0, medals,
    alternativeExplanations: {
      total: altCounts?.total ?? 0,
      nonePlausible: altCounts?.none_plausible ?? 0,
    },
  })
})

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
function genAgentToken(): string {
  return `wr_agent_v1_${randHex(32)}`
}

app.get('/api/agent/token', (c) => c.json({
  error: 'MASTER TOKEN RETIRED. Issue a scoped credential with POST /api/agent/credentials.',
}, 410))
app.post('/api/agent/token/rotate', async (c) => {
  await parseEmptyBody(c)
  return c.json({
    error: 'MASTER TOKEN RETIRED. Issue a scoped credential with POST /api/agent/credentials.',
  }, 410)
})

app.post('/api/agent/credentials', async (c) => {
  const userId = c.get('userId')
  const body = await parseJson(c, agentCredentialBodySchema)
  const scopes = body.scopes ?? [...DEFAULT_AGENT_SCOPES]
  const token = genAgentToken()
  const expiresAt = new Date(
    Date.now() + (body.expiresInDays ?? 90) * 24 * 60 * 60 * 1000,
  ).toISOString()
  const inserted = await c.env.DB.prepare(
    `INSERT INTO agent_credentials
       (user_id, token_hash, token_prefix, device_label, scopes, expires_at)
     VALUES (?,?,?,?,?,?)`,
  ).bind(
    userId,
    await sha256(token),
    token.slice(0, 20),
    body.deviceLabel,
    JSON.stringify(scopes),
    expiresAt,
  ).run()
  const id = Number(inserted.meta.last_row_id)
  await agentCredentialEvent(c, id, userId, 'issued')
  return c.json({
    id,
    token,
    deviceLabel: body.deviceLabel,
    scopes,
    expiresAt,
  }, 201)
})

app.get('/api/agent/credentials', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, token_prefix, device_label, scopes, expires_at, revoked_at,
            created_at, last_used_at, last_request_method,
            last_request_route, last_request_country, last_request_network
     FROM agent_credentials WHERE user_id=? ORDER BY created_at DESC, id DESC`,
  ).bind(c.get('userId')).all()
  return c.json((results as any[]).map((row) => ({
    id: row.id,
    tokenPrefix: row.token_prefix,
    deviceLabel: row.device_label,
    scopes: JSON.parse(row.scopes),
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    lastRequest: row.last_request_route ? {
      method: row.last_request_method,
      route: row.last_request_route,
      country: row.last_request_country,
      network: row.last_request_network,
    } : null,
  })))
})

app.post('/api/agent/credentials/:id/revoke', async (c) => {
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  await parseEmptyBody(c)
  const userId = c.get('userId')
  const credential = await c.env.DB.prepare(
    `SELECT id FROM agent_credentials WHERE id=? AND user_id=?`,
  ).bind(id, userId).first<{ id: number }>()
  if (!credential) return c.json({ error: 'not found' }, 404)
  const revoked = await c.env.DB.prepare(
    `UPDATE agent_credentials
     SET revoked_at=COALESCE(revoked_at, datetime('now'))
     WHERE id=? AND user_id=?`,
  ).bind(id, userId).run()
  if ((revoked.meta as any).changes > 0) {
    await agentCredentialEvent(c, id, userId, 'revoked')
  }
  return c.json({ ok: true })
})
// /api/agent/v1/* routes registered from ./routes/agent-v1 (Book 7).
registerAgentV1Routes(app)

// ============ PWA MANIFEST + SERVICE WORKER ============
app.get('/manifest.json', (c) => c.json(MANIFEST))

app.get('/sw.js', (c) =>
  new Response(SERVICE_WORKER, { headers: { 'Content-Type': 'application/javascript' } }))

// ============ SHELL ============
app.get('/', (c) => c.html(SHELL_HTML))

export default app
