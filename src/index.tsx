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
import { computeStreak, trailingMedian } from './streak'
import { type ChapterCursor, readChapterCursor } from './cursor'
import { hermesBriefing, continuityBrief } from './commanders-file'
import { callModel, fencedModelData, EXTERNAL_MESSAGE_PREFIX, modelAudit, modelBaseURL } from './ai'
import { RequestValidationError, validationFailed, parseJson, parseEmptyBody, parseValue } from './validation'

// Bindings/Variables extracted to ./env (Book 7).

type SessionRecord = {
  id: number
  user_id: number
}

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

// ============ BOOK 13.2 — ALTERNATIVE-EXPLANATION GATE ============

// "None plausible" (in any of its plain spellings) is legal but is the paranoia
// tell — a rising count is what the operator must be able to watch.
function isNonePlausible(text: string): boolean {
  return /^\s*none(\s+plausible)?\.?\s*$/i.test(text)
}

// The brake, in application form (the DB trigger is the backstop). A capture
// whose heat is anything other than calm requires a non-empty
// alternative_explanation. Returns an error Response to send, or null to pass.
function altGate(c: any, heat: string | undefined, alt: string | undefined): Response | null {
  if (heat && heat !== 'calm' && !(alt && alt.trim())) {
    return c.json({ error: 'ALTERNATIVE EXPLANATION REQUIRED' }, 400)
  }
  return null
}

// Record one brake row, counting the "none plausible" tell. Best-effort; the
// consequence has already been written.
async function recordAltExplanation(
  DB: D1Database,
  entry: { userId: number; entityType: string; entityId?: string | number | null; heat?: string | null; text: string },
): Promise<void> {
  try {
    await DB.prepare(
      `INSERT INTO alternative_explanations (user_id, entity_type, entity_id, heat, text, none_plausible)
       VALUES (?,?,?,?,?,?)`,
    ).bind(
      entry.userId, entry.entityType,
      entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId),
      entry.heat ?? null, entry.text.trim(), isNonePlausible(entry.text) ? 1 : 0,
    ).run()
  } catch (_) { /* never break the write path on a ledger failure */ }
}

// ============ BOOK 5.7 — AUDIT AND IDEMPOTENCY ============

// Caller-supplied identity of one user intent. The frontend and the Termux
// bridge generate this per action and REUSE it on retry, which is what makes
// a redelivery recognisable as the same request rather than a new one.
const requestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,200}$/)

function requestId(c: any): string | null {
  const raw = c.req.header('x-request-id')
  if (!raw) return null
  const parsed = requestIdSchema.safeParse(raw.trim())
  return parsed.success ? parsed.data : null
}

type ActorType = 'user' | 'agent' | 'cron' | 'system'

