import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../src/index'
import clientSource from '../public/static/app.js?raw'

const baseEnv = {
  DB: env.DB,
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: 'https://model.invalid',
  OPENAI_ALLOWED_BASE_URLS: 'https://model.invalid',
}

async function passwordHash(password: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256)
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function session(): Promise<{ headers: Record<string, string>; userId: number }> {
  const password = 'catchup-wire-password'
  const salt = 'ccddeeff00112233445566778899aabb'
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

async function today(headers: Record<string, string>): Promise<string> {
  const res = await app.request('/api/state', { headers }, baseEnv)
  return (await res.json<{ date: string }>()).date
}

describe('Book 8.6 — /api/state re-entry signal', () => {
  it('raises needsCatchup after three dark days', async () => {
    const { headers, userId } = await session()
    const d = await today(headers)
    // Wipe recent activity for this owner in the trailing window.
    for (let i = 1; i <= 4; i++) {
      const day = new Date(new Date(d + 'T12:00:00Z').getTime() - i * 86400000).toISOString().slice(0, 10)
      await env.DB.prepare(`DELETE FROM block_logs WHERE user_id=? AND log_date=?`).bind(userId, day).run()
      await env.DB.prepare(`DELETE FROM debriefs WHERE user_id=? AND log_date=?`).bind(userId, day).run()
    }
    const res = await app.request('/api/state', { headers }, baseEnv)
    const state = await res.json<{ needsCatchup: boolean }>()
    expect(state.needsCatchup).toBe(true)
  })

  it('clears needsCatchup once there is recent activity', async () => {
    const { headers, userId } = await session()
    const d = await today(headers)
    const yesterday = new Date(new Date(d + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10)
    await env.DB.prepare(
      `INSERT INTO debriefs (user_id, log_date, wins) VALUES (?,?,'back at it')`,
    ).bind(userId, yesterday).run()
    const res = await app.request('/api/state', { headers }, baseEnv)
    const state = await res.json<{ needsCatchup: boolean }>()
    expect(state.needsCatchup).toBe(false)
  })
})

describe('Book 8.6 — frontend re-entry wiring', () => {
  it('shows the re-entry door when needsCatchup is set', () => {
    expect(clientSource).toMatch(/s\.needsCatchup\?/)
    expect(clientSource).toMatch(/runCatchup\(\)/)
  })
  it('exposes runCatchup and logRecovery', () => {
    expect(clientSource).toMatch(/window\.runCatchup = runCatchup/)
    expect(clientSource).toMatch(/window\.logRecovery = logRecovery/)
  })
  it('logs recovery through POST /api/recovery', () => {
    expect(clientSource).toMatch(/axios\.post\('\/api\/recovery'/)
  })
})
