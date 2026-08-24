import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'

// Book 17 test matrix, Curriculum row: "... transfer reference required for transferred
// status, DELAYED REVIEW, locked-unit behaviour ..."
//
// "Delayed review" has no feature code of its own — `grep -i delay` over src/ and
// migrations/ finds nothing but seed prose. It is a PROPERTY of the three review queues,
// and it had zero coverage. Thirteen scheduling tests exist across test/fsrs.test.ts,
// test/fsrs-wiring.test.ts and test/tongue-review.test.ts; every one of them reviews a
// card on the day it fell due, or proves a not-yet-due card is refused. None reviews a
// card LATE, which is the case that actually happens: he misses four days, comes back,
// and the queue has to behave.
//
// Three queues share the shape, and each implements it separately:
//
//   maxim flashcards  src/routes/learn.ts     SM-2 on flashcards
//   the Tongue        src/routes/tongue.ts    FSRS on review_items
//   the ladder        src/routes/rhetoric.ts  the fixed 1/3/7/16/35 on rhetoric_cards
//
// Four claims per queue, each of which fails on its own:
//
//   1. An overdue item is STILL IN the queue, most-overdue first. The predicate is
//      `due_date <= ?`; a `=` would silently drop everything he missed, and the queue
//      would look empty precisely on the day he came back to it.
//   2. A late review is ACCEPTED. The not-due guard must test `due_date > today` only.
//   3. The next due date is computed from the day the review HAPPENED, not from the
//      stale due date. Reschedule from the stale date and a card 400 days overdue comes
//      back due immediately, forever — the queue never drains and the ladder is a
//      treadmill.
//   4. The delay is VISIBLE to the scheduler. FSRS prices a success by how much was
//      forgotten first, so `elapsed` must be measured from the last real review.
//
// And the mirror image, which is how a delay would be faked away rather than served:
// a review cannot be dated in the FUTURE. Nine of the ten route files run every
// client-supplied date through `safeDate`, which clamps forward dates to today.

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
  const salt = '2468ace02468ace02468ace02468ace0'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash('delayed-review-pw', salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'delayed-review-pw' }),
  }, baseEnv)
  expect(res.status, 'login failed, so every claim below would be a 401').toBe(200)
  const cookie = res.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await res.json<{ csrfToken: string }>()
  const owner = await env.DB.prepare(`SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`).first<{ id: number }>()
  return { cookie, csrf: csrfToken, userId: owner!.id }
}

type Session = { cookie: string; csrf: string; userId: number }

function post(path: string, s: Session, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { Cookie: s.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf },
    body: JSON.stringify(body),
  }, baseEnv)
}

const get = (path: string, s: Session) =>
  app.request(path, { headers: { Cookie: s.cookie } }, baseEnv)

/**
 * A fixed PAST date, used as the review date everywhere below.
 *
 * `safeDate` clamps a forward date to today and passes a past one through unchanged, so
 * naming a past date makes every reschedule assertion exact and independent of the wall
 * clock — which a test that reviewed "today" could not be. It only has to stay in the
 * past, and time does not run backwards.
 */
const REVIEWED_ON = '2026-08-20'

/** Long enough ago that no plausible interval could reach today from there. */
const ANCIENT = '1990-01-01'
const LESS_ANCIENT = '1995-01-01'

/** The app's own idea of today, asked of the app rather than assumed. */
async function todayPerApp(s: Session): Promise<string> {
  const res = await get('/api/rhetoric/review/due', s)
  expect(res.status, 'could not read the app clock').toBe(200)
  const { date } = await res.json<{ date: string }>()
  expect(date, 'the app did not report a date').toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)
  return date
}

// ---------------------------------------------------------------------------
// Seeds. Each returns an id and backdates the schedule row, which is the only way to
// simulate the passage of time: `safeDate` refuses to let a request claim a future date,
// so the card must be moved into the past instead of the clock into the future.
// ---------------------------------------------------------------------------

let maximSeq = 0
async function seedMaxim(s: Session, dueDate: string): Promise<number> {
  const n = ++maximSeq
  const res = await post('/api/maxims', s, {
    source: `Delayed review source ${n}`,
    principle: `Delayed review principle ${n}`,
  })
  expect(res.status, 'the maxim did not capture').toBe(200)
  const { id } = await res.json<{ id: number }>()
  const upd = await env.DB.prepare(
    `UPDATE flashcards SET due_date=? WHERE maxim_id=? AND user_id=?`,
  ).bind(dueDate, id, s.userId).run()
  expect((upd.meta as { changes: number }).changes, 'no flashcard row to backdate').toBe(1)
  return id
}

