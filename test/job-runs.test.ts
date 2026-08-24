import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../src/index'

// Book 7's named `job_runs` table, and the Book 5.3 clause that the internal job path
// leaves audit evidence. The behaviour these tests pin is the one the operator needs:
// a run record exists whether the job was cranked by the Cron Worker or by a browser
// tick, the two are distinguishable, a finished run cannot be rewritten, and no row
// value ever reaches the record.

const JOB_SECRET = 'job-runs-test-secret-value-32-chars'

const baseEnv = {
  DB: env.DB,
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: 'https://model.invalid',
  OPENAI_ALLOWED_BASE_URLS: 'https://model.invalid',
  ENFORCEMENT_JOB_SECRET: JOB_SECRET,
}

async function passwordHash(pw: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)))
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256,
  )
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function login(): Promise<{ cookie: string; csrf: string }> {
  const salt = 'f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0,
       locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash('job-runs-test-pw', salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'job-runs-test-pw' }),
  }, baseEnv)
  expect(res.status).toBe(200)
  const cookie = res.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await res.json<{ csrfToken: string }>()
  return { cookie, csrf: csrfToken }
}

function cron(path: string) {
  return app.request(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${JOB_SECRET}`, 'Content-Type': 'application/json' },
    body: '{}',
  }, baseEnv)
}

async function runsFor(job: string) {
  return (await env.DB.prepare(
    `SELECT * FROM job_runs WHERE job=? ORDER BY id`,
  ).bind(job).all()).results as Array<Record<string, any>>
}

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM job_runs`).run()
})

describe('Book 7 job_runs — the internal job path leaves a run record', () => {
  it('records a completed enforcement run when the Cron Worker calls it', async () => {
    const response = await cron('/internal/jobs/enforcement')
    expect(response.status).toBe(200)

    const runs = await runsFor('enforcement')
    expect(runs.length).toBe(1)
    expect(runs[0].actor_type).toBe('cron')
    expect(runs[0].status).toBe('ok')
    expect(runs[0].finished_at).toBeTruthy()
    expect(runs[0].owners_walked).toBeGreaterThanOrEqual(1)
  })

  it('separates a browser tick from a Cron run, so a dead Cron is visible', async () => {
    const session = await login()
    await env.DB.prepare(`DELETE FROM settings WHERE key='timezone_locked'`).run()
    const tick = await app.request('/api/tick', {
      method: 'POST',
      headers: {
        Cookie: session.cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': session.csrf,
      },
      body: '{}',
    }, baseEnv)
    expect(tick.status).toBe(200)

    const runs = await runsFor('enforcement')
    expect(runs.length).toBe(1)
    expect(runs[0].actor_type, 'a browser tick is not a Cron run').toBe('user')
  })

  it('records an alarms run', async () => {
    const response = await cron('/internal/jobs/alarms')
    // 503 when no VAPID config is present is a real answer from a handler that ran.
    expect([200, 503]).toContain(response.status)
    const runs = await runsFor('alarms')
    expect(runs.length).toBe(1)
    expect(runs[0].actor_type).toBe('cron')
  })

  it('writes no run record for a caller with the wrong secret', async () => {
    const response = await app.request('/internal/jobs/enforcement', {
      method: 'POST',
      headers: { Authorization: 'Bearer not-the-secret', 'Content-Type': 'application/json' },
      body: '{}',
    }, baseEnv)
    expect(response.status).toBe(401)
    expect(await runsFor('enforcement')).toEqual([])
  })

  it('refuses to rewrite a finished run', async () => {
    await cron('/internal/jobs/enforcement')
    const run = (await runsFor('enforcement'))[0]
    await expect(
      env.DB.prepare(`UPDATE job_runs SET status='error' WHERE id=?`).bind(run.id).run(),
    ).rejects.toThrow()
  })

  it('carries counts and never a row value', async () => {
    await cron('/internal/jobs/enforcement')
    const run = (await runsFor('enforcement'))[0]
    // counts_json is counts. If it ever grows a string field it must not be text the
    // commander wrote, so the assertion is on shape: every value is a number.
    const counts = JSON.parse(String(run.counts_json ?? '{}'))
    for (const [key, value] of Object.entries(counts)) {
      expect(typeof value, `counts_json.${key}`).toBe('number')
    }
    expect(String(run.error_class ?? '')).not.toMatch(/SELECT|INSERT|Bearer|password/i)
  })
})
