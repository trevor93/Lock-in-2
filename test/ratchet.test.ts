import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import {
  ANCHOR_TARGET, HOLD_DAYS, DEMOTE_AFTER_MISSES,
  consequenceBlocks, penalisedBlocks, heldCleanly, needsAnchors, promotionVerdict,
} from '../src/ratchet'
import { dayAdherence } from '../src/scoring'

// Book 8.1 — THE RATCHET. The mandatory day is three anchors; the rest is a deck.
// These prove the rule that matters: consequence covers the mandatory set ONLY, a
// promotion must be earned by a clean seven-day hold, a block that misses three
// times running is demoted, and reducing your own load is never punished.

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
  const salt = 'beefcafe0123456789abcdefbeefcafe'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash('ratchet-test-pw', salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'ratchet-test-pw' }),
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
async function makeBlock(userId: number, title: string, start: string, tier = 'deck'): Promise<number> {
  const r = await env.DB.prepare(
    `INSERT INTO schedule_blocks
       (user_id, sort_order, start_time, end_time, title, category, days, weight, points, ratchet_tier)
     VALUES (?,?,?,?,?,'deepwork','mon,tue,wed,thu,fri,sat,sun',3,10,?)`,
  ).bind(userId, 50, start, start.replace(/^(\d\d)/, (h) => String(Number(h) + 1).padStart(2, '0')), title, tier).run()
  return Number(r.meta.last_row_id)
}

describe('B8.1 ratchet — the rules, as pure functions', () => {
  it('scores and penalises the mandatory set only, once one exists', () => {
    const blocks = [
      { id: 1, title: 'anchor', start_time: '06:00', weight: 3, ratchet_tier: 'mandatory', log_status: 'done', is_non_negotiable: 0 },
      { id: 2, title: 'deck one', start_time: '10:00', weight: 3, ratchet_tier: 'deck', log_status: null, is_non_negotiable: 1 },
    ]
    expect(consequenceBlocks(blocks).map((b) => b.id), 'deck blocks must not be scored').toEqual([1])
    expect(penalisedBlocks(blocks).map((b) => b.id), 'a deck block must not be punished even if non-negotiable').toEqual([1])
    // The unfinished deck block cannot drag the day down.
    expect(dayAdherence(blocks).pct).toBe(100)
  })

  it('falls back to the prior rule while no anchor has been named', () => {
    const blocks = [
      { id: 1, title: 'nn', start_time: '06:00', weight: 3, ratchet_tier: 'deck', log_status: null, is_non_negotiable: 1 },
      { id: 2, title: 'other', start_time: '10:00', weight: 1, ratchet_tier: 'deck', log_status: 'done', is_non_negotiable: 0 },
    ]
    expect(needsAnchors(blocks)).toBe(true)
    expect(consequenceBlocks(blocks).length, 'nothing is silently unscored').toBe(2)
    expect(penalisedBlocks(blocks).map((b) => b.id), 'the declared non-negotiable still counts').toEqual([1])
  })

  it('a day is held only when every scheduled mandatory block landed', () => {
    const done = [{ id: 1, title: 'a', start_time: '06:00', ratchet_tier: 'mandatory', log_status: 'done' }]
    const partial = [{ id: 1, title: 'a', start_time: '06:00', ratchet_tier: 'mandatory', log_status: 'partial' }]
    const missed = [
      { id: 1, title: 'a', start_time: '06:00', ratchet_tier: 'mandatory', log_status: 'done' },
      { id: 2, title: 'b', start_time: '09:00', ratchet_tier: 'mandatory', log_status: null },
    ]
    expect(heldCleanly(done)).toBe(true)
    expect(heldCleanly(partial), 'a partial is still a landing').toBe(true)
    expect(heldCleanly(missed)).toBe(false)
    expect(heldCleanly([]), 'an empty set is not a hold').toBe(false)
  })

  it('promotion is free below three anchors and earned by a clean hold above them', () => {
    const noState = { hold_started_on: null, last_promotion_on: null, last_demotion_on: null }
    expect(promotionVerdict(0, 0, noState, '2026-08-22').allowed, 'naming the first anchor').toBe(true)
    expect(promotionVerdict(ANCHOR_TARGET - 1, 0, noState, '2026-08-22').allowed).toBe(true)
    // At the anchor target, a partial hold is not enough.
    const short = promotionVerdict(ANCHOR_TARGET, HOLD_DAYS - 1, noState, '2026-08-22')
    expect(short.allowed).toBe(false)
    expect(short.reason).toContain(`${HOLD_DAYS - 1} of ${HOLD_DAYS}`)
    expect(promotionVerdict(ANCHOR_TARGET, HOLD_DAYS, noState, '2026-08-22').allowed).toBe(true)
    // One promotion per day.
    const already = { ...noState, last_promotion_on: '2026-08-22' }
    expect(promotionVerdict(ANCHOR_TARGET, HOLD_DAYS, already, '2026-08-22').allowed).toBe(false)
  })
})

