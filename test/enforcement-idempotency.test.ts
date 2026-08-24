import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import { dowOf } from '../src/time'

// Real duplicate-job idempotency (Book 17 test matrix: "duplicate-job
// idempotency, no duplicate penalty"). Unlike a probe that 401s on the closed
// internal endpoint, this supplies the job secret and runs the enforcement pass
// TWICE against a seeded victory-yesterday, proving the atomic award guards
// cannot double-credit.
const JOB_SECRET = 'enforcement-idempotency-test-secret'
const baseEnv = {
  DB: env.DB,
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: 'https://model.invalid',
  OPENAI_ALLOWED_BASE_URLS: 'https://model.invalid',
  ENFORCEMENT_JOB_SECRET: JOB_SECRET,
}

async function passwordHash(password: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256)
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function ownerSession(): Promise<{ headers: Record<string, string>; userId: number }> {
  const password = 'enf-idem-password'
  const salt = 'c0ffee00c0ffee00c0ffee00c0ffee00'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash(password, salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
  }, baseEnv)
  const cookie = res.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await res.json<{ csrfToken: string }>()
  const owner = await env.DB.prepare(`SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`).first<{ id: number }>()
  return { userId: owner!.id, headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken } }
}

async function serverToday(headers: Record<string, string>): Promise<string> {
  const res = await app.request('/api/state', { headers }, baseEnv)
  return (await res.json<{ date: string }>()).date
}