// Metadata-only audit append. Callers pass already-safe values; nothing here
// records credentials, prompts, or model output. Failure to audit never breaks
// the user's action — the consequence has already been applied.
async function auditEvent(
  DB: D1Database,
  entry: {
    userId: number
    actorType: ActorType
    actorId?: string | null
    requestId: string
    action: string
    entityType: string
    entityId?: string | number | null
    before?: unknown
    after?: unknown
    metadata?: Record<string, unknown> | null
  },
): Promise<void> {
  const json = (value: unknown) =>
    value === undefined || value === null ? null : JSON.stringify(value)
  try {
    await DB.prepare(
      `INSERT INTO audit_events
         (user_id, actor_type, actor_id, request_id, action, entity_type,
          entity_id, before_json, after_json, metadata_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
    ).bind(
      entry.userId,
      entry.actorType,
      entry.actorId ?? null,
      entry.requestId,
      entry.action,
      entry.entityType,
      entry.entityId === undefined || entry.entityId === null
        ? null
        : String(entry.entityId),
      json(entry.before),
      json(entry.after),
      json(entry.metadata),
    ).run()
  } catch (_) {
    // Append-only evidence is best-effort at the edge; never mask the action.
  }
}

// Delivery idempotency arbiter.
//
// The INSERT is the lock: it either lands (this is the first delivery — run
// the handler) or reports zero changes (a redelivery — replay the stored
// response). There is no read-then-write window for a concurrent retry to
// slip through.
//
// A caller that sends no X-Request-Id gets normal non-idempotent behaviour,
// because without it "the same request" cannot be identified. The frontend
// and the bridge always send one.
async function withIdempotency(
  c: any,
  scope: string,
  handler: () => Promise<Response>,
): Promise<Response> {
  const DB = c.env.DB as D1Database
  const userId = c.get('userId') as number
  const rid = requestId(c)
  if (!rid) return handler()

  const claim = await DB.prepare(
    `INSERT OR IGNORE INTO idempotency_keys (user_id, scope, request_id)
     VALUES (?,?,?)`,
  ).bind(userId, scope, rid).run()

  if ((claim.meta as any).changes === 0) {
    const prior = await DB.prepare(
      `SELECT status, response_status, response_json FROM idempotency_keys
       WHERE user_id=? AND scope=? AND request_id=?`,
    ).bind(userId, scope, rid).first<any>()
    if (prior?.status === 'complete' && prior.response_json) {
      // Replay the original answer verbatim: same body, same status.
      return c.json(JSON.parse(prior.response_json), prior.response_status || 200)
    }
    // A first delivery is still in flight. Report contention rather than
    // duplicating the consequence.
    return c.json({ error: 'REQUEST IN PROGRESS' }, 409)
  }

  let response: Response
  try {
    response = await handler()
  } catch (error) {
    // The work failed, so the claim must not block an honest retry.
    await DB.prepare(
      `DELETE FROM idempotency_keys
       WHERE user_id=? AND scope=? AND request_id=? AND status='in_progress'`,
    ).bind(userId, scope, rid).run()
    throw error
  }

  const body = await response.clone().text()
  await DB.prepare(
    `UPDATE idempotency_keys
     SET status='complete', response_status=?, response_json=?,
         completed_at=datetime('now')
     WHERE user_id=? AND scope=? AND request_id=?`,
  ).bind(response.status, body, userId, scope, rid).run()
  return response
}

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
async function userNow(DB: D1Database, userId?: number): Promise<{ date: string; time: string; tz: string }> {
  const tz = (await getSetting(DB, 'timezone', userId)) || 'Africa/Nairobi'
  const now = new Date()
  let date: string, time: string
  try {
    date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
    time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
  } catch (_) {
    date = now.toISOString().slice(0, 10); time = now.toISOString().slice(11, 16)
  }
  if (time.startsWith('24')) time = '00' + time.slice(2)
  return { date, time, tz }
}

// Clamp any validated client-supplied date, never into the future.
async function safeDate(DB: D1Database, q?: string | null, userId?: number): Promise<string> {
  const { date: today } = await userNow(DB, userId)
  if (!q) return today
  const validated = parseValue(dateSchema, q)
  return validated > today ? today : validated
}

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
async function flagExists(
  DB: D1Database,
  userId: number,
  date: string,
  type: string,
  refType?: string,
  refId?: number,
) {
  const q = refType
    ? DB.prepare(
        `SELECT id FROM honesty_flags
         WHERE user_id=? AND flag_date=? AND flag_type=? AND ref_type=? AND ref_id=?`,
      ).bind(userId, date, type, refType, refId ?? 0)
    : DB.prepare(
        `SELECT id FROM honesty_flags
         WHERE user_id=? AND flag_date=? AND flag_type=? AND ref_type IS NULL`,
      ).bind(userId, date, type)
  return !!(await q.first())
}

// Race-safe flag+penalty: the UNIQUE identity index means INSERT OR IGNORE is the
// arbiter — the penalty is written ONLY when the flag row was actually inserted.
async function addFlag(
  DB: D1Database,
  userId: number,
  date: string,
  type: string,
  severity: string,
  message: string,
  penalty: number,
  refType?: string,
  refId?: number,
) {
  if (await flagExists(DB, userId, date, type, refType, refId)) return false
  const ins = await DB.prepare(
    `INSERT OR IGNORE INTO honesty_flags
       (user_id, flag_date, flag_type, severity, message, ref_type, ref_id)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(userId, date, type, severity, message, refType ?? null, refId ?? null).run()
  if (penalty !== 0 && (ins.meta as any).changes > 0) {
    await DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type, ref_id)
       VALUES (?,?,?,?,?,?)`,
    ).bind(userId, date, penalty, message, 'flag', refId ?? null).run()
  }
  return (ins.meta as any).changes > 0
}

// ============ DAY SUMMARY (materialized — one row per day) ============
// Written whenever a past day is processed; makes streak/stats O(1) reads.
async function writeDaySummary(DB: D1Database, userId: number, date: string, finalize = false) {
  const blocks = await blocksForDate(DB, userId, date)
  const adh = dayAdherence(blocks)
  const deb = await DB.prepare(`SELECT id FROM debriefs WHERE user_id=? AND log_date=?`).bind(userId, date).first()
  const pts = await DB.prepare(`SELECT COALESCE(SUM(points),0) t FROM points_ledger WHERE user_id=? AND log_date=?`).bind(userId, date).first<any>()
  // Victory = 80%+ weighted adherence with debrief. MVD held alone keeps the
  // streak ALIVE (survival), it does not count as a victory day.
  const victory = blocks.length > 0 && adh.pct >= 80 && !!deb
  // Minimum Viable Recovery (Book 8.2): a single restoring action logged on a
  // breach day lets the day SURVIVE, exactly like MVD. Derived from the
  // recovery_actions record so re-materialising a day never loses it.
  const rec = await DB.prepare(
    `SELECT 1 AS r FROM recovery_actions WHERE user_id=? AND action_date=?`,
  ).bind(userId, date).first<{ r: number }>()
  const mvrHeld = !!rec
  const survives = victory || adh.mvdHeld || mvrHeld
  const existing = await DB.prepare(`SELECT summary_date FROM day_summary WHERE user_id=? AND summary_date=?`)
    .bind(userId, date).first()
  if (existing) {
    await DB.prepare(
      `UPDATE day_summary SET adherence_pct=?, weighted_score=?, weighted_total=?, blocks_done=?, blocks_total=?,
       mvd_held=?, mvr_held=?, debrief_filed=?, victory=?, points=?, finalized=MAX(finalized, ?), updated_at=datetime('now')
       WHERE user_id=? AND summary_date=?`,
    ).bind(adh.pct, adh.wScore, adh.wTotal, Math.round(adh.done), adh.total,
      adh.mvdHeld ? 1 : 0, mvrHeld ? 1 : 0, deb ? 1 : 0, victory ? 1 : 0, pts?.t ?? 0, finalize ? 1 : 0,
      userId, date).run()
  } else {
    await DB.prepare(
      `INSERT INTO day_summary (user_id, summary_date, adherence_pct, weighted_score, weighted_total, blocks_done, blocks_total,
       mvd_held, mvr_held, debrief_filed, victory, points, finalized, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
    ).bind(userId, date, adh.pct, adh.wScore, adh.wTotal, Math.round(adh.done), adh.total,
      adh.mvdHeld ? 1 : 0, mvrHeld ? 1 : 0, deb ? 1 : 0, victory ? 1 : 0, pts?.t ?? 0, finalize ? 1 : 0).run()
  }
  return { adh, deb: !!deb, victory, survives }
}

// ============ HONESTY ENGINE ============
// Runs against yesterday (and the day before) — ONLY from POST /api/tick, never on reads.
async function runHonestyEngine(DB: D1Database, userId: number, today: string) {
  const startDate = (await getSetting(DB, 'start_date', userId)) || today
  const y1 = addDays(today, -1)
  const y2 = addDays(today, -2)
  if (y1 < startDate) return

  // Skip if yesterday is already finalized (engine idempotence, saves ~10 queries/req)
  const done = await DB.prepare(
    `SELECT finalized FROM day_summary WHERE user_id=? AND summary_date=?`,
  ).bind(userId, y1).first<any>()
  const alreadyFinal = !!done?.finalized

  // 1. Missed debrief
  const deb = await DB.prepare(
    `SELECT id FROM debriefs WHERE user_id=? AND log_date=?`,
  ).bind(userId, y1).first()
  if (!deb) {
    await addFlag(DB, userId, y1, 'missed_debrief', 'serious',
      `NIGHT DEBRIEF MISSED (${y1}). Law 5: Track, don't trust. An army without intelligence reports is blind. -15 pts. Write a catch-up debrief now.`, -15)
  }

  // 2. Missed non-negotiable blocks yesterday
  // (skip 'missed' — those were already punished LIVE by the same-day enforcement engine)
  const yBlocks = await blocksForDate(DB, userId, y1)
  const adh = dayAdherence(yBlocks)
  if (!alreadyFinal) {
    for (const b of yBlocks) {
      if (b.is_non_negotiable && b.log_status !== 'done' && b.log_status !== 'partial' && b.log_status !== 'missed') {
        const skipped = b.log_status === 'skipped'
        await addFlag(DB, userId, y1, 'missed_block', skipped ? 'warn' : 'serious',
          `[Block #${b.id}] NON-NEGOTIABLE ${skipped ? 'SKIPPED' : 'UNLOGGED'}: "${b.title}" (${y1}). ${skipped ? 'You were honest about it — logged, no ambush. -5 pts.' : 'Not even logged. Silence is the worst report. -10 pts.'}`,
          skipped ? -5 : -10, 'block', b.id)
      }
    }

    // 3. LOAD REDUCTION (never-miss-twice INVERTED — review Tier-1 #3).
    // Two straight misses = the schedule was wrong, not just the will.
    // Response: HALVE the block for 3 days + demand the WHY. No extra penalty stack.
    if (y2 >= startDate) {
      const y2Blocks = await blocksForDate(DB, userId, y2)
      const missY2 = new Set(y2Blocks.filter((b: any) => b.is_non_negotiable && b.log_status !== 'done' && b.log_status !== 'partial').map((b: any) => b.id))
      for (const b of yBlocks) {
        if (b.is_non_negotiable && missY2.has(b.id) && b.log_status !== 'done' && b.log_status !== 'partial') {
          const created = await addFlag(DB, userId, y1, 'load_reduction', 'serious',
            `[Block #${b.id}] TWO MISSES IN A ROW: "${b.title}" (${y2}, ${y1}). The block is now UNDER LOAD REDUCTION — half duration for 3 days. A plan that keeps breaking is a bad plan or a hidden refusal. Answer the why: wrong time? too long? wrong prerequisite? or you don't actually want it?`,
            0, 'block', b.id)
          if (created) {
            await DB.prepare(
              `INSERT OR IGNORE INTO load_reductions (user_id, block_id, start_date, end_date)
               VALUES (?,?,?,?)`
            ).bind(userId, b.id, today, addDays(today, 2)).run()
          }
        }
      }
    }

    // 3.5 TONGUE NEGLECT — drills piling up unreviewed means the armory is rotting
    try {
      const overdue = await DB.prepare(
        `SELECT COUNT(*) n FROM response_srs s
         JOIN responses r ON r.id=s.response_id AND r.user_id=s.user_id
         WHERE s.user_id=? AND r.archived=0 AND s.due_date <= ?`
      ).bind(userId, addDays(today, -3)).first<any>()
      if ((overdue?.n ?? 0) >= 5) {
        await addFlag(DB, userId, y1, 'tongue_neglect', 'serious',
          `TONGUE NEGLECT: ${overdue.n} wise responses are 3+ days overdue for drilling. You recorded wisdom and let it rot — a full armory you never trained with. -10 pts. Drill them today.`, -10)
      }
    } catch (_) { /* table may not exist pre-migration */ }

    // 4. Collapse day — but a HELD LINE (MVD) is NOT a collapse. Survival counts.
    if (yBlocks.length > 0 && adh.pct < 50 && !adh.mvdHeld) {
      await addFlag(DB, userId, y1, 'low_adherence', 'serious',
        `ADHERENCE COLLAPSE: ${adh.pct}% on ${y1} (target: 80%). No shame — but no lies either. Read your debrief, find the breach point, patch the wall. -10 pts.`, -10)
    }

    // 4.5 MVD HELD on a hard day — the line held. Small positive, streak survives.
    if (yBlocks.length > 0 && adh.mvdHeld && adh.pct < 80) {
      // ATOMIC: the INSERT's own WHERE NOT EXISTS is the arbiter, so two
      // concurrent enforcement passes (tick + cron) cannot both award.
      await DB.prepare(
        `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type)
         SELECT ?,?,?,?,'mvd'
         WHERE NOT EXISTS (
           SELECT 1 FROM points_ledger
           WHERE user_id=? AND log_date=? AND ref_type='mvd'
         )`,
      ).bind(userId, y1, 10, `HELD THE LINE: all ${adh.mvdTotal} core blocks hit on a hard day (${y1}). The streak lives. +10 pts.`, userId, y1).run()
    }

    // 5. Victory: 80%+ weighted day with debrief
    if (yBlocks.length > 0 && adh.pct >= 80 && deb) {
      // ATOMIC: same conditional-INSERT guard as the MVD bonus above.
      await DB.prepare(
        `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type)
         SELECT ?,?,?,?,'streak'
         WHERE NOT EXISTS (
           SELECT 1 FROM points_ledger
           WHERE user_id=? AND log_date=? AND ref_type='streak'
         )`,
      ).bind(userId, y1, 30, `VICTORY DAY: ${adh.pct}% adherence + debrief filed (${y1}). +30 pts.`, userId, y1).run()
    }
  }

  // 6. Materialize + FINALIZE yesterday (immutable close of books)
  await writeDaySummary(DB, userId, y1, true)
}

// O(1) STREAK from day_summary. A day extends the streak if victory=1;
// mvd_held=1 lets the streak SURVIVE (day is neutral, not a break).
// computeStreak/trailingMedian extracted to ./streak (Book 7).

// ============ SAME-DAY ENFORCEMENT (real-time honesty — no free passes) ============
// A block whose end_time + grace has passed with no log is AUTO-MARKED 'missed':
// instant penalty, instant flag, window closed. The day bleeds while you watch.
async function runSameDayEnforcement(DB: D1Database, userId: number, date: string, time: string) {
  const start = await getSetting(DB, 'start_date', userId)
  if (start && date < start) return
  const grace = Math.max(0, Number((await getSetting(DB, 'grace_minutes', userId)) ?? 30))
  const [nh, nm] = time.split(':').map(Number)
  const nowMin = nh * 60 + nm
  const blocks = await blocksForDate(DB, userId, date)
  for (const b of blocks) {
    // 'pending' is NOT a real log — toggling a block back to pending after the
    // window closes must NOT let it escape the cancellation (honesty loophole).
    if (b.log_status && b.log_status !== 'pending') continue
    const [eh, em] = b.end_time.split(':').map(Number)
    const deadline = eh * 60 + em + grace
    if (nowMin <= deadline) continue                // still inside the window
    // AUTO-CANCEL: the window closed unlogged (overwrites a lingering 'pending' row)
    await DB.prepare(
      `INSERT INTO block_logs (user_id, block_id, log_date, status, note, completed_at)
       VALUES (?,?,?,?,?,datetime('now'))
       ON CONFLICT(block_id, log_date) DO UPDATE SET
         status='missed', note=excluded.note, completed_at=excluded.completed_at
       WHERE block_logs.user_id=excluded.user_id AND block_logs.status='pending'`
    ).bind(userId, b.id, date, 'missed', `AUTO-CANCELED: window closed unlogged at ${time} (grace ${grace}m).`).run()
    const nn = !!b.is_non_negotiable
    const w = b.weight ?? 1
    // CONTEXT blocks (weight 0) are unscored AND unpenalized — canceled silently.
    if (w === 0) continue
    const penalty = nn ? -15 : -5
    await addFlag(DB, userId, date, 'missed_live', nn ? 'critical' : 'warn',
      `[Block #${b.id}] ${nn ? 'NON-NEGOTIABLE ' : ''}MISSED — CANCELED: "${b.title}" (${b.start_time}–${b.end_time}) ended unlogged. The window is closed. ${penalty} pts. One appeal token per week can reopen a window — at the cost of a written, permanent reason.`,
      penalty, 'block', b.id)
  }
}

// ============ STATE (read-only heartbeat) + TICK (the engine crank) ============
// GET /api/state no longer mutates anything — engines run ONLY via POST /api/tick,
// with the SERVER's clock. A client can no longer time-travel penalties into existence.
async function buildState(DB: D1Database, userId: number, date: string, time: string) {
  const blocks = await blocksForDate(DB, userId, date)
  const current = blocks.find((b: any) => b.start_time <= time && time < b.end_time) || null
  const next = blocks.find((b: any) => b.start_time > time) || null
  const adh = dayAdherence(blocks)
  const streak = await computeStreak(DB, userId, date)

  const pts = await DB.prepare(
    `SELECT COALESCE(SUM(points),0) as total FROM points_ledger WHERE user_id=?`,
  ).bind(userId).first<{ total: number }>()
  const todayPts = await DB.prepare(
    `SELECT COALESCE(SUM(points),0) as total FROM points_ledger WHERE user_id=? AND log_date=?`,
  ).bind(userId, date).first<{ total: number }>()
  const flags = (await DB.prepare(
    `SELECT * FROM honesty_flags WHERE user_id=? AND acknowledged=0 ORDER BY created_at DESC LIMIT 20`,
  ).bind(userId).all()).results
  const debrief = await DB.prepare(
    `SELECT * FROM debriefs WHERE user_id=? AND log_date=?`,
  ).bind(userId, date).first()
  const yDebrief = await DB.prepare(
    `SELECT * FROM debriefs WHERE user_id=? AND log_date=?`,
  ).bind(userId, addDays(date, -1)).first()
  const dueCards = await DB.prepare(
    `SELECT COUNT(*) as n FROM flashcards WHERE user_id=? AND due_date <= ?`,
  ).bind(userId, date).first<{ n: number }>()
  const dueTongue = await DB.prepare(
    `SELECT COUNT(*) as n FROM response_srs s
     JOIN responses r ON r.id=s.response_id AND r.user_id=s.user_id
     WHERE s.user_id=? AND r.archived=0 AND s.due_date <= ?`
  ).bind(userId, date).first<{ n: number }>().catch(() => ({ n: 0 }))

  // active units per track
  const activeUnits = (await DB.prepare(
    `SELECT u.id, u.title, p.code, p.title as phase_title, p.track, up.status
     FROM units u JOIN phases p ON p.id=u.phase_id JOIN unit_progress up ON up.unit_id=u.id
     WHERE up.user_id=? AND up.status NOT IN ('locked','complete')
     ORDER BY p.sort_order, u.sort_order`
  ).bind(userId).all()).results

  // delta scoring vs trailing 14-day median + appeal availability + active load reductions
  const median = await trailingMedian(DB, userId, date)
  const weekKey = isoWeekKey(date)
  const appealUsed = await DB.prepare(
    `SELECT id FROM appeals WHERE user_id=? AND week_key=?`,
  ).bind(userId, weekKey).first()
  const loadReductions = (await DB.prepare(
    `SELECT lr.*, b.title FROM load_reductions lr
     JOIN schedule_blocks b ON b.id=lr.block_id AND b.user_id=lr.user_id
     WHERE lr.user_id=? AND lr.end_date >= ? ORDER BY lr.start_date DESC`
  ).bind(userId, date).all().catch(() => ({ results: [] as any[] }))).results
  const openPredictions = await DB.prepare(
    `SELECT COUNT(*) n FROM predictions
     WHERE user_id=? AND outcome='unresolved' AND resolve_by <= ?`
  ).bind(userId, date).first<any>().catch(() => ({ n: 0 }))

  // Re-entry signal (Book 8.6): auto-offer /catchup after three consecutive
  // zero days. One bounded query so it does not inflate the /api/state budget.
  const recent = await DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM block_logs WHERE user_id=? AND log_date > ? AND log_date <= ? AND status IN ('done','partial')) AS blocks,
       (SELECT COUNT(*) FROM debriefs WHERE user_id=? AND log_date > ? AND log_date <= ?) AS debriefs`,
  ).bind(userId, addDays(date, -3), addDays(date, -1), userId, addDays(date, -3), addDays(date, -1))
    .first<{ blocks: number; debriefs: number }>().catch(() => ({ blocks: 1, debriefs: 0 }))
  const needsCatchup = ((recent as any)?.blocks ?? 0) === 0 && ((recent as any)?.debriefs ?? 0) === 0

  return {
    date, time, blocks, current, next, adherence: adh, streak,
    points: pts?.total ?? 0, todayPoints: todayPts?.total ?? 0,
    flags, debrief, debriefDoneToday: !!debrief,
    yesterdayTargets: (yDebrief as any)?.tomorrow_targets || null,
    dueCards: dueCards?.n ?? 0, dueTongue: (dueTongue as any)?.n ?? 0, activeUnits,
    median, delta: median === null ? null : adh.pct - median,
    appealAvailable: !appealUsed, loadReductions,
    duePredictions: (openPredictions as any)?.n ?? 0,
    needsCatchup
  }
}


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

async function runEnforcement(DB: D1Database, userId: number): Promise<{ date: string; time: string; tz: string }> {
  const now = await userNow(DB, userId)
  await ensureUnlocks(DB, userId)
  await ensureCards(DB, userId)
  await runHonestyEngine(DB, userId, now.date)
  await runSameDayEnforcement(DB, userId, now.date, now.time)
  await writeDaySummary(DB, userId, now.date, false)
  return now
}

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

// ============ CAMPAIGN (progress-locked) ============
async function ensureUnlocks(DB: D1Database, userId: number) {
  // seed progress rows for all units
  await DB.prepare(
    `INSERT OR IGNORE INTO unit_progress (user_id, unit_id, status)
     SELECT ?, u.id, 'locked' FROM units u
     WHERE u.id NOT IN (SELECT unit_id FROM unit_progress WHERE user_id=?)`
  ).bind(userId, userId).run()
  // per track: walk phases in order; first incomplete unit becomes active
  const phases = (await DB.prepare(`SELECT * FROM phases ORDER BY sort_order`).all()).results as any[]
  const tracks: Record<string, any[]> = {}
  for (const p of phases) { (tracks[p.track] ||= []).push(p) }
  for (const track of Object.keys(tracks)) {
    let blocked = false
    for (const p of tracks[track]) {
      if (blocked) break
      const units = (await DB.prepare(
        `SELECT u.id, up.status FROM units u JOIN unit_progress up ON up.unit_id=u.id
         WHERE up.user_id=? AND u.phase_id=? ORDER BY u.sort_order`
      ).bind(userId, p.id).all()).results as any[]
      for (const u of units) {
        if (u.status === 'complete') continue
        if (u.status === 'locked') {
          await DB.prepare(
            `UPDATE unit_progress SET status='active' WHERE unit_id=? AND user_id=?`,
          ).bind(u.id, userId).run()
        }
        blocked = true
        break
      }
    }
  }
}

app.get('/api/campaign', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const phases = (await DB.prepare(`SELECT * FROM phases ORDER BY sort_order`).all()).results as any[]
  const out = []
  for (const p of phases) {
    const units = (await DB.prepare(
      `SELECT u.*, up.status, up.reading_done_at, up.drill_done_at, up.drill_report, up.debrief_answer,
              up.exam_answers, up.exam_self_score, up.completed_at, up.attempts
       FROM units u JOIN unit_progress up ON up.unit_id=u.id
       WHERE up.user_id=? AND u.phase_id=? ORDER BY u.sort_order`
    ).bind(userId, p.id).all()).results as any[]
    const complete = units.filter(u => u.status === 'complete').length
    out.push({ ...p, units, progress: units.length ? Math.round((complete / units.length) * 100) : 0, complete, total: units.length })
  }
  return c.json(out)
})

app.post('/api/units/:id/step', async (c) => withIdempotency(c, 'unit:step', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  const {
    step, drill_report, debrief_answer, exam_answers, exam_self_score, date,
  } = await parseJson(c, unitStepBodySchema)
  const up = await DB.prepare(
    `SELECT * FROM unit_progress WHERE user_id=? AND unit_id=?`,
  ).bind(userId, id).first<any>()
  const unit = await DB.prepare(`SELECT * FROM units WHERE id=?`).bind(id).first<any>()
  if (!up || !unit) return c.json({ error: 'not found' }, 404)
  if (up.status === 'locked') return c.json({ error: 'UNIT LOCKED. Finish the previous unit first — this system is progress-based, no skipping.' }, 400)
  if (up.status === 'complete') {
    return c.json({ error: 'UNIT COMPLETE. Terminal records cannot be rewritten.' }, 409)
  }
  const allowedUnitSteps: Record<string, string[]> = unit.is_exam
    ? { active: ['complete'] }
    : {
        active: ['reading'],
        reading_done: unit.field_drill ? ['drill'] : ['complete'],
        drill_done: ['complete'],
      }
  if (!allowedUnitSteps[up.status]?.includes(step)) {
    return c.json({ error: 'ILLEGAL UNIT TRANSITION. Complete each gate in order.' }, 409)
  }
  const today = date || (await userNow(c.env.DB, userId)).date

  if (step === 'reading') {
    await DB.prepare(
      `UPDATE unit_progress SET status='reading_done', reading_done_at=datetime('now')
       WHERE unit_id=? AND user_id=?`,
    ).bind(id, userId).run()
    await DB.prepare(
      `INSERT INTO points_ledger (user_id,log_date,points,reason,ref_type,ref_id)
       VALUES (?,?,?,?,?,?)`,
    ).bind(userId, today, 20, `Reading complete: ${unit.title} (+20)`, 'unit', id).run()
  } else if (step === 'drill') {
    if (!drill_report || drill_report.trim().length < 30) {
      return c.json({ error: 'DRILL REPORT TOO THIN. A field drill without a real report is a skipped drill — write at least a few honest sentences about what you actually DID and what happened.' }, 400)
    }
    await DB.prepare(
      `UPDATE unit_progress SET status='drill_done', drill_done_at=datetime('now'), drill_report=?
       WHERE unit_id=? AND user_id=?`,
    ).bind(drill_report, id, userId).run()
    await DB.prepare(
      `INSERT INTO points_ledger (user_id,log_date,points,reason,ref_type,ref_id)
       VALUES (?,?,?,?,?,?)`,
    ).bind(userId, today, 30, `Field drill executed: ${unit.title} (+30)`, 'unit', id).run()
  } else if (step === 'complete') {
    if (unit.is_exam) {
      if (!exam_answers) return c.json({ error: 'Exam answers required.' }, 400)
      const score = Number(exam_self_score ?? 0)
      await DB.prepare(
        `UPDATE unit_progress SET exam_answers=?, exam_self_score=?, attempts=attempts+1
         WHERE unit_id=? AND user_id=?`,
      ).bind(JSON.stringify(exam_answers), score, id, userId).run()
      if (score < 70) {
        await addFlag(DB, userId, today, 'exam_failed', 'serious',
          `EXAM NOT PASSED: ${unit.title} — self-score ${score}/100 (pass: 70). No shame: the weak chapters are now visible. Re-study them, retake when ready. The gate stays closed until earned. -10 pts.`, -10)
        return c.json({ ok: false, failed: true, message: `Score ${score}/100. Pass mark is 70. The honesty engine has logged this attempt. Restudy your weak chapters and retake — the next phase stays locked until you EARN it.` })
      }
      await DB.prepare(
        `UPDATE unit_progress SET status='complete', completed_at=datetime('now')
         WHERE unit_id=? AND user_id=?`,
      ).bind(id, userId).run()
      await DB.prepare(
        `INSERT INTO points_ledger (user_id,log_date,points,reason,ref_type,ref_id)
         VALUES (?,?,?,?,?,?)`,
      ).bind(userId, today, 100, `EXAM PASSED (${score}/100): ${unit.title} (+100)`, 'exam', id).run()
    } else {
      if (up.status !== 'drill_done' && up.status !== 'reading_done') {
        return c.json({ error: 'Mark the reading done first.' }, 400)
      }
      if (up.status === 'reading_done' && unit.field_drill) {
        return c.json({ error: 'FIELD DRILL NOT REPORTED. Reading without application is entertainment, not training. Execute the drill, file the report, then complete.' }, 400)
      }
      await DB.prepare(
        `UPDATE unit_progress SET status='complete', completed_at=datetime('now'),
         debrief_answer=COALESCE(?,debrief_answer) WHERE unit_id=? AND user_id=?`,
      ).bind(debrief_answer || null, id, userId).run()
      await DB.prepare(
        `INSERT INTO points_ledger (user_id,log_date,points,reason,ref_type,ref_id)
         VALUES (?,?,?,?,?,?)`,
      ).bind(userId, today, 50, `UNIT CONQUERED: ${unit.title} (+50)`, 'unit', id).run()
    }
    await ensureUnlocks(DB, userId)
  }
  return c.json({ ok: true })
}))

// ============ MAXIMS + FLASHCARDS ============
app.get('/api/maxims', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM maxims WHERE user_id=? ORDER BY source, id`,
  ).bind(c.get('userId')).all()
  return c.json(results)
})
app.post('/api/maxims', async (c) => {
  const userId = c.get('userId')
  const b = await parseJson(c, maximBodySchema)
  const r = await c.env.DB.prepare(
    `INSERT INTO maxims
       (user_id, source, principle, naive_reading, master_reading, my_words, created_by_user)
     VALUES (?,?,?,?,?,?,1)`
  ).bind(userId, b.source, b.principle, b.naive_reading || '(write it)', b.master_reading || '(write it)', b.my_words || null).run()
  await c.env.DB.prepare(
    `INSERT INTO flashcards (user_id, maxim_id) VALUES (?,?)`,
  ).bind(userId, r.meta.last_row_id).run()
  return c.json({ ok: true, id: r.meta.last_row_id })
})
app.post('/api/maxims/:id/my-words', async (c) => {
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  const body = await parseJson(c, myWordsBodySchema)
  const updated = await c.env.DB.prepare(
    `UPDATE maxims SET my_words=? WHERE id=? AND user_id=?`,
  ).bind(myWordsOrNull(body), id, c.get('userId')).run()
  if ((updated.meta as any).changes === 0) return c.json({ error: 'not found' }, 404)
  return c.json({ ok: true })
})

