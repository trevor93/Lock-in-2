import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../src/index'
import {
  LADDER, COPIA_TARGET, RELISTEN_DAYS, REJECTED_VERBATIM_ALLOCATION,
} from '../src/rhetoric'

// Book 11 — the Farnsworth track ROUTES. The module tests pin the rules; these pin the
// places the rules have to bite on real rows: the Part III gate, the commonplace log
// that has nowhere to put the text, the fixed ladder deriving its own step, and the
// metric that inverts.

const baseEnv = {
  DB: env.DB, OPENAI_API_KEY: '', OPENAI_BASE_URL: 'https://model.invalid',
  OPENAI_ALLOWED_BASE_URLS: 'https://model.invalid',
}

async function passwordHash(pw: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)))
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256,
  )
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

type Session = { cookie: string; csrf: string; userId: number }

async function login(): Promise<Session> {
  const salt = 'aabb00112233445566778899ccddeeff'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0,
       locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash('rhetoric-routes-pw', salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'rhetoric-routes-pw' }),
  }, baseEnv)
  expect(res.status).toBe(200)
  const cookie = res.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await res.json<{ csrfToken: string }>()
  const owner = await env.DB.prepare(
    `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
  ).first<{ id: number }>()
  return { cookie, csrf: csrfToken, userId: owner!.id }
}

function post(path: string, s: Session, body: unknown = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { Cookie: s.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf },
    body: JSON.stringify(body),
  }, baseEnv)
}
function get(path: string, s: Session) {
  return app.request(path, { headers: { Cookie: s.cookie } }, baseEnv)
}

/** Mark a whole Part installed by recording its Day 7 consolidations. */
async function installPart(userId: number, part: number) {
  const chapters = (await env.DB.prepare(
    `SELECT id FROM rhetoric_chapters WHERE part=?`,
  ).bind(part).all()).results as Array<{ id: number }>
  for (const ch of chapters) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO cycle_days (user_id, chapter_id, cycle_day, occurred_on)
       VALUES (?,?,7,'2026-08-01')`,
    ).bind(userId, ch.id).run()
  }
}

let session: Session

beforeEach(async () => {
  session = await login()
  // rhetoric_cards is deliberately NOT cleared: rhetoric_card_reviews references it and
  // is append-only by trigger, so D1's foreign keys would refuse the delete and the
  // trigger would refuse the alternative. Each ladder test therefore uses its own figure.
  for (const table of ['cycle_days', 'commonplace_log', 'copia_renderings', 'copia_sessions',
    'deployment_pivots', 'deployments', 'recordings']) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(session.userId).run()
  }
})

describe('11.1 — the Part gate, on real rows', () => {
  it('reports Part III locked until Parts I and II are installed', async () => {
    const res = await get('/api/rhetoric/track', session)
    expect(res.status).toBe(200)
    const body = await res.json<any>()
    expect(body.rootNode).toMatch(/controlled repetition or controlled absence/)
    const third = body.parts.find((p: any) => p.part === 3)
    expect(third.unlocked).toBe(false)
    expect(third.reason).toMatch(/needs Part 1 and Part 2/)
    expect(body.parts.find((p: any) => p.part === 1).unlocked).toBe(true)
  })

  it('refuses a Part III cycle day and accepts it once Parts I and II are in', async () => {
    // Chapter 13 (Praeteritio) is the first Part III chapter.
    const blocked = await post('/api/rhetoric/cycle-day', session, {
      chapter_id: 13, cycle_day: 1, occurred_on: '2026-08-23',
    })
    expect(blocked.status).toBe(409)
    const reason = await blocked.json<any>()
    expect(reason.error).toBe('PART LOCKED')
    expect(reason.reason).toMatch(/a gap only registers against an established pattern/)

    await installPart(session.userId, 1)
    await installPart(session.userId, 2)
    const allowed = await post('/api/rhetoric/cycle-day', session, {
      chapter_id: 13, cycle_day: 1, occurred_on: '2026-08-23',
    })
    expect(allowed.status).toBe(200)
    const body = await allowed.json<any>()
    // Day 1 produces nothing, and the route says so rather than expecting an artefact.
    expect(body.producesArtefact).toBe(false)
    expect(body.constraint).toMatch(/produces NOTHING/)
  })

  it('never gates a Part I chapter', async () => {
    const res = await post('/api/rhetoric/cycle-day', session, {
      chapter_id: 1, cycle_day: 2, occurred_on: '2026-08-23',
    })
    expect(res.status).toBe(200)
    expect((await res.json<any>()).cycleDay.slug).toBe('tier_and_copy')
  })
})

