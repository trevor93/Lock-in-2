// Book 10.2 / 10.3 / 10.4 — the mastery routes.
//
// The ladder is readable, evidence is submittable (and refused when it does not meet
// the level's declared bar), retrieval is graded by cloze and free-recall diffing
// rather than by self-report, and knowledge calibration is reported beside the decision
// Brier. Nothing here subtracts a point: Book 10.3 is diagnostic by design.
import { Hono } from 'hono'
import type { Bindings, Variables } from '../env'
import { parseJson, parseValue } from '../validation'
import {
  masteryEvidenceBodySchema, retrievalBodySchema, clozeBodySchema, positiveIdSchema,
} from '../schemas'
import { userNow } from '../clock'
import { withIdempotency } from '../request-support'
import {
  LEVELS, REQUIRED_EVIDENCE, ACCEPTED_EVIDENCE, RUBRIC_DIMENSIONS, SCORE_MEANING,
  INTEGRATED_MIN_MEAN, admitEvidence, rubricMean, levelFromEvidence, type Level, type Rubric,
} from '../mastery'
import { makeCloze, scoreCloze, diffRecall } from '../cloze'
import { calibrationTerms, brierScore, reliabilityBuckets, namePattern } from '../calibration'

async function recomputeMastery(
  DB: D1Database, userId: number, kind: string, id: string,
): Promise<{ level: Level; rubric_mean: number | null }> {
  const rows = (await DB.prepare(
    `SELECT level, rubric_mean FROM mastery_evidence
     WHERE user_id=? AND subject_kind=? AND subject_id=?`,
  ).bind(userId, kind, id).all()).results as Array<{ level: string; rubric_mean: number | null }>
  const level = levelFromEvidence(rows.map((r) => r.level))
  const means = rows.map((r) => r.rubric_mean).filter((m): m is number => typeof m === 'number')
  const mean = means.length ? means.reduce((a, b) => a + b, 0) / means.length : null
  await DB.prepare(
    `INSERT INTO mastery (user_id, subject_kind, subject_id, level, rubric_mean, updated_at)
     VALUES (?,?,?,?,?,datetime('now'))
     ON CONFLICT(user_id, subject_kind, subject_id) DO UPDATE SET
       level=excluded.level, rubric_mean=excluded.rubric_mean, updated_at=datetime('now')`,
  ).bind(userId, kind, id, level, mean).run()
  return { level, rubric_mean: mean }
}

export function registerMasteryRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {

// The ladder itself, with the bar for each rung and what the rubric scores mean, so
// the interface never has to paraphrase Book 10.2.
app.get('/api/mastery/ladder', (c) => c.json({
  levels: LEVELS.map((level) => ({
    level,
    requiredEvidence: REQUIRED_EVIDENCE[level],
    acceptedEvidence: ACCEPTED_EVIDENCE[level],
  })),
  rubric: {
    dimensions: RUBRIC_DIMENSIONS,
    scoreMeaning: SCORE_MEANING,
    integratedRequires: `mean >= ${INTEGRATED_MIN_MEAN} with no dimension at 0`,
  },
  note: 'Self-scoring is never a gate. It is recorded only so calibration can be measured (Book 10.3).',
}))

// Where a subject actually stands, with its evidence trail.
app.get('/api/mastery/:kind/:id', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const kind = c.req.param('kind')
  const id = c.req.param('id')
  const current = await DB.prepare(
    `SELECT level, rubric_mean, updated_at FROM mastery
     WHERE user_id=? AND subject_kind=? AND subject_id=?`,
  ).bind(userId, kind, id).first<any>()
  const evidence = (await DB.prepare(
    `SELECT id, level, evidence_kind, rubric_mean, self_score, word_count, transfer_ref, created_at
     FROM mastery_evidence WHERE user_id=? AND subject_kind=? AND subject_id=?
     ORDER BY id DESC LIMIT 50`,
  ).bind(userId, kind, id).all()).results
  const level = (current?.level as Level) || 'encountered'
  const next = LEVELS[Math.min(LEVELS.length - 1, LEVELS.indexOf(level) + 1)]
  return c.json({
    level,
    rubricMean: current?.rubric_mean ?? null,
    nextLevel: next === level ? null : next,
    nextRequires: next === level ? null : REQUIRED_EVIDENCE[next],
    evidence,
  })
})