function myWordsOrNull(body: any): string | null {
  return body.my_words ?? null
}

async function ensureCards(DB: D1Database, userId: number) {
  await DB.prepare(
    `INSERT OR IGNORE INTO flashcards (user_id, maxim_id)
     SELECT ?, id FROM maxims
     WHERE user_id=? AND id NOT IN (SELECT maxim_id FROM flashcards WHERE user_id=?)`,
  ).bind(userId, userId, userId).run()
}
app.get('/api/cards/due', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const date = await safeDate(DB, c.req.query('date'), userId)
  const { results } = await DB.prepare(
    `SELECT f.*, m.source, m.principle, m.naive_reading, m.master_reading, m.my_words
     FROM flashcards f JOIN maxims m ON m.id=f.maxim_id AND m.user_id=f.user_id
     WHERE f.user_id=? AND f.due_date <= ? ORDER BY f.due_date LIMIT 15`
  ).bind(userId, date).all()
  return c.json(results)
})
app.post('/api/cards/:maximId/review', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const mid = parseValue(positiveIdSchema, c.req.param('maximId'))
  const { grade, date } = await parseJson(c, cardReviewBodySchema)
  const card = await DB.prepare(
    `SELECT * FROM flashcards WHERE maxim_id=? AND user_id=?`,
  ).bind(mid, userId).first<any>()
  if (!card) return c.json({ error: 'no card' }, 404)
  const today = await safeDate(DB, date, userId)
  if (card.due_date > today) {
    return c.json({ error: 'CARD NOT DUE. Review transitions follow the schedule.' }, 409)
  }
  let { interval_days, ease, reps, lapses } = card
  if (grade === 0) { lapses++; reps = 0; interval_days = 0; ease = Math.max(1.3, ease - 0.2) }
  else {
    reps++
    ease = Math.max(1.3, ease + (grade === 3 ? 0.1 : grade === 1 ? -0.15 : 0))
    if (reps === 1) interval_days = 1
    else if (reps === 2) interval_days = 3
    else interval_days = Math.round(interval_days * ease * (grade === 1 ? 0.8 : grade === 3 ? 1.3 : 1))
  }
  const due = addDays(today, Math.max(interval_days, grade === 0 ? 0 : 1))
  // Atomic (Book 6): the schedule advance and the review log land together or
  // not at all, so a mid-write failure can never desync them.
  await DB.batch([
    DB.prepare(
      `UPDATE flashcards SET interval_days=?, ease=?, reps=?, lapses=?, due_date=?
       WHERE maxim_id=? AND user_id=?`,
    ).bind(interval_days, ease, reps, lapses, due, mid, userId),
    DB.prepare(
      `INSERT INTO card_reviews (user_id, maxim_id, grade) VALUES (?,?,?)`,
    ).bind(userId, mid, grade),
  ])
  return c.json({ ok: true, next_due: due })
})