describe('B8.1 ratchet — the routes', () => {
  it('reports the mandatory set, the deck, and whether anchors are still unnamed', async () => {
    const s = await login()
    const res = await app.request('/api/ratchet', { headers: { Cookie: s.cookie } }, baseEnv)
    expect(res.status).toBe(200)
    const body = await res.json<any>()
    expect(body.anchorTarget).toBe(ANCHOR_TARGET)
    expect(body.holdRequired).toBe(HOLD_DAYS)
    expect(Array.isArray(body.mandatory)).toBe(true)
    expect(Array.isArray(body.deck)).toBe(true)
    expect(typeof body.needsAnchors).toBe('boolean')
  })

  it('promotes a deck block while the set is still being assembled, and records it', async () => {
    const s = await login()
    await env.DB.prepare(`UPDATE schedule_blocks SET ratchet_tier='deck' WHERE user_id=?`).bind(s.userId).run()
    const id = await makeBlock(s.userId, 'Wake', '05:30')

    const res = await post('/api/ratchet/promote', s, { block_id: id })
    expect(res.status).toBe(200)
    const row = await env.DB.prepare(
      `SELECT ratchet_tier FROM schedule_blocks WHERE id=?`,
    ).bind(id).first<{ ratchet_tier: string }>()
    expect(row?.ratchet_tier).toBe('mandatory')
    const event = await env.DB.prepare(
      `SELECT event FROM ratchet_events WHERE block_id=? ORDER BY id DESC LIMIT 1`,
    ).bind(id).first<{ event: string }>()
    expect(event?.event).toBe('promoted')

    // Promoting the same block again is refused rather than duplicated.
    expect((await post('/api/ratchet/promote', s, { block_id: id })).status).toBe(409)
  })

  it('refuses a promotion past three anchors without a clean seven-day hold', async () => {
    const s = await login()
    await env.DB.prepare(`UPDATE schedule_blocks SET ratchet_tier='deck' WHERE user_id=?`).bind(s.userId).run()
    await env.DB.prepare(`DELETE FROM ratchet_state WHERE user_id=?`).bind(s.userId).run()
    const anchors = [
      await makeBlock(s.userId, 'A1', '05:00', 'mandatory'),
      await makeBlock(s.userId, 'A2', '07:00', 'mandatory'),
      await makeBlock(s.userId, 'A3', '21:00', 'mandatory'),
    ]
    expect(anchors.length).toBe(ANCHOR_TARGET)
    const fourth = await makeBlock(s.userId, 'Fourth', '13:00')

    const res = await post('/api/ratchet/promote', s, { block_id: fourth })
    expect(res.status, 'the fourth block must be earned').toBe(409)
    const body = await res.json<any>()
    expect(body.error).toBe('PROMOTION NOT EARNED')
    expect(body.reason).toContain(`of ${HOLD_DAYS}`)
    const still = await env.DB.prepare(
      `SELECT ratchet_tier FROM schedule_blocks WHERE id=?`,
    ).bind(fourth).first<{ ratchet_tier: string }>()
    expect(still?.ratchet_tier).toBe('deck')
  })

  it('lets him send a block back to the deck at any time, and records why', async () => {
    const s = await login()
    const id = await makeBlock(s.userId, 'Too much', '15:00', 'mandatory')
    const res = await post('/api/ratchet/demote', s, { block_id: id, reason: 'Too long for a weekday.' })
    expect(res.status, 'reducing your own load is never refused').toBe(200)
    const row = await env.DB.prepare(
      `SELECT ratchet_tier FROM schedule_blocks WHERE id=?`,
    ).bind(id).first<{ ratchet_tier: string }>()
    expect(row?.ratchet_tier).toBe('deck')
    const event = await env.DB.prepare(
      `SELECT event, reason FROM ratchet_events WHERE block_id=? ORDER BY id DESC LIMIT 1`,
    ).bind(id).first<{ event: string; reason: string }>()
    expect(event?.event).toBe('demoted')
    expect(event?.reason).toBe('Too long for a weekday.')
    // Demoting something already in the deck is a 404, not a silent success.
    expect((await post('/api/ratchet/demote', s, { block_id: id })).status).toBe(404)
  })

  it('keeps the ratchet history append-only', async () => {
    const s = await login()
    const id = await makeBlock(s.userId, 'History probe', '16:00', 'mandatory')
    await post('/api/ratchet/demote', s, { block_id: id })
    let refused = false
    try {
      await env.DB.prepare(`DELETE FROM ratchet_events WHERE block_id=?`).bind(id).run()
    } catch (e: any) { refused = /RATCHET_EVENTS_APPEND_ONLY/.test(String(e?.message || e)) }
    expect(refused, 'a ratchet event could be deleted').toBe(true)
  })

  it('exposes the ratchet in /api/state without extra queries', async () => {
    const s = await login()
    const res = await app.request('/api/state', { headers: { Cookie: s.cookie } }, baseEnv)
    expect(res.status).toBe(200)
    const state = await res.json<any>()
    expect(state.ratchet).toBeTruthy()
    expect(state.ratchet.anchorTarget).toBe(ANCHOR_TARGET)
    expect(typeof state.ratchet.mandatoryToday).toBe('number')
    expect(typeof state.ratchet.needsAnchors).toBe('boolean')
  })
})

