import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'

// Book 17 test matrix, Curriculum row: "UNIT PROGRESSION, six-level ladder, transfer
// reference required for transferred status, delayed review, LOCKED-UNIT BEHAVIOUR,
// source metadata present."
//
// The progress lock is also one of the six behaviours the standing brief names as
// must-preserve, alongside the honesty engine, the append-only journal, the same-day
// window close, never-miss-twice, and offline mobile use. It was enforced by exactly
// one line — src/routes/learn.ts, `if (up.status === 'locked')` — and NOTHING tested
// it. A refactor that dropped that line, or merely moved it below the reading check,
// would have taken the whole suite green with the lock gone.
//
// The test fixture seeds ONE unit in ONE phase, so `ensureUnlocks` activates it and no
// unit is ever locked. A test written against that fixture would have passed while
// asserting nothing — the vacuous pass this audit keeps finding, and the first draft of
// this very file did exactly that: `rows.slice(activeIndex + 1)` was empty, so "every
// unit behind the active one is locked" held over an empty list. So this file BUILDS the
// ladder it needs — four rungs in a track of its own, which is the exact N / N+1 shape
// the rule is about — and asserts all four rungs by id rather than by slice.
//
// Four claims, because they fail independently:
//
//   1. The lock exists as DATA. One active unit per track, every later unit locked.
//   2. Progression is one step. Conquering N activates N+1 and leaves N+2 locked.
//   3. The lock REFUSES, and refuses without writing. A 400 that still advanced the
//      record would be worse than no lock at all.
//   4. The lock is checked FIRST. The reading gate sits directly beneath it; if the two
//      ever swapped, a locked unit could bank a measured reading session and the refusal
//      would arrive after the state change. The ordering is the invariant.

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
  const salt = '13579bdf13579bdf13579bdf13579bdf'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash('progress-lock-pw', salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'progress-lock-pw' }),
  }, baseEnv)
  const cookie = res.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await res.json<{ csrfToken: string }>()
  const owner = await env.DB.prepare(`SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`).first<{ id: number }>()
  return { cookie, csrf: csrfToken, userId: owner!.id }
}

function post(path: string, s: { cookie: string; csrf: string }, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { Cookie: s.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf },
    body: JSON.stringify(body),
  }, baseEnv)
}

/**
 * A four-rung ladder in a phase and TRACK of its own.
 *
 * Its own track, deliberately. `ensureUnlocks` groups phases by `phases.track` and walks
 * each group independently, so a ladder hung behind the fixture's incomplete legacy unit
 * would have every rung locked — including the first — and the "exactly one active" claim
 * would fail for a reason that has nothing to do with the lock. A fresh track is the
 * smallest arrangement in which the rule under test is the only thing being exercised.
 *
 * The counter keeps each call's track distinct: the workers pool does not roll storage
 * back between tests in a file, so a fixed name would have the second test inheriting the
 * first test's completed rungs.
 *
 * Returns the four unit ids in ladder order, so a test can name "the one after the active
 * one" without hard-coding a row id.
 */
let ladderSeq = 0
async function buildLadder(): Promise<number[]> {
  const n = ++ladderSeq
  const track = `ladder-${n}`
  await env.DB.prepare(
    `INSERT INTO phases (code, title, sort_order, track) VALUES (?,?,?,?)`,
  ).bind(`LAD${n}`, `Ladder phase ${n}`, 100 + n, track).run()
  const phase = await env.DB.prepare(
    `SELECT id FROM phases WHERE track=?`,
  ).bind(track).first<{ id: number }>()
  expect(phase, 'the ladder phase did not insert').not.toBeNull()
  for (const rung of [1, 2, 3, 4]) {
    await env.DB.prepare(
      `INSERT INTO units (phase_id, sort_order, title) VALUES (?,?,?)`,
    ).bind(phase!.id, rung, `Ladder ${n} unit ${rung}`).run()
  }
  const rows = (await env.DB.prepare(
    `SELECT id FROM units WHERE phase_id=? ORDER BY sort_order`,
  ).bind(phase!.id).all()).results as unknown as Array<{ id: number }>
  expect(rows.length, 'the ladder did not build').toBe(4)
  return rows.map((r) => r.id)
}