// ============ FLAGS ============
app.post('/api/flags/:id/ack', async (c) => {
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  await parseEmptyBody(c)
  const updated = await c.env.DB.prepare(
    `UPDATE honesty_flags SET acknowledged=1 WHERE id=? AND user_id=?`,
  ).bind(id, c.get('userId')).run()
  if ((updated.meta as any).changes === 0) return c.json({ error: 'not found' }, 404)
  return c.json({ ok: true })
})
app.get('/api/flags/history', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM honesty_flags WHERE user_id=? ORDER BY created_at DESC LIMIT 100`,
  ).bind(c.get('userId')).all()
  return c.json(results)
})

// ============ THE TONGUE — WISE-RESPONSE ARMORY + SUPREME MEMORIZATION ============
// Mastery ladder: new → learning (3+ correct) → memorized (7+ correct, interval≥7d)
//                 → ingrained (14+ correct, interval≥21d) → reflex (25+ correct, interval≥45d)
function tongueMastery(s: any): string {
  const cr = s.correct_reviews, iv = s.interval_days
  if (cr >= 25 && iv >= 45) return 'reflex'
  if (cr >= 14 && iv >= 21) return 'ingrained'
  if (cr >= 7 && iv >= 7) return 'memorized'
  if (cr >= 3) return 'learning'
  return 'new'
}

// Capture a wise response (the daily field-recording ritual)
app.post('/api/tongue', async (c) => withIdempotency(c, 'tongue:capture', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { situation, trigger_q, response, why_works, source, category } =
    await parseJson(c, tongueBodySchema)
  const today = (await userNow(DB, userId)).date
  const r = await DB.prepare(
    `INSERT INTO responses
       (user_id, situation, trigger_q, response, why_works, source, category)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(userId, situation.trim(), trigger_q.trim(), response.trim(), (why_works || '').trim() || null, (source || '').trim() || null, category || 'wit').run()
  const rid = r.meta.last_row_id
  // Atomic (Book 6): the SRS seeding and the capture reward both hang off the
  // new response id and must commit together.
  await DB.batch([
    DB.prepare(
      `INSERT INTO response_srs (user_id, response_id, due_date) VALUES (?,?,?)`,
    ).bind(userId, rid, today),
    DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type, ref_id)
       VALUES (?,?,?,?,?,?)`,
    ).bind(userId, today, 3, `INTEL CAPTURED: recorded a wise response ("${String(trigger_q).slice(0, 50)}…"). +3 pts. Now memorize it.`, 'tongue', rid),
  ])
  return c.json({ ok: true, id: rid })
}))

// List / filter the armory
app.get('/api/tongue', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const category = c.req.query('category')
  const cat = category === undefined || category === 'all'
    ? category
    : parseValue(responseCategorySchema, category)
  const q = c.req.query('q') === undefined
    ? undefined
    : parseValue(z.string().trim().min(1).max(200), c.req.query('q'))
  let sql = `SELECT r.*, s.mastery, s.due_date, s.reps, s.lapses, s.interval_days, s.total_reviews, s.correct_reviews
             FROM responses r JOIN response_srs s ON s.response_id=r.id AND s.user_id=r.user_id
             WHERE r.user_id=? AND r.archived=0`
  const binds: any[] = [userId]
  if (cat && cat !== 'all') { sql += ` AND r.category=?`; binds.push(cat) }
  if (q) { sql += ` AND (r.situation LIKE ? OR r.trigger_q LIKE ? OR r.response LIKE ?)`; binds.push(`%${q}%`, `%${q}%`, `%${q}%`) }
  sql += ` ORDER BY r.created_at DESC LIMIT 300`
  const { results } = await DB.prepare(sql).bind(...binds).all()
  return c.json(results)
})

app.put('/api/tongue/:id', async (c) => {
  const DB = c.env.DB
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  const { situation, trigger_q, response, why_works, source, category } =
    await parseJson(c, tongueBodySchema)
  const updated = await DB.prepare(
    `UPDATE responses SET situation=?, trigger_q=?, response=?, why_works=?, source=?, category=?
     WHERE id=? AND user_id=?`,
  ).bind(situation, trigger_q, response, why_works || null, source || null, category || 'wit', id, c.get('userId')).run()
  if ((updated.meta as any).changes === 0) return c.json({ error: 'not found' }, 404)
  return c.json({ ok: true })
})
app.delete('/api/tongue/:id', async (c) => {
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  await parseEmptyBody(c)
  const updated = await c.env.DB.prepare(
    `UPDATE responses SET archived=1 WHERE id=? AND user_id=?`,
  ).bind(id, c.get('userId')).run()
  if ((updated.meta as any).changes === 0) return c.json({ error: 'not found' }, 404)
  return c.json({ ok: true })
})

// Due drills — each response is served with a rotating challenge mode so the
// brain is attacked from 5 angles: recall / cloze / first_letters / reverse / delivery
app.get('/api/tongue/due', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const date = await safeDate(DB, c.req.query('date'), userId)
  const { results } = await DB.prepare(
    `SELECT r.*, s.mastery, s.due_date, s.reps, s.lapses, s.interval_days, s.total_reviews, s.correct_reviews, s.last_mode
     FROM responses r JOIN response_srs s ON s.response_id=r.id AND s.user_id=r.user_id
     WHERE r.user_id=? AND r.archived=0 AND s.due_date <= ? ORDER BY s.due_date LIMIT 20`
  ).bind(userId, date).all()
  const MODES = ['recall', 'cloze', 'first_letters', 'reverse', 'delivery']
  const out = (results as any[]).map((r: any) => {
    // rotate: never repeat the last mode; deeper mastery gets harder modes more often
    let pool = MODES.filter(m => m !== r.last_mode)
    if (r.mastery === 'ingrained' || r.mastery === 'reflex') pool = pool.filter(m => m !== 'recall')
    const mode = pool[Math.floor(Math.random() * pool.length)] || 'recall'
    return { ...r, drill_mode: mode }
  })
  return c.json(out)
})

// Grade a drill (0 blank | 1 shaky | 2 solid | 3 fluent) — SM-2 with mastery ladder
app.post('/api/tongue/:id/review', async (c) => withIdempotency(c, 'tongue:review', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  const { grade, mode, date } = await parseJson(c, tongueReviewBodySchema)
  const s = await DB.prepare(
    `SELECT s.*, r.archived FROM response_srs s
     JOIN responses r ON r.id=s.response_id AND r.user_id=s.user_id
     WHERE s.response_id=? AND s.user_id=?`,
  ).bind(id, userId).first<any>()
  if (!s) return c.json({ error: 'no such response' }, 404)
  const today = await safeDate(DB, date, userId)
  if (s.archived) {
    return c.json({ error: 'RESPONSE ARCHIVED. Terminal records cannot be reviewed.' }, 409)
  }
  if (s.due_date > today) {
    return c.json({ error: 'RESPONSE NOT DUE. Review transitions follow the schedule.' }, 409)
  }
  let { interval_days, ease, reps, lapses, total_reviews, correct_reviews } = s
  total_reviews++
  if (grade === 0) { lapses++; reps = 0; interval_days = 0; ease = Math.max(1.3, ease - 0.2) }
  else {
    reps++; correct_reviews++
    ease = Math.max(1.3, ease + (grade === 3 ? 0.1 : grade === 1 ? -0.15 : 0))
    if (reps === 1) interval_days = 1
    else if (reps === 2) interval_days = 3
    else interval_days = Math.round(interval_days * ease * (grade === 1 ? 0.8 : grade === 3 ? 1.3 : 1))
  }
  const due = addDays(today, Math.max(interval_days, grade === 0 ? 0 : 1))
  const mastery = tongueMastery({ correct_reviews, interval_days })
  const prevMastery = s.mastery
  await DB.prepare(
    `UPDATE response_srs SET interval_days=?, ease=?, reps=?, lapses=?, due_date=?, mastery=?, total_reviews=?, correct_reviews=?, last_mode=?
     WHERE response_id=? AND user_id=?`
  ).bind(interval_days, ease, reps, lapses, due, mastery, total_reviews, correct_reviews, mode || 'recall', id, userId).run()
  await DB.prepare(
    `INSERT INTO tongue_reviews (user_id, response_id, review_date, mode, grade)
     VALUES (?,?,?,?,?)`,
  ).bind(userId, id, today, mode || 'recall', grade).run()
  // Mastery promotion bonuses — real, earned progress
  let promoted: string | null = null
  if (mastery !== prevMastery) {
    const bonus: any = { learning: 2, memorized: 8, ingrained: 15, reflex: 30 }
    if (bonus[mastery]) {
      promoted = mastery
      const r = await DB.prepare(
        `SELECT trigger_q FROM responses WHERE id=? AND user_id=?`,
      ).bind(id, userId).first<any>()
      await DB.prepare(
        `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type, ref_id)
         VALUES (?,?,?,?,?,?)`,
      ).bind(userId, today, bonus[mastery], `TONGUE ${mastery.toUpperCase()}: "${String(r?.trigger_q || '').slice(0, 50)}…" climbed to ${mastery.toUpperCase()}. +${bonus[mastery]} pts.`, 'tongue', id).run()
    }
  }
  return c.json({ ok: true, next_due: due, mastery, promoted })
}))

// Weekly exam — strict. 10 random armed responses (or all if fewer). Pass ≥ 80%.
app.get('/api/tongue/exam', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { results } = await DB.prepare(
    `SELECT r.id, r.situation, r.trigger_q, r.response, r.category, s.mastery
     FROM responses r JOIN response_srs s ON s.response_id=r.id AND s.user_id=r.user_id
     WHERE r.user_id=? AND r.archived=0 AND s.total_reviews > 0 ORDER BY RANDOM() LIMIT 10`
  ).bind(userId).all()
  return c.json(results)
})
app.post('/api/tongue/exam/submit', async (c) => withIdempotency(c, 'tongue:exam', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { total, correct, date } = await parseJson(c, tongueExamBodySchema)
  const today = await safeDate(DB, date, userId)
  const pct = total ? Math.round((correct / total) * 100) : 0
  const passed = pct >= 80 ? 1 : 0
  await DB.prepare(
    `INSERT INTO tongue_exams (user_id, exam_date, total, correct, score_pct, passed)
     VALUES (?,?,?,?,?,?)`,
  ).bind(userId, today, total, correct, pct, passed).run()
  if (passed) {
    await DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type)
       VALUES (?,?,?,?,?)`,
    ).bind(userId, today, 25, `TONGUE EXAM PASSED: ${correct}/${total} (${pct}%). The armory is in your head. +25 pts.`, 'tongue').run()
  } else {
    await addFlag(DB, userId, today, 'tongue_exam_failed', 'serious',
      `TONGUE EXAM FAILED: ${correct}/${total} (${pct}%). You recorded wisdom you cannot recall — that is decoration, not armament. −10 pts. Drill and retake.`, -10)
  }
  return c.json({ ok: true, score_pct: pct, passed: !!passed })
}))

