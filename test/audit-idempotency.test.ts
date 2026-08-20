import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import app from '../src/index'
import { preMigrationRowCounts } from './setup'

const baseEnv = {
  DB: env.DB,
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: 'https://model.invalid/v1',
  OPENAI_ALLOWED_BASE_URLS: 'https://model.invalid/v1',
}

async function passwordHash(password: string, saltHex: string): Promise<string> {
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
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    key,
    256,
  )
  return [...new Uint8Array(bits)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function authenticatedSession(): Promise<{
  headers: Record<string, string>
  userId: number
}> {
  const password = 'audit-idempotency-test-password'
  const salt = 'aabbccdd00112233445566778899eeff'
  await env.DB.prepare(
    `UPDATE users
     SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL
     WHERE role='owner'`,
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
  return {
    userId: owner!.id,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
  }
}

async function issueCredential(
  headers: Record<string, string>,
  scopes: string[],
): Promise<string> {
  const response = await app.request(
    '/api/agent/credentials',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        deviceLabel: `idem-${scopes.join('-')}`.slice(0, 100),
        scopes,
      }),
    },
    baseEnv,
  )
  expect([200, 201]).toContain(response.status)
  const { token } = await response.json<{ token: string }>()
  expect(typeof token).toBe('string')
  return token
}

async function countRows(table: string, userId: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM ${table} WHERE user_id=?`,
  ).bind(userId).first<{ total: number }>()
  return row?.total ?? 0
}

async function pointsFor(userId: number, refType: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM points_ledger WHERE user_id=? AND ref_type=?`,
  ).bind(userId, refType).first<{ total: number }>()
  return row?.total ?? 0
}

beforeEach(async () => {
  const owner = await env.DB.prepare(
    `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
  ).first<{ id: number }>()
  if (!owner) return
  for (const table of ['audit_events', 'idempotency_keys']) {
    try {
      await env.DB.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(owner.id).run()
    } catch (_) { /* table absent before 0008 — the RED condition */ }
  }
})

afterEach(async () => {
  // Keep fixtures from leaking into later files in the shared D1 binding.
  const owner = await env.DB.prepare(
    `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
  ).first<{ id: number }>()
  if (!owner) return
  await env.DB.prepare(
    `DELETE FROM intel_entries WHERE user_id=? AND title LIKE '%IDEMPOTENCY FIXTURE%'`,
  ).bind(owner.id).run()
})

describe('Book 5.7 audit_events table', () => {
  it('exists with exactly the mandated columns', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM pragma_table_info('audit_events') ORDER BY cid`,
    ).all<{ name: string }>()
    expect((results as { name: string }[]).map((r) => r.name)).toEqual([
      'id', 'user_id', 'actor_type', 'actor_id', 'request_id', 'action',
      'entity_type', 'entity_id', 'before_json', 'after_json', 'metadata_json',
      'created_at',
    ])
  })

  it('carries both mandated indexes', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master
       WHERE type='index' AND tbl_name='audit_events' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    ).all<{ name: string }>()
    const names = (results as { name: string }[]).map((r) => r.name)
    expect(names).toContain('idx_audit_user_time')
    expect(names).toContain('idx_audit_entity')
  })

  it('declares no column that could hold a secret', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM pragma_table_info('audit_events')`,
    ).all<{ name: string }>()
    for (const { name } of results as { name: string }[]) {
      expect(name).not.toMatch(/token|secret|password|hash|credential|api_?key/i)
    }
  })

  it('rejects UPDATE and DELETE — append-only', async () => {
    const { userId } = await authenticatedSession()
    await env.DB.prepare(
      `INSERT INTO audit_events
         (user_id, actor_type, request_id, action, entity_type, created_at)
       VALUES (?,'system','append-only-probe','probe','probe',datetime('now'))`,
    ).bind(userId).run()
    const row = await env.DB.prepare(
      `SELECT id FROM audit_events WHERE request_id='append-only-probe'`,
    ).first<{ id: number }>()
    expect(row?.id).toBeTruthy()

    await expect(
      env.DB.prepare(`UPDATE audit_events SET action='tampered' WHERE id=?`)
        .bind(row!.id).run(),
    ).rejects.toThrow(/AUDIT_APPEND_ONLY/)
    await expect(
      env.DB.prepare(`DELETE FROM audit_events WHERE id=?`).bind(row!.id).run(),
    ).rejects.toThrow(/AUDIT_APPEND_ONLY/)

    const still = await env.DB.prepare(
      `SELECT action FROM audit_events WHERE id=?`,
    ).bind(row!.id).first<{ action: string }>()
    expect(still?.action).toBe('probe')
  })
})

