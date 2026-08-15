import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'

const baseEnv = {
  DB: env.DB,
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: 'https://model.invalid',
}

async function clearAuth(): Promise<void> {
  await env.DB.prepare(`DELETE FROM sessions`).run()
  const owner = await env.DB.prepare(
    `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
  ).first<{ id: number }>()
  if (owner) {
    await env.DB.prepare(
      `UPDATE users SET password_hash='', password_salt='', failed_login_count=0, locked_until=NULL WHERE id=?`,
    ).bind(owner.id).run()
  }
  await env.DB.prepare(
    `DELETE FROM settings WHERE key IN ('auth_hash','auth_salt','session_secret','auth_fails')`,
  ).run()
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

async function setupResponse(password = 'test-password-only'): Promise<Response> {
  let response = await app.request(
    '/api/auth/setup',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    },
    baseEnv,
  )

  if (response.status === 400) {
    const salt = '00112233445566778899aabbccddeeff'
    await env.DB.prepare(
      `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
    ).bind(await passwordHash(password, salt), salt).run()
    response = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      },
      baseEnv,
    )
  }

  expect(response.status).toBe(200)
  return response
}

async function setup(password = 'test-password-only'): Promise<string> {
  const response = await setupResponse(password)
  const cookie = response.headers.get('set-cookie')
  expect(cookie).toBeTruthy()
  return cookie!.split(';', 1)[0]
}

async function login(password = 'test-password-only'): Promise<string> {
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
  return response.headers.get('set-cookie')!.split(';', 1)[0]
}