// Tongue stats — the real-progress dashboard
app.get('/api/tongue/stats', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const date = await safeDate(DB, c.req.query('date'), userId)
  const byMastery = (await DB.prepare(
    `SELECT s.mastery, COUNT(*) n FROM response_srs s
     JOIN responses r ON r.id=s.response_id AND r.user_id=s.user_id
     WHERE r.user_id=? AND r.archived=0 GROUP BY s.mastery`
  ).bind(userId).all()).results
  const totals = await DB.prepare(
    `SELECT COUNT(*) total FROM responses WHERE user_id=? AND archived=0`,
  ).bind(userId).first<any>()
  const due = await DB.prepare(
    `SELECT COUNT(*) n FROM response_srs s
     JOIN responses r ON r.id=s.response_id AND r.user_id=s.user_id
     WHERE r.user_id=? AND r.archived=0 AND s.due_date<=?`,
  ).bind(userId, date).first<any>()
  const reviews7 = await DB.prepare(
    `SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN grade>=2 THEN 1 ELSE 0 END),0) solid
     FROM tongue_reviews WHERE user_id=? AND review_date >= ?`,
  ).bind(userId, addDays(date, -7)).first<any>()
  const exams = (await DB.prepare(
    `SELECT * FROM tongue_exams WHERE user_id=? ORDER BY created_at DESC LIMIT 8`,
  ).bind(userId).all()).results
  const captured7 = await DB.prepare(
    `SELECT COUNT(*) n FROM responses
     WHERE user_id=? AND archived=0 AND created_at >= datetime(?, '-7 days')`,
  ).bind(userId, date + ' 00:00:00').first<any>()
  const byCat = (await DB.prepare(
    `SELECT category, COUNT(*) n FROM responses
     WHERE user_id=? AND archived=0 GROUP BY category ORDER BY n DESC`,
  ).bind(userId).all()).results
  const lastExam = (exams as any[])[0] || null
  const weekExamDone = lastExam && (lastExam as any).exam_date >= addDays(date, -6)
  return c.json({
    total: totals?.total ?? 0, due: due?.n ?? 0, byMastery, byCat,
    reviews7: reviews7?.n ?? 0, solid7: reviews7?.solid ?? 0,
    captured7: captured7?.n ?? 0, exams, weekExamDone: !!weekExamDone
  })
})

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