/**
 * Seed the lock by cranking the engine.
 *
 * `ensureUnlocks` is reachable from exactly two places: `runEnforcement`, which only
 * `POST /api/tick` and the protected internal cron call, and the tail of a conquered
 * unit's own step. No GET runs it — which is the Book 17 first-slice rule ("all GET and
 * HEAD handlers read-only") holding in the one place it would be most tempting to break,
 * since `GET /api/campaign` is precisely the read that wants fresh unlocks. So this
 * helper ticks. A first draft of this file read the campaign instead and got a 404 from
 * every step, because nothing had written a `unit_progress` row at all.
 */
async function seedUnlocks(s: { cookie: string; csrf: string }): Promise<void> {
  const res = await post('/api/tick', s, {})
  expect(res.status, 'the tick failed, so nothing was seeded').toBe(200)
}

const statusOf = async (userId: number, unitId: number): Promise<string | undefined> =>
  (await env.DB.prepare(
    `SELECT status FROM unit_progress WHERE user_id=? AND unit_id=?`,
  ).bind(userId, unitId).first<{ status: string }>())?.status

describe('B10/B17 the progress lock exists as data, not only as an error message', () => {
  it('a seeded ladder has exactly one active unit and locks every unit behind it', async () => {
    const s = await login()
    const ladder = await buildLadder()
    await seedUnlocks(s)

    const statuses = await Promise.all(ladder.map((id) => statusOf(s.userId, id)))
    // Floor: if seeding wrote no rows at all, every claim below would be vacuous.
    expect(statuses.filter(Boolean).length, 'unit_progress was not seeded for the ladder').toBe(4)
    expect(statuses[0], 'the first unit is not open — nothing is reachable').toBe('active')
    expect(
      statuses.slice(1),
      'a unit behind the active one is not locked — unit N+1 stays locked until N is conquered',
    ).toEqual(['locked', 'locked', 'locked'])
  })

  it('conquering a unit opens exactly the next one and leaves the rest locked', async () => {
    // Unit progression, the same matrix row. One step, not a cascade: a seeder that
    // activated everything after the completed unit would satisfy "N+1 is active".
    const s = await login()
    const ladder = await buildLadder()
    await seedUnlocks(s)
    await env.DB.prepare(
      `UPDATE unit_progress SET status='complete', completed_at=datetime('now') WHERE user_id=? AND unit_id=?`,
    ).bind(s.userId, ladder[0]).run()
    await seedUnlocks(s)

    expect(await statusOf(s.userId, ladder[0]), 'a conquered unit was reopened').toBe('complete')
    expect(await statusOf(s.userId, ladder[1]), 'the next unit did not open').toBe('active')
    expect(
      [await statusOf(s.userId, ladder[2]), await statusOf(s.userId, ladder[3])],
      'conquering one unit unlocked more than one — the ladder is not a ladder',
    ).toEqual(['locked', 'locked'])
  })
})