async function mutationHeaders(cookie: string): Promise<Record<string, string>> {
  const rawToken = decodeURIComponent(cookie.split('=', 2)[1])
  const csrfBytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`csrf:${rawToken}`),
  )
  const csrfToken = [...new Uint8Array(csrfBytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return {
    Cookie: cookie,
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken,
  }
}

describe('Book 5.2 durable sessions', () => {
  it('sets an expiring host-only secure browser-session cookie', async () => {
    await clearAuth()
    const response = await setupResponse()
    const setCookie = response.headers.get('set-cookie')

    expect(setCookie).toBeTruthy()
    expect(setCookie).toContain('wr_session=')
    expect(setCookie).toMatch(/;\s*HttpOnly(?:;|$)/i)
    expect(setCookie).toMatch(/;\s*Secure(?:;|$)/i)
    expect(setCookie).toMatch(/;\s*SameSite=Lax(?:;|$)/i)
    expect(setCookie).toMatch(/;\s*Path=\/(?:;|$)/i)
    expect(setCookie).toMatch(/;\s*Max-Age=\d+(?:;|$)/i)
    expect(setCookie).not.toMatch(/;\s*Domain=/i)
  })

  it('stores only a session-token hash and accepts the valid cookie', async () => {
    await clearAuth()
    const cookie = await setup()
    const rawToken = decodeURIComponent(cookie.split('=', 2)[1])
    const row = await env.DB.prepare(
      `SELECT token_hash, expires_at, revoked_at FROM sessions`,
    ).first<{ token_hash: string; expires_at: string; revoked_at: string | null }>()

    expect(row).toBeTruthy()
    expect(row!.token_hash).not.toBe(rawToken)
    expect(row!.token_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(row!.revoked_at).toBeNull()

    const accepted = await app.request('/api/state', { headers: await mutationHeaders(cookie) }, baseEnv)
    expect(accepted.status).toBe(200)
  })

  it('rejects expired sessions', async () => {
    await clearAuth()
    const cookie = await setup()
    await env.DB.prepare(
      `UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z'`,
    ).run()

    const response = await app.request('/api/state', { headers: await mutationHeaders(cookie) }, baseEnv)
    expect(response.status).toBe(401)
  })

  it('rejects ISO-formatted sessions that expired earlier today', async () => {
    await clearAuth()
    const cookie = await setup()
    await env.DB.prepare(
      `UPDATE sessions
       SET expires_at=strftime('%Y-%m-%dT00:00:00.000Z','now')`,
    ).run()

    const response = await app.request('/api/state', { headers: await mutationHeaders(cookie) }, baseEnv)
    expect(response.status).toBe(401)
  })

  it('revokes the server-side session on logout', async () => {
    await clearAuth()
    const cookie = await setup()
    const logout = await app.request(
      '/api/auth/logout',
      { method: 'POST', headers: await mutationHeaders(cookie) },
      baseEnv,
    )
    expect(logout.status).toBe(200)

    const row = await env.DB.prepare(`SELECT revoked_at FROM sessions`).first<{ revoked_at: string | null }>()
    expect(row?.revoked_at).toBeTruthy()
    const denied = await app.request('/api/state', { headers: await mutationHeaders(cookie) }, baseEnv)
    expect(denied.status).toBe(401)
  })

  it('rotates the session on login and rejects session fixation', async () => {
    await clearAuth()
    const setupCookie = await setup()
    const loginCookie = await login()

    expect(loginCookie).not.toBe(setupCookie)
    const oldSession = await app.request('/api/state', { headers: { Cookie: setupCookie } }, baseEnv)
    const currentSession = await app.request('/api/state', { headers: { Cookie: loginCookie } }, baseEnv)
    expect(oldSession.status).toBe(401)
    expect(currentSession.status).toBe(200)
  })

  it('claims rows written by an additive-schema application rollback on next login', async () => {
    await clearAuth()
    const legacyRow = await env.DB.prepare(
      `INSERT INTO intel_entries
         (user_id, log_date, domain, title)
       VALUES (NULL, '2026-08-15', 'other', 'Rollback-era unowned row')`,
    ).run()

    await setup()

    const owner = await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
    ).first<{ id: number }>()
    const row = await env.DB.prepare(
      `SELECT user_id FROM intel_entries WHERE id=?`,
    ).bind(legacyRow.meta.last_row_id).first<{ user_id: number | null }>()
    expect(row?.user_id).toBe(owner?.id)
  })
})

describe('Book 5.2 ownership', () => {
  it('backfills every personal table to the durable owner', async () => {
    await clearAuth()
    await setup()
    const owner = await env.DB.prepare(`SELECT id FROM users WHERE role='owner'`).first<{ id: number }>()
    expect(owner).toBeTruthy()

    const personalTables = [
      'schedule_blocks', 'block_logs', 'debriefs', 'unit_progress', 'maxims',
      'flashcards', 'card_reviews', 'honesty_flags', 'points_ledger',
      'reward_redemptions', 'law_checks', 'settings', 'intel_entries',
      'book_progress', 'hermes_messages', 'responses', 'response_srs',
      'tongue_reviews', 'tongue_exams', 'day_summary', 'predictions',
      'appeals', 'load_reductions',
    ]

    for (const table of personalTables) {
      const info = (await env.DB.prepare(`PRAGMA table_info(${table})`).all()).results as Array<{ name: string }>
      expect(info.map((column) => column.name), table).toContain('user_id')
      const unowned = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM ${table} WHERE user_id IS NULL OR user_id != ?`,
      ).bind(owner!.id).first<{ n: number }>()
      expect(unowned?.n, table).toBe(0)
    }
  })

  it('denies cross-user record access at the route boundary', async () => {
    await clearAuth()
    const ownerCookie = await setup()
    const owner = await env.DB.prepare(`SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`).first<{ id: number }>()
    const otherUserId = Number((await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' AND id<>? ORDER BY id LIMIT 1`,
    ).bind(owner!.id).first<{ id: number }>())?.id ?? (await env.DB.prepare(
      `INSERT INTO users (password_hash, password_salt, role) VALUES ('test-hash','test-salt','owner')`,
    ).run()).meta.last_row_id)
    const foreignPrediction = await env.DB.prepare(
      `INSERT INTO predictions (user_id, made_date, claim, confidence, resolve_by) VALUES (?,?,?,?,?)`,
    ).bind(otherUserId, '2026-08-15', 'A foreign prediction record', 75, '2026-08-20').run()

    const response = await app.request(
      `/api/predictions/${foreignPrediction.meta.last_row_id}/resolve`,
      {
        method: 'POST',
        headers: await mutationHeaders(ownerCookie),
        body: JSON.stringify({ outcome: 'right', note: 'must not cross owner boundary' }),
      },
      baseEnv,
    )

    expect(response.status).toBe(404)
    const record = await env.DB.prepare(
      `SELECT outcome FROM predictions WHERE id=? AND user_id=?`,
    ).bind(foreignPrediction.meta.last_row_id, otherUserId).first<{ outcome: string }>()
    expect(record?.outcome).toBe('unresolved')
    expect(owner!.id).not.toBe(otherUserId)
  })

  it('filters foreign records from collection reads and state totals', async () => {
    await clearAuth()
    const ownerCookie = await setup()
    const owner = await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
    ).first<{ id: number }>()
    const otherUserId = Number((await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' AND id<>? ORDER BY id LIMIT 1`,
    ).bind(owner!.id).first<{ id: number }>())?.id ?? (await env.DB.prepare(
      `INSERT INTO users (password_hash, password_salt, role) VALUES ('foreign-hash','foreign-salt','owner')`,
    ).run()).meta.last_row_id)

    const ownerPrediction = await env.DB.prepare(
      `INSERT INTO predictions (user_id, made_date, claim, confidence, resolve_by) VALUES (?,?,?,?,?)`,
    ).bind(owner!.id, '2026-08-15', 'An owner prediction record', 70, '2026-09-10').run()
    const foreignPrediction = await env.DB.prepare(
      `INSERT INTO predictions (user_id, made_date, claim, confidence, resolve_by) VALUES (?,?,?,?,?)`,
    ).bind(otherUserId, '2026-08-15', 'Another foreign prediction record', 80, '2026-09-11').run()

    const before = await app.request('/api/state', { headers: { Cookie: ownerCookie } }, baseEnv)
    expect(before.status).toBe(200)
    const beforeState = await before.json<{ points: number }>()
    await env.DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason) VALUES (?,?,?,?)`,
    ).bind(otherUserId, '2026-08-15', 50000, 'foreign points').run()

    const list = await app.request('/api/predictions', { headers: { Cookie: ownerCookie } }, baseEnv)
    expect(list.status).toBe(200)
    const predictions = await list.json<Array<{ id: number }>>()
    expect(predictions.some((row) => row.id === Number(ownerPrediction.meta.last_row_id))).toBe(true)
    expect(predictions.some((row) => row.id === Number(foreignPrediction.meta.last_row_id))).toBe(false)

    const after = await app.request('/api/state', { headers: { Cookie: ownerCookie } }, baseEnv)
    expect(after.status).toBe(200)
    const afterState = await after.json<{ points: number }>()
    expect(afterState.points).toBe(beforeState.points)
  })

  it('denies updating another user response', async () => {
    await clearAuth()
    const ownerCookie = await setup()
    const owner = await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
    ).first<{ id: number }>()
    const otherUserId = Number((await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' AND id<>? ORDER BY id LIMIT 1`,
    ).bind(owner!.id).first<{ id: number }>())?.id ?? (await env.DB.prepare(
      `INSERT INTO users (password_hash, password_salt, role) VALUES ('foreign-hash','foreign-salt','owner')`,
    ).run()).meta.last_row_id)
    const foreignResponse = await env.DB.prepare(
      `INSERT INTO responses
         (user_id, situation, trigger_q, response, category)
       VALUES (?,?,?,?,?)`,
    ).bind(otherUserId, 'Foreign situation', 'Foreign trigger', 'Foreign answer', 'wit').run()

    const response = await app.request(
      `/api/tongue/${foreignResponse.meta.last_row_id}`,
      {
        method: 'PUT',
        headers: await mutationHeaders(ownerCookie),
        body: JSON.stringify({
          situation: 'Owner overwrite attempt',
          trigger_q: 'Owner trigger',
          response: 'Owner answer',
          category: 'wit',
        }),
      },
      baseEnv,
    )

    expect(response.status).toBe(404)
    const row = await env.DB.prepare(
      `SELECT situation FROM responses WHERE id=? AND user_id=?`,
    ).bind(foreignResponse.meta.last_row_id, otherUserId).first<{ situation: string }>()
    expect(row?.situation).toBe('Foreign situation')
  })

  it('denies appending a log to another user block', async () => {
    await clearAuth()
    const ownerCookie = await setup()
    const owner = await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
    ).first<{ id: number }>()
    const otherUserId = Number((await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' AND id<>? ORDER BY id LIMIT 1`,
    ).bind(owner!.id).first<{ id: number }>())?.id ?? (await env.DB.prepare(
      `INSERT INTO users (password_hash, password_salt, role) VALUES ('foreign-hash','foreign-salt','owner')`,
    ).run()).meta.last_row_id)
    const foreignBlock = await env.DB.prepare(
      `INSERT INTO schedule_blocks
         (user_id, sort_order, start_time, end_time, title, category, days, points)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).bind(otherUserId, 1001, '03:00', '03:30', 'Foreign append target', 'admin', 'sun,mon,tue,wed,thu,fri,sat', 10).run()

    const response = await app.request(
      `/api/blocks/${foreignBlock.meta.last_row_id}/log`,
      {
        method: 'POST',
        headers: await mutationHeaders(ownerCookie),
        body: JSON.stringify({ status: 'done', note: 'must not append' }),
      },
      baseEnv,
    )

    expect(response.status).toBe(404)
    const row = await env.DB.prepare(
      `SELECT id FROM block_logs WHERE block_id=?`,
    ).bind(foreignBlock.meta.last_row_id).first()
    expect(row).toBeNull()
  })

  it('filters another user schedule from the calendar export', async () => {
    await clearAuth()
    const ownerCookie = await setup()
    const owner = await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
    ).first<{ id: number }>()
    const otherUserId = Number((await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' AND id<>? ORDER BY id LIMIT 1`,
    ).bind(owner!.id).first<{ id: number }>())?.id ?? (await env.DB.prepare(
      `INSERT INTO users (password_hash, password_salt, role) VALUES ('foreign-hash','foreign-salt','owner')`,
    ).run()).meta.last_row_id)
    await env.DB.prepare(
      `INSERT INTO schedule_blocks
         (user_id, sort_order, start_time, end_time, title, category, days, points)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).bind(otherUserId, 1002, '04:00', '04:30', 'FOREIGN-CALENDAR-SECRET', 'admin', 'mon', 10).run()

    const response = await app.request(
      '/calendar.ics',
      { headers: { Cookie: ownerCookie } },
      baseEnv,
    )

    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain('FOREIGN-CALENDAR-SECRET')
  })

  it('filters another user records from the Hermes briefing context', async () => {
    await clearAuth()
    const ownerCookie = await setup()
    const owner = await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
    ).first<{ id: number }>()
    const otherUserId = Number((await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' AND id<>? ORDER BY id LIMIT 1`,
    ).bind(owner!.id).first<{ id: number }>())?.id ?? (await env.DB.prepare(
      `INSERT INTO users (password_hash, password_salt, role) VALUES ('foreign-hash','foreign-salt','owner')`,
    ).run()).meta.last_row_id)
    const rotate = await app.request(
      '/api/agent/token/rotate',
      { method: 'POST', headers: await mutationHeaders(ownerCookie) },
      baseEnv,
    )
    expect(rotate.status).toBe(200)
    const { token } = await rotate.json<{ token: string }>()

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO debriefs (user_id, log_date, wins) VALUES (?,?,?)`,
      ).bind(otherUserId, '2099-12-30', 'FOREIGN-BRIEFING-DEBRIEF'),
      env.DB.prepare(
        `INSERT INTO honesty_flags
           (user_id, flag_date, flag_type, message)
         VALUES (?,?,?,?)`,
      ).bind(otherUserId, '2099-12-30', 'foreign', 'FOREIGN-BRIEFING-FLAG'),
      env.DB.prepare(
        `INSERT INTO intel_entries
           (user_id, log_date, domain, title, situation)
         VALUES (?,?,?,?,?)`,
      ).bind(otherUserId, '2099-12-30', 'other', 'FOREIGN-BRIEFING-INTEL', 'FOREIGN-BRIEFING-SITUATION'),
    ])

    const response = await app.request(
      '/api/agent/briefing',
      { headers: { 'X-Agent-Token': token } },
      baseEnv,
    )

    expect(response.status).toBe(200)
    const briefing = await response.text()
    expect(briefing).not.toContain('FOREIGN-BRIEFING-DEBRIEF')
    expect(briefing).not.toContain('FOREIGN-BRIEFING-FLAG')
    expect(briefing).not.toContain('FOREIGN-BRIEFING-INTEL')
    expect(briefing).not.toContain('FOREIGN-BRIEFING-SITUATION')
  })

  it('filters another user records from agent export', async () => {
    await clearAuth()
    const ownerCookie = await setup()
    const owner = await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
    ).first<{ id: number }>()
    const otherUserId = Number((await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' AND id<>? ORDER BY id LIMIT 1`,
    ).bind(owner!.id).first<{ id: number }>())?.id ?? (await env.DB.prepare(
      `INSERT INTO users (password_hash, password_salt, role) VALUES ('foreign-hash','foreign-salt','owner')`,
    ).run()).meta.last_row_id)
    const rotate = await app.request(
      '/api/agent/token/rotate',
      { method: 'POST', headers: await mutationHeaders(ownerCookie) },
      baseEnv,
    )
    expect(rotate.status).toBe(200)
    const { token } = await rotate.json<{ token: string }>()
    await env.DB.prepare(
      `INSERT INTO intel_entries (user_id, log_date, domain, title) VALUES (?,?,?,?)`,
    ).bind(otherUserId, '2026-08-15', 'other', 'FOREIGN-EXPORT-SECRET').run()

    const response = await app.request(
      '/api/agent/export',
      { headers: { 'X-Agent-Token': token } },
      baseEnv,
    )

    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain('FOREIGN-EXPORT-SECRET')
  })

  it('denies updating another user load-reduction record', async () => {
    await clearAuth()
    const ownerCookie = await setup()
    const owner = await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
    ).first<{ id: number }>()
    const otherUserId = Number((await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' AND id<>? ORDER BY id LIMIT 1`,
    ).bind(owner!.id).first<{ id: number }>())?.id ?? (await env.DB.prepare(
      `INSERT INTO users (password_hash, password_salt, role) VALUES ('foreign-hash','foreign-salt','owner')`,
    ).run()).meta.last_row_id)
    const foreignBlock = await env.DB.prepare(
      `INSERT INTO schedule_blocks
         (user_id, sort_order, start_time, end_time, title, category, days, points)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).bind(otherUserId, 1000, '02:00', '02:30', 'Foreign reduced block', 'admin', 'sun,mon,tue,wed,thu,fri,sat', 10).run()
    const reduction = await env.DB.prepare(
      `INSERT INTO load_reductions (user_id, block_id, start_date, end_date) VALUES (?,?,?,?)`,
    ).bind(otherUserId, foreignBlock.meta.last_row_id, '2026-08-15', '2026-08-17').run()

    const response = await app.request(
      `/api/load-reductions/${reduction.meta.last_row_id}/answer`,
      {
        method: 'POST',
        headers: await mutationHeaders(ownerCookie),
        body: JSON.stringify({ reason: 'wrong_time' }),
      },
      baseEnv,
    )

    expect(response.status).toBe(404)
    const row = await env.DB.prepare(
      `SELECT reason FROM load_reductions WHERE id=? AND user_id=?`,
    ).bind(reduction.meta.last_row_id, otherUserId).first<{ reason: string | null }>()
    expect(row?.reason).toBeNull()
  })
})
