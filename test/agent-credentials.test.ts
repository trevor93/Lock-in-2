import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'

const baseEnv = {
  DB: env.DB,
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: 'https://model.invalid',
}

const DEFAULT_AGENT_SCOPES = [
  'briefing:read',
  'blocks:read',
  'blocks:write',
  'debriefs:read',
  'debriefs:write',
  'intel:read',
  'intel:write',
  'hermes:write',
]

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

async function ownerHeaders(): Promise<Record<string, string>> {
  const password = 'agent-credential-test-password'
  const salt = '0123456789abcdeffedcba9876543210'
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
  const cookie = response.headers.get('set-cookie')
  const body = await response.json<{ csrfToken: string }>()
  return {
    Cookie: cookie!.split(';', 1)[0],
    'Content-Type': 'application/json',
    'X-CSRF-Token': body.csrfToken,
  }
}

type IssuedCredential = {
  id: number
  token: string
  deviceLabel: string
  scopes: string[]
  expiresAt: string
}

async function issueCredential(
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<IssuedCredential> {
  const response = await app.request(
    '/api/agent/credentials',
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
    baseEnv,
  )
  expect(response.status).toBe(201)
  return response.json<IssuedCredential>()
}

function agentHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Agent-Token': token,
  }
}

async function agentRead(path: string, token: string): Promise<Response> {
  return app.request(
    path,
    {
      method: 'POST',
      headers: agentHeaders(token),
      body: '{}',
    },
    baseEnv,
  )
}

