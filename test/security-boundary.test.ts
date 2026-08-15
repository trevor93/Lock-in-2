import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'

const baseEnv = {
  DB: env.DB,
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: 'https://model.invalid',
}

async function passwordHash(password: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((hex) => Number.parseInt(hex, 16)))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    key,
    256,
  )
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

type AuthenticatedSession = {
  cookie: string
  csrfToken?: string
}

async function authenticatedSession(): Promise<AuthenticatedSession> {
  const password = 'test-password-only'
  const salt = '00112233445566778899aabbccddeeff'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
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
  const setCookie = response.headers.get('set-cookie')
  expect(setCookie).toBeTruthy()
  const body = await response.json<{ csrfToken?: string }>()
  return {
    cookie: setCookie!.split(';', 1)[0],
    csrfToken: body.csrfToken,
  }
}

describe('private response boundary', () => {
  it('rejects disallowed browser origins without wildcard CORS', async () => {
    const response = await app.request(
      '/api/auth/status',
      { headers: { Origin: 'https://attacker.example' } },
      baseEnv,
    )

    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).not.toBe('*')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('allows same-origin browser requests and explicitly configured origins', async () => {
    const sameOrigin = await app.request(
      'https://warroom.test/api/auth/status',
      { headers: { Origin: 'https://warroom.test' } },
      baseEnv,
    )
    expect(sameOrigin.status).toBe(200)
    expect(sameOrigin.headers.get('access-control-allow-origin')).toBe('https://warroom.test')

    const configured = await app.request(
      'https://warroom.test/api/auth/status',
      { headers: { Origin: 'https://trusted.example' } },
      { ...baseEnv, ALLOWED_ORIGINS: 'https://trusted.example' },
    )
    expect(configured.status).toBe(200)
    expect(configured.headers.get('access-control-allow-origin')).toBe('https://trusted.example')
    expect(configured.headers.get('access-control-allow-credentials')).toBe('true')
    expect(configured.headers.get('vary')).toContain('Origin')
  })

  it('answers allowlisted browser preflight without opening wildcard CORS', async () => {
    const response = await app.request(
      'https://warroom.test/api/tick',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://trusted.example',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type,x-csrf-token',
        },
      },
      { ...baseEnv, ALLOWED_ORIGINS: 'https://trusted.example' },
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://trusted.example')
    expect(response.headers.get('access-control-allow-origin')).not.toBe('*')
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
    expect(response.headers.get('access-control-allow-headers')).toContain('X-CSRF-Token')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('marks private success and error responses no-store and protects calendar export', async () => {
    const authStatus = await app.request('/api/auth/status', {}, baseEnv)
    expect(authStatus.status).toBe(200)
    expect(authStatus.headers.get('cache-control')).toBe('no-store')

    const deniedState = await app.request('/api/state', {}, baseEnv)
    expect(deniedState.status).toBe(401)
    expect(deniedState.headers.get('cache-control')).toBe('no-store')

    const deniedCalendar = await app.request('/calendar.ics', {}, baseEnv)
    expect(deniedCalendar.status).toBe(401)
    expect(deniedCalendar.headers.get('cache-control')).toBe('no-store')

    const { cookie } = await authenticatedSession()
    const calendar = await app.request('/calendar.ics', { headers: { Cookie: cookie } }, baseEnv)
    expect(calendar.status).toBe(200)
    expect(calendar.headers.get('cache-control')).toBe('no-store')
  })
})

describe('Book 5.4 browser boundary hardening', () => {
  it('returns CSRF proof when restoring a valid browser session', async () => {
    const { cookie, csrfToken } = await authenticatedSession()
    const response = await app.request(
      '/api/auth/status',
      { headers: { Cookie: cookie } },
      baseEnv,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      setup: true,
      authed: true,
      csrfToken,
    })
  })

  it('sets the required hardening headers on shell and private responses', async () => {
    const shell = await app.request('/', {}, baseEnv)
    const deniedApi = await app.request('/api/state', {}, baseEnv)

    for (const response of [shell, deniedApi]) {
      const csp = response.headers.get('content-security-policy')
      expect(csp).toContain("frame-ancestors 'none'")
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
      expect(response.headers.get('permissions-policy')).toContain('camera=()')
      expect(response.headers.get('permissions-policy')).toContain('microphone=()')
      expect(response.headers.get('permissions-policy')).toContain('geolocation=()')
    }
    expect(deniedApi.headers.get('cache-control')).toBe('no-store')
  })

  it('requires the issued CSRF proof for cookie-authenticated mutations', async () => {
    const { cookie, csrfToken } = await authenticatedSession()
    expect(csrfToken).toMatch(/^[a-f0-9]{64}$/)

    const missing = await app.request(
      'https://warroom.test/api/tick',
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: 'https://warroom.test',
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
      baseEnv,
    )
    expect(missing.status).toBe(403)
    await expect(missing.json()).resolves.toMatchObject({ error: 'CSRF VALIDATION FAILED' })

    const invalid = await app.request(
      'https://warroom.test/api/tick',
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: 'https://warroom.test',
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'wrong-token',
        },
        body: '{}',
      },
      baseEnv,
    )
    expect(invalid.status).toBe(403)

    const accepted = await app.request(
      'https://warroom.test/api/tick',
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: 'https://warroom.test',
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken!,
        },
        body: '{}',
      },
      baseEnv,
    )
    expect(accepted.status).toBe(200)
  })

  it('rejects oversized JSON before authenticated route parsing', async () => {
    const { cookie, csrfToken } = await authenticatedSession()
    const response = await app.request(
      'https://warroom.test/api/tick',
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: 'https://warroom.test',
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken!,
        },
        body: JSON.stringify({ tz: 'x'.repeat(65 * 1024) }),
      },
      baseEnv,
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({ error: 'PAYLOAD TOO LARGE' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

describe('internal enforcement entry', () => {
  it('is POST-only and rejects missing or invalid internal credentials', async () => {
    const configuredEnv = { ...baseEnv, ENFORCEMENT_JOB_SECRET: 'test-internal-secret' }

    const getResponse = await app.request('/internal/jobs/enforcement', {}, configuredEnv)
    expect(getResponse.status).toBe(404)
    expect(getResponse.headers.get('cache-control')).toBe('no-store')

    const missing = await app.request('/internal/jobs/enforcement', { method: 'POST' }, configuredEnv)
    expect(missing.status).toBe(401)
    expect(missing.headers.get('cache-control')).toBe('no-store')

    const invalid = await app.request(
      '/internal/jobs/enforcement',
      { method: 'POST', headers: { Authorization: 'Bearer wrong-secret' } },
      configuredEnv,
    )
    expect(invalid.status).toBe(401)
  })

  it('runs enforcement with server time and remains consequence-idempotent', async () => {
    const configuredEnv = { ...baseEnv, ENFORCEMENT_JOB_SECRET: 'test-internal-secret' }
    const request = () => app.request(
      '/internal/jobs/enforcement',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-internal-secret',
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
      configuredEnv,
    )

    const first = await request()
    expect(first.status).toBe(200)
    const firstBody = await first.json<{ ok: boolean; date: string }>()
    expect(firstBody.ok).toBe(true)
    expect(firstBody.date).not.toBe('2999-12-31')

    const before = await env.DB.prepare(`SELECT COUNT(*) n FROM honesty_flags`).first<{ n: number }>()
    const pointsBefore = await env.DB.prepare(`SELECT COUNT(*) n FROM points_ledger`).first<{ n: number }>()
    const second = await request()
    expect(second.status).toBe(200)
    const after = await env.DB.prepare(`SELECT COUNT(*) n FROM honesty_flags`).first<{ n: number }>()
    const pointsAfter = await env.DB.prepare(`SELECT COUNT(*) n FROM points_ledger`).first<{ n: number }>()

    expect(after?.n).toBe(before?.n)
    expect(pointsAfter?.n).toBe(pointsBefore?.n)
  })
})
