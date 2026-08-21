// Book 7 refactor — the authentication routes (Book 5.2): the only
// unauthenticated API surface (setup/login/logout/status). Registered BEFORE
// the /api/* guard so the gate itself is reachable. Session lifecycle helpers
// come from ../auth; password hashing/CSRF from ../crypto.
import { Hono } from 'hono'
import { getCookie, deleteCookie } from 'hono/cookie'
import type { Bindings, Variables } from '../env'
import { parseJson, parseEmptyBody } from '../validation'
import { passwordBodySchema } from '../schemas'
import { pbkdf2, csrfToken, timingSafeEq, randHex } from '../crypto'
import { ownerUser, sessionValid, findSession, issueSession, revokePresentedSession, sessionCookie } from '../auth'

async function claimUnownedData(DB: D1Database, userId: number): Promise<void> {
  const tables = [
    'schedule_blocks', 'block_logs', 'debriefs', 'unit_progress', 'maxims',
    'flashcards', 'card_reviews', 'honesty_flags', 'points_ledger',
    'reward_redemptions', 'law_checks', 'settings', 'intel_entries',
    'book_progress', 'hermes_messages', 'responses', 'response_srs',
    'tongue_reviews', 'tongue_exams', 'day_summary', 'predictions',
    'appeals', 'load_reductions',
    // Book 7 unified tables — must be claimed too, else a rollback-era unowned
    // row backfilled into captures would never adopt the owner and would vanish
    // from the owner-filtered reads.
    'captures', 'review_items', 'exams',
  ]
  await DB.batch(tables.map((table) =>
    DB.prepare(`UPDATE ${table} SET user_id=? WHERE user_id IS NULL`).bind(userId),
  ))
}

export function registerAuthRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {
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
}