let tongueSeq = 0
async function seedTongue(
  s: Session,
  dueDate: string,
  lastReview: string | null = null,
): Promise<number> {
  const n = ++tongueSeq
  const res = await post('/api/tongue', s, {
    situation: `A delayed-review situation ${n}`,
    trigger_q: `Trigger question ${n}?`,
    response: `The line he means to have ready, number ${n}.`,
    category: 'wit',
  })
  expect([200, 201], 'the response did not capture').toContain(res.status)
  const { id } = await res.json<{ id: number }>()
  // Seed FSRS state explicitly so two cards can differ in DELAY and in nothing else.
  const upd = await env.DB.prepare(
    `UPDATE review_items SET due_date=?, last_review=?, stability=10, difficulty=5,
       interval_days=10, reps=3, total_reviews=3, correct_reviews=3
     WHERE kind='response' AND item_id=? AND user_id=?`,
  ).bind(dueDate, lastReview, id, s.userId).run()
  expect((upd.meta as { changes: number }).changes, 'no review_items row to backdate').toBe(1)
  return id
}

async function seedRhetoricCard(s: Session, figure: string, dueDate: string): Promise<number> {
  // A distinct figure per card: the identity index is
  // (user_id, card_type, figure_slug, specimen_id) and the insert is OR IGNORE, so
  // reusing a figure hands back the previous test's card with its ladder step intact.
  const res = await post('/api/rhetoric/cards', s, {
    card_type: 'name_to_definition', figure_slug: figure, due_date: dueDate,
  })
  expect(res.status, `the ${figure} card did not create`).toBe(200)
  const { card } = await res.json<{ card: { id: number; due_date: string } }>()
  expect(card.due_date, 'the card did not take the due date it was given').toBe(dueDate)
  return card.id
}

// ===========================================================================

describe('B17 an item missed for months is still in its queue, most-overdue first', () => {
  it('the maxim queue surfaces overdue cards and orders the worst first', async () => {
    const s = await login()
    const older = await seedMaxim(s, ANCIENT)
    const newer = await seedMaxim(s, LESS_ANCIENT)

    const res = await get(`/api/cards/due?date=${REVIEWED_ON}`, s)
    expect(res.status).toBe(200)
    const rows = await res.json<Array<{ maxim_id: number; due_date: string }>>()
    const ids = rows.map((r) => r.maxim_id)
    // Floor: if the queue came back empty, the ordering claim below would be vacuous.
    expect(rows.length, 'the due queue came back empty').toBeGreaterThan(0)
    expect(ids, 'a card overdue by decades fell out of the queue').toContain(older)
    expect(ids, 'a card overdue by decades fell out of the queue').toContain(newer)
    expect(
      ids.indexOf(older) < ids.indexOf(newer),
      'the queue is not ordered most-overdue-first, so the worst debt is served last',
    ).toBe(true)
  })

  it('the Tongue queue surfaces overdue cards and orders the worst first', async () => {
    const s = await login()
    const older = await seedTongue(s, ANCIENT)
    const newer = await seedTongue(s, LESS_ANCIENT)

    const res = await get(`/api/tongue/due?date=${REVIEWED_ON}`, s)
    expect(res.status).toBe(200)
    const rows = await res.json<Array<{ id: number }>>()
    const ids = rows.map((r) => r.id)
    expect(rows.length, 'the drill queue came back empty').toBeGreaterThan(0)
    expect(ids, 'a response overdue by decades fell out of the drill queue').toContain(older)
    expect(ids, 'a response overdue by decades fell out of the drill queue').toContain(newer)
    expect(
      ids.indexOf(older) < ids.indexOf(newer),
      'the drill queue is not ordered most-overdue-first',
    ).toBe(true)
  })

  it('the ladder queue surfaces overdue cards and orders the worst first', async () => {
    const s = await login()
    const older = await seedRhetoricCard(s, 'epizeuxis', ANCIENT)
    const newer = await seedRhetoricCard(s, 'epimone', LESS_ANCIENT)

    const res = await get('/api/rhetoric/review/due', s)
    expect(res.status).toBe(200)
    const { due } = await res.json<{ due: Array<{ id: number }> }>()
    const ids = due.map((d) => d.id)
    expect(due.length, 'the ladder queue came back empty').toBeGreaterThan(0)
    expect(ids, 'a ladder card overdue by decades fell out of the queue').toContain(older)
    expect(ids, 'a ladder card overdue by decades fell out of the queue').toContain(newer)
    expect(
      ids.indexOf(older) < ids.indexOf(newer),
      'the ladder queue is not ordered most-overdue-first',
    ).toBe(true)
  })
})