function addDaysUTC(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

async function runJob(attempt: number): Promise<number> {
  const res = await app.request('/internal/jobs/enforcement', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${JOB_SECRET}`,
      'X-Request-Id': `enf-real-00${attempt}`,
    },
    body: '{}',
  }, baseEnv)
  return res.status
}

async function ledgerRows(userId: number, date: string, refType: string): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM points_ledger WHERE user_id=? AND log_date=? AND ref_type=?`,
  ).bind(userId, date, refType).first<{ n: number }>()
  return r?.n ?? 0
}

describe('Book 17 — duplicate enforcement never double-awards', () => {
  it('authenticates the internal job with the shared secret', async () => {
    // Sanity: without the secret the job is closed; with it, it runs.
    const closed = await app.request('/internal/jobs/enforcement', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }, baseEnv)
    expect(closed.status).toBe(401)
    expect(await runJob(0)).toBe(200)
  })

  it('awards exactly one victory bonus when the job runs twice for the same day', async () => {
    const { headers, userId } = await ownerSession()
    const today = await serverToday(headers)
    const yesterday = addDaysUTC(today, -1)

    // Seed a clean victory-yesterday: an all-days block, logged done, with a
    // debrief filed. Adherence is then 100% and the day qualifies for +30.
    await env.DB.prepare(
      `INSERT INTO schedule_blocks (user_id, sort_order, start_time, end_time, title, category, days, points, weight, is_non_negotiable, is_mvd)
       VALUES (?, 900, '06:00', '07:00', 'ENF IDEM victory block', 'deepwork', 'mon,tue,wed,thu,fri,sat,sun', 20, 3, 1, 1)`,
    ).bind(userId).run()
    const blk = await env.DB.prepare(
      `SELECT id FROM schedule_blocks WHERE user_id=? AND title='ENF IDEM victory block'`,
    ).bind(userId).first<{ id: number }>()
    await env.DB.prepare(
      `INSERT INTO block_logs (user_id, block_id, log_date, status, completed_at)
       VALUES (?,?,?, 'done', datetime('now'))`,
    ).bind(userId, blk!.id, yesterday).run()
    // Yesterday has to be a genuine victory, and "genuine" turns out to depend on the
    // CALENDAR. test/setup.ts seeds one legacy block scheduled `mon` and nothing else, so it
    // enters yesterday's denominator only when yesterday happens to be a Monday. This test
    // seeded a single block of its own, asserted the day was therefore 100%, and so passed six
    // days a week and failed the seventh.
    //
    // Measured, not inferred: green while yesterday was 2026-08-23 (Sun), red the next day
    // with yesterday = 2026-08-24 (Mon), where the unlogged legacy block took WEIGHTED
    // adherence to 3/(3+1) = 75%, below the >= 80% victory threshold in src/enforcement.ts,
    // so the branch under test never ran and the failure read "victory bonus was not awarded
    // on the first pass" — a true statement about a premise the test had failed to establish,
    // not about the idempotency guard it exists to check.
    //
    // A preflight that is red one day in seven teaches an operator to distrust the suite, and
    // the runbook's gate is the only gate this repository has. So every block the app itself
    // considers scheduled yesterday is logged done, using the app's own day predicate from
    // src/repositories.ts rather than a second copy of the weekday rule that could drift from
    // it. Any weekday now yields 100%.
    await env.DB.prepare(
      `INSERT INTO block_logs (user_id, block_id, log_date, status, completed_at)
       SELECT ?, b.id, ?, 'done', datetime('now') FROM schedule_blocks b
       WHERE b.user_id = ? AND (',' || b.days || ',') LIKE ?
         AND NOT EXISTS (
           SELECT 1 FROM block_logs l
           WHERE l.user_id = ? AND l.block_id = b.id AND l.log_date = ?
         )`,
    ).bind(userId, yesterday, userId, `%,${dowOf(yesterday)},%`, userId, yesterday).run()
    await env.DB.prepare(
      `INSERT INTO debriefs (user_id, log_date, wins) VALUES (?,?, 'held the line')`,
    ).bind(userId, yesterday).run()
    // The honesty engine only evaluates a day at/after start_date and skips a
    // day already finalized. Set start_date well back and clear yesterday's
    // summary so the victory branch actually runs; clearing it again before the
    // second pass forces that branch to re-enter, so the atomic INSERT guard —
    // not merely the finalized-skip — is what must prevent the double award.
    const setStart = async () => {
      const row = await env.DB.prepare(
        `SELECT rowid AS r FROM settings WHERE user_id=? AND key='start_date' LIMIT 1`,
      ).bind(userId).first<{ r: number }>()
      if (row) await env.DB.prepare(`UPDATE settings SET value='2026-01-01' WHERE rowid=?`).bind(row.r).run()
      else await env.DB.prepare(`INSERT INTO settings (user_id, key, value) VALUES (?, 'start_date', '2026-01-01')`).bind(userId).run()
    }
    const clearYesterday = () => env.DB.prepare(
      `DELETE FROM day_summary WHERE user_id=? AND summary_date=?`,
    ).bind(userId, yesterday).run()
    await setStart()
    await env.DB.prepare(
      `DELETE FROM points_ledger WHERE user_id=? AND log_date=? AND ref_type IN ('streak','mvd')`,
    ).bind(userId, yesterday).run()

    await clearYesterday()
    expect(await runJob(1)).toBe(200)
    const afterFirst = await ledgerRows(userId, yesterday, 'streak')

    await clearYesterday()               // force the victory branch to run again
    expect(await runJob(2)).toBe(200)
    const afterSecond = await ledgerRows(userId, yesterday, 'streak')

    // The award landed once; the second pass re-entered the branch but the
    // atomic WHERE NOT EXISTS guard refused to double-credit.
    expect(afterFirst, 'victory bonus was not awarded on the first pass').toBe(1)
    expect(afterSecond, 'the second enforcement pass double-awarded the streak bonus').toBe(1)
  })

  it('files no duplicate penalty across repeated enforcement', async () => {
    const { headers, userId } = await ownerSession()
    const today = await serverToday(headers)
    const yesterday = addDaysUTC(today, -1)
    // Run several times; whatever flags/penalties yesterday warrants, their
    // count must not grow with the number of passes.
    await runJob(3)
    const penaltiesAfterOne = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM honesty_flags WHERE user_id=? AND flag_date=?`,
    ).bind(userId, yesterday).first<{ n: number }>()
    await runJob(4)
    await runJob(5)
    const penaltiesAfterMany = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM honesty_flags WHERE user_id=? AND flag_date=?`,
    ).bind(userId, yesterday).first<{ n: number }>()
    expect(penaltiesAfterMany?.n ?? 0).toBe(penaltiesAfterOne?.n ?? 0)
  })
})
