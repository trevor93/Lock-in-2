// Book 7 refactor — agent authentication (Book 5.5), the middleware/agent-auth
// layer. Scope list, credential body schema, the append-only credential-event
// recorder, coarse-network derivation, the versioned-route map + resolver, the
// hashed-credential verifier (rate limit, expiry, revocation), and raw-token
// minting. The /api/* guard in index.tsx composes these; the credential routes
// live in routes/agent-credentials.
import { z } from 'zod'
import { requiredTrimmedText } from './schemas'
import { sha256, randHex } from './crypto'

export const AGENT_SCOPES = [
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
export const DEFAULT_AGENT_SCOPES = AGENT_SCOPES.filter(
  (scope) => scope !== 'export:read',
)
export const agentScopeSchema = z.enum(AGENT_SCOPES)
export const agentCredentialBodySchema = z.strictObject({
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




export type AgentCredentialRecord = {
  id: number
  user_id: number
  scopes: string
  expires_at: string
  revoked_at: string | null
  rate_window_started_at: string | null
  rate_window_count: number
}

export const AGENT_RATE_LIMIT = 60
export const AGENT_RATE_WINDOW_SECONDS = 60

export function coarseNetwork(value: string | undefined): string | null {
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

export function agentRequestMetadata(c: any): {
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

export async function agentCredentialEvent(
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

export async function consumeAgentRateLimit(
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

export async function authenticateAgent(c: any): Promise<Response | null> {
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

export function agentRoute(
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

export const AGENT_V1_PATHS = new Set([
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

export function genAgentToken(): string {
  return `wr_agent_v1_${randHex(32)}`
}
