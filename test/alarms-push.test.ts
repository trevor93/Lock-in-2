import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import { vapidJwt, inQuietHours, vapidConfig } from '../src/push'

// Book 7 alarms. Covers the VAPID signing path (a real ES256 signature, verified
// with WebCrypto), the quiet-hours window, the subscription/preferences routes, and
// the internal Cron entry: it refuses an unauthenticated caller, fails closed with
// no VAPID configured, and delivers idempotently (a re-run in the same minute cannot
// double-notify) while a dead push endpoint cannot abort the run.

async function generateVapid(): Promise<{ publicKey: string; privateJwk: string; subject: string }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  )
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  let bin = ''
  for (const b of raw) bin += String.fromCharCode(b)
  const publicKey = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return { publicKey, privateJwk: JSON.stringify(jwk), subject: 'mailto:owner@example.invalid' }
}

const VAPID = await generateVapid()

const baseEnv = {
  DB: env.DB, OPENAI_API_KEY: '', OPENAI_BASE_URL: 'https://model.invalid',
  OPENAI_ALLOWED_BASE_URLS: 'https://model.invalid',
}
const pushEnv = {
  ...baseEnv,
  ENFORCEMENT_JOB_SECRET: 'alarms-job-secret',
  VAPID_PUBLIC_KEY: VAPID.publicKey,
  VAPID_PRIVATE_JWK: VAPID.privateJwk,
  VAPID_SUBJECT: VAPID.subject,
}

async function passwordHash(pw: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256)
  return [...new Uint8Array(bits)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
async function login(e: Record<string, unknown> = pushEnv): Promise<{ cookie: string; csrf: string; userId: number }> {
  const salt = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash('alarms-test-pw', salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'alarms-test-pw' }),
  }, e)
  expect(res.status).toBe(200)
  const cookie = res.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await res.json<{ csrfToken: string }>()
  const owner = await env.DB.prepare(`SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`).first<{ id: number }>()
  return { cookie, csrf: csrfToken, userId: owner!.id }
}
function post(path: string, s: { cookie: string; csrf: string }, body: unknown, e: Record<string, unknown> = pushEnv) {
  return app.request(path, {
    method: 'POST', headers: { Cookie: s.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf },
    body: JSON.stringify(body),
  }, e)
}
function job(secret: string | null, e: Record<string, unknown> = pushEnv) {
  return app.request('/internal/jobs/alarms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: '{}',
  }, e)
}

describe('B7 alarms — VAPID signing', () => {
  it('produces a verifiable ES256 JWT with the right claims', async () => {
    const jwt = await vapidJwt('https://push.example.invalid', VAPID, 1_700_000_000_000)
    const [h, p, sig] = jwt.split('.')
    const decode = (part: string) =>
      JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
    expect(decode(h)).toEqual({ typ: 'JWT', alg: 'ES256' })
    const claims = decode(p)
    expect(claims.aud).toBe('https://push.example.invalid')
    expect(claims.sub).toBe(VAPID.subject)
    expect(claims.exp).toBe(1_700_000_000 + 12 * 3600)

    // Verify the signature with the matching public key — a real crypto check.
    const rawKey = Uint8Array.from(
      atob(VAPID.publicKey.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0),
    )
    const verifyKey = await crypto.subtle.importKey(
      'raw', rawKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
    )
    const sigBytes = Uint8Array.from(
      atob(sig.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0),
    )
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, verifyKey, sigBytes,
      new TextEncoder().encode(`${h}.${p}`),
    )
    expect(ok, 'the VAPID signature did not verify').toBe(true)
  })

  it('reports unconfigured when any VAPID value is missing or the subject is bogus', () => {
    expect(vapidConfig({})).toBeNull()
    expect(vapidConfig({ VAPID_PUBLIC_KEY: 'k', VAPID_PRIVATE_JWK: '{}' })).toBeNull()
    expect(vapidConfig({
      VAPID_PUBLIC_KEY: 'k', VAPID_PRIVATE_JWK: '{}', VAPID_SUBJECT: 'not-a-contact',
    })).toBeNull()
    expect(vapidConfig({
      VAPID_PUBLIC_KEY: 'k', VAPID_PRIVATE_JWK: '{}', VAPID_SUBJECT: 'mailto:a@b.c',
    })).not.toBeNull()
  })

  it('quiet hours handle a window that wraps past midnight', () => {
    expect(inQuietHours('23:30', '23:00', '06:00')).toBe(true)
    expect(inQuietHours('02:00', '23:00', '06:00')).toBe(true)
    expect(inQuietHours('06:00', '23:00', '06:00')).toBe(false)
    expect(inQuietHours('12:00', '23:00', '06:00')).toBe(false)
    expect(inQuietHours('12:00', '09:00', '17:00')).toBe(true)
    expect(inQuietHours('12:00', '08:00', '08:00'), 'start==end means no quiet hours').toBe(false)
  })
})