// ============ LIFE INTEL (The Council) ============
app.get('/api/intel', async (c) => {
  const userId = c.get('userId')
  const domain = c.req.query('domain') === undefined
    ? undefined
    : parseValue(intelDomainSchema, c.req.query('domain'))
  const q = domain
    ? c.env.DB.prepare(
      `SELECT * FROM intel_entries WHERE user_id=? AND domain=?
       ORDER BY log_date DESC, id DESC LIMIT 100`,
    ).bind(userId, domain)
    : c.env.DB.prepare(
      `SELECT * FROM intel_entries WHERE user_id=? ORDER BY log_date DESC, id DESC LIMIT 100`,
    ).bind(userId)
  return c.json((await q.all()).results)
})

app.post('/api/intel', async (c) => withIdempotency(c, 'intel:file', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const b = await parseJson(c, intelBodySchema)
  // Book 13.2 brake: a heated capture cannot be filed without an alternative.
  const gated = altGate(c, b.heat, b.alternative_explanation)
  if (gated) return gated
  // Book 5.3/6: clamp a client date never-future (safeDate) so a filed intel
  // entry can be honestly back-dated but its +15 can never land on a future day.
  const logDate = await safeDate(DB, b.log_date, userId)
  const r = await DB.prepare(
    `INSERT INTO intel_entries
       (user_id, log_date, domain, title, situation, my_move, outcome, verdict,
        principle_used, lesson, people, heat, alternative_explanation)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(userId, logDate, b.domain, b.title, b.situation || null,
    b.my_move || null, b.outcome || null, b.verdict || 'pending', b.principle_used || null,
    b.lesson || null, b.people || null, b.heat || null, b.alternative_explanation || null).run()
  await DB.prepare(
    `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type, ref_id)
     VALUES (?,?,?,?,?,?)`,
  ).bind(userId, logDate, 15, `Intel filed: [${b.domain}] ${b.title} (+15)`, 'intel', r.meta.last_row_id).run()
  // Count the brake (and the "none plausible" tell) when heat is non-calm.
  if (b.heat && b.heat !== 'calm' && b.alternative_explanation) {
    await recordAltExplanation(DB, {
      userId, entityType: 'capture', entityId: r.meta.last_row_id,
      heat: b.heat, text: b.alternative_explanation,
    })
  }
  const rid = requestId(c)
  if (rid) {
    await auditEvent(DB, {
      userId, actorType: 'user', requestId: rid,
      action: 'intel.file', entityType: 'intel_entry', entityId: r.meta.last_row_id,
      after: { domain: b.domain, log_date: logDate, points: 15, heat: b.heat || 'calm' },
    })
  }
  return c.json({ ok: true, id: r.meta.last_row_id })
}))

app.post('/api/intel/:id/verdict', async (c) => {
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  const { verdict, lesson } = await parseJson(c, intelVerdictBodySchema)
  const entry = await c.env.DB.prepare(
    `SELECT verdict FROM intel_entries WHERE id=? AND user_id=?`,
  ).bind(id, c.get('userId')).first<{ verdict: string | null }>()
  if (!entry) return c.json({ error: 'not found' }, 404)
  if (entry.verdict && entry.verdict !== 'pending') {
    return c.json({ error: 'VERDICT FINAL. Terminal records cannot be rewritten.' }, 409)
  }
  await c.env.DB.prepare(
    `UPDATE intel_entries SET verdict=?, lesson=COALESCE(?,lesson)
     WHERE id=? AND user_id=?`,
  ).bind(verdict, lesson || null, id, c.get('userId')).run()
  return c.json({ ok: true })
})

// ============ BOOK PROGRESS (real books library) ============
const BOOKS_META = [
  { id: 'art_of_war', title: 'The Art of War', author: 'Sun Tzu', phase: 'P1', chapters: 13 },
  { id: 'the_prince', title: 'The Prince', author: 'Machiavelli', phase: 'P2', chapters: 26 },
  { id: 'discourses', title: 'Discourses on Livy', author: 'Machiavelli', phase: 'P2B', chapters: 141 },
  { id: 'on_war', title: 'On War (Book I)', author: 'Clausewitz', phase: 'P3', chapters: 12 },
  { id: 'meditations', title: 'Meditations', author: 'Marcus Aurelius', phase: 'PHIL', chapters: 12 },
  { id: 'enchiridion', title: 'The Enchiridion', author: 'Epictetus', phase: 'PHIL', chapters: 6 },
  { id: 'apology', title: 'Apology', author: 'Plato', phase: 'PHIL', chapters: 4 },
  { id: 'crito', title: 'Crito', author: 'Plato', phase: 'PHIL', chapters: 3 },
  { id: 'republic', title: 'The Republic (I–IV)', author: 'Plato', phase: 'PHIL', chapters: 4 },
  { id: 'zarathustra', title: 'Thus Spake Zarathustra (Pt.1)', author: 'Nietzsche', phase: 'PHIL', chapters: 25 },
  { id: 'beyond_good_evil', title: 'Beyond Good and Evil', author: 'Nietzsche', phase: 'PHIL', chapters: 10 },
]

app.get('/api/library', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT book_id, chapter_idx, status, last_para FROM book_progress WHERE user_id=?`,
  ).bind(c.get('userId')).all()
  const prog: Record<string, any[]> = {}
  for (const r of results as any[]) (prog[r.book_id] ||= []).push(r)
  return c.json(BOOKS_META.map(b => {
    const rows = prog[b.id] || []
    const done = rows.filter(r => r.status === 'done').length
    const reading = rows.find(r => r.status === 'reading')
    return { ...b, chaptersDone: done, currentChapter: reading?.chapter_idx ?? null, lastPara: reading?.last_para ?? 0 }
  }))
})

