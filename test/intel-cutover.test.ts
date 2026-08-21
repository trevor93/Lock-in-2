import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'

// Book 7 table unification — intel cutover (migration 0014 + route switch).
// Proves intel now reads/writes through captures, the legacy intel_entries table
// is frozen, and the Law-23 alternative-explanation brake still holds — both at
// the application layer (clean 400) and as a schema trigger ON the unified table.

const baseEnv = {
  DB: env.DB, OPENAI_API_KEY: '', OPENAI_BASE_URL: 'https://model.invalid',
  OPENAI_ALLOWED_BASE_URLS: 'https://model.invalid',
}
async function count(sql: string, ...b: unknown[]): Promise<number> {
  const r = await env.DB.prepare(sql).bind(...b).first<{ n: number }>()
  return r?.n ?? 0
}
async function passwordHash(pw: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256)
  return [...new Uint8Array(bits)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
async function login(): Promise<{ cookie: string; csrf: string }> {
  const salt = 'ffeeddccbbaa99887766554433221100'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash('intel-cutover-pw', salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'intel-cutover-pw' }),
  }, baseEnv)
  const cookie = res.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await res.json<{ csrfToken: string }>()
  return { cookie, csrf: csrfToken }
}
function post(path: string, s: { cookie: string; csrf: string }, body: unknown) {
  return app.request(path, {
    method: 'POST', headers: { Cookie: s.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf },
    body: JSON.stringify(body),
  }, baseEnv)
}

describe('B7 intel routes now read/write captures', () => {
  it('POST /api/intel writes to captures (not the frozen legacy table) and GET reads it back', async () => {
    const s = await login()
    const intelBefore = await count(`SELECT COUNT(*) AS n FROM intel_entries`)
    const capturesBefore = await count(`SELECT COUNT(*) AS n FROM captures WHERE kind='intel'`)

    const created = await post('/api/intel', s, {
      domain: 'network', title: 'A quiet reversal', situation: 'they overplayed', heat: 'calm',
    })
    expect([200, 201]).toContain(created.status)
    const { id } = await created.json<{ id: number }>()

    expect(await count(`SELECT COUNT(*) AS n FROM captures WHERE kind='intel'`)).toBe(capturesBefore + 1)
    expect(await count(`SELECT COUNT(*) AS n FROM intel_entries`), 'legacy intel_entries must stay frozen')
      .toBe(intelBefore)

    const list = await app.request('/api/intel', { headers: { Cookie: s.cookie } }, baseEnv)
    const rows = await list.json<Array<{ id: number; title: string }>>()
    expect(rows.find((r) => r.id === id)?.title).toBe('A quiet reversal')
  })

  it('a final verdict on a capture cannot be rewritten', async () => {
    const s = await login()
    const { id } = await (await post('/api/intel', s, { domain: 'money', title: 'verdict path', heat: 'calm' })).json<{ id: number }>()
    expect((await post(`/api/intel/${id}/verdict`, s, { verdict: 'smart', lesson: 'held the line' })).status).toBe(200)
    expect((await post(`/api/intel/${id}/verdict`, s, { verdict: 'dumb' })).status).toBe(409)
  })

  it('the alternative-explanation brake holds through the API for a heated capture', async () => {
    const s = await login()
    const denied = await post('/api/intel', s, { domain: 'women_relationships', title: 'stung', heat: 'baited' })
    expect(denied.status, 'a heated capture with no alternative must be refused').toBe(400)
    const allowed = await post('/api/intel', s, {
      domain: 'women_relationships', title: 'stung but calm', heat: 'baited',
      alternative_explanation: 'They may simply have been tired, not hostile.',
    })
    expect([200, 201]).toContain(allowed.status)
  })

  it('the Law-23 brake is also a trigger on the unified captures table (DB backstop)', async () => {
    const owner = await env.DB.prepare(`SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`).first<{ id: number }>()
    let aborted = false
    try {
      await env.DB.prepare(
        `INSERT INTO captures (user_id, kind, domain, title, heat) VALUES (?,'intel','x','heated no-alt','proud')`,
      ).bind(owner!.id).run()
    } catch (e: any) { aborted = /ALT_EXPLANATION_REQUIRED/.test(String(e?.message || e)) }
    expect(aborted, 'the captures trigger must abort a non-calm intel row with no alternative').toBe(true)

    // A calm row, or a heated row WITH an alternative, is accepted.
    const ok = await env.DB.prepare(
      `INSERT INTO captures (user_id, kind, domain, title, heat, alternative_explanation)
       VALUES (?,'intel','x','heated with alt','proud','maybe it was nothing')`,
    ).bind(owner!.id).run()
    expect(Number((ok.meta as any).changes)).toBe(1)
  })
})
