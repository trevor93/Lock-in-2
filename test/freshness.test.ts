import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import app from '../src/index'
import clientSource from '../public/static/app.js?raw'
import alarmSource from '../public/static/app5.js?raw'

const baseEnv = {
  DB: env.DB,
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: 'https://model.invalid',
  OPENAI_ALLOWED_BASE_URLS: 'https://model.invalid',
}

async function passwordHash(password: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(
    saltHex.match(/.{2}/g)!.map((hex) => Number.parseInt(hex, 16)),
  )
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256,
  )
  return [...new Uint8Array(bits)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

let headers: Record<string, string>
let userId: number

beforeAll(async () => {
  const password = 'freshness-test-password'
  const salt = '11223344556677889900112233445566'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0,
       locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash(password, salt), salt).run()
  const response = await app.request(
    '/api/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    },
    baseEnv,
  )
  expect(response.status).toBe(200)
  const cookie = response.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await response.json<{ csrfToken: string }>()
  const owner = await env.DB.prepare(
    `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
  ).first<{ id: number }>()
  userId = owner!.id
  headers = {
    Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken,
  }
})

describe('Book 6 version endpoint', () => {
  it('requires a session', async () => {
    const response = await app.request('/api/version', {}, baseEnv)
    expect(response.status).toBe(401)
  })

  it('returns a version and a weak ETag', async () => {
    const response = await app.request('/api/version', { headers }, baseEnv)
    expect(response.status).toBe(200)
    const etag = response.headers.get('etag')
    expect(etag, 'no ETag issued').toBeTruthy()
    expect(etag).toMatch(/^W\//)
    const body = await response.json<{ version: string; date: string }>()
    expect(body.version).toBeTruthy()
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(etag).toContain(body.version)
  })

  it('answers 304 with no body when nothing changed', async () => {
    // The version embeds the civil minute by design (a block boundary or
    // midnight rollover must invalidate it), so a pair of requests that
    // straddles a minute tick will legitimately differ. Re-pair once so the
    // test asserts the 304 contract deterministically rather than racing the
    // clock.
    let second: Response | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const first = await app.request('/api/version', { headers }, baseEnv)
      const etag = first.headers.get('etag')!
      second = await app.request(
        '/api/version',
        { headers: { ...headers, 'If-None-Match': etag } },
        baseEnv,
      )
      if (second.status === 304) break
    }
    expect(second!.status).toBe(304)
    expect(await second!.text()).toBe('')
  })

  it('changes the version when a consequence is written', async () => {
    const before = await app.request('/api/version', { headers }, baseEnv)
    const beforeVersion = (await before.json<{ version: string }>()).version

    await env.DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason)
       VALUES (?, '2026-08-14', 1, 'FRESHNESS FIXTURE')`,
    ).bind(userId).run()

    const after = await app.request('/api/version', { headers }, baseEnv)
    const afterVersion = (await after.json<{ version: string }>()).version
    expect(afterVersion, 'a new ledger row did not move the version')
      .not.toBe(beforeVersion)

    // And the stale ETag must no longer validate.
    const revalidate = await app.request(
      '/api/version',
      { headers: { ...headers, 'If-None-Match': `W/"${beforeVersion}"` } },
      baseEnv,
    )
    expect(revalidate.status).toBe(200)
  })

  it('costs far fewer statements than a full state build', async () => {
    let versionCount = 0
    let stateCount = 0
    const wrap = (tally: () => void) => ({
      prepare(sql: string) { tally(); return env.DB.prepare(sql) },
      batch(s: unknown[]) { for (let i = 0; i < s.length; i++) tally(); return (env.DB as any).batch(s) },
    } as unknown as D1Database)

    await app.request('/api/version', { headers }, { ...baseEnv, DB: wrap(() => { versionCount++ }) })
    await app.request('/api/state', { headers }, { ...baseEnv, DB: wrap(() => { stateCount++ }) })

    expect(versionCount, `version=${versionCount} state=${stateCount}`)
      .toBeLessThan(stateCount)
  })

  it('performs no writes', async () => {
    const count = async () => {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM points_ledger WHERE user_id=?`,
      ).bind(userId).first<{ n: number }>()
      return row?.n ?? 0
    }
    const before = await count()
    for (let i = 0; i < 5; i++) {
      await app.request('/api/version', { headers }, baseEnv)
    }
    expect(await count()).toBe(before)
  })
})

describe('Book 6 polling removal', () => {
  it('no longer runs an unconditional 60s state poll', () => {
    // The documented defect was a fixed-interval refresh regardless of change.
    expect(clientSource).not.toMatch(
      /setInterval\([^)]*loadState[\s\S]{0,120}?60000/,
    )
  })

  it('refreshes on focus, visibility and reconnect instead', () => {
    expect(clientSource).toMatch(/addEventListener\('focus'/)
    expect(clientSource).toMatch(/visibilitychange/)
    expect(clientSource).toMatch(/addEventListener\('online'/)
  })

  it('checks freshness through the conditional version probe', () => {
    expect(clientSource).toMatch(/If-None-Match/)
    expect(clientSource).toMatch(/\/api\/version/)
  })

  it('schedules a wake at the next block boundary', () => {
    expect(clientSource).toMatch(/scheduleBoundaryCheck/)
  })

  it('keeps the countdown local so the clock needs no network', () => {
    // A 1s ticker that only writes textContent — no fetch inside it.
    expect(clientSource).toMatch(/block-countdown/)
    expect(clientSource).toMatch(/}, 1000\)/)
  })

  it('routes the alarm ticker refresh through the same version gate', () => {
    expect(alarmSource).toMatch(/refreshIfStale/)
    // The alarm keeps its own local 60s clock for ringing bells, which costs
    // no network; what must not remain is an unconditional state fetch.
    expect(alarmSource).not.toMatch(/^\s*loadState\(\)\.then/m)
  })
})