app.post('/api/library/:bookId/chapter/:idx', async (c) => withIdempotency(c, 'library:chapter', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const bookId = c.req.param('bookId')
  const book = BOOKS_META.find((candidate) => candidate.id === bookId)
  if (!book) throw new RequestValidationError()
  const idx = parseValue(chapterIndexSchema, c.req.param('idx'))
  if (idx >= book.chapters) throw new RequestValidationError()
  const { status, last_para, notes, date } =
    await parseJson(c, bookProgressBodySchema)
  const prev = await DB.prepare(
    `SELECT id, status, last_para FROM book_progress
     WHERE user_id=? AND book_id=? AND chapter_idx=?`,
  ).bind(userId, bookId, idx).first<{
    id: number
    status: string
    last_para: number
  }>()
  const nextStatus = status || 'reading'
  if ((!prev || prev.status === 'unread') && nextStatus !== 'reading') {
    return c.json({ error: 'READING REQUIRED. Chapters must be opened before completion.' }, 409)
  }
  if (prev?.status === 'done') {
    return c.json({ error: 'CHAPTER COMPLETE. Terminal records cannot be rewritten.' }, 409)
  }
  if (prev?.status === 'reading' && nextStatus !== 'reading' && nextStatus !== 'done') {
    return c.json({ error: 'ILLEGAL CHAPTER TRANSITION.' }, 409)
  }
  if (prev) {
    await DB.prepare(
      `UPDATE book_progress SET status=?, last_para=?, notes=COALESCE(?,notes),
         completed_at=CASE WHEN ?='done' THEN datetime('now') ELSE completed_at END
       WHERE id=? AND user_id=?`,
    ).bind(nextStatus, last_para ?? prev.last_para, notes || null, nextStatus, prev.id, userId).run()
  } else {
    await DB.prepare(
      `INSERT INTO book_progress
         (user_id, book_id, chapter_idx, status, last_para, notes, completed_at)
       VALUES (?,?,?,?,?,?,NULL)`,
    ).bind(userId, bookId, idx, 'reading', last_para ?? 0, notes || null).run()
  }
  if (nextStatus === 'done') {
    await DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type)
       VALUES (?,?,?,?,?)`,
    ).bind(userId, date || (await userNow(DB, userId)).date, 20, `Real chapter finished: ${bookId} ch.${idx + 1} (+20)`, 'book').run()
  }
  return c.json({ ok: true })
}))

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

// ============ HERMES — the autonomous counsel ============
// hermesBriefing extracted to ./commanders-file (Book 7).

// AI / model service extracted to ./ai (Book 5.6 / Book 7).

app.post('/api/hermes', async (c) => withIdempotency(c, 'hermes:chat', async () => {
  const DB = c.env.DB
  const { message, date } = await parseJson(c, hermesBodySchema)
  const userId = c.get('userId')
  const today = await safeDate(DB, date, userId)
  if (message.length > MODEL_USER_INPUT_CHARS) {
    return c.json({ error: 'MODEL INPUT TOO LARGE' }, 413)
  }
  if (!c.env.OPENAI_API_KEY || !modelBaseURL(c)) {
    await modelAudit(DB, {
      userId,
      requestId: `model_${randHex(16)}`,
      route: 'hermes:chat',
      eventType: 'offline',
      inputChars: message.length,
    })
    return c.json({ error: 'MODEL SERVICE OFFLINE' }, 503)
  }

  const briefing = await hermesBriefing(DB, userId, today)
  const history = ((await DB.prepare(
    `SELECT role, content FROM hermes_messages WHERE user_id=? ORDER BY id DESC LIMIT 12`,
  ).bind(userId).all()).results as any[]).reverse()
  const transcript = history.map((item: any) => ({
    role: String(item.role),
    content: String(item.content),
  }))
  const externalMessages = transcript.filter((item) =>
    item.content.startsWith(EXTERNAL_MESSAGE_PREFIX))
  const journalMessages = transcript.filter((item) =>
    !item.content.startsWith(EXTERNAL_MESSAGE_PREFIX))
  const result = await callModel(c, 'hermes:chat', [
    { role: 'user', content: `USER REQUEST:\n${message}` },
    {
      role: 'user',
      content: fencedModelData('RETRIEVED_SOURCE_CONTENT', briefing),
    },
    {
      role: 'user',
      content: fencedModelData(
        'PERSONAL_JOURNAL_CONTENT',
        journalMessages.map((item) => `[${item.role}] ${item.content}`).join('\n'),
      ),
    },
    {
      role: 'user',
      content: fencedModelData(
        'QUOTED_EXTERNAL_MESSAGES',
        externalMessages.map((item) =>
          `[${item.role}] ${item.content.slice(EXTERNAL_MESSAGE_PREFIX.length)}`)
          .join('\n'),
      ),
    },
  ])
  if (result.response) return result.response

  await DB.batch([
    DB.prepare(
      `INSERT INTO hermes_messages (user_id, role, content, context_date)
       VALUES (?, 'user', ?, ?)`,
    ).bind(userId, message, today),
    DB.prepare(
      `INSERT INTO hermes_messages (user_id, role, content, context_date)
       VALUES (?, 'assistant', ?, ?)`,
    ).bind(userId, result.answer, today),
  ])
  return c.json({ answer: result.answer })
}))

app.get('/api/hermes/history', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM hermes_messages WHERE user_id=? ORDER BY id DESC LIMIT 40`,
  ).bind(c.get('userId')).all()
  return c.json((results as any[]).reverse())
})

// Morning war council: Hermes proactively reviews the file and issues the day's orders
app.post('/api/hermes/council', async (c) => withIdempotency(c, 'hermes:council', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { date } = await parseJson(c, councilBodySchema)
  const today = await safeDate(DB, date, userId)
  if (!c.env.OPENAI_API_KEY || !modelBaseURL(c)) {
    await modelAudit(DB, {
      userId,
      requestId: `model_${randHex(16)}`,
      route: 'hermes:council',
      eventType: 'offline',
    })
    return c.json({ error: 'MODEL SERVICE OFFLINE' }, 503)
  }
  const briefing = await hermesBriefing(DB, userId, today)
  const result = await callModel(c, 'hermes:council', [
    {
      role: 'user',
      content: `USER REQUEST:\nConvene the war council for ${today}. Deliver: 1) STATE OF THE COMMANDER — the single most important pattern in recent data, with evidence. 2) THREAT ASSESSMENT — the biggest current vulnerability. 3) COMMENDATION — one real win to build on. 4) TODAY'S ORDERS — the one concrete move that matters most today. Keep it under 300 words.`,
    },
    {
      role: 'user',
      content: fencedModelData('RETRIEVED_SOURCE_CONTENT', briefing),
    },
  ])
  if (result.response) return result.response
  await DB.prepare(
    `INSERT INTO hermes_messages (user_id, role, content, context_date)
     VALUES (?, 'assistant', ?, ?)`,
  ).bind(
    userId,
    `[MORNING WAR COUNCIL ${today}]\n${result.answer}`,
    today,
  ).run()
  return c.json({ answer: result.answer })
}))

// Hermes analysis of a specific intel entry
app.post('/api/intel/:id/analyze', async (c) => withIdempotency(c, 'intel:analyze', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  await parseEmptyBody(c)
  const entry = await DB.prepare(
    `SELECT * FROM intel_entries WHERE id=? AND user_id=?`,
  ).bind(id, userId).first<any>()
  if (!entry) return c.json({ error: 'No such entry' }, 404)
  if (!c.env.OPENAI_API_KEY || !modelBaseURL(c)) {
    await modelAudit(DB, {
      userId,
      requestId: `model_${randHex(16)}`,
      route: 'intel:analyze',
      eventType: 'offline',
    })
    return c.json({ error: 'MODEL SERVICE OFFLINE' }, 503)
  }
  const untrustedEntry = JSON.stringify({
    domain: entry.domain,
    title: entry.title,
    situation: entry.situation,
    myMove: entry.my_move,
    outcome: entry.outcome,
    people: entry.people,
  })
  if (untrustedEntry.length > MODEL_USER_INPUT_CHARS) {
    return c.json({ error: 'MODEL INPUT TOO LARGE' }, 413)
  }
  const result = await callModel(c, 'intel:analyze', [
    {
      role: 'user',
      content: `USER REQUEST:\nAnalyze the separately fenced move. Give: 1) VERDICT (smart/dumb/mixed). 2) THE PRINCIPLE — the exact applicable Sun Tzu, Machiavelli, or Stoic principle. 3) THE MASTER MOVE. 4) THE PATTERN WARNING. Max 200 words.`,
    },
    {
      role: 'user',
      content: fencedModelData('RETRIEVED_SOURCE_CONTENT', untrustedEntry),
    },
  ])
  if (result.response) return result.response
  await DB.prepare(
    `UPDATE intel_entries SET hermes_analysis=? WHERE id=? AND user_id=?`,
  ).bind(result.answer, id, userId).run()
  return c.json({ analysis: result.answer })
}))

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