// Submit evidence for a level. The bar is enforced here; the self-score is stored but
// never consulted.
app.post('/api/mastery/evidence', async (c) => withIdempotency(c, 'mastery:evidence', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const b = await parseJson(c, masteryEvidenceBodySchema)
  const rubric: Rubric = b.rubric || {}
  const words = b.body ? b.body.trim().split(/\s+/).filter(Boolean).length : 0

  const verdict = admitEvidence({
    level: b.level as Level,
    evidence_kind: b.evidence_kind,
    rubric,
    word_count: words,
    transfer_ref: b.transfer_ref ?? null,
    self_score: b.self_score ?? null,
    no_source: b.no_source,
  })
  if (!verdict.accepted) {
    return c.json({ error: 'EVIDENCE NOT ADMITTED', reason: verdict.reason, needed: REQUIRED_EVIDENCE[b.level as Level] }, 409)
  }

  const mean = rubricMean(rubric)
  await DB.prepare(
    `INSERT INTO mastery_evidence
       (user_id, subject_kind, subject_id, level, evidence_kind, evidence_ref, body, word_count,
        r_recall, r_explanation, r_mechanism, r_application, r_reversal, r_defence,
        r_evidence, r_transfer, r_retention, rubric_mean, graded_by, self_score, transfer_ref)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(userId, b.subject_kind, b.subject_id, b.level, b.evidence_kind, b.evidence_ref ?? null,
    b.body ?? null, words,
    rubric.recall ?? null, rubric.explanation ?? null, rubric.mechanism ?? null,
    rubric.application ?? null, rubric.reversal ?? null, rubric.defence ?? null,
    rubric.evidence ?? null, rubric.transfer ?? null, rubric.retention ?? null,
    mean, b.graded_by || 'adversarial', b.self_score ?? null, b.transfer_ref ?? null).run()

  const state = await recomputeMastery(DB, userId, b.subject_kind, b.subject_id)
  return c.json({ ok: true, admitted: verdict.reason, ...state })
}))

// Cheap immediate testing: deterministic cloze deletions from a stored passage, so the
// same passage always produces the same test and cannot be rerolled until it is easy.
app.get('/api/cloze/:anchor', async (c) => {
  const DB = c.env.DB
  const anchor = c.req.param('anchor')
  const section = await DB.prepare(
    `SELECT anchor, text, chapter_idx, paragraph_idx FROM source_sections WHERE anchor=?`,
  ).bind(anchor).first<any>()
  if (!section) return c.json({ error: 'no such section anchor' }, 404)
  const cloze = makeCloze(section.text)
  // The answers are NOT returned: they are the test.
  return c.json({
    anchor: section.anchor,
    prompt: cloze.prompt,
    blanks: cloze.answers.length,
    chapter: section.chapter_idx,
    paragraph: section.paragraph_idx,
  })
})

// Answer a cloze. Graded locally against the stored passage — no self-report involved.
app.post('/api/cloze/:anchor/answer', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const anchor = c.req.param('anchor')
  const b = await parseJson(c, clozeBodySchema)
  const section = await DB.prepare(
    `SELECT text FROM source_sections WHERE anchor=?`,
  ).bind(anchor).first<{ text: string }>()
  if (!section) return c.json({ error: 'no such section anchor' }, 404)
  const cloze = makeCloze(section.text)
  const score = scoreCloze(cloze.answers, b.answers)
  const { date } = await userNow(DB, userId)

  const terms = calibrationTerms(b.confidence_before, score.ratio)
  await DB.batch([
    DB.prepare(
      `INSERT INTO retrieval_attempts
         (user_id, subject_kind, subject_id, anchor, prompt, answer, mode, hit_ratio,
          same_session, used_source, confidence_before, confidence_after, calibration_error)
       VALUES (?,'section',?,?,?,?,'cloze',?,?,?,?,?,?)`,
    ).bind(userId, anchor, anchor, cloze.prompt, b.answers.join(' | '), score.ratio,
      b.same_session ? 1 : 0, b.used_source ? 1 : 0,
      b.confidence_before, b.confidence_after ?? null, terms.calibrationError),
    DB.prepare(
      `INSERT INTO calibration_events
         (user_id, domain, source_kind, source_ref, confidence_before, confidence_after,
          outcome, calibration_error, brier_term, occurred_on)
       VALUES (?,'knowledge','retrieval',?,?,?,?,?,?,?)`,
    ).bind(userId, anchor, b.confidence_before, b.confidence_after ?? null,
      score.ratio, terms.calibrationError, terms.brierTerm, date),
  ])
  return c.json({ ok: true, hits: score.hits, total: score.total, ratio: Number(score.ratio.toFixed(3)), ...terms })
})

// Book 10.4 R0 / Book 10.2 'recalled': a no-notes free-recall answer, diffed against
// the passage. The diff names what was missed; it never scores the person.
app.post('/api/retrieval', async (c) => withIdempotency(c, 'retrieval:attempt', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const b = await parseJson(c, retrievalBodySchema)
  const { date } = await userNow(DB, userId)

  let passage = b.passage ?? null
  if (!passage && b.anchor) {
    const section = await DB.prepare(
      `SELECT text FROM source_sections WHERE anchor=?`,
    ).bind(b.anchor).first<{ text: string }>()
    passage = section?.text ?? null
  }
  const diff = passage ? diffRecall(passage, b.answer) : null
  const outcome = diff ? diff.hitRatio : 0
  const terms = calibrationTerms(b.confidence_before, outcome)

  const inserted = await DB.prepare(
    `INSERT INTO retrieval_attempts
       (user_id, subject_kind, subject_id, anchor, prompt, answer, mode, hit_ratio,
        same_session, used_source, confidence_before, confidence_after, calibration_error)
     VALUES (?,?,?,?,?,?,'free_recall',?,?,?,?,?,?)`,
  ).bind(userId, b.subject_kind, b.subject_id, b.anchor ?? null, b.prompt, b.answer,
    outcome, b.same_session ? 1 : 0, b.used_source ? 1 : 0,
    b.confidence_before, b.confidence_after ?? null, terms.calibrationError).run()

  await DB.prepare(
    `INSERT INTO calibration_events
       (user_id, domain, source_kind, source_ref, confidence_before, confidence_after,
        outcome, calibration_error, brier_term, occurred_on)
     VALUES (?,'knowledge','retrieval',?,?,?,?,?,?,?)`,
  ).bind(userId, String(inserted.meta.last_row_id), b.confidence_before,
    b.confidence_after ?? null, outcome, terms.calibrationError, terms.brierTerm, date).run()

  return c.json({
    ok: true,
    attempt_id: Number(inserted.meta.last_row_id),
    hitRatio: Number(outcome.toFixed(3)),
    recovered: diff?.recovered ?? [],
    missed: diff?.missed ?? [],
    ...terms,
    note: b.used_source
      ? 'Recorded, but retrieval with the source open is not retrieval — it will not evidence the recalled level.'
      : 'Recorded with the source closed.',
  })
}))

// The second Brier score, beside the decision one. Purely diagnostic.
app.get('/api/calibration/knowledge', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const rows = (await DB.prepare(
    `SELECT confidence_before AS confidence, outcome, brier_term
     FROM calibration_events WHERE user_id=? AND domain='knowledge'
     ORDER BY id DESC LIMIT 500`,
  ).bind(userId).all()).results as Array<{ confidence: number; outcome: number; brier_term: number }>
  const decisionRows = (await DB.prepare(
    `SELECT brier_term FROM calibration_events WHERE user_id=? AND domain='decision'
     ORDER BY id DESC LIMIT 500`,
  ).bind(userId).all()).results as Array<{ brier_term: number }>

  const knowledgeBrier = brierScore(rows.map((r) => r.brier_term))
  const decisionBrier = brierScore(decisionRows.map((r) => r.brier_term))
  const events = rows.map((r) => ({ confidence: r.confidence, outcome: r.outcome }))
  return c.json({
    events: rows.length,
    knowledgeBrier: knowledgeBrier === null ? null : Number(knowledgeBrier.toFixed(4)),
    decisionBrier: decisionBrier === null ? null : Number(decisionBrier.toFixed(4)),
    buckets: reliabilityBuckets(events),
    pattern: namePattern(events, 'retrieval and cloze questions'),
    note: 'Diagnostic only. Calibration never costs points (Book 10.3).',
  })
})
}
