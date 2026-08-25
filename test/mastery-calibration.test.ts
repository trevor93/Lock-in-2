import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import masteryRoutesSrc from '../src/routes/mastery.ts?raw'
import learnRoutesSrc from '../src/routes/learn.ts?raw'
import {
  LEVELS, RUBRIC_DIMENSIONS, REQUIRED_EVIDENCE, INTEGRATED_MIN_MEAN,
  admitEvidence, rubricMean, levelFromEvidence,
} from '../src/mastery'
import { makeCloze, scoreCloze, diffRecall, contentWords } from '../src/cloze'
import {
  calibrationTerms, brierScore, reliabilityBuckets, namePattern,
  PATTERN_MIN_EVENTS, OVERCONFIDENCE_GAP,
} from '../src/calibration'

// Book 10.2 — six levels with declared required evidence, a nine-dimension rubric, and
// "self-scoring is never a gate". Grading is adversarial: cloze from the source text,
// free-recall diffing, and (elsewhere) the model attacking the answer.
// Book 10.3 — confidence before/after on every graded moment, a second Brier score, and
// overconfidence named as a pattern, never penalised.
// Book 10.4 — R0 is same-session, no-notes retrieval, and no lesson closes without it.

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
  const salt = '99887766554433221100aabbccddeeff'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash('mastery-test-pw', salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'mastery-test-pw' }),
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
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')

describe('B10.2 the ladder and the rubric', () => {
  it('declares six levels, each with its required evidence, and nine rubric dimensions', () => {
    expect([...LEVELS]).toEqual(['encountered', 'recalled', 'explained', 'applied', 'transferred', 'integrated'])
    for (const level of LEVELS) expect(REQUIRED_EVIDENCE[level].length).toBeGreaterThan(20)
    expect([...RUBRIC_DIMENSIONS]).toEqual([
      'recall', 'explanation', 'mechanism', 'application',
      'reversal', 'defence', 'evidence', 'transfer', 'retention',
    ])
  })

  it('refuses evidence that does not meet the level’s declared bar', () => {
    // Wrong kind for the level.
    expect(admitEvidence({ level: 'applied', evidence_kind: 'retrieval' }).accepted).toBe(false)
    // Retrieval with the source open is not retrieval.
    expect(admitEvidence({ level: 'recalled', evidence_kind: 'retrieval', no_source: false }).accepted).toBe(false)
    expect(admitEvidence({ level: 'recalled', evidence_kind: 'retrieval', no_source: true }).accepted).toBe(true)
    // An explanation must be 50-150 words in his own language.
    expect(admitEvidence({ level: 'explained', evidence_kind: 'explanation', word_count: 20 }).accepted).toBe(false)
    expect(admitEvidence({ level: 'explained', evidence_kind: 'explanation', word_count: 400 }).accepted).toBe(false)
    expect(admitEvidence({ level: 'explained', evidence_kind: 'explanation', word_count: 90 }).accepted).toBe(true)
    // Transfer needs a populated reference to something real.
    expect(admitEvidence({ level: 'transferred', evidence_kind: 'transfer' }).accepted).toBe(false)
    expect(admitEvidence({ level: 'transferred', evidence_kind: 'transfer', transfer_ref: 'decision:41' }).accepted).toBe(true)
  })

  it('gates integrated on a rubric mean of 2.5 with no dimension at zero', () => {
    const full = (v: number) => Object.fromEntries(RUBRIC_DIMENSIONS.map((d) => [d, v]))
    expect(rubricMean(full(3))).toBe(3)
    expect(admitEvidence({ level: 'integrated', evidence_kind: 'essay', rubric: full(3) }).accepted).toBe(true)
    expect(admitEvidence({ level: 'integrated', evidence_kind: 'essay', rubric: full(2) }).accepted, `mean 2 < ${INTEGRATED_MIN_MEAN}`).toBe(false)
    // A single zero blocks it however high the rest are.
    const oneZero = { ...full(3), reversal: 0 }
    const verdict = admitEvidence({ level: 'integrated', evidence_kind: 'essay', rubric: oneZero })
    expect(verdict.accepted).toBe(false)
    expect(verdict.reason).toContain('no dimension at zero')
  })

  it('self-scoring is never a gate', () => {
    // A perfect self-score cannot admit evidence that fails the bar...
    const flattering = admitEvidence({
      level: 'explained', evidence_kind: 'explanation', word_count: 3, self_score: 100,
    })
    expect(flattering.accepted).toBe(false)
    // ...and a harsh self-score cannot block evidence that meets it.
    const harsh = admitEvidence({
      level: 'explained', evidence_kind: 'explanation', word_count: 90, self_score: 0,
    })
    expect(harsh.accepted).toBe(true)
    // The gate function never reads self_score at all.
    expect(masteryRoutesSrc).toContain('never consulted')
  })

  it('derives the level from evidence and never skips a rung', () => {
    expect(levelFromEvidence([])).toBe('encountered')
    expect(levelFromEvidence(['encountered', 'recalled'])).toBe('recalled')
    // A gap stops the ladder: integrated evidence alone does not make him integrated.
    expect(levelFromEvidence(['encountered', 'integrated'])).toBe('encountered')
    expect(levelFromEvidence(['encountered', 'recalled', 'explained', 'applied'])).toBe('applied')
  })
})

