import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import schemasSrc from '../src/schemas.ts?raw'
import dayRouteSrc from '../src/routes/day.ts?raw'
import rhetoricRouteSrc from '../src/routes/rhetoric.ts?raw'
import rhetoricLabRouteSrc from '../src/routes/rhetoric-lab.ts?raw'
import learnRouteSrc from '../src/routes/learn.ts?raw'
import tongueRouteSrc from '../src/routes/tongue.ts?raw'
import agentV1RouteSrc from '../src/routes/agent-v1.ts?raw'
import intelLibraryRouteSrc from '../src/routes/intel-library.ts?raw'
import economyRouteSrc from '../src/routes/economy.ts?raw'
import hermesRouteSrc from '../src/routes/hermes.ts?raw'
import recoveryRouteSrc from '../src/routes/recovery.ts?raw'
import missCauseRouteSrc from '../src/routes/miss-cause.ts?raw'
import readingRouteSrc from '../src/routes/reading.ts?raw'
import ratchetRouteSrc from '../src/routes/ratchet.ts?raw'
import pushRouteSrc from '../src/routes/push.ts?raw'
import principlesRouteSrc from '../src/routes/principles.ts?raw'
import masteryRouteSrc from '../src/routes/mastery.ts?raw'
import cursorRouteSrc from '../src/routes/cursor.ts?raw'
import calendarRouteSrc from '../src/routes/calendar.ts?raw'
import authRouteSrc from '../src/routes/auth.ts?raw'
import agentCredentialsRouteSrc from '../src/routes/agent-credentials.ts?raw'

// The standing brief: "Never fabricate app data, chapter numbers, database contents, or
// history." A client-supplied date that says something HAPPENED on a day that has not
// arrived fabricates history, and the app had no rule about it — only nine instances of
// one.
//
// test/delayed-review.test.ts found the first: `reviewed_on` on the ladder review reached
// the database raw, so `'2099-01-01'` both parked the card 73 years outside the due queue
// and wrote a future-dated row into an append-only review log. One import fixed it. But
// fixing one field is what this audit keeps finding done and keeps finding insufficient:
// the sweep afterwards found SIX more raw event dates in the same file and one more file
// besides.
//
// The harm is not only cosmetic, and it is not only the fabricated row:
//
//   * Every one of these tables is read back `ORDER BY <the event date> DESC LIMIT 100`
//     or `LIMIT 200`. A single 2099 row pins itself to the top of his commonplace book,
//     his deployments, his recordings and his lab attempts until 2099 — and at a hundred
//     such rows, real history falls off the end of the list and is simply not shown.
//   * `cycle_days` upserts: `ON CONFLICT(user_id, chapter_id, cycle_day) DO UPDATE SET
//     occurred_on=excluded.occurred_on`. A forward date does not merely add a false
//     record, it REPLACES a true one.
//
// THE RULE, stated once, because the app was already enforcing it in two places without
// ever naming it:
//
//   A client-supplied date that records what has ALREADY HAPPENED is bounded to today.
//   A client-supplied date that SCHEDULES something for later is not.
//
// And the app enforces the first half by two different mechanisms, both legitimate, both
// visible in src/routes/day.ts:
//
//   clamp    `const date = await safeDate(DB, b.date, userId)`   // day.ts:396
//   refuse   `if (block_date > date) return … 'Cannot appeal the future.'`  // day.ts:233
//
// So this guard accepts either. A scan that demanded `safeDate` alone would have reported
// day.ts:233 — the line that IS the rule — as a violation of it.
//
// The second half of the rule is not a loophole to be closed later. `resolve_by` is
// REQUIRED to be forward (`if (resolve_by <= date) return … 'Resolution date must be in
// the future.'`, day.ts:330) and a flashcard's `due_date` is forward by definition. Both
// are asserted below as intent dates rather than quietly omitted, because an exemption
// that lives only in a regex is an exemption the next reader deletes.
//
// The field list is DERIVED from src/schemas.ts, not written here. That is the whole
// point: this audit's recurring defect is a hand-written list that stopped being
// exhaustive the moment the thing it lists grew, and a new date field must be covered by
// this guard on the day it is added, not on the day someone remembers to come back.