describe('11.6 / 11.7 — the chapter render and both faces', () => {
  it('returns the thirteen slots and both faces of the figure', async () => {
    const res = await get('/api/rhetoric/chapter/2', session)
    expect(res.status).toBe(200)
    const body = await res.json<any>()
    expect(body.chapter.title).toBe('Anaphora')
    expect(body.slots).toHaveLength(13)
    expect(body.figure.bothFaces.legitimate.length).toBeGreaterThan(20)
    expect(body.figure.bothFaces.manipulative.length).toBeGreaterThan(20)
    expect(body.figure.bothFaces.detectionQuestion.length).toBeGreaterThan(20)
    expect(body.figure.bothFaces.overuseTells.length).toBeGreaterThan(20)
    expect(body.figure.conversationalJobs.length).toBeGreaterThan(0)
    // Tier 1 ships empty: the arsenal is his, and Tier 1 is copied by hand.
    expect(body.specimens.tier1).toHaveLength(0)
    expect(body.specimens.tier3.length).toBeGreaterThan(0)
  })

  it('says so where no page anchor was confirmed, rather than guessing one', async () => {
    const res = await get('/api/rhetoric/chapter/19', session)
    const body = await res.json<any>()
    if (body.pageAnchors.length) {
      expect(body.pageAnchorNote).toMatch(/confirmed by reading the page/)
    } else {
      expect(body.pageAnchorNote).toMatch(/Nothing here is inferred/)
    }
  })

  it('404s an unknown chapter instead of inventing one', async () => {
    expect((await get('/api/rhetoric/chapter/97', session)).status).toBe(404)
  })
})

describe('11.3 / 11.4 — the commonplace log holds no text, and the tier rule bites', () => {
  it('records that Tier 1 was copied, and refuses a body carrying the text', async () => {
    const ok = await post('/api/rhetoric/commonplace', session, {
      figure_slug: 'anaphora', copied_on: '2026-08-23', page_of_book: '14',
    })
    expect(ok.status).toBe(200)
    const body = await ok.json<any>()
    expect(body.handwritten).toMatch(/stays handwritten/)
    expect(body.rejectedAllocation).toBe(REJECTED_VERBATIM_ALLOCATION)
    expect(body.warning).toBeNull()

    // There is no text field, and the schema is strict, so sending one is refused.
    const withText = await post('/api/rhetoric/commonplace', session, {
      figure_slug: 'anaphora', copied_on: '2026-08-23', text: 'the specimen itself',
    })
    expect(withText.status).toBe(400)
  })

  it('has no column anywhere in commonplace_log for the copied text', async () => {
    const cols = (await env.DB.prepare(`PRAGMA table_info(commonplace_log)`).all())
      .results as Array<{ name: string }>
    const names = cols.map((c) => c.name)
    expect(names).not.toContain('text')
    expect(names).not.toContain('specimen_text')
    expect(names).toContain('copied_on')
  })

  it('refuses a Tier 2 or Tier 3 specimen: only Tier 1 is copied verbatim', async () => {
    const tier3 = await env.DB.prepare(
      `SELECT id, figure_slug FROM specimens WHERE tier=3 LIMIT 1`,
    ).first<{ id: number; figure_slug: string }>()
    const res = await post('/api/rhetoric/commonplace', session, {
      figure_slug: tier3!.figure_slug, specimen_id: tier3!.id, copied_on: '2026-08-23',
    })
    expect(res.status).toBe(409)
    expect((await res.json<any>()).error).toBe('NOT A TIER 1 SPECIMEN')
  })
})