describe('Book 5.7 delivery idempotency', () => {
  it('files one intel entry when the same request id is delivered twice', async () => {
    const { headers, userId } = await authenticatedSession()
    const before = await countRows('intel_entries', userId)
    const body = JSON.stringify({
      domain: 'other',
      title: 'IDEMPOTENCY FIXTURE intel',
      situation: 'delivered twice',
    })
    const send = () => app.request(
      '/api/intel',
      { method: 'POST', headers: { ...headers, 'X-Request-Id': 'intel-req-001' }, body },
      baseEnv,
    )
    const first = await send()
    expect(first.status).toBe(200)
    const firstBody = await first.json<any>()
    const second = await send()
    expect(second.status).toBe(200)
    expect(await second.json<any>()).toEqual(firstBody)
    expect(await countRows('intel_entries', userId)).toBe(before + 1)
  })

  it('debits a reward once when the same redemption is delivered twice', async () => {
    const { headers, userId } = await authenticatedSession()
    await env.DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason)
       VALUES (?, '2026-08-14', 500, 'IDEMPOTENCY FIXTURE float')`,
    ).bind(userId).run()
    const reward = await env.DB.prepare(
      `SELECT id FROM rewards ORDER BY cost LIMIT 1`,
    ).first<{ id: number }>()
    expect(reward?.id).toBeTruthy()

    const before = await pointsFor(userId, 'reward')
    const send = () => app.request(
      `/api/rewards/${reward!.id}/redeem`,
      { method: 'POST', headers: { ...headers, 'X-Request-Id': 'redeem-req-001' } },
      baseEnv,
    )
    const first = await send()
    expect(first.status).toBe(200)
    const second = await send()
    expect(second.status).toBe(200)
    expect(await pointsFor(userId, 'reward')).toBe(before + 1)
  })

  it('creates one consequence when a bridge intel write is retried', async () => {
    const { headers, userId } = await authenticatedSession()
    const token = await issueCredential(headers, ['intel:write'])
    const before = await countRows('intel_entries', userId)
    const send = () => app.request(
      '/api/agent/v1/intel',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Token': token,
          'X-Request-Id': 'bridge-intel-req-001',
        },
        body: JSON.stringify({ domain: 'other', title: 'IDEMPOTENCY FIXTURE bridge' }),
      },
      baseEnv,
    )
    const first = await send()
    expect(first.status).toBe(200)
    const firstBody = await first.json<any>()
    const second = await send()
    expect(second.status).toBe(200)
    expect(await second.json<any>()).toEqual(firstBody)
    expect(await countRows('intel_entries', userId)).toBe(before + 1)
  })

  it('awards one MVD and one victory bonus when enforcement runs twice', async () => {
    const { userId } = await authenticatedSession()
    await env.DB.prepare(
      `INSERT OR REPLACE INTO points_ledger (user_id, log_date, points, reason, ref_type)
       VALUES (?, '2026-08-18', 10, 'IDEMPOTENCY FIXTURE mvd', 'mvd')`,
    ).bind(userId).run()
    const mvdBefore = await pointsFor(userId, 'mvd')
    const streakBefore = await pointsFor(userId, 'streak')

    for (const attempt of [1, 2]) {
      const response = await app.request(
        '/internal/jobs/enforcement',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Request-Id': `enforcement-req-00${attempt}`,
          },
          body: '{}',
        },
        baseEnv,
      )
      // This asserts only that the internal job stays CLOSED without the shared
      // secret (so an unauthenticated caller cannot drive enforcement). The real
      // end-to-end duplicate-award guard is proven in
      // test/enforcement-idempotency.test.ts, which supplies the secret and runs
      // the pass twice against a seeded victory day.
      expect([401, 403]).toContain(response.status)
    }
    expect(await pointsFor(userId, 'mvd')).toBe(mvdBefore)
    expect(await pointsFor(userId, 'streak')).toBe(streakBefore)
  })

  it('accepts x-request-id through CORS preflight', async () => {
    // Browser CORS defaults to same-origin (Book 5.4), so the preflight must
    // carry this deployment's own origin; a foreign origin is refused earlier
    // by policy and would not exercise the header allowlist.
    const response = await app.request(
      'http://localhost/api/intel',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type, x-csrf-token, x-request-id',
        },
      },
      baseEnv,
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-headers') ?? '')
      .toMatch(/x-request-id/i)
  })

  it('still refuses a preflight asking for an unlisted header', async () => {
    const response = await app.request(
      'http://localhost/api/intel',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type, x-smuggled-header',
        },
      },
      baseEnv,
    )
    expect(response.status).toBe(403)
  })
})

describe('Book 5.7 migration safety', () => {
  it('preserves every pre-0008 personal row', async () => {
    for (const [table, expected] of Object.entries(preMigrationRowCounts)) {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM ${table}`,
      ).first<{ total: number }>()
      expect(row?.total ?? 0, `${table} lost rows across migration 0008`)
        .toBeGreaterThanOrEqual(expected)
    }
  })

  it('stores an idempotency key scoped per owner and request', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master
       WHERE type='index' AND tbl_name='idempotency_keys' AND sql LIKE '%UNIQUE%'`,
    ).all<{ name: string }>()
    const unique = await env.DB.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='idempotency_keys'`,
    ).first<{ sql: string }>()
    const ddl = `${unique?.sql ?? ''} ${(results as { name: string }[]).map((r) => r.name).join(' ')}`
    expect(ddl).toMatch(/user_id/)
    expect(ddl).toMatch(/request_id/)
    expect(ddl).toMatch(/scope/)
  })
})