// ---------------------------------------------------------------------------
// Part 1 — the derivation. Every date-typed field, split by what it means.
// ---------------------------------------------------------------------------

/**
 * Field names declared `dateSchema` or `optionalDate` in src/schemas.ts.
 *
 * Derived rather than listed. If the regex ever stops matching the file's real shape the
 * floor test below fails on the count, rather than this guard silently covering less.
 */
function declaredDateFields(src: string): string[] {
  const out = new Set<string>()
  for (const m of src.matchAll(/^\s{2}([a-z_]+):\s*(?:dateSchema|optionalDate)\b/gm)) {
    out.add(m[1])
  }
  return [...out].sort()
}

/**
 * The adjudication, and the ONLY hand-written list in this file.
 *
 * A date here is one the commander is naming for the future on purpose. Everything else
 * derived from the schemas is an event date and must be bounded. Adding a field here is
 * therefore a deliberate, reviewable act — and each entry is proved to be real by
 * `the intent dates are intended` below, so the list cannot be padded to silence a
 * finding.
 */
const INTENT_DATES = ['due_date', 'resolve_by'] as const

const ALL_DATE_FIELDS = declaredDateFields(schemasSrc)
const EVENT_DATES = ALL_DATE_FIELDS.filter((f) => !(INTENT_DATES as readonly string[]).includes(f))

// ---------------------------------------------------------------------------
// Part 2 — the scan.
// ---------------------------------------------------------------------------

/** Blank comments, keeping the line count so nothing shifts. */
function stripComments(src: string): string {
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ')
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + blank(m.slice(p1.length)))
}

/**
 * Blank template literals, keeping the line count.
 *
 * Every SQL statement in this app is a backtick string, and SQL uses `b.` as a TABLE
 * ALIAS: src/routes/rhetoric-lab.ts:592 reads `WHERE b.user_id=? ORDER BY b.occurred_on
 * DESC`. That is a column on an aliased table, not a property read on a parsed body, and
 * a scan that could not tell the difference would report the two SELECT statements in
 * that file as offences and be disbelieved on the two INSERTs that are real.
 */
