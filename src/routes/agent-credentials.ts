// Book 7 refactor — the owner-only agent credential routes (Book 5.5): the
// retired master-token endpoints (410), and issue/list/revoke of scoped hashed
// credentials. The owner-session guard runs first (index.tsx). Agent-auth
// primitives come from ../agent-auth.
import { Hono } from 'hono'
import type { Bindings, Variables } from '../env'
import { parseJson, parseValue, parseEmptyBody } from '../validation'
import { positiveIdSchema } from '../schemas'
import { sha256 } from '../crypto'
import {
  type AgentCredentialRecord, agentCredentialBodySchema, DEFAULT_AGENT_SCOPES,
  agentCredentialEvent, coarseNetwork, genAgentToken,
} from '../agent-auth'

export function registerAgentCredentialRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {
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
}
