import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import shellSrc from '../public/static/app/core/shell.js?raw'
import {
  DOMAINS, DOMAIN_LABELS, LEGACY_DOMAINS, collapseDomain,
} from '../src/intel-domains'

// Book 9 — information architecture. "Nine tabs collapse to five: TODAY, LEARN,
// PRACTICE, REVIEW, MORE. Sixteen intel domains collapse to six." Nothing the
// commander had may become unreachable or unfindable in the process.

const baseEnv = {
  DB: env.DB, OPENAI_API_KEY: '', OPENAI_BASE_URL: 'https://model.invalid',
  OPENAI_ALLOWED_BASE_URLS: 'https://model.invalid',
}
async function passwordHash(pw: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256)
  return [...new Uint8Array(bits)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
async function login(): Promise<{ cookie: string; csrf: string; userId: number }> {
  const salt = 'dec0de00dec0de00dec0de00dec0de00'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash('domains-test-pw', salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'domains-test-pw' }),
  }, baseEnv)
  expect(res.status).toBe(200)
  const cookie = res.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await res.json<{ csrfToken: string }>()
  const owner = await env.DB.prepare(`SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`).first<{ id: number }>()
  return { cookie, csrf: csrfToken, userId: owner!.id }
}
function post(path: string, s: { cookie: string; csrf: string }, body: unknown) {
  return app.request(path, {
    method: 'POST', headers: { Cookie: s.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf },
    body: JSON.stringify(body),
  }, baseEnv)
}

describe('B9 sixteen intel domains collapse to six', () => {
  it('offers exactly six domains, each with a label', () => {
    expect(DOMAINS.length).toBe(6)
    for (const d of DOMAINS) expect(DOMAIN_LABELS[d].length).toBeGreaterThan(2)
  })

  it('maps every legacy value onto one of the six — nothing becomes unfindable', () => {
    const unmapped = LEGACY_DOMAINS.filter((legacy) => !(DOMAINS as readonly string[]).includes(collapseDomain(legacy)))
    expect(unmapped, 'a legacy domain fell outside the six').toEqual([])
    // Spot-check the intent of the collapse.
    expect(collapseDomain('family')).toBe('people')
    expect(collapseDomain('classmates')).toBe('people')
    expect(collapseDomain('society')).toBe('network')
    expect(collapseDomain('hustle')).toBe('money')
    expect(collapseDomain('clever_move')).toBe('tactics')
    expect(collapseDomain('manipulation_spotted')).toBe('tactics')
    expect(collapseDomain('other'), 'other lands somewhere real').toBe('wisdom')
    // A value already collapsed maps to itself; nonsense still lands somewhere.
    expect(collapseDomain('people')).toBe('people')
    expect(collapseDomain('nonsense_domain')).toBe('wisdom')
    expect(collapseDomain(null)).toBe('wisdom')
  })

  it('publishes the six so the capture form never invents its own list', async () => {
    const s = await login()
    const res = await app.request('/api/intel/domains', { headers: { Cookie: s.cookie } }, baseEnv)
    expect(res.status).toBe(200)
    const list = await res.json<Array<{ domain: string; label: string }>>()
    expect(list.map((x) => x.domain)).toEqual([...DOMAINS])
  })

  it('accepts a capture in one of the six and reports its group', async () => {
    const s = await login()
    const created = await post('/api/intel', s, {
      domain: 'tactics', title: 'A clean redirection', heat: 'calm',
    })
    expect([200, 201]).toContain(created.status)
    const { id } = await created.json<{ id: number }>()
    const rows = await (await app.request('/api/intel', { headers: { Cookie: s.cookie } }, baseEnv))
      .json<Array<{ id: number; domain: string; domain_group: string }>>()
    const mine = rows.find((r) => r.id === id)
    expect(mine?.domain).toBe('tactics')
    expect(mine?.domain_group).toBe('tactics')
  })

  it('keeps a legacy capture readable and filterable under its new domain', async () => {
    const s = await login()
    // A row written before the collapse, with a legacy value.
    const legacy = await env.DB.prepare(
      `INSERT INTO captures (user_id, kind, log_date, domain, title)
       VALUES (?, 'intel', '2026-08-01', 'women_relationships', 'A legacy capture')`,
    ).bind(s.userId).run()
    const legacyId = Number(legacy.meta.last_row_id)

    const all = await (await app.request('/api/intel', { headers: { Cookie: s.cookie } }, baseEnv))
      .json<Array<{ id: number; domain: string; domain_group: string }>>()
    const row = all.find((r) => r.id === legacyId)
    expect(row?.domain, 'the stored value is never rewritten').toBe('women_relationships')
    expect(row?.domain_group, 'but it is grouped under one of the six').toBe('intimacy')

    // Filtering by the new domain finds the legacy row.
    const filtered = await (await app.request('/api/intel?domain=intimacy', { headers: { Cookie: s.cookie } }, baseEnv))
      .json<Array<{ id: number }>>()
    expect(filtered.some((r) => r.id === legacyId), 'a legacy capture must stay findable').toBe(true)

    // Filtering by the legacy value still works too.
    const byLegacy = await (await app.request('/api/intel?domain=women_relationships', { headers: { Cookie: s.cookie } }, baseEnv))
      .json<Array<{ id: number }>>()
    expect(byLegacy.some((r) => r.id === legacyId)).toBe(true)
  })
})

describe('B9 nine tabs collapse to five', () => {
  it('the shipped bottom nav names exactly TODAY, LEARN, PRACTICE, REVIEW, MORE', () => {
    const block = shellSrc.slice(shellSrc.indexOf('const tabs = ['), shellSrc.indexOf('const markup'))
    const ids = [...block.matchAll(/\['([a-z]+)'/g)].map((m) => m[1])
    expect(ids).toEqual(['today', 'learn', 'practice', 'review', 'more'])
    // The old nine are gone from the bar itself.
    for (const gone of ['now', 'campaign', 'library', 'council', 'mind', 'tongue', 'debrief', 'stats']) {
      expect(ids, `${gone} should no longer be a bottom-bar tab`).not.toContain(gone)
    }
  })

  it('every old tab survives as a face of one of the five', () => {
    const seg = shellSrc.slice(shellSrc.indexOf('export const SEGMENTS'), shellSrc.indexOf('export function segments'))
    for (const face of ['now', 'schedule', 'campaign', 'books', 'cards', 'maxims',
      'tongue', 'debrief', 'stats', 'council', 'intel', 'settings']) {
      expect(seg, `the ${face} surface must still be reachable`).toContain(`'${face}'`)
    }
  })
})
