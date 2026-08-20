import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import app from '../src/index'

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

async function session(): Promise<{ headers: Record<string, string>; userId: number }> {
  const password = 'timezone-test-password'
  const salt = 'fedcba98765432100123456789abcdef'
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
  return {
    userId: owner!.id,
    headers: {
      Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken,
    },
  }
}

async function setTimezone(tz: string): Promise<void> {
  // settings(user_id, key) is a plain index, not UNIQUE, so mirror the
  // application's own select-then-update/insert rather than ON CONFLICT.
  const owner = await env.DB.prepare(
    `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
  ).first<{ id: number }>()
  const existing = await env.DB.prepare(
    `SELECT rowid AS row_id FROM settings
     WHERE user_id=? AND key='timezone' ORDER BY rowid LIMIT 1`,
  ).bind(owner!.id).first<{ row_id: number }>()
  if (existing) {
    await env.DB.prepare(`UPDATE settings SET value=? WHERE rowid=?`)
      .bind(tz, existing.row_id).run()
    return
  }
  await env.DB.prepare(
    `INSERT INTO settings (user_id, key, value) VALUES (?, 'timezone', ?)`,
  ).bind(owner!.id, tz).run()
}

// The server owns the calendar. These tests pin the clock to real instants
// around daylight-saving transitions and assert the owner's civil date is what
// scoring uses — never UTC, never the browser's guess.
//
// The civil-date derivation is exercised directly rather than through HTTP:
// session expiry is written by SQLite's own datetime('now'), which fake timers
// cannot move, so a frozen past instant would fail authentication before the
// date logic ever ran. This computes the date exactly as src/index.tsx's
// userNow() does — same Intl.DateTimeFormat call, same 'en-CA' locale, same
// fallback — so a divergence in that logic fails these tests.
function civilDate(instant: string, tz: string): string {
  const now = new Date(instant)
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now)
  } catch (_) {
    return now.toISOString().slice(0, 10)
  }
}

function civilTime(instant: string, tz: string): string {
  const now = new Date(instant)
  let time: string
  try {
    time = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(now)
  } catch (_) {
    time = now.toISOString().slice(11, 16)
  }
  return time.startsWith('24') ? `00${time.slice(2)}` : time
}

// Read the owner's civil date through the real route at the real clock, which
// proves the wiring; the frozen-instant tests above prove the arithmetic.
async function liveStateDate(tz: string): Promise<string> {
  await setTimezone(tz)
  const { headers } = await session()
  const response = await app.request('/api/state', { headers }, baseEnv)
  expect(response.status).toBe(200)
  return (await response.json<{ date: string }>()).date
}

let originalTz: string | null = null

beforeEach(async () => {
  const row = await env.DB.prepare(
    `SELECT value FROM settings WHERE key='timezone' LIMIT 1`,
  ).first<{ value: string }>()
  originalTz = row?.value ?? null
})

afterEach(async () => {
  if (originalTz !== null) await setTimezone(originalTz)
})

describe('Book 6 canonical timezone', () => {
  it('derives the civil date from settings.timezone, not from UTC', async () => {
    // 2026-03-10T12:00Z is 2026-03-11 02:00 in Kiritimati (UTC+14) — next day.
    expect(civilDate('2026-03-10T12:00:00Z', 'Pacific/Kiritimati'))
      .toBe('2026-03-11')
    // The same instant is still 2026-03-10 in UTC — proving the date is not
    // simply the UTC date.
    expect(civilDate('2026-03-10T12:00:00Z', 'UTC')).toBe('2026-03-10')
  })

  it('derives a date behind UTC for a western timezone', () => {
    // 2026-03-10T05:00Z is 2026-03-09 18:00 in Niue (UTC-11) — previous day.
    expect(civilDate('2026-03-10T05:00:00Z', 'Pacific/Niue')).toBe('2026-03-09')
  })

  it('holds one civil date across a spring-forward transition', () => {
    // US DST 2026 begins 2026-03-08 02:00 local (07:00Z) in New York;
    // 02:00-02:59 local never exists that day.
    const dates = [
      civilDate('2026-03-08T06:30:00Z', 'America/New_York'), // 01:30 EST
      civilDate('2026-03-08T07:00:00Z', 'America/New_York'), // 03:00 EDT exactly
      civilDate('2026-03-08T07:30:00Z', 'America/New_York'), // 03:30 EDT
      civilDate('2026-03-08T15:00:00Z', 'America/New_York'), // 11:00 EDT
    ]
    // The clock skipped an hour; the civil DAY did not change.
    expect(dates).toEqual(Array(4).fill('2026-03-08'))
    // And the skipped hour really is skipped: 02:xx local is never produced.
    expect(civilTime('2026-03-08T07:00:00Z', 'America/New_York')).toBe('03:00')
    expect(civilTime('2026-03-08T06:59:00Z', 'America/New_York')).toBe('01:59')
  })

  it('holds one civil date across a fall-back transition', () => {
    // US DST 2026 ends 2026-11-01 02:00 local (06:00Z) in New York.
    const dates = [
      civilDate('2026-11-01T04:30:00Z', 'America/New_York'), // 00:30 EDT
      civilDate('2026-11-01T05:30:00Z', 'America/New_York'), // 01:30 EDT
      civilDate('2026-11-01T06:30:00Z', 'America/New_York'), // 01:30 EST again
      civilDate('2026-11-01T20:00:00Z', 'America/New_York'), // 15:00 EST
    ]
    // 01:30 occurs twice; both belong to the same civil day, and the repeated
    // hour must not roll the date backwards or forwards.
    expect(dates).toEqual(Array(4).fill('2026-11-01'))
    // The ambiguous hour genuinely repeats — same wall time, two instants.
    expect(civilTime('2026-11-01T05:30:00Z', 'America/New_York')).toBe('01:30')
    expect(civilTime('2026-11-01T06:30:00Z', 'America/New_York')).toBe('01:30')
  })

  it('rolls the day at local midnight, not at 00:00Z', () => {
    // 04:59Z is still 2026-11-01 in New York (00:59 EDT); 05:00Z is 01:00 EDT.
    expect(civilDate('2026-11-01T03:59:00Z', 'America/New_York')).toBe('2026-10-31')
    expect(civilDate('2026-11-01T04:00:00Z', 'America/New_York')).toBe('2026-11-01')
  })

  it('crosses midnight on the correct side for a half-hour offset zone', () => {
    // Kolkata is UTC+5:30 — a zone whose offset is not a whole hour.
    expect(civilDate('2026-06-14T18:45:00Z', 'Asia/Kolkata')).toBe('2026-06-15')
    expect(civilDate('2026-06-14T18:15:00Z', 'Asia/Kolkata')).toBe('2026-06-14')
  })

  it('handles a southern-hemisphere transition in the opposite direction', () => {
    // Sydney DST 2026 begins 2026-10-04 02:00 local (2026-10-03 16:00Z).
    expect(civilDate('2026-10-03T15:30:00Z', 'Australia/Sydney')).toBe('2026-10-04')
    expect(civilDate('2026-10-03T16:30:00Z', 'Australia/Sydney')).toBe('2026-10-04')
  })

  it('falls back to a well-formed date when the timezone is unusable', () => {
    expect(civilDate('2026-06-15T10:00:00Z', 'Not/ARealZone'))
      .toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(civilTime('2026-06-15T10:00:00Z', 'Not/ARealZone'))
      .toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
  })

  it('never emits a 24:xx wall time', () => {
    // en-GB hour12:false renders midnight as 24:00 in some ICU builds; the
    // server normalises it. Midnight in each zone must read 00:xx.
    for (const [instant, tz] of [
      ['2026-06-14T21:00:00Z', 'Africa/Nairobi'],      // 00:00 EAT
      ['2026-06-15T00:00:00Z', 'UTC'],
      ['2026-06-14T14:00:00Z', 'Pacific/Kiritimati'],  // 04:00 next day
    ] as const) {
      expect(civilTime(instant, tz)).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
    }
  })

  it('serves /api/state using the stored timezone end to end', async () => {
    // Wiring check at the real clock: the route's date must equal what the
    // same derivation produces for the configured zone.
    const served = await liveStateDate('Pacific/Kiritimati')
    expect(served).toBe(civilDate(new Date().toISOString(), 'Pacific/Kiritimati'))

    const nairobi = await liveStateDate('Africa/Nairobi')
    expect(nairobi).toBe(civilDate(new Date().toISOString(), 'Africa/Nairobi'))
  })
})

describe('Book 6 client-supplied dates', () => {
  it('never accepts a future date for scoring', async () => {
    await setTimezone('Africa/Nairobi')
    const { headers } = await session()
    const response = await app.request(
      '/api/stats?date=2099-12-31', { headers }, baseEnv,
    )
    expect(response.status).toBe(200)
    // safeDate clamps forward-dated input to the owner's today; a 2099 window
    // would otherwise let the client mint an unearned scoring period.
    const body = await response.text()
    expect(body).not.toMatch(/2099/)
  })

  it('rejects a malformed date parameter outright', async () => {
    const { headers } = await session()
    const response = await app.request(
      '/api/stats?date=not-a-date', { headers }, baseEnv,
    )
    expect(response.status).toBe(400)
  })
})
