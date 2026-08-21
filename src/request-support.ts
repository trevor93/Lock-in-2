// Book 7 refactor — request-time support (Books 5.7 and 13.2).
// The alternative-explanation brake (isNonePlausible/altGate/recordAltExplanation),
// the request-id reader, metadata-only audit-event append, and the delivery
// idempotency arbiter (withIdempotency) — the cross-cutting helpers the routes
// use to stay honest and non-duplicating. Depends only on zod + the passed
// Hono context / D1 handle.
import { z } from 'zod'

// ============ BOOK 13.2 — ALTERNATIVE-EXPLANATION GATE ============

// "None plausible" (in any of its plain spellings) is legal but is the paranoia
// tell — a rising count is what the operator must be able to watch.
export function isNonePlausible(text: string): boolean {
  return /^\s*none(\s+plausible)?\.?\s*$/i.test(text)
}

// The brake, in application form (the DB trigger is the backstop). A capture
// whose heat is anything other than calm requires a non-empty
// alternative_explanation. Returns an error Response to send, or null to pass.
export function altGate(c: any, heat: string | undefined, alt: string | null | undefined): Response | null {
  if (heat && heat !== 'calm' && !(alt && alt.trim())) {
    return c.json({ error: 'ALTERNATIVE EXPLANATION REQUIRED' }, 400)
  }
  return null
}

// Record one brake row, counting the "none plausible" tell. Best-effort; the
// consequence has already been written.
export async function recordAltExplanation(
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
export const requestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,200}$/)

export function requestId(c: any): string | null {
  const raw = c.req.header('x-request-id')
  if (!raw) return null
  const parsed = requestIdSchema.safeParse(raw.trim())
  return parsed.success ? parsed.data : null
}

export type ActorType = 'user' | 'agent' | 'cron' | 'system'

// Metadata-only audit append. Callers pass already-safe values; nothing here
// records credentials, prompts, or model output. Failure to audit never breaks
// the user's action — the consequence has already been applied.
export async function auditEvent(
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
export async function withIdempotency(
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