describe('B10.2 adversarial grading, cheaply and locally', () => {
  const passage = 'The supreme art of war is to subdue the enemy without fighting, for prolonged warfare exhausts the state.'

  it('generates deterministic cloze deletions from the source text', () => {
    const a = makeCloze(passage)
    const b = makeCloze(passage)
    expect(a.prompt, 'the same passage must always produce the same test').toBe(b.prompt)
    expect(a.answers.length).toBeGreaterThan(0)
    expect(a.prompt).toContain('____')
    // Stopwords are never the test.
    for (const answer of a.answers) expect(['the', 'of', 'is', 'to']).not.toContain(answer.toLowerCase())
  })

  it('scores a cloze against the passage, not against a self-report', () => {
    const cloze = makeCloze(passage)
    const perfect = scoreCloze(cloze.answers, cloze.answers)
    expect(perfect.ratio).toBe(1)
    const empty = scoreCloze(cloze.answers, ['nonsense'])
    expect(empty.hits).toBe(0)
  })

  it('diffs free recall: what came back, what was missed, what was invented', () => {
    const good = diffRecall(passage, 'Subdue the enemy without fighting; prolonged warfare exhausts the state.')
    const poor = diffRecall(passage, 'Something about winning I think.')
    expect(good.hitRatio).toBeGreaterThan(poor.hitRatio)
    expect(good.recovered).toContain('enemy')
    expect(poor.missed.length).toBeGreaterThan(0)
    expect(diffRecall(passage, 'quantum blockchain synergy').invented).toContain('blockchain')
    expect(contentWords('The the of and')).toEqual([])
  })

  it('never returns the cloze answers with the prompt', async () => {
    const s = await login()
    await env.DB.prepare(
      `INSERT OR IGNORE INTO sources (id, title, author) VALUES ('cloze_src','Cloze source','Test')`,
    ).run()
    await env.DB.prepare(
      `INSERT OR IGNORE INTO source_editions (id, source_id, translation_status, completeness)
       VALUES ('cloze_src:ed','cloze_src','public_domain','complete')`,
    ).run()
    await env.DB.prepare(
      `INSERT OR IGNORE INTO source_sections (anchor, edition_id, chapter_idx, paragraph_idx, text, word_count)
       VALUES ('cloze_src:1:1','cloze_src:ed',1,1,?,18)`,
    ).bind(passage).run()

    const res = await app.request('/api/cloze/cloze_src:1:1', { headers: { Cookie: s.cookie } }, baseEnv)
    expect(res.status).toBe(200)
    const body = await res.json<any>()
    expect(body.prompt).toContain('____')
    expect(body.answers, 'the answers are the test; they are never handed over').toBeUndefined()
    expect(body.blanks).toBeGreaterThan(0)

    // Answering records the grade and the calibration term.
    const answered = await post('/api/cloze/cloze_src:1:1/answer', s, {
      answers: ['supreme', 'subdue'], confidence_before: 80,
    })
    expect(answered.status).toBe(200)
    const graded = await answered.json<any>()
    expect(graded.total).toBe(body.blanks)
    expect(typeof graded.calibrationError).toBe('number')
  })
})