describe('B17 a late review is accepted and reschedules from the day it happened', () => {
  it('the maxim queue accepts a review decades late and schedules forward', async () => {
    const s = await login()
    const id = await seedMaxim(s, ANCIENT)

    const res = await post(`/api/cards/${id}/review`, s, { grade: 3, date: REVIEWED_ON })
    expect(res.status, 'a late review was refused — the not-due guard reads the wrong way').toBe(200)
    const { next_due } = await res.json<{ next_due: string }>()
    // THE CLAIM. Reschedule from the stale due date and this lands in 1990.
    expect(
      next_due > REVIEWED_ON,
      `next_due was ${next_due}: a card reviewed decades late must be scheduled `
      + 'forward from the review, not from the due date it missed',
    ).toBe(true)
    // And the record agrees with the answer, so this is not a response-only truth.
    const row = await env.DB.prepare(
      `SELECT due_date FROM flashcards WHERE maxim_id=? AND user_id=?`,
    ).bind(id, s.userId).first<{ due_date: string }>()
    expect(row?.due_date, 'the stored schedule disagrees with the reply').toBe(next_due)
  })

  it('the Tongue queue accepts a review decades late and schedules forward', async () => {
    const s = await login()
    const id = await seedTongue(s, ANCIENT, ANCIENT)

    const res = await post(`/api/tongue/${id}/review`, s, {
      grade: 2, mode: 'recall', date: REVIEWED_ON,
    })
    expect(res.status, 'a late drill was refused').toBe(200)
    const { next_due } = await res.json<{ next_due: string }>()
    expect(
      next_due > REVIEWED_ON,
      `next_due was ${next_due}: a response drilled decades late must be scheduled forward`,
    ).toBe(true)
  })

  it('the ladder schedules from the day named, not from the due date it missed', async () => {
    const s = await login()
    const id = await seedRhetoricCard(s, 'conduplicatio', ANCIENT)

    const res = await post(`/api/rhetoric/review/${id}`, s, {
      correct: true, reviewed_on: REVIEWED_ON,
    })
    expect(res.status, 'a late ladder review was refused').toBe(200)
    const body = await res.json<{ dueDate: string; intervalDays: number; stepAfter: number }>()
    // The ladder is fixed, so this is exact rather than merely forward: step 0 -> 1 is
    // the first rung, one day.
    expect(body.stepAfter, 'a correct answer must advance exactly one rung').toBe(1)
    expect(body.intervalDays, 'the first rung of the fixed ladder is one day').toBe(1)
    expect(
      body.dueDate,
      'the ladder rescheduled from the stale due date, so the card stays permanently due',
    ).toBe('2026-08-21')
  })
})

describe('B17 the delay is visible to the scheduler, not merely survived', () => {
  it('a success after a long delay is not scheduled like a success on time', async () => {
    // FSRS prices a success by how much was forgotten before it. Two cards identical in
    // stability, difficulty and interval, differing ONLY in when they were last seen,
    // must therefore come back with different next-due dates. Make the delay invisible —
    // feed the scheduler the stored interval instead of the real gap — and these two
    // collapse onto the same answer.
    const s = await login()
    const onTime = await seedTongue(s, '2026-08-10', '2026-08-10')
    const delayed = await seedTongue(s, '2020-01-01', '2020-01-01')

    const a = await post(`/api/tongue/${onTime}/review`, s, {
      grade: 2, mode: 'recall', date: REVIEWED_ON,
    })
    const b = await post(`/api/tongue/${delayed}/review`, s, {
      grade: 2, mode: 'recall', date: REVIEWED_ON,
    })
    expect(a.status, 'the on-time drill was refused').toBe(200)
    expect(b.status, 'the delayed drill was refused').toBe(200)
    const onTimeDue = (await a.json<{ next_due: string }>()).next_due
    const delayedDue = (await b.json<{ next_due: string }>()).next_due
    // Floor: both must have been scheduled forward at all, or "they differ" could hold
    // for a reason that has nothing to do with the delay.
    expect(onTimeDue > REVIEWED_ON, 'the on-time card was not scheduled forward').toBe(true)
    expect(delayedDue > REVIEWED_ON, 'the delayed card was not scheduled forward').toBe(true)
    expect(
      delayedDue,
      'the delay never reached the scheduler: a card unseen for six years was priced '
      + 'exactly like one reviewed on schedule',
    ).not.toBe(onTimeDue)
  })

  it('the review date is stamped on the card, so the NEXT delay is measurable', async () => {
    // Without this, `elapsed` is computed from a stale date forever and every later
    // review is mispriced. It is the state that makes the claim above possible a second
    // time.
    const s = await login()
    const id = await seedTongue(s, ANCIENT, ANCIENT)
    const before = await env.DB.prepare(
      `SELECT last_review FROM review_items WHERE kind='response' AND item_id=? AND user_id=?`,
    ).bind(id, s.userId).first<{ last_review: string }>()
    expect(before?.last_review, 'the seed did not take').toBe(ANCIENT)

    const res = await post(`/api/tongue/${id}/review`, s, {
      grade: 2, mode: 'recall', date: REVIEWED_ON,
    })
    expect(res.status).toBe(200)
    const after = await env.DB.prepare(
      `SELECT last_review FROM review_items WHERE kind='response' AND item_id=? AND user_id=?`,
    ).bind(id, s.userId).first<{ last_review: string }>()
    expect(
      after?.last_review,
      'last_review was not advanced, so every later review measures the delay from a '
      + 'date that is already wrong',
    ).toBe(REVIEWED_ON)
  })
})