function stripTemplates(src: string): string {
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ')
  return src.replace(/`[^`]*`/g, blank)
}

/** Comments and SQL removed, line numbering intact. */
const scannable = (src: string): string => stripTemplates(stripComments(src))

/**
 * Names destructured straight off a parsed body.
 *
 * `src/routes/day.ts` never writes `b.block_date`; it writes
 * `const { block_id, block_date, reason } = await parseJson(c, appealBodySchema)` and then
 * uses the bare identifier. A scan that only understood `b.<field>` would have declared
 * day.ts clean without ever looking at the appeal route — which is the file that holds
 * the strictest version of this rule in the whole app.
 */
function destructuredFromBody(src: string): Set<string> {
  const out = new Set<string>()
  for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*(?:await\s+)?parseJson\s*\(/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.split(':')[0].trim()
      if (/^[a-z_][\w]*$/.test(name)) out.add(name)
    }
  }
  return out
}

/** Does this file take `field` off a request body at all? */
function readsField(src: string, field: string): boolean {
  const code = scannable(src)
  if (new RegExp(`\\b(?:b|body)\\.${field}\\b`).test(code)) return true
  return destructuredFromBody(code).has(field)
}

/**
 * Does this file BOUND `field` to today — by either legitimate mechanism?
 *
 * The evidence must name the field. A file that clamps `date` and then binds
 * `occurred_on` raw has evidence for one and none for the other, which is exactly the
 * state src/routes/rhetoric.ts was in after the delayed-review fix: `reviewed_on` went
 * through `safeDate` while five of its neighbours did not.
 */
function boundsField(src: string, field: string): boolean {
  const code = scannable(src)
  const clamped = new RegExp(`safeDate\\s*\\([^)]*\\b${field}\\b`).test(code)
  // `if (<field> > date) return …` / `if (b.<field> > today) return …`
  const refused = new RegExp(
    `\\b(?:b\\.|body\\.)?${field}\\s*>\\s*(?:date|today)\\b[^\\n]*return`,
  ).test(code)
  return clamped || refused
}

/**
 * One entry per route HANDLER, not per file.
 *
 * THE SCAN'S OWN FIRST DRAFT WAS FILE-SCOPED, AND IT REPORTED A FALSE CLEAN.
 * src/routes/economy.ts binds a client `date` raw into `law_checks.log_date` at :59 —
 * and thirteen lines above it, an unrelated route reads
 * `safeDate(c.env.DB, c.req.query('date'), userId)`. File-scoped, that call satisfied
 * "economy.ts bounds `date`" and the offence went unreported. A guard that answers
 * "somewhere in this file, someone clamped something of that name" is not answering the
 * question; it is the vacuous pass in structural form, and it is more dangerous than a
 * missing test because it reads as coverage.
 *
 * Handler-scoped, the evidence has to sit in the same route as the bind. A helper in the
 * file prelude that clamps on a route's behalf would now be reported — deliberately.
 * This app has no such helper (`safeDate` is called inline in every route that uses it),
 * and if one is ever introduced the guard should make a human say so out loud rather than
 * infer it.
 */
function routeBlocks(src: string): Array<{ at: string; code: string }> {
  const code = scannable(src)
  const starts: Array<{ index: number; label: string }> = []
  for (const m of code.matchAll(/^app\.(get|post|put|patch|delete|all)\(\s*'([^']*)'/gm)) {
    starts.push({ index: m.index ?? 0, label: `${m[1].toUpperCase()} ${m[2]}` })
  }
  return starts.map((s, i) => ({
    at: s.label,
    code: code.slice(s.index, i + 1 < starts.length ? starts[i + 1].index : code.length),
  }))
}

/** Every route file, so a new one cannot be added outside the sweep unnoticed. */
const ROUTE_FILES: Array<[string, string]> = [
  ['src/routes/day.ts', dayRouteSrc],
  ['src/routes/rhetoric.ts', rhetoricRouteSrc],
  ['src/routes/rhetoric-lab.ts', rhetoricLabRouteSrc],
  ['src/routes/learn.ts', learnRouteSrc],
  ['src/routes/tongue.ts', tongueRouteSrc],
  ['src/routes/agent-v1.ts', agentV1RouteSrc],
  ['src/routes/intel-library.ts', intelLibraryRouteSrc],
  ['src/routes/economy.ts', economyRouteSrc],
  ['src/routes/hermes.ts', hermesRouteSrc],
  ['src/routes/recovery.ts', recoveryRouteSrc],
  ['src/routes/miss-cause.ts', missCauseRouteSrc],
  ['src/routes/reading.ts', readingRouteSrc],
  ['src/routes/ratchet.ts', ratchetRouteSrc],
  ['src/routes/push.ts', pushRouteSrc],
  ['src/routes/principles.ts', principlesRouteSrc],
  ['src/routes/mastery.ts', masteryRouteSrc],
  ['src/routes/cursor.ts', cursorRouteSrc],
  ['src/routes/calendar.ts', calendarRouteSrc],
  ['src/routes/auth.ts', authRouteSrc],
  ['src/routes/agent-credentials.ts', agentCredentialsRouteSrc],
]

describe('B17 the scan can see what it exists to catch', () => {
  it('reads real sources, so a broken import fails loudly instead of finding nothing', () => {
    expect(schemasSrc.length, 'src/schemas.ts came back empty').toBeGreaterThan(5000)
    for (const [name, src] of ROUTE_FILES) {
      expect(src.length, `${name} came back empty`).toBeGreaterThan(200)
    }
    expect(ROUTE_FILES.length, 'the route list shrank').toBeGreaterThanOrEqual(20)
  })

  it('derives the date fields from the schemas rather than trusting a list', () => {
    // The floor. If the derivation regex stops matching, this fails here rather than
    // reporting a clean sweep over an empty field set.
    expect(ALL_DATE_FIELDS.length, 'no date-typed field was derived at all').toBeGreaterThanOrEqual(9)
    for (const known of ['occurred_on', 'copied_on', 'made_on', 'reviewed_on', 'block_date', 'log_date', 'date']) {
      expect(ALL_DATE_FIELDS, `the derivation missed ${known}`).toContain(known)
    }
    expect(EVENT_DATES.length, 'the intent exemption swallowed every field').toBeGreaterThanOrEqual(7)
    for (const intent of INTENT_DATES) {
      expect(EVENT_DATES, `${intent} is exempt and must not be swept`).not.toContain(intent)
    }
  })

  it('the intent dates are intended, proved from the app rather than asserted here', () => {
    // An exemption nobody checks is an exemption that hides the next defect. `resolve_by`
    // is not merely allowed to be forward — the app REFUSES it when it is not.
    expect(
      scannable(dayRouteSrc),
      'resolve_by is exempt from this sweep because the app requires it to be in the '
      + 'future; that requirement is gone, so the exemption is now unjustified',
    ).toMatch(/resolve_by\s*<=\s*date\b[^\n]*return/)
    // `due_date` is a schedule. If it ever stopped being one, the exemption would need
    // re-arguing rather than inheriting.
    expect(schemasSrc, 'due_date left the card schema').toMatch(/due_date:\s*optionalDate/)
  })

  it('recognises BOTH ways the app bounds a date, and neither by accident', () => {
    const clamp = 'const date = await safeDate(DB, b.date, userId)'
    expect(boundsField(clamp, 'date'), 'the scan cannot see a safeDate clamp').toBe(true)
    const refuse = "  if (block_date > date) return c.json({ error: 'Cannot appeal the future.' }, 400)"
    expect(boundsField(refuse, 'block_date'), 'the scan cannot see a refusal').toBe(true)
    // Evidence must NAME the field, or clamping one date would excuse binding another.
    expect(
      boundsField(clamp, 'occurred_on'),
      'a clamp on one field was accepted as evidence for a different field',
    ).toBe(false)
    // And a bare read with no bounding at all must not pass.
    expect(boundsField('  .bind(userId, b.occurred_on).run()', 'occurred_on')).toBe(false)
  })

  it('splits a file into its handlers, so one route cannot vouch for another', () => {
    // The floor for the scoping itself: a regex that stopped matching `app.post(` would
    // yield zero blocks, the sweep would examine nothing, and it would report clean.
    let total = 0
    for (const [name, src] of ROUTE_FILES) {
      const blocks = routeBlocks(src)
      expect(blocks.length, `${name} yielded no route handlers at all`).toBeGreaterThanOrEqual(1)
      total += blocks.length
    }
    expect(total, 'far fewer handlers than the app really declares').toBeGreaterThanOrEqual(120)
  })

  it('a clamp in one handler is not evidence for a raw bind in the next', () => {
    // THE FALSE CLEAN, as a fixture. This is src/routes/economy.ts in miniature: the
    // shape that passed the file-scoped draft of this very scan.
    const twoRoutes = [
      "app.get('/api/ledger', async (c) => {",
      "  const date = await safeDate(c.env.DB, c.req.query('date'), userId)",
      '  return c.json({ date })',
      '})',
      "app.post('/api/laws/:id/check', async (c) => {",
      '  const { date, kept } = await parseJson(c, lawCheckBodySchema)',
      '  await DB.prepare(SQL).bind(userId, lawId, date, kept ? 1 : 0).run()',
      '})',
    ].join('\n')
    // File-scoped, this was "bounded" and reported nothing.
    expect(
      boundsField(twoRoutes, 'date'),
      'the fixture no longer reproduces the masking this scoping exists to fix',
    ).toBe(true)
    // Handler-scoped, the bind stands alone and is seen.
    const blocks = routeBlocks(twoRoutes)
    expect(blocks.map((b) => b.at)).toEqual(['GET /api/ledger', 'POST /api/laws/:id/check'])
    const offending = blocks.filter((b) => readsField(b.code, 'date') && !boundsField(b.code, 'date'))
    expect(
      offending.map((b) => b.at),
      'a raw bind was excused by a clamp in a different route — the scan is still masked',
    ).toEqual(['POST /api/laws/:id/check'])
  })

  it('sees a raw bind, and is not fooled by SQL aliases or comments', () => {
    // The exact defect line this guard exists for, from src/routes/rhetoric.ts.
    const real = '    ).bind(userId, b.figure_slug, b.specimen_id ?? null, b.copied_on, b.page_of_book ?? null).run()'
    expect(readsField(real, 'copied_on'), 'the scan cannot see the defect it exists for').toBe(true)
    // The SQL alias from src/routes/rhetoric-lab.ts:592. `b` is a table here.
    const alias = '     `WHERE b.user_id=? ORDER BY b.occurred_on DESC, b.id DESC LIMIT 100`,'
    expect(readsField(alias, 'occurred_on'), 'a SQL table alias was read as a body field').toBe(false)
    // A comment discussing the field is not a use of it.
    expect(readsField('// b.occurred_on used to be raw here', 'occurred_on')).toBe(false)
    // And the destructured access pattern day.ts actually uses.
    const destructured = '  const { block_id, block_date, reason } = await parseJson(c, appealBodySchema)'
    expect(readsField(destructured, 'block_date'), 'the scan is blind to destructuring').toBe(true)
  })
})

describe('B17 no route stores a client date claiming something happened in the future', () => {
  it('every event date a route accepts is bounded to today, by clamp or by refusal', () => {
    const offences: string[] = []
    for (const [name, src] of ROUTE_FILES) {
      for (const { at, code } of routeBlocks(src)) {
        for (const field of EVENT_DATES) {
          if (readsField(code, field) && !boundsField(code, field)) {
            offences.push(`${name} ${at} → ${field}`)
          }
        }
      }
    }
    expect(
      offences,
      'this date says something happened on a day that has not arrived. Clamp it with '
      + 'safeDate, or refuse it the way the appeal route does — a forward event date '
      + 'fabricates history and pins itself to the top of every ORDER BY … DESC list '
      + 'that reads the table back',
    ).toEqual([])
  })

  it('the sweep actually reached the routes that take event dates, not zero of them', () => {
    // Floor: if `readsField` broke, the sweep above would find no offences because it
    // found no fields — a clean pass over nothing. Name the pairs it must have examined.
    const examined: string[] = []
    for (const [name, src] of ROUTE_FILES) {
      for (const { at, code } of routeBlocks(src)) {
        for (const field of EVENT_DATES) {
          if (readsField(code, field)) examined.push(`${name} ${at} → ${field}`)
        }
      }
    }
    expect(examined, 'the sweep examined nothing')
      .toContain('src/routes/day.ts POST /api/appeals → block_date')
    expect(examined).toContain('src/routes/rhetoric.ts POST /api/rhetoric/cycle-day → occurred_on')
    expect(examined).toContain('src/routes/rhetoric.ts POST /api/rhetoric/commonplace → copied_on')
    expect(examined).toContain('src/routes/rhetoric.ts POST /api/rhetoric/recording → made_on')
    expect(examined).toContain('src/routes/rhetoric.ts POST /api/rhetoric/review/:id → reviewed_on')
    expect(examined).toContain('src/routes/rhetoric-lab.ts POST /api/lab/attempt → occurred_on')
    expect(examined).toContain('src/routes/economy.ts POST /api/laws/:id/check → date')
    expect(examined).toContain('src/routes/learn.ts POST /api/units/:id/step → date')
    expect(examined.length, 'far fewer route/field pairs than the app really has')
      .toBeGreaterThanOrEqual(10)
  })
})

// ---------------------------------------------------------------------------
// Part 3 — the same claim end to end. The scan proves the clamp is CALLED; only a
// request proves the row that lands is not dated in the future.
// ---------------------------------------------------------------------------

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

interface Session { cookie: string; csrf: string; userId: number }

async function login(): Promise<Session> {
  const salt = 'fedcba9876543210fedcba9876543210'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash('future-date-pw', salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'future-date-pw' }),
  }, baseEnv)
  const cookie = res.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await res.json<{ csrfToken: string }>()
  const owner = await env.DB.prepare(`SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`).first<{ id: number }>()
  return { cookie, csrf: csrfToken, userId: owner!.id }
}

/** No X-Request-Id, so withIdempotency is bypassed and each post is its own write. */
function post(path: string, s: Session, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { Cookie: s.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf },
    body: JSON.stringify(body),
  }, baseEnv)
}

/** The app's own idea of today, asked of the app rather than assumed from the clock. */
async function todayPerApp(s: Session): Promise<string> {
  const res = await app.request('/api/rhetoric/review/due', { headers: { Cookie: s.cookie } }, baseEnv)
  expect(res.status, 'could not read the app clock').toBe(200)
  const { date } = await res.json<{ date: string }>()
  expect(date, 'the app did not report a date').toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)
  return date
}

const FUTURE = '2099-01-01'

/** Chapter 1 is Part 1, and `partIsUnlocked` returns early for part <= 1 — no gate. */
const PART_ONE_CHAPTER = 1

/**
 * A distinct cycle day per call. `cycle_days` is UNIQUE on
 * (user_id, chapter_id, cycle_day) and the workers pool does not roll storage back
 * between tests in a file, so a fixed day would have the second test upserting the
 * first test's row and proving nothing about a fresh insert.
 *
 * Day 7 is skipped: it is the consolidation that marks a part installed, and spending it
 * here would move the Part gate for every later test in the file.
 */
let cycleDaySeq = 0
const nextCycleDay = (): number => 1 + (cycleDaySeq++ % 6)

describe('B17 a forward event date does not reach the record', () => {
  it('a cycle day claimed for 2099 is stored no later than today', async () => {
    const s = await login()
    const today = await todayPerApp(s)
    const day = nextCycleDay()

    const res = await post('/api/rhetoric/cycle-day', s, {
      chapter_id: PART_ONE_CHAPTER, cycle_day: day, occurred_on: FUTURE,
      note: 'Recorded with a date that has not happened.',
    })
    expect(res.status, 'the cycle day was refused for an unrelated reason').toBe(200)

    const row = await env.DB.prepare(
      `SELECT occurred_on FROM cycle_days WHERE user_id=? AND chapter_id=? AND cycle_day=?`,
    ).bind(s.userId, PART_ONE_CHAPTER, day).first<{ occurred_on: string }>()
    expect(row, 'nothing was written, so the assertion below would be vacuous').not.toBeNull()
    expect(
      row!.occurred_on <= today,
      `cycle_days.occurred_on stored ${row!.occurred_on}, which has not happened yet`,
    ).toBe(true)
  })

  it('a forward date cannot overwrite a truthful one through the upsert', async () => {
    // `ON CONFLICT(user_id, chapter_id, cycle_day) DO UPDATE SET
    // occurred_on=excluded.occurred_on`. Re-recording a cycle day is meant to replace the
    // date — so the claim here is not that the old date survives, it is that whatever
    // replaces it is a day that has actually happened.
    const s = await login()
    const today = await todayPerApp(s)
    const day = nextCycleDay()

    const first = await post('/api/rhetoric/cycle-day', s, {
      chapter_id: PART_ONE_CHAPTER, cycle_day: day, occurred_on: '2026-08-18',
    })
    expect(first.status, 'the truthful record did not land').toBe(200)

    const second = await post('/api/rhetoric/cycle-day', s, {
      chapter_id: PART_ONE_CHAPTER, cycle_day: day, occurred_on: FUTURE,
    })
    expect(second.status, 'the re-record was refused for an unrelated reason').toBe(200)

    const row = await env.DB.prepare(
      `SELECT occurred_on FROM cycle_days WHERE user_id=? AND chapter_id=? AND cycle_day=?`,
    ).bind(s.userId, PART_ONE_CHAPTER, day).first<{ occurred_on: string }>()
    expect(row, 'the row vanished').not.toBeNull()
    expect(
      row!.occurred_on <= today,
      `the upsert replaced a real date with ${row!.occurred_on}, which has not happened`,
    ).toBe(true)
  })

  it('a recording claimed for 2099 is stored no later than today', async () => {
    // Recordings are the case where a forward date does most damage to him rather than to
    // the data: the baseline is deliberately not listened back until Day 143, and the
    // whole list is read `ORDER BY made_on DESC`.
    const s = await login()
    const today = await todayPerApp(s)

    const res = await post('/api/rhetoric/recording', s, {
      kind: 'written_baseline',
      file_reference: 'recordings/future-dated-probe.m4a',
      made_on: FUTURE,
    })
    expect(res.status, 'the recording was refused for an unrelated reason').toBe(200)
    const { id } = await res.json<{ id: number }>()

    const row = await env.DB.prepare(
      `SELECT made_on FROM recordings WHERE id=? AND user_id=?`,
    ).bind(id, s.userId).first<{ made_on: string }>()
    expect(row, 'nothing was written').not.toBeNull()
    expect(
      row!.made_on <= today,
      `recordings.made_on stored ${row!.made_on}, which has not happened yet`,
    ).toBe(true)
  })

  it('a lab attempt claimed for 2099 is stored no later than today', async () => {
    const s = await login()
    const today = await todayPerApp(s)

    // The route gates the insert three ways before it reaches occurred_on: the exercise
    // slug must be one of the thirteen, `why_not_obvious` must run to at least twenty
    // characters, and the answer must not trip a reel tell. A body that failed any of
    // them would be refused with a 409 and would never reach the code under test — the
    // vacuous pass this audit keeps finding.
    const res = await post('/api/lab/attempt', s, {
      exercise_type: 'construct_original',
      answer: 'The ledger does not argue with me; it simply declines to forget.',
      why_not_obvious: 'The obvious version moralises at him. This one lets the record '
        + 'do the work and says nothing about his character at all.',
      occurred_on: FUTURE,
    })
    expect(res.status, 'the attempt was refused before it reached the insert').toBe(200)
    const { id } = await res.json<{ id: number }>()

    const row = await env.DB.prepare(
      `SELECT occurred_on FROM rhetoric_attempts WHERE id=? AND user_id=?`,
    ).bind(id, s.userId).first<{ occurred_on: string }>()
    expect(row, 'nothing was written').not.toBeNull()
    expect(
      row!.occurred_on <= today,
      `rhetoric_attempts.occurred_on stored ${row!.occurred_on}, which has not happened`,
    ).toBe(true)
  })
})

describe('B17 and a date that schedules something is left alone', () => {
  it('a card created due in the future keeps that due date', async () => {
    // The other half of the rule, and the reason this guard names its exemptions instead
    // of clamping every date it can find. Clamping this one would make every card ever
    // created due today, which would drown the ladder on the day someone "fixed" it.
    const s = await login()
    const res = await post('/api/rhetoric/cards', s, {
      card_type: 'situation_to_figure', figure_slug: 'anaphora', due_date: '2026-12-25',
    })
    expect(res.status, 'the card did not create').toBe(200)
    const { card } = await res.json<{ card: { due_date: string } }>()
    expect(
      card.due_date,
      'a scheduled due date was clamped to today — this guard is for dates that claim '
      + 'the PAST, and a card is scheduled forward on purpose',
    ).toBe('2026-12-25')
  })
})
