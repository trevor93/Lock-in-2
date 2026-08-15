import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'

const baseEnv = {
  DB: env.DB,
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: 'https://model.invalid',
}

async function passwordHash(
  password: string,
  saltHex: string,
): Promise<string> {
  const salt = new Uint8Array(
    saltHex.match(/.{2}/g)!.map((hex) => Number.parseInt(hex, 16)),
  )
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: 100000,
    },
    key,
    256,
  )
  return [...new Uint8Array(bits)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function authenticatedHeaders(): Promise<Record<string, string>> {
  const password = 'validation-test-password'
  const salt = '8899aabbccddeeff0011223344556677'
  await env.DB.prepare(
    `UPDATE users
     SET password_hash=?, password_salt=?, failed_login_count=0,
         locked_until=NULL
     WHERE role='owner'`,
  ).bind(
    await passwordHash(password, salt),
    salt,
  ).run()

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
  const body = await response.json<{ csrfToken: string }>()
  expect(setCookie).toBeTruthy()
  expect(body.csrfToken).toMatch(/^[a-f0-9]{64}$/)

  return {
    Cookie: setCookie!.split(';', 1)[0],
    'Content-Type': 'application/json',
    'X-CSRF-Token': body.csrfToken,
  }
}

async function predictionCount(claim: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM predictions WHERE claim=?`,
  ).bind(claim).first<{ total: number }>()
  return row?.total ?? 0
}

describe('Book 5.4 strict request validation', () => {
  it('returns controlled 400 responses for malformed JSON', async () => {
    const headers = await authenticatedHeaders()
    const response = await app.request(
      '/api/predictions',
      {
        method: 'POST',
        headers,
        body: '{"claim":',
      },
      baseEnv,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'VALIDATION FAILED',
    })
  })

  it('rejects unknown and mass-assignment fields without writing', async () => {
    const headers = await authenticatedHeaders()
    const claim = 'A unique strict-validation prediction claim'
    const before = await predictionCount(claim)
    const response = await app.request(
      '/api/predictions',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          claim,
          confidence: 75,
          resolve_by: '2999-12-31',
          domain: 'work',
          user_id: 999,
        }),
      },
      baseEnv,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'VALIDATION FAILED',
    })
    expect(await predictionCount(claim)).toBe(before)
  })

  it.each([
    '/api/flags/0/ack',
    '/api/flags/-1/ack',
    '/api/flags/not-a-number/ack',
    '/api/flags/1.5/ack',
    '/api/flags/9007199254740993/ack',
  ])('rejects invalid route identifier %s', async (path) => {
    const headers = await authenticatedHeaders()
    const response = await app.request(
      path,
      {
        method: 'POST',
        headers,
        body: '{}',
      },
      baseEnv,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'VALIDATION FAILED',
    })
  })

  it.each([
    { confidence: 75.5, resolve_by: '2999-12-31' },
    { confidence: 100, resolve_by: '2999-12-31' },
    { confidence: 75, resolve_by: '2999-02-31' },
  ])('rejects invalid prediction ranges and dates: %j', async (invalid) => {
    const headers = await authenticatedHeaders()
    const response = await app.request(
      '/api/predictions',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          claim: 'This invalid prediction must never be persisted',
          domain: '',
          ...invalid,
        }),
      },
      baseEnv,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'VALIDATION FAILED',
    })
  })

  it('rejects invalid date queries instead of silently using today', async () => {
    const headers = await authenticatedHeaders()
    const response = await app.request(
      '/api/stats?date=not-a-date',
      { headers },
      baseEnv,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'VALIDATION FAILED',
    })
  })

  it('rejects invalid time fields', async () => {
    const headers = await authenticatedHeaders()
    const response = await app.request(
      '/api/debrief',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          date: '2026-08-15',
          wins: 'Validation work progressed.',
          tomorrow_targets: 'Finish strict validation.',
          sleep_time: '25:00',
        }),
      },
      baseEnv,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'VALIDATION FAILED',
    })
  })

  it('rejects fields on empty-body mutations', async () => {
    const headers = await authenticatedHeaders()
    const owner = await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
    ).first<{ id: number }>()
    const inserted = await env.DB.prepare(
      `INSERT INTO honesty_flags
         (user_id, flag_date, flag_type, severity, message)
       VALUES (?,?,?,?,?)`,
    ).bind(
      owner!.id,
      '2026-08-15',
      'validation_test',
      'warn',
      'Strict request validation fixture',
    ).run()

    const response = await app.request(
      `/api/flags/${inserted.meta.last_row_id}/ack`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ user_id: 999 }),
      },
      baseEnv,
    )

    expect(response.status).toBe(400)
    const row = await env.DB.prepare(
      `SELECT acknowledged FROM honesty_flags WHERE id=?`,
    ).bind(inserted.meta.last_row_id).first<{ acknowledged: number }>()
    expect(row?.acknowledged).toBe(0)
  })

  it('accepts a valid representative prediction', async () => {
    const headers = await authenticatedHeaders()
    const claim = 'A valid prediction survives strict parsing'
    const response = await app.request(
      '/api/predictions',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          claim,
          confidence: 75,
          resolve_by: '2999-12-31',
          domain: 'work',
        }),
      },
      baseEnv,
    )

    expect(response.status).toBe(200)
    expect(await predictionCount(claim)).toBe(1)
  })
})