describe('B17 a review cannot be dated in the future', () => {
  // The mirror image of a delayed review, and the way one would be erased rather than
  // served: date the review forward and the card leaves the queue without the work
  // being done, while the append-only log records a review that has not happened yet.
  // `safeDate` is the clamp; the rule is that every queue uses it.
  const FUTURE = '2099-01-01'

  it('the maxim queue clamps a forward review date to today', async () => {
    const s = await login()
    const today = await todayPerApp(s)
    const id = await seedMaxim(s, ANCIENT)

    const res = await post(`/api/cards/${id}/review`, s, { grade: 3, date: FUTURE })
    expect(res.status).toBe(200)
    const { next_due } = await res.json<{ next_due: string }>()
    expect(
      next_due <= '2099-01-01',
      'a forward review date was taken at face value',
    ).toBe(true)
    // Exact: the clamp means the schedule is measured from today, so the next due date
    // cannot be more than the longest plausible interval past today, and certainly
    // cannot be in 2099.
    expect(
      next_due < FUTURE,
      `next_due was ${next_due}, scheduled from a date that has not happened`,
    ).toBe(true)
    expect(next_due > today, 'the clamp went too far and scheduled into the past').toBe(true)
  })

  it('the Tongue queue clamps a forward review date to today', async () => {
    const s = await login()
    const today = await todayPerApp(s)
    const id = await seedTongue(s, ANCIENT, ANCIENT)

    const res = await post(`/api/tongue/${id}/review`, s, {
      grade: 2, mode: 'recall', date: FUTURE,
    })
    expect(res.status).toBe(200)
    const { next_due } = await res.json<{ next_due: string }>()
    expect(next_due < FUTURE, `next_due was ${next_due}, scheduled from 2099`).toBe(true)
    const row = await env.DB.prepare(
      `SELECT last_review FROM review_items WHERE kind='response' AND item_id=? AND user_id=?`,
    ).bind(id, s.userId).first<{ last_review: string }>()
    expect(
      row?.last_review,
      'the card records having been reviewed on a day that has not arrived',
    ).toBe(today)
  })

  it('the ladder clamps a forward reviewed_on to today', async () => {
    // src/routes/rhetoric.ts is the one route file of the ten that does not import
    // safeDate. `reviewed_on` is deliberately client-supplied — he drills on paper and
    // records it afterwards, so a PAST date is the whole point — but nothing bounded it
    // forward.
    const s = await login()
    const today = await todayPerApp(s)
    const id = await seedRhetoricCard(s, 'diacope', ANCIENT)

    const res = await post(`/api/rhetoric/review/${id}`, s, {
      correct: true, reviewed_on: FUTURE,
    })
    expect(res.status).toBe(200)
    const { dueDate } = await res.json<{ dueDate: string }>()
    expect(
      dueDate,
      'a forward reviewed_on scheduled the card from a day that has not happened, '
      + 'which parks it outside the queue',
    ).toBe(addOne(today))

    const logged = await env.DB.prepare(
      `SELECT reviewed_on FROM rhetoric_card_reviews WHERE card_id=? AND user_id=?`,
    ).bind(id, s.userId).first<{ reviewed_on: string }>()
    expect(
      logged?.reviewed_on,
      'the append-only review log records a review dated in the future',
    ).toBe(today)
  })

  /** One day on, computed the way src/time.ts does, so the expectation is exact. */
  function addOne(date: string): string {
    const d = new Date(date + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0, 10)
  }
})