describe('Book 5.5 scoped agent credentials', () => {
  it('shows a generated credential once, stores only its hash, and lists safe metadata', async () => {
    const headers = await ownerHeaders()
    const issued = await issueCredential(headers, {
      deviceLabel: 'Termux phone',
      expiresInDays: 30,
    })

    expect(issued.token).toMatch(/^wr_agent_v1_[A-Za-z0-9_-]{40,}$/)
    expect(issued.deviceLabel).toBe('Termux phone')
    expect(issued.scopes).toEqual(DEFAULT_AGENT_SCOPES)
    expect(issued.scopes).not.toContain('export:read')

    const stored = await env.DB.prepare(
      `SELECT token_hash, token_prefix, device_label, scopes
       FROM agent_credentials WHERE id=?`,
    ).bind(issued.id).first<{
      token_hash: string
      token_prefix: string
      device_label: string
      scopes: string
    }>()
    expect(stored?.token_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(stored?.token_hash).not.toBe(issued.token)
    expect(stored?.token_prefix).toBe(issued.token.slice(0, 20))
    expect(stored?.device_label).toBe('Termux phone')
    expect(JSON.parse(stored!.scopes)).toEqual(DEFAULT_AGENT_SCOPES)

    const legacy = await env.DB.prepare(
      `SELECT value FROM settings WHERE key='agent_token'`,
    ).first<{ value: string }>()
    expect(legacy?.value).toBe('')
    expect(legacy?.value).not.toBe(issued.token)
    expect(legacy?.value).not.toBe('legacy-agent-token')

    const listed = await app.request(
      '/api/agent/credentials',
      { headers },
      baseEnv,
    )
    expect(listed.status).toBe(200)
    const rows = await listed.json<Array<Record<string, unknown>>>()
    const metadata = rows.find((row) => row.id === issued.id)
    expect(metadata).toMatchObject({
      id: issued.id,
      deviceLabel: 'Termux phone',
      scopes: DEFAULT_AGENT_SCOPES,
      revokedAt: null,
    })
    expect(metadata).not.toHaveProperty('token')
    expect(metadata).not.toHaveProperty('tokenHash')

    const retiredRead = await app.request(
      '/api/agent/token',
      { headers },
      baseEnv,
    )
    expect(retiredRead.status).toBe(410)
    await expect(retiredRead.json()).resolves.not.toHaveProperty('token')
  })

  it('enforces route scopes and requires the versioned agent API', async () => {
    const owner = await ownerHeaders()
    const issued = await issueCredential(owner, {
      deviceLabel: 'Read-only block watcher',
      scopes: ['blocks:read'],
      expiresInDays: 30,
    })

    const pending = await agentRead(
      '/api/agent/v1/pending',
      issued.token,
    )
    expect(pending.status).toBe(200)
    expect((await app.request(
      '/api/agent/v1/pending',
      { headers: agentHeaders(issued.token) },
      baseEnv,
    )).status).toBe(405)

    const briefing = await agentRead(
      '/api/agent/v1/briefing',
      issued.token,
    )
    expect(briefing.status).toBe(403)
    await expect(briefing.json()).resolves.toEqual({
      error: 'AGENT SCOPE REQUIRED',
      requiredScope: 'briefing:read',
    })

    const write = await app.request(
      '/api/agent/v1/block-log',
      {
        method: 'POST',
        headers: agentHeaders(issued.token),
        body: JSON.stringify({
          block_id: 1,
          status: 'done',
        }),
      },
      baseEnv,
    )
    expect(write.status).toBe(403)

    const legacy = await app.request(
      '/api/agent/pending',
      { headers: agentHeaders(issued.token) },
      baseEnv,
    )
    expect(legacy.status).toBe(410)
  })

  it('rejects query-string credentials without authenticating them', async () => {
    const owner = await ownerHeaders()
    const issued = await issueCredential(owner, {
      deviceLabel: 'Header-only credential',
      scopes: ['blocks:read'],
    })
    const response = await app.request(
      `/api/agent/v1/pending?token=${encodeURIComponent(issued.token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
      baseEnv,
    )
    expect(response.status).toBe(401)
  })

  it('denies revoked and expired credentials', async () => {
    const owner = await ownerHeaders()
    const revoked = await issueCredential(owner, {
      deviceLabel: 'Revoked device',
      scopes: ['briefing:read'],
    })
    const revoke = await app.request(
      `/api/agent/credentials/${revoked.id}/revoke`,
      {
        method: 'POST',
        headers: owner,
        body: '{}',
      },
      baseEnv,
    )
    expect(revoke.status).toBe(200)
    expect((await agentRead(
      '/api/agent/v1/briefing',
      revoked.token,
    )).status).toBe(401)

    const expired = await issueCredential(owner, {
      deviceLabel: 'Expired device',
      scopes: ['briefing:read'],
    })
    await env.DB.prepare(
      `UPDATE agent_credentials
       SET expires_at=datetime('now','-1 minute') WHERE id=?`,
    ).bind(expired.id).run()
    expect((await agentRead(
      '/api/agent/v1/briefing',
      expired.token,
    )).status).toBe(401)
  })

  it('separates export permission from every default credential', async () => {
    const owner = await ownerHeaders()
    const standard = await issueCredential(owner, {
      deviceLabel: 'Standard bridge',
    })
    expect((await agentRead(
      '/api/agent/v1/export',
      standard.token,
    )).status).toBe(403)

    const exporter = await issueCredential(owner, {
      deviceLabel: 'Explicit exporter',
      scopes: ['export:read'],
      expiresInDays: 1,
    })
    const exported = await agentRead(
      '/api/agent/v1/export',
      exporter.token,
    )
    expect(exported.status).toBe(200)
    await expect(exported.json()).resolves.toHaveProperty('debriefs')
  })

  it('records credential lifecycle and coarse metadata without storing request bodies', async () => {
    const owner = await ownerHeaders()
    const issued = await issueCredential(owner, {
      deviceLabel: 'Council writer',
      scopes: ['hermes:write'],
    })
    const response = await app.request(
      'https://warroom.test/api/agent/v1/message',
      {
        method: 'POST',
        headers: {
          ...agentHeaders(issued.token),
          'CF-IPCountry': 'KE',
          'CF-Connecting-IP': '203.0.113.87',
        },
        body: JSON.stringify({
          content: 'A credential-metadata test message.',
        }),
      },
      baseEnv,
    )
    expect(response.status).toBe(200)

    const stored = await env.DB.prepare(
      `SELECT last_used_at, last_request_method, last_request_route,
              last_request_country, last_request_network
       FROM agent_credentials WHERE id=?`,
    ).bind(issued.id).first<Record<string, string | null>>()
    expect(stored?.last_used_at).toBeTruthy()
    expect(stored?.last_request_method).toBe('POST')
    expect(stored?.last_request_route).toBe('hermes:message')
    expect(stored?.last_request_country).toBe('KE')
    expect(stored?.last_request_network).toBe('203.0.113.0/24')

    const events = (await env.DB.prepare(
      `SELECT event_type, request_method, request_route
       FROM agent_credential_events
       WHERE credential_id=? ORDER BY id`,
    ).bind(issued.id).all()).results
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'issued' }),
      expect.objectContaining({
        event_type: 'used',
        request_method: 'POST',
        request_route: 'hermes:message',
      }),
    ]))
    const serialized = JSON.stringify(events)
    expect(serialized).not.toContain('credential-metadata test message')
  })

  it('records a valid coarse network for compressed IPv6 addresses', async () => {
    const owner = await ownerHeaders()
    const issued = await issueCredential(owner, {
      deviceLabel: 'IPv6 metadata reader',
      scopes: ['blocks:read'],
    })
    const response = await app.request(
      'https://warroom.test/api/agent/v1/pending',
      {
        method: 'POST',
        headers: {
          ...agentHeaders(issued.token),
          'CF-Connecting-IP': '2001:db8::1',
        },
        body: '{}',
      },
      baseEnv,
    )
    expect(response.status).toBe(200)
    const stored = await env.DB.prepare(
      `SELECT last_request_network FROM agent_credentials WHERE id=?`,
    ).bind(issued.id).first<{ last_request_network: string | null }>()
    expect(stored?.last_request_network).toBe('2001:db8:0::/48')
  })

  it('atomically rate limits concurrent agent requests', async () => {
    const owner = await ownerHeaders()
    const reader = await issueCredential(owner, {
      deviceLabel: 'Concurrent rate-limited reader',
      scopes: ['blocks:read'],
    })
    const responses = await Promise.all(
      Array.from({ length: 61 }, () => agentRead(
        '/api/agent/v1/pending',
        reader.token,
      )),
    )
    expect(responses.filter((response) => response.status === 200)).toHaveLength(60)
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1)
  })

  it('rate limits repeated agent requests and applies the JSON request-size boundary', async () => {
    const owner = await ownerHeaders()
    const reader = await issueCredential(owner, {
      deviceLabel: 'Rate-limited reader',
      scopes: ['blocks:read'],
    })
    let response: Response | undefined
    for (let request = 0; request < 61; request++) {
      response = await agentRead(
        '/api/agent/v1/pending',
        reader.token,
      )
    }
    expect(response?.status).toBe(429)
    expect(response?.headers.get('retry-after')).toBeTruthy()

    const writer = await issueCredential(owner, {
      deviceLabel: 'Bounded writer',
      scopes: ['hermes:write'],
    })
    const oversized = await app.request(
      '/api/agent/v1/message',
      {
        method: 'POST',
        headers: agentHeaders(writer.token),
        body: JSON.stringify({ content: 'x'.repeat(65 * 1024) }),
      },
      baseEnv,
    )
    expect(oversized.status).toBe(413)
  })
})