describe('B10.3 calibration on learning', () => {
  it('computes the error and the Brier term for one prediction', () => {
    const sure = calibrationTerms(100, 1)
    expect(sure.calibrationError).toBe(0)
    expect(sure.brierTerm).toBe(0)
    const wrong = calibrationTerms(100, 0)
    expect(wrong.calibrationError).toBe(1)
    expect(wrong.brierTerm).toBe(1)
    expect(calibrationTerms(50, 0.5).calibrationError).toBe(0)
    expect(brierScore([0, 1])).toBe(0.5)
    expect(brierScore([])).toBeNull()
  })

  it('shows reliability by confidence band', () => {
    const buckets = reliabilityBuckets([
      { confidence: 95, outcome: 0.5 }, { confidence: 92, outcome: 0.5 },
      { confidence: 40, outcome: 0.4 },
    ])
    const high = buckets.find((b) => b.label === '90-99')!
    expect(high.count).toBe(2)
    expect(high.gap, 'he was more confident than correct here').toBeGreaterThan(0.3)
  })

  it('names overconfidence as a specific pattern, never a penalty', () => {
    const overconfident = Array.from({ length: PATTERN_MIN_EVENTS }, () => ({ confidence: 90, outcome: 0.55 }))
    const named = namePattern(overconfident, 'reversal questions')
    expect(named.named).toBe(true)
    expect(named.gap!).toBeGreaterThan(OVERCONFIDENCE_GAP)
    // Book 10.3's own shape: a concrete comparison, and no penalty language.
    expect(named.statement).toMatch(/rate yourself \d of 5 and score \d of 3 on reversal questions/)
    expect(named.statement).toContain('No points are involved')
    expect(named.statement).not.toMatch(/penalt|deduct|lose|-\d+ pts/i)

    // Underconfidence is named too, and kindly.
    const under = namePattern(Array.from({ length: PATTERN_MIN_EVENTS }, () => ({ confidence: 30, outcome: 0.9 })))
    expect(under.named).toBe(true)
    expect(under.statement).toContain('know more than you are giving yourself credit for')

    // Too little data says so instead of inventing a pattern.
    expect(namePattern([{ confidence: 90, outcome: 0 }]).named).toBe(false)
  })

  it('reports the knowledge Brier beside the decision Brier', async () => {
    const s = await login()
    const res = await app.request('/api/calibration/knowledge', { headers: { Cookie: s.cookie } }, baseEnv)
    expect(res.status).toBe(200)
    const body = await res.json<any>()
    expect(body).toHaveProperty('knowledgeBrier')
    expect(body).toHaveProperty('decisionBrier')
    expect(body).toHaveProperty('buckets')
    expect(body.pattern).toBeTruthy()
    expect(body.note).toContain('never costs points')
  })
})