describe('11.3 Day 5 — copia keeps the bad renderings and counts them', () => {
  it('stores every rendering, marks the bad ones, and reports the shortfall', async () => {
    const renderings = Array.from({ length: 12 }, (_, i) => ({
      text: `Rendering number ${i + 1} of the sentence I actually had to say.`,
      self_marked_bad: i % 4 === 0,
    }))
    const res = await post('/api/rhetoric/copia', session, {
      figure_slug: 'anaphora',
      seed_sentence: 'I need the timeline before I can commit.',
      occurred_on: '2026-08-23',
      renderings,
    })
    expect(res.status).toBe(200)
    const body = await res.json<any>()
    expect(body.count).toBe(12)
    expect(body.selfMarkedBad).toBe(3)
    expect(body.target).toBe(COPIA_TARGET)
    expect(body.shortOfTarget).toMatch(/8 short of the twenty/)
    expect(body.note).toMatch(/Volume is the trainer, not quality/)

    // The bad ones are KEPT, not dropped.
    const stored = await env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(self_marked_bad),0) AS bad
       FROM copia_renderings WHERE session_id=?`,
    ).bind(body.id).first<{ n: number; bad: number }>()
    expect(stored!.n).toBe(12)
    expect(stored!.bad).toBe(3)
  })
})

describe('11.3 Day 6 / 11.9 — live fire, and being noticed as the failure condition', () => {
  it('names the failure the cycle still owes, and never counts noticed as a win', async () => {
    const fits = await post('/api/rhetoric/deployment', session, {
      figure_slug: 'anaphora', occurred_on: '2026-08-23',
      context: 'Standup with the delivery lead.',
      what_happened: 'The three-beat opening carried the point and nobody named it.',
      fit: 'fits', counterpart_noticed: false,
      script: 'Open on the constraint, three times, then stop.',
      delivery_notation: 'Pause before the third. Stress "timeline". Stop after it.',
      never_list: 'Do not concede the Friday date. Do not name the other team.',
      pivots: [{ trigger: 'they concede', response: 'Stop talking.' }],
    })
    expect(fits.status).toBe(200)
    const first = await fits.json<any>()
    expect(first.pivots).toBe(1)
    expect(first.cycleComplete).toBe(false)
    expect(first.missingForThisFigure).toEqual(['barely', 'fails'])
    expect(first.failureRequired).toMatch(/required, not tolerated/)
    expect(first.noticedIsFailure).toBeNull()

    const noticed = await post('/api/rhetoric/deployment', session, {
      figure_slug: 'anaphora', occurred_on: '2026-08-23',
      context: 'Same conversation, later.',
      what_happened: 'He asked whether I had been reading a rhetoric book.',
      fit: 'barely', counterpart_noticed: true,
    })
    const second = await noticed.json<any>()
    expect(second.noticedIsFailure).toMatch(/Being noticed is the failure condition/)

    await post('/api/rhetoric/deployment', session, {
      figure_slug: 'anaphora', occurred_on: '2026-08-23',
      context: 'A one-line reply in chat.',
      what_happened: 'Three beats in one sentence read as theatrical and killed the point.',
      fit: 'fails', counterpart_noticed: true,
    })
    const done = await post('/api/rhetoric/deployment', session, {
      figure_slug: 'anaphora', occurred_on: '2026-08-24',
      context: 'A second fitting use.', what_happened: 'Landed invisibly.',
      fit: 'fits', counterpart_noticed: false,
    })
    const fourth = await done.json<any>()
    expect(fourth.cycleComplete).toBe(true)
    expect(fourth.missingForThisFigure).toEqual([])
  })

  it('reports the noticed ratio as a metric that must NOT render as progress', async () => {
    await post('/api/rhetoric/deployment', session, {
      figure_slug: 'anaphora', occurred_on: '2026-08-23', context: 'A room.',
      what_happened: 'Noticed.', fit: 'fits', counterpart_noticed: true,
    })
    await post('/api/rhetoric/deployment', session, {
      figure_slug: 'anaphora', occurred_on: '2026-08-23', context: 'A room.',
      what_happened: 'Invisible.', fit: 'barely', counterpart_noticed: false,
    })
    const res = await get('/api/rhetoric/metrics', session)
    expect(res.status).toBe(200)
    const body = await res.json<any>()
    const noticed = body.metrics.find((m: any) => m.slug === 'noticed_ratio')
    expect(noticed.inverted).toBe(true)
    expect(noticed.renderAsProgress).toBe(false)
    expect(noticed.data.value).toBeCloseTo(0.5)
    // It is the only one, and there are six.
    expect(body.metrics.filter((m: any) => m.inverted)).toHaveLength(1)
    expect(body.metrics).toHaveLength(6)
  })
})

describe('11.5 — the fixed ladder, derived rather than submitted', () => {
  it('walks 1, 3, 7, 16, 35 on correct answers and returns to the first rung on a lapse', async () => {
    const created = await post('/api/rhetoric/cards', session, {
      card_type: 'skeleton_to_example', figure_slug: 'anaphora',
    })
    expect(created.status).toBe(200)
    const cardId = (await created.json<any>()).card.id

    const intervals: number[] = []
    for (let i = 0; i < 6; i++) {
      const res = await post(`/api/rhetoric/review/${cardId}`, session, {
        correct: true, reviewed_on: '2026-08-23',
      })
      expect(res.status).toBe(200)
      intervals.push((await res.json<any>()).intervalDays)
    }
    // Five intervals and no sixth: 11.5 names five, so the last rung repeats rather
    // than being extrapolated into curriculum the book never wrote.
    expect(intervals).toEqual([1, 3, 7, 16, 35, 35])

    const lapse = await post(`/api/rhetoric/review/${cardId}`, session, {
      correct: false, reviewed_on: '2026-08-23',
    })
    const body = await lapse.json<any>()
    expect(body.stepAfter).toBe(1)
    expect(body.intervalDays).toBe(LADDER[0])
    expect(body.dueDate).toBe('2026-08-24')

    const card = await env.DB.prepare(
      `SELECT ladder_step, lapses, total_reviews, correct_reviews FROM rhetoric_cards WHERE id=?`,
    ).bind(cardId).first<any>()
    expect(card.lapses).toBe(1)
    expect(card.total_reviews).toBe(7)
    expect(card.correct_reviews).toBe(6)
  })

  it('refuses a submitted ladder step: the step is derived from what was answered', async () => {
    const created = await post('/api/rhetoric/cards', session, {
      card_type: 'name_to_definition', figure_slug: 'epistrophe',
    })
    const cardId = (await created.json<any>()).card.id
    const res = await post(`/api/rhetoric/review/${cardId}`, session, {
      correct: true, ladder_step: 5, reviewed_on: '2026-08-23',
    })
    expect(res.status).toBe(400)
  })

  it('keeps the review trail append-only', async () => {
    const created = await post('/api/rhetoric/cards', session, {
      card_type: 'situation_to_figure', figure_slug: 'chiasmus',
    })
    const cardId = (await created.json<any>()).card.id
    await post(`/api/rhetoric/review/${cardId}`, session, {
      correct: true, reviewed_on: '2026-08-23',
    })
    await expect(
      env.DB.prepare(`DELETE FROM rhetoric_card_reviews WHERE card_id=?`).bind(cardId).run(),
    ).rejects.toThrow(/append-only/)
  })

  it('does not send the answer with the prompt', async () => {
    await post('/api/rhetoric/cards', session, {
      card_type: 'name_to_definition', figure_slug: 'isocolon', due_date: '2020-01-01',
    })
    const res = await get('/api/rhetoric/review/due', session)
    const body = await res.json<any>()
    expect(body.ladder).toEqual([...LADDER])
    const card = body.due.find((d: any) => d.figure_slug === 'isocolon')
    expect(card).toBeTruthy()
    expect(card.prompt).toBeTruthy()
    expect(card.plain_definition).toBeUndefined()
  })
})

describe('11.9 — recordings are references, and the re-listen waits', () => {
  it('stores a reference and refuses the re-listen before Day 143', async () => {
    const made = await post('/api/rhetoric/recording', session, {
      kind: 'baseline', file_reference: 'baseline-2026-08-23.m4a',
      made_on: '2026-08-23', duration_seconds: 180,
    })
    expect(made.status).toBe(200)
    const body = await made.json<any>()
    expect(body.storage).toMatch(/stores the reference only/)
    expect(body.relistenDays).toEqual([...RELISTEN_DAYS])

    // Set the programme start to today, so the current programme day is 1.
    const today = (await (await get('/api/rhetoric/today', session)).json<any>()).date
    await env.DB.prepare(
      `INSERT INTO settings (key, value, user_id) VALUES ('start_date', ?, ?)`,
    ).bind(today, session.userId).run()

    const early = await post(`/api/rhetoric/recording/${body.id}/relisten`, session, {})
    expect(early.status).toBe(409)
    const refusal = await early.json<any>()
    expect(refusal.error).toBe('RELISTEN NOT DUE')
    expect(refusal.reason).toMatch(/Day 143 and Day 204/)
    expect(refusal.programmeDay).toBe(1)

    await env.DB.prepare(`DELETE FROM settings WHERE key='start_date' AND user_id=?`)
      .bind(session.userId).run()
  })

  it('has no column for the audio itself: the file stays on his machine', async () => {
    const cols = (await env.DB.prepare(`PRAGMA table_info(recordings)`).all())
      .results as Array<{ name: string }>
    const names = cols.map((c) => c.name)
    expect(names).toContain('file_reference')
    expect(names).not.toContain('audio')
    expect(names).not.toContain('blob')
    expect(names).not.toContain('data')
  })
})

describe('11.9 — the self-audit mark', () => {
  it('accepts U, R, and N and nothing else', async () => {
    const ok = await post('/api/rhetoric/chapter/3/self-audit', session, { self_audit: 'R' })
    expect(ok.status).toBe(200)
    expect((await ok.json<any>()).meaning).toMatch(/recognised in others but not producible/)
    const bad = await post('/api/rhetoric/chapter/3/self-audit', session, { self_audit: 'X' })
    expect(bad.status).toBe(400)
  })
})

describe('11.10 — the field default travels with the track', () => {
  it('is one figure, once, never announced', async () => {
    const body = await (await get('/api/rhetoric/today', session)).json<any>()
    expect(body.fieldDefault.figures_per_exchange).toBe(1)
    expect(body.fieldDefault.announce).toBe(false)
    expect(body.dailyReviewMinutes).toBe(10)
  })
})
