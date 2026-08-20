// Book 7 refactor — authentication and session management (Book 5.2).
// Durable owner + opaque sessions stored SHA-256-hashed, delivered in host-only
// HttpOnly; Secure; SameSite=Lax cookies with expiry, rotation, revocation, and
// a derived CSRF token. No token is ever stored in localStorage or returned in
// full by a GET.
import { getCookie, setCookie } from 'hono/cookie'
import { sha256, randHex, csrfToken } from './crypto'

export type SessionRecord = {
  id: number
  user_id: number
}

export const SESSION_DAYS = 30

export function sessionCookie(c: any, token: string, maxAge = SESSION_DAYS * 24 * 3600): void {
  setCookie(c, 'wr_session', token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: true,
    path: '/',
    maxAge,
  })
}
export async function findSession(c: any): Promise<SessionRecord | null> {
  const raw = getCookie(c, 'wr_session')
  if (!raw) return null
  const tokenHash = await sha256(raw)
  return (await c.env.DB.prepare(
    `SELECT id, user_id FROM sessions
     WHERE token_hash=? AND revoked_at IS NULL
       AND unixepoch(expires_at) > unixepoch('now')`,
  ).bind(tokenHash).first()) as SessionRecord | null
}
export async function sessionValid(c: any): Promise<boolean> {
  const session = await findSession(c)
  if (!session) return false
  c.set('userId', session.user_id)
  return true
}
export async function revokePresentedSession(c: any): Promise<void> {
  const raw = getCookie(c, 'wr_session')
  if (!raw) return
  await c.env.DB.prepare(
    `UPDATE sessions SET revoked_at=COALESCE(revoked_at, datetime('now')) WHERE token_hash=?`,
  ).bind(await sha256(raw)).run()
}
export async function issueSession(c: any, userId: number, rotatedFromId?: number): Promise<string> {
  const token = randHex(32)
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toISOString()
  await c.env.DB.prepare(
    `INSERT INTO sessions (user_id, token_hash, expires_at, rotated_from_id)
     VALUES (?,?,?,?)`,
  ).bind(userId, await sha256(token), expiresAt, rotatedFromId ?? null).run()
  sessionCookie(c, token)
  return csrfToken(token)
}
export async function ownerUser(DB: D1Database): Promise<{ id: number; password_hash: string; password_salt: string; failed_login_count: number; locked_until: string | null } | null> {
  return DB.prepare(
    `SELECT id, password_hash, password_salt, failed_login_count, locked_until
     FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
  ).first()
}