describe('B10.2/10.4 the routes, end to end', () => {
  it('admits evidence, refuses what falls short, and derives the level', async () => {
    const s = await login()
    const subject = `concept:probe-${Date.now()}`

    const thin = await post('/api/mastery/evidence', s, {
      subject_kind: 'concept', subject_id: subject,
      level: 'explained', evidence_kind: 'explanation', body: 'Too short.',
    })
    expect(thin.status).toBe(409)
    expect((await thin.json<any>()).reason).toContain('50-150 words')

    // encountered, then recalled, then a proper explanation.
    expect((await post('/api/mastery/evidence', s, {
      subject_kind: 'concept', subject_id: subject,
      level: 'encountered', evidence_kind: 'reading_record', evidence_ref: 'session:1',
    })).status).toBe(200)
    expect((await post('/api/mastery/evidence', s, {
      subject_kind: 'concept', subject_id: subject,
      level: 'recalled', evidence_kind: 'retrieval', no_source: true,
    })).status).toBe(200)
    const explained = await post('/api/mastery/evidence', s, {
      subject_kind: 'concept', subject_id: subject,
      level: 'explained', evidence_kind: 'explanation', body: words(90),
      rubric: { recall: 2, explanation: 2, mechanism: 2 }, self_score: 100,
    })
    expect(explained.status).toBe(200)
    expect((await explained.json<any>()).level).toBe('explained')

    const state = await (await app.request(
      `/api/mastery/concept/${encodeURIComponent(subject)}`, { headers: { Cookie: s.cookie } }, baseEnv,
    )).json<any>()
    expect(state.level).toBe('explained')
    expect(state.nextLevel).toBe('applied')
    expect(state.nextRequires).toContain('decision map')
    expect(state.evidence.length).toBe(3)
  })

  it('keeps the evidence trail append-only', async () => {
    const s = await login()
    const subject = `concept:immutable-${Date.now()}`
    await post('/api/mastery/evidence', s, {
      subject_kind: 'concept', subject_id: subject,
      level: 'encountered', evidence_kind: 'reading_record',
    })
    let refused = false
    try {
      await env.DB.prepare(`DELETE FROM mastery_evidence WHERE subject_id=?`).bind(subject).run()
    } catch (e: any) { refused = /MASTERY_EVIDENCE_APPEND_ONLY/.test(String(e?.message || e)) }
    expect(refused).toBe(true)
  })

  it('no lesson closes without R0 (same-session, source closed)', async () => {
    const s = await login()
    const phase = await env.DB.prepare(
      `INSERT INTO phases (sort_order, code, title) VALUES (901,'B104','R0 gate')`,
    ).run()
    const unit = await env.DB.prepare(
      `INSERT INTO units (phase_id, sort_order, title) VALUES (?,1,'R0 unit')`,
    ).bind(Number(phase.meta.last_row_id)).run()
    const unitId = Number(unit.meta.last_row_id)
    await env.DB.prepare(
      `INSERT INTO unit_progress (user_id, unit_id, status) VALUES (?,?,'reading_done')`,
    ).bind(s.userId, unitId).run()

    const refused = await post(`/api/units/${unitId}/step`, s, { step: 'complete', debrief_answer: 'Done.' })
    expect(refused.status).toBe(409)
    const body = await refused.json<any>()
    expect(body.needsR0).toBe(true)

    // A retrieval taken WITH the source open does not satisfy R0.
    await post('/api/retrieval', s, {
      subject_kind: 'unit', subject_id: String(unitId),
      prompt: 'State the principle without notes.', answer: 'Prepare before commitment.',
      confidence_before: 60, same_session: true, used_source: true,
    })
    expect((await post(`/api/units/${unitId}/step`, s, { step: 'complete', debrief_answer: 'Done.' })).status,
      'an open-book answer is not retrieval').toBe(409)

    // The honest R0 closes the lesson.
    const r0 = await post('/api/retrieval', s, {
      subject_kind: 'unit', subject_id: String(unitId),
      passage: 'Prepare carefully before commitment and avoid unnecessary prolongation.',
      prompt: 'State the principle without notes.',
      answer: 'Prepare carefully before commitment; avoid unnecessary prolongation.',
      confidence_before: 70, confidence_after: 80, same_session: true, used_source: false,
    })
    expect(r0.status).toBe(200)
    const graded = await r0.json<any>()
    expect(graded.hitRatio).toBeGreaterThan(0.5)
    expect(graded.note).toContain('source closed')
    expect((await post(`/api/units/${unitId}/step`, s, { step: 'complete', debrief_answer: 'Done.' })).status).toBe(200)
  })

  it('the R0 rule lives in the server', () => {
    expect(learnRoutesSrc).toContain('retrieval_attempts')
    expect(learnRoutesSrc).toContain('same_session=1')
    expect(learnRoutesSrc).toContain('used_source=0')
  })

  // Book 17 test matrix, Curriculum row: "transfer reference required for transferred
  // status". `admitEvidence` is unit-tested at the top of this file, and the route is wired
  // to it — the thin-explanation case above proves a refusal reaches the client as a 409.
  //
  // What nothing covered until now is the OTHER direction: that the gate can be SATISFIED
  // through the route. That asymmetry hides a worse defect than a missed refusal. If the
  // handler ever stopped forwarding `transfer_ref` — a hardcoded null, a renamed schema
  // field, a dropped line in the `admitEvidence({...})` call — every unit test here would
  // stay green, the refusal above would stay green, and `transferred` would become a level
  // no evidence could ever reach. A rung of the ladder would quietly cease to exist, and
  // the app would blame the user for omitting a reference they had in fact supplied.
  it('admits transfer evidence with a reference, and refuses it without one, through the route', async () => {
    const s = await login()
    const subject = `concept:transfer-${Date.now()}`

    const bare = await post('/api/mastery/evidence', s, {
      subject_kind: 'concept', subject_id: subject,
      level: 'transferred', evidence_kind: 'transfer',
    })
    expect(bare.status, 'a transfer with no reference was admitted').toBe(409)
    expect((await bare.json<any>()).reason).toContain('populated reference')

    // Whitespace is not a reference. The schema trims, so this arrives as '' and must be
    // refused for the same reason rather than passing as a present-but-empty field.
    const blank = await post('/api/mastery/evidence', s, {
      subject_kind: 'concept', subject_id: subject,
      level: 'transferred', evidence_kind: 'transfer', transfer_ref: '   ',
    })
    expect(blank.status, 'a whitespace-only reference counted as a reference').toBe(409)

    const real = await post('/api/mastery/evidence', s, {
      subject_kind: 'concept', subject_id: subject,
      level: 'transferred', evidence_kind: 'transfer', transfer_ref: 'decision:41',
    })
    expect(
      real.status,
      'a transfer WITH a reference was refused, so `transferred` is unreachable through the '
      + 'route and the refusal blames the user for an omission they did not make',
    ).toBe(200)
    const body = await real.json<any>()
    expect(body.admitted).toContain('transferred')

    // The rung is earned, not the ladder. Evidence for one level never awards the levels
    // beneath it, so a transfer filed before the lower rungs leaves the derived level where
    // it was — otherwise one submission would skip four levels of proof.
    expect(body.level, 'a transfer submitted out of order awarded the level anyway').toBe('encountered')
  })
})