describe('B10/B17 a locked unit refuses every step and moves nothing', () => {
  it('the step route refuses with 400 and names the reason', async () => {
    const s = await login()
    const ladder = await buildLadder()
    await seedUnlocks(s)

    const res = await post(`/api/units/${ladder[1]}/step`, s, { step: 'reading', date: '2026-08-24' })
    expect(res.status, 'a locked unit accepted a step — the progress lock is gone').toBe(400)
    const body = await res.json<{ error?: string }>()
    expect(body.error, 'the refusal does not tell him WHY, so it reads as a bug').toMatch(/LOCKED/i)
  })

  it('the refused step leaves the record exactly as it was', async () => {
    // A 400 that had already written is the failure mode a status-code assertion cannot
    // see. Compare the whole row across every step the route accepts.
    //
    // The three steps are the three the schema accepts — `reading`, `drill`, `complete`.
    // An earlier draft looped over 'debrief' and 'exam' too, which the strict body schema
    // rejects before the route runs: two of the four iterations were refused by the
    // validator and never reached the lock at all. Half a test, passing.
    //
    // This is also where the lock's SECOND wall shows: `allowedUnitSteps` has no entry
    // for 'locked', so even with the lock line deleted a locked unit is refused again by
    // the transition table. Removing the lock therefore does NOT make this test fail —
    // which is worth stating plainly rather than implying a coverage this test hasn't got.
    // What it does hold is the claim in its name, and it holds it for all three steps.
    const s = await login()
    const ladder = await buildLadder()
    await seedUnlocks(s)

    const snapshot = async () => JSON.stringify(await env.DB.prepare(
      `SELECT status, reading_done_at, drill_done_at, drill_report, completed_at
       FROM unit_progress WHERE user_id=? AND unit_id=?`,
    ).bind(s.userId, ladder[1]).first())

    const before = await snapshot()
    expect(JSON.parse(before)?.status, 'the target unit was not locked to begin with').toBe('locked')
    for (const step of ['reading', 'drill', 'complete']) {
      const res = await post(`/api/units/${ladder[1]}/step`, s, {
        step, date: '2026-08-24',
        drill_report: 'A real report, long enough to clear the thin-report floor by some way.',
        debrief_answer: 'forced', exam_answers: ['a'], exam_self_score: 100,
      })
      // Floor: a step that was ACCEPTED would leave the row changed, but a step the
      // validator rejected never reached the lock. Both must be visible, so require a
      // refusal in the 4xx range for each one individually.
      expect(res.status, `step ${step} was not refused`).toBeGreaterThanOrEqual(400)
      expect(res.status, `step ${step} failed on the server rather than being refused`).toBeLessThan(500)
    }
    expect(await snapshot(), 'a refused step still wrote to the locked unit').toBe(before)
  })

  it('the lock is checked BEFORE the reading gate, so a locked unit is refused as locked', async () => {
    // The ordering invariant. src/routes/learn.ts checks `status === 'locked'` first and
    // only THEN asks whether a plausible reading session exists. Move the lock below the
    // reading gate and a locked unit with NO session is refused with the reading gate's
    // 409 `needsReading` — the wrong refusal, telling him to go and read a chapter he is
    // not yet entitled to read, and hiding the ladder rule behind an unrelated complaint.
    //
    // A locked unit with no session is the arrangement that separates the two orderings.
    // Give it a PLAUSIBLE session instead and both orderings return the lock's 400, since
    // the reading gate falls through — which is why the plausible-session case belongs in
    // its own test below rather than here.
    const s = await login()
    const ladder = await buildLadder()
    await seedUnlocks(s)

    const res = await post(`/api/units/${ladder[1]}/step`, s, { step: 'reading', date: '2026-08-24' })
    expect(res.status, 'the reading gate answered before the lock did').toBe(400)
    const body = await res.json<{ error?: string; needsReading?: boolean }>()
    expect(body.error, 'a locked unit was refused for the wrong reason').toMatch(/LOCKED/i)
    expect(
      body.needsReading,
      'the reading gate answered a question the lock had already closed',
    ).toBeUndefined()
  })

  it('a measured, plausible read does not let a locked unit through', async () => {
    // The other half: the lock is not merely FIRST, it is unconditional. A session that
    // would satisfy the reading gate on its own must still be refused by the lock, and
    // must move nothing.
    const s = await login()
    const ladder = await buildLadder()
    await seedUnlocks(s)

    await env.DB.prepare(
      `INSERT INTO reading_sessions
         (user_id, book_id, chapter_idx, unit_id, dwell_seconds, max_scroll_pct,
          sections_seen, word_count, plausible)
       VALUES (?, 'test-book', 1, ?, 3600, 100, 20, 2000, 1)`,
    ).bind(s.userId, ladder[1]).run()

    const res = await post(`/api/units/${ladder[1]}/step`, s, { step: 'reading', date: '2026-08-24' })
    expect(res.status, 'a plausible read let a LOCKED unit through').toBe(400)
    expect((await res.json<{ error?: string }>()).error, 'the refusal was not the lock’s').toMatch(/LOCKED/i)
    expect(await statusOf(s.userId, ladder[1]), 'the locked unit advanced anyway').toBe('locked')
  })
})

describe('B10/B17 a conquered unit is terminal', () => {
  it('a complete unit refuses a rewrite with 409 rather than reopening', async () => {
    // The other end of the same rule: progression is one-way. The append-only principle
    // covers the curriculum record too — a conquered unit is history, not a draft.
    const s = await login()
    const ladder = await buildLadder()
    await seedUnlocks(s)
    await env.DB.prepare(
      `UPDATE unit_progress SET status='complete', completed_at=datetime('now') WHERE user_id=? AND unit_id=?`,
    ).bind(s.userId, ladder[0]).run()

    const res = await post(`/api/units/${ladder[0]}/step`, s, { step: 'reading', date: '2026-08-24' })
    expect(res.status, 'a conquered unit was reopened for a rewrite').toBe(409)
    const body = await res.json<{ error?: string }>()
    expect(body.error).toMatch(/COMPLETE|Terminal/i)
  })
})