describe('B8.1 ratchet — demotion after repeated misses', () => {
  it('returns a mandatory block to the deck after three straight misses, with no extra penalty', async () => {
    const s = await login()
    // A block scheduled every day, mandatory, never logged.
    const id = await makeBlock(s.userId, 'Not holding', '11:00', 'mandatory')
    await env.DB.prepare(
      `INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, 'start_date', '2020-01-01')`,
    ).bind(s.userId).run().catch(async () => {
      await env.DB.prepare(`INSERT INTO settings (user_id, key, value) VALUES (?, 'start_date', '2020-01-01')`).bind(s.userId).run()
    })

    // Crank the engine: yesterday and the two days before have no log for it.
    const tick = await post('/api/tick', s, {})
    expect(tick.status).toBe(200)

    const row = await env.DB.prepare(
      `SELECT ratchet_tier FROM schedule_blocks WHERE id=?`,
    ).bind(id).first<{ ratchet_tier: string }>()
    expect(row?.ratchet_tier, `a block missed ${DEMOTE_AFTER_MISSES}x running must return to the deck`).toBe('deck')

    const event = await env.DB.prepare(
      `SELECT event, reason FROM ratchet_events WHERE block_id=? AND event='demoted' ORDER BY id DESC LIMIT 1`,
    ).bind(id).first<{ event: string; reason: string }>()
    expect(event?.reason).toContain('Returned to the deck')

    // The demotion flag carries no point penalty: it removes consequence.
    const penalty = await env.DB.prepare(
      `SELECT COALESCE(SUM(points),0) AS p FROM points_ledger
       WHERE user_id=? AND reason LIKE '%RETURNED TO THE DECK%'`,
    ).bind(s.userId).first<{ p: number }>()
    expect(penalty?.p, 'demotion must never cost points').toBe(0)
  })
})