describe('B7 alarms — subscription and preferences', () => {
  const SUB = {
    endpoint: 'https://push.example.invalid/send/abc123',
    p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
    auth: 'tBHItJI5svbpez7KI4CCXg',
    device_label: 'Pixel',
  }

  it('stores a subscription, upserts on repeat, and drops it on unsubscribe', async () => {
    const s = await login()
    expect((await post('/api/push/subscribe', s, SUB)).status).toBe(200)
    let row = await env.DB.prepare(
      `SELECT user_id, device_label FROM push_subscriptions WHERE endpoint=?`,
    ).bind(SUB.endpoint).first<{ user_id: number; device_label: string }>()
    expect(row?.user_id).toBe(s.userId)
    expect(row?.device_label).toBe('Pixel')

    // Same endpoint again must update, not duplicate.
    expect((await post('/api/push/subscribe', s, { ...SUB, device_label: 'Pixel 9' })).status).toBe(200)
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint=?`,
    ).bind(SUB.endpoint).first<{ n: number }>()
    expect(count?.n).toBe(1)
    row = await env.DB.prepare(
      `SELECT user_id, device_label FROM push_subscriptions WHERE endpoint=?`,
    ).bind(SUB.endpoint).first<any>()
    expect(row?.device_label).toBe('Pixel 9')

    expect((await post('/api/push/unsubscribe', s, { endpoint: SUB.endpoint })).status).toBe(200)
    const gone = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint=?`,
    ).bind(SUB.endpoint).first<{ n: number }>()
    expect(gone?.n).toBe(0)
  })

  it('rejects a malformed subscription', async () => {
    const s = await login()
    // http (not https) endpoint
    expect((await post('/api/push/subscribe', s, { ...SUB, endpoint: 'http://push.invalid/x' })).status).toBe(400)
    // key material that is not base64url
    expect((await post('/api/push/subscribe', s, { ...SUB, auth: 'not/base64url+' })).status).toBe(400)
    // unknown field (strict schema, no mass assignment)
    expect((await post('/api/push/subscribe', s, { ...SUB, user_id: 999 })).status).toBe(400)
  })

  it('serves defaults then persists changed preferences', async () => {
    const s = await login()
    const first = await app.request('/api/notification-preferences', { headers: { Cookie: s.cookie } }, pushEnv)
    expect(first.status).toBe(200)
    const prefs = await first.json<any>()
    expect(prefs.quiet_start).toBe('23:00')
    expect(prefs.lead_minutes).toBe(2)
    expect(prefs.pushConfigured, 'VAPID is configured in this test env').toBe(true)

    expect((await post('/api/notification-preferences', s, {
      blocks_enabled: false, quiet_start: '22:30', lead_minutes: 10,
    })).status).toBe(200)
    const after = await (await app.request(
      '/api/notification-preferences', { headers: { Cookie: s.cookie } }, pushEnv,
    )).json<any>()
    expect(after.blocks_enabled).toBe(0)
    expect(after.quiet_start).toBe('22:30')
    expect(after.lead_minutes).toBe(10)
    // an unchanged field keeps its value
    expect(after.quiet_end).toBe('06:00')
  })

  it('reports push as unconfigured when the operator has set no VAPID keys', async () => {
    const s = await login(baseEnv)
    const res = await app.request('/api/notification-preferences', { headers: { Cookie: s.cookie } }, baseEnv)
    const prefs = await res.json<any>()
    expect(prefs.pushConfigured).toBe(false)
    const key = await app.request('/api/push/key', { headers: { Cookie: s.cookie } }, baseEnv)
    expect(key.status, 'the key route must fail closed').toBe(503)
  })
})

describe('B7 alarms — the internal Cron job', () => {
  it('refuses a caller without the shared secret', async () => {
    expect((await job(null)).status).toBe(401)
    expect((await job('wrong-secret')).status).toBe(401)
  })

  it('fails closed when VAPID is not configured', async () => {
    const res = await job('alarms-job-secret', { ...baseEnv, ENFORCEMENT_JOB_SECRET: 'alarms-job-secret' })
    expect(res.status).toBe(503)
  })

  it('delivers at most once per (kind, ref, day) even when re-run, and survives a dead endpoint', async () => {
    const s = await login()
    // A subscription pointing at an unroutable host: sendPush will throw/fail, and
    // the job must still complete and account for it.
    await post('/api/push/subscribe', s, {
      endpoint: 'https://push.invalid.localhost/send/dead',
      p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
      auth: 'tBHItJI5svbpez7KI4CCXg',
    })
    // Force a due debrief nudge regardless of the wall clock, with no quiet hours.
    await post('/api/notification-preferences', s, {
      blocks_enabled: false, review_enabled: false, debrief_enabled: true,
      quiet_start: '00:00', quiet_end: '00:00',
    })
    await env.DB.prepare(`DELETE FROM push_deliveries`).run().catch(() => {})

    const first = await job('alarms-job-secret')
    expect(first.status, 'the job must not 500 on an unreachable push service').toBe(200)
    const second = await job('alarms-job-secret')
    expect(second.status).toBe(200)

    // Whatever fired, it can only have been claimed once per identity.
    const dupes = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT user_id, kind, ref, occurs_on, COUNT(*) AS c
         FROM push_deliveries GROUP BY user_id, kind, ref, occurs_on HAVING c > 1
       )`,
    ).first<{ n: number }>()
    expect(dupes?.n, 'a re-run double-notified').toBe(0)
  })

  it('keeps the delivery ledger append-only', async () => {
    const owner = await env.DB.prepare(`SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`).first<{ id: number }>()
    await env.DB.prepare(
      `INSERT OR IGNORE INTO push_deliveries (user_id, kind, ref, occurs_on)
       VALUES (?,'block','append-only-probe','2026-08-21')`,
    ).bind(owner!.id).run()
    let refused = false
    try {
      await env.DB.prepare(
        `DELETE FROM push_deliveries WHERE ref='append-only-probe'`,
      ).run()
    } catch (e: any) { refused = /PUSH_DELIVERY_APPEND_ONLY/.test(String(e?.message || e)) }
    expect(refused, 'a delivery row could be deleted').toBe(true)
  })
})