// Full situational briefing for the agent (text + structured JSON)
app.post('/api/agent/v1/briefing', async (c) => {
  await parseEmptyBody(c)
  const userId = c.get('userId')
  const DB = c.env.DB
  const { date, time } = await userNow(DB, userId) // server clock; reads never run engines
  const briefing = await hermesBriefing(DB, userId, date)
  const blocks = await blocksForDate(DB, userId, date)
  const current = blocks.find((b: any) => b.start_time <= time && time < b.end_time) || null
  const next = blocks.find((b: any) => b.start_time > time) || null
  const flags = (await DB.prepare(
    `SELECT * FROM honesty_flags WHERE user_id=? AND acknowledged=0`,
  ).bind(userId).all()).results
  return c.json({ date, briefing, current, next, adherence: dayAdherence(blocks), flags, blocks })
})

// What needs attention RIGHT NOW (for the agent's watch loop → Telegram/termux-notification)
app.post('/api/agent/v1/pending', async (c) => {
  await parseEmptyBody(c)
  const userId = c.get('userId')
  const DB = c.env.DB
  const { date, time } = await userNow(DB, userId) // server clock; reads never run engines
  const blocks = await blocksForDate(DB, userId, date)
  const overdue = blocks.filter((b: any) => b.end_time <= time && !b.log_status)
  const current = blocks.find((b: any) => b.start_time <= time && time < b.end_time) || null
  const flags = (await DB.prepare(
    `SELECT * FROM honesty_flags WHERE user_id=? AND acknowledged=0 ORDER BY created_at DESC`,
  ).bind(userId).all()).results
  const debriefToday = await DB.prepare(
    `SELECT id FROM debriefs WHERE user_id=? AND log_date=?`,
  ).bind(userId, date).first()
  const dueCards = await DB.prepare(
    `SELECT COUNT(*) n FROM flashcards WHERE user_id=? AND due_date<=?`,
  ).bind(userId, date).first<any>()
  return c.json({
    date, time,
    current_block: current ? { id: current.id, title: current.title, start: current.start_time, end: current.end_time, status: current.log_status } : null,
    overdue_unlogged: overdue.map((b: any) => ({ id: b.id, title: b.title, end: b.end_time, non_negotiable: !!b.is_non_negotiable })),
    unacknowledged_flags: flags,
    debrief_filed_today: !!debriefToday,
    flashcards_due: dueCards?.n ?? 0
  })
})

app.post('/api/agent/v1/debriefs', async (c) => {
  await parseEmptyBody(c)
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM debriefs WHERE user_id=? ORDER BY log_date DESC LIMIT 60`,
  ).bind(c.get('userId')).all()
  return c.json(results)
})

app.post('/api/agent/v1/intel/read', async (c) => {
  await parseEmptyBody(c)
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM intel_entries WHERE user_id=?
     ORDER BY log_date DESC, id DESC LIMIT 100`,
  ).bind(c.get('userId')).all()
  return c.json(results)
})

// Agent auto-journals anything it observes: intel, debrief updates, block check-offs
app.post('/api/agent/v1/intel', async (c) => withIdempotency(c, 'agent:intel', async () => {
  const userId = c.get('userId')
  const b = await parseJson(c, agentIntelBodySchema)
  const r = await c.env.DB.prepare(
    `INSERT INTO intel_entries
       (user_id, log_date, domain, title, situation, my_move, outcome, verdict,
        principle_used, lesson, people, hermes_analysis)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(userId, await safeDate(c.env.DB, b.log_date, userId),
    b.domain, '[HERMES] ' + b.title, b.situation || null,
    b.my_move || null, b.outcome || null, b.verdict || 'pending', b.principle_used || null,
    b.lesson || null, b.people || null, b.analysis || null).run()
  return c.json({ ok: true, id: r.meta.last_row_id })
}))

app.post('/api/agent/v1/debrief', async (c) => withIdempotency(c, 'agent:debrief', async () => {
  const userId = c.get('userId')
  const DB = c.env.DB
  const b = await parseJson(c, agentDebriefBodySchema)
  const date = await safeDate(DB, b.date, userId)
  const prev = await DB.prepare(
    `SELECT * FROM debriefs WHERE user_id=? AND log_date=?`,
  ).bind(userId, date).first<any>()
  const merge = (a: string | null | undefined, x: string | null | undefined) =>
    x ? (a ? a + '\n[HERMES] ' + x : '[HERMES] ' + x) : (a ?? null)
  const values = [
    merge(prev?.wins, b.wins),
    merge(prev?.breaks, b.breaks),
    merge(prev?.tomorrow_targets, b.tomorrow_targets),
    merge(prev?.strategy_insight, b.strategy_insight),
    b.mood ?? prev?.mood ?? null,
    b.energy ?? prev?.energy ?? null,
    b.sleep_time ?? prev?.sleep_time ?? null,
    b.wake_time ?? prev?.wake_time ?? null,
    b.sleep_hours ?? prev?.sleep_hours ?? null,
  ]
  if (prev) {
    await DB.prepare(
      `UPDATE debriefs SET wins=?, breaks=?, tomorrow_targets=?, strategy_insight=?,
         mood=?, energy=?, sleep_time=?, wake_time=?, sleep_hours=?
       WHERE id=? AND user_id=?`,
    ).bind(...values, prev.id, userId).run()
  } else {
    await DB.prepare(
      `INSERT INTO debriefs
         (user_id, log_date, wins, breaks, tomorrow_targets, strategy_insight,
          mood, energy, sleep_time, wake_time, sleep_hours)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(userId, date, ...values).run()
  }
  return c.json({ ok: true })
}))

app.post('/api/agent/v1/block-log', async (c) => withIdempotency(c, 'agent:block-log', async () => {
  const userId = c.get('userId')
  const DB = c.env.DB
  const { block_id, date, status, note } =
    await parseJson(c, agentBlockLogBodySchema)
  const block = await DB.prepare(
    `SELECT id FROM schedule_blocks WHERE id=? AND user_id=?`,
  ).bind(block_id, userId).first()
  if (!block) return c.json({ error: 'no such block' }, 404)
  const logDate = await safeDate(DB, date, userId)
  const existing = await DB.prepare(
    `SELECT id, status FROM block_logs
     WHERE user_id=? AND block_id=? AND log_date=?`,
  ).bind(userId, block_id, logDate).first<{
    id: number
    status: string
  }>()
  if (existing?.status === 'missed') {
    return c.json({ error: 'WINDOW CLOSED. Auto-missed blocks require an appeal.' }, 409)
  }
  if (existing) {
    await DB.prepare(
      `UPDATE block_logs SET status=?, note=?, completed_at=datetime('now')
       WHERE id=? AND user_id=?`,
    ).bind(status, note ? '[HERMES] ' + note : null, existing.id, userId).run()
  } else {
    await DB.prepare(
      `INSERT INTO block_logs
         (user_id, block_id, log_date, status, note, completed_at)
       VALUES (?,?,?,?,?,datetime('now'))`,
    ).bind(userId, block_id, logDate, status, note ? '[HERMES] ' + note : null).run()
  }
  return c.json({ ok: true })
}))

// Agent posts its counsel into the app's Council log (visible in the COUNCIL tab)
app.post('/api/agent/v1/message', async (c) => withIdempotency(c, 'agent:message', async () => {
  const userId = c.get('userId')
  const { content, role } = await parseJson(c, agentMessageBodySchema)
  await c.env.DB.prepare(
    `INSERT INTO hermes_messages (user_id, role, content, context_date)
     VALUES (?,?,?,?)`,
  ).bind(userId, role === 'user' ? 'user' : 'assistant',
    EXTERNAL_MESSAGE_PREFIX + content,
    (await userNow(c.env.DB, userId)).date).run()
  return c.json({ ok: true })
}))

// Everything endpoint: full DB export for the credential owner only.
app.post('/api/agent/v1/export', async (c) => {
  await parseEmptyBody(c)
  const userId = c.get('userId')
  const DB = c.env.DB
  const out: Record<string, any> = {}
  for (const t of ['debriefs', 'intel_entries', 'honesty_flags', 'points_ledger', 'unit_progress', 'book_progress', 'law_checks', 'maxims']) {
    out[t] = (await DB.prepare(`SELECT * FROM ${t} WHERE user_id=?`).bind(userId).all()).results
  }
  return c.json(out)
})

// ============ PWA MANIFEST + SERVICE WORKER ============
app.get('/manifest.json', (c) => c.json(MANIFEST))

app.get('/sw.js', (c) =>
  new Response(SERVICE_WORKER, { headers: { 'Content-Type': 'application/javascript' } }))

// ============ SHELL ============
app.get('/', (c) => c.html(SHELL_HTML))

export default app
