// Book 12 — the Rhetoric Lab and the Response Lab.
//
// Four of Book 12's rules are gates rather than topics, and they live here because a
// rule that only appears in prose can be walked around:
//
//   12.1 A figure cannot be named until all six canon slots are filled. Figure-first
//        composition is how a student produces ornamented nonsense.
//   12.4 The outbound red-team card is mandatory before a draft is marked deployed.
//   12.6 why_not_obvious is required on every saved line, and if it reads like a reel it
//        is rejected. Detection PROPOSES; his correction is the training signal.
//   12.7 A response is built in four layers. Never the line alone.
import { Hono } from 'hono'
import type { Bindings, Variables } from '../env'
import { parseJson, parseValue } from '../validation'
import {
  canonMapBodySchema, rhetoricAttemptBodySchema, figureDetectionBodySchema,
  figureCorrectionBodySchema, inboundCardBodySchema, outboundCardBodySchema,
  responseBuildBodySchema, positiveIdSchema,
} from '../schemas'
import { withIdempotency } from '../request-support'
import {
  CANON_SLOTS, CANON_PURPOSES, FIGURE_FIRST_REASON, canonMapComplete, TRIANGLE,
  EXERCISE_TYPES, DELIVERY_REGISTERS, THREE_VERSIONS,
  INBOUND_QUESTIONS, OUTBOUND_QUESTIONS, DAYLIGHT_TEST, outboundGate,
  PIVOT_RULES, DELIVERY_NOTATION, NEVER_LIST_SCOPE,
  DETECTION_IS_A_PROPOSAL, SOURCE_IS_THE_ROOM, antiObviousVerdict,
  RESPONSE_LAYERS, NEVER_THE_LINE_ALONE, ASSESSMENT_CRITERIA,
  missingResponseLayers, criterionIsInverted,
} from '../rhetoric-lab'

/**
 * 12.6's detector. It PROPOSES, from the mechanical signature of each device: a word
 * immediately repeated, clauses opening or closing on the same word, a clause ending on
 * the word the next one begins with, conjunctions everywhere or nowhere.
 *
 * It is never written as fact. The row stores the proposal and his correction side by
 * side, and `was_correct` is derived from the two — his correction is the training
 * signal, so the detector is never the authority on what he actually did.
 */
function proposeFigures(text: string): string[] {
  const proposed: string[] = []
  const clean = text.replace(/\s+/g, ' ').trim()
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean)
  const wordsOf = (s: string) =>
    s.toLowerCase().replace(/[^a-z\s']/g, ' ').split(/\s+/).filter(Boolean)
  const words = wordsOf(clean)

  // epizeuxis: the same word immediately repeated. English doubles a few words for
  // grammatical reasons, so those are excluded rather than proposed as a figure.
  const GRAMMATICAL_DOUBLES = new Set(['that', 'had', 'is', 'do', 'so'])
  for (let i = 1; i < words.length; i++) {
    if (words[i] === words[i - 1] && !GRAMMATICAL_DOUBLES.has(words[i])) {
      proposed.push('epizeuxis')
      break
    }
  }

  const clauses = clean.split(/[,;:.!?]+/).map((s) => s.trim()).filter(Boolean)
  const firstWord = (s: string) => wordsOf(s)[0] || ''
  const lastWord = (s: string) => {
    const w = wordsOf(s)
    return w[w.length - 1] || ''
  }

  // anaphora: successive clauses opening on the same word.
  for (let i = 1; i < clauses.length; i++) {
    if (firstWord(clauses[i]) && firstWord(clauses[i]) === firstWord(clauses[i - 1])) {
      proposed.push('anaphora')
      break
    }
  }
  // epistrophe: successive clauses closing on the same word.
  for (let i = 1; i < clauses.length; i++) {
    if (lastWord(clauses[i]) && lastWord(clauses[i]) === lastWord(clauses[i - 1])) {
      proposed.push('epistrophe')
      break
    }
  }
  // symploce: both at once.
  if (proposed.includes('anaphora') && proposed.includes('epistrophe')) proposed.push('symploce')

  // anadiplosis: a clause ending on the word the next clause begins with.
  for (let i = 1; i < clauses.length; i++) {
    if (lastWord(clauses[i - 1]) && lastWord(clauses[i - 1]) === firstWord(clauses[i])) {
      proposed.push('anadiplosis')
      break
    }
  }

  // polysyndeton and asyndeton: conjunctions everywhere, or a list carrying none.
  const conjunctions = words.filter((w) => w === 'and' || w === 'or' || w === 'nor').length
  if (conjunctions >= 3) proposed.push('polysyndeton')
  if (conjunctions === 0 && (clean.match(/,/g) || []).length >= 2) proposed.push('asyndeton')

  // praeteritio: raising what he declines to raise.
  if (/\b(?:i (?:will|shall) not (?:mention|dwell|speak)|not to mention|to say nothing of|let us pass over)\b/i.test(clean)) {
    proposed.push('praeteritio')
  }
  // aposiopesis: the sentence broken off.
  if (/(?:--|—|\.\.\.)\s*$/.test(clean)) proposed.push('aposiopesis')

  // erotema and hypophora: the question, and the question he answers himself.
  const askedAt = sentences.findIndex((s) => s.trim().endsWith('?'))
  if (askedAt >= 0) proposed.push(askedAt < sentences.length - 1 ? 'hypophora' : 'erotema')

  // litotes: the affirmative stated as the denial of its opposite.
  if (/\bnot (?:un|in|im)[a-z]+\b|\bno small\b|\bnot the (?:worst|least)\b/i.test(clean)) {
    proposed.push('litotes')
  }
  // metanoia: the correction of what was just said.
  if (/\b(?:or rather|or better|indeed,? more than that)\b/i.test(clean)) proposed.push('metanoia')

  return [...new Set(proposed)]
}

export function registerRhetoricLabRoutes(
  app: Hono<{ Bindings: Bindings; Variables: Variables }>,
) {

// The Lab's rules, readable, so the interface never has to paraphrase Book 12.
app.get('/api/lab/rules', (c) => c.json({
  canon: {
    slots: CANON_SLOTS,
    purposes: CANON_PURPOSES,
    figuresChosenAfter: FIGURE_FIRST_REASON,
  },
  triangle: TRIANGLE,
  exercises: EXERCISE_TYPES,
  deliveryRegisters: DELIVERY_REGISTERS,
  threeVersions: THREE_VERSIONS,
  inbound: INBOUND_QUESTIONS,
  outbound: OUTBOUND_QUESTIONS,
  daylightTest: DAYLIGHT_TEST,
  pivots: PIVOT_RULES,
  deliveryNotation: DELIVERY_NOTATION,
  neverList: NEVER_LIST_SCOPE,
  detection: DETECTION_IS_A_PROPOSAL,
  source: SOURCE_IS_THE_ROOM,
  responseLayers: RESPONSE_LAYERS,
  neverTheLineAlone: NEVER_THE_LINE_ALONE,
  assessment: ASSESSMENT_CRITERIA.map((a) => ({ ...a, inverted: criterionIsInverted(a.slug) })),
}))

// ---------------------------------------------------------------------------
// 12.1 — the canon map. All six slots are required by the schema AND checked by the
// gate, so a partial map cannot be stored and then quietly treated as complete.
// ---------------------------------------------------------------------------
app.post('/api/lab/canon-map', async (c) => withIdempotency(c, 'lab:canon-map', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const b = await parseJson(c, canonMapBodySchema)
  const verdict = canonMapComplete(b)
  if (!verdict.complete) {
    return c.json({
      error: 'CANON MAP INCOMPLETE', missing: verdict.missing, reason: verdict.reason,
    }, 409)
  }
  const res = await DB.prepare(
    `INSERT INTO canon_maps (user_id, purpose, audience, occasion, proof, arrangement, delivery)
     VALUES (?,?,?,?,?,?,?)`,
  ).bind(userId, b.purpose, b.audience, b.occasion, b.proof, b.arrangement, b.delivery).run()
  return c.json({
    ok: true,
    id: res.meta.last_row_id,
    // Only now may a figure be named.
    figuresUnlocked: true,
    reason: FIGURE_FIRST_REASON,
    triangle: TRIANGLE,
  })
}))

app.get('/api/lab/canon-maps', async (c) => {
  const userId = c.get('userId')
  const rows = (await c.env.DB.prepare(
    `SELECT id, purpose, audience, occasion, proof, arrangement, delivery, created_at
     FROM canon_maps WHERE user_id=? ORDER BY id DESC LIMIT 100`,
  ).bind(userId).all()).results
  return c.json({ maps: rows, slots: CANON_SLOTS })
})

// ---------------------------------------------------------------------------
// 12.2 — the thirteen exercise types, and 12.6's two requirements on any saved line.
// The thirteenth exercise is the one that TEACHES the anti-obvious rule: it asks for
// three versions and his own written diagnosis of why the excessive one fails. The
// validator can stop a bad line; only the exercise builds the ear that stops writing them.
// ---------------------------------------------------------------------------
app.post('/api/lab/attempt', async (c) => withIdempotency(c, 'lab:attempt', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const b = await parseJson(c, rhetoricAttemptBodySchema)

  const exercise = EXERCISE_TYPES.find((e) => e.slug === b.exercise_type)
  if (!exercise) {
    return c.json({
      error: 'UNKNOWN EXERCISE TYPE',
      known: EXERCISE_TYPES.map((e) => e.slug),
    }, 400)
  }

  // 12.1's gate, at the point a figure is actually named. A named figure without a
  // complete canon map is refused, not warned about.
  if (b.figure_slug) {
    const figure = await DB.prepare(`SELECT slug FROM figures WHERE slug=?`)
      .bind(b.figure_slug).first()
    if (!figure) return c.json({ error: 'no such figure' }, 404)

    const map = b.canon_map_id
      ? await DB.prepare(
        `SELECT purpose, audience, occasion, proof, arrangement, delivery FROM canon_maps
         WHERE id=? AND user_id=?`,
      ).bind(b.canon_map_id, userId).first<any>()
      : null
    if (!map) {
      return c.json({
        error: 'CANON MAP REQUIRED BEFORE A FIGURE IS NAMED',
        reason: FIGURE_FIRST_REASON,
        slots: CANON_SLOTS.map((s) => s.slug),
      }, 409)
    }
    const verdict = canonMapComplete(map)
    if (!verdict.complete) {
      return c.json({
        error: 'CANON MAP INCOMPLETE', missing: verdict.missing, reason: verdict.reason,
      }, 409)
    }
  }

  // The thirteenth exercise is not complete without the diagnosis: the diagnosis IS
  // the exercise. Three versions with no written reason is a formatting drill.
  if (exercise.slug === 'three_versions_and_diagnosis') {
    const missing = (['version_plain', 'version_controlled', 'version_excessive',
      'excess_diagnosis'] as const).filter((k) => !String(b[k] ?? '').trim())
    if (missing.length) {
      return c.json({
        error: 'EXERCISE THIRTEEN INCOMPLETE',
        missing,
        reason: exercise.teaches,
      }, 409)
    }
  }

  // 12.6, on every saved line.
  const anti = antiObviousVerdict({
    text: b.answer,
    why_not_obvious: b.why_not_obvious ?? null,
    source: b.source_room ?? null,
  })
  if (!anti.accepted) {
    return c.json({ error: 'LINE REFUSED', reasons: anti.reasons, source: SOURCE_IS_THE_ROOM }, 409)
  }

  const res = await DB.prepare(
    `INSERT INTO rhetoric_attempts
       (user_id, exercise_type, figure_slug, canon_map_id, prompt, answer,
        version_plain, version_controlled, version_excessive, excess_diagnosis,
        why_not_obvious, source_room, confidence_before, confidence_after, occurred_on)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(userId, b.exercise_type, b.figure_slug ?? null, b.canon_map_id ?? null,
    b.prompt ?? null, b.answer, b.version_plain ?? null, b.version_controlled ?? null,
    b.version_excessive ?? null, b.excess_diagnosis ?? null, b.why_not_obvious ?? null,
    b.source_room ?? null, b.confidence_before ?? null, b.confidence_after ?? null,
    b.occurred_on).run()

  return c.json({
    ok: true,
    id: res.meta.last_row_id,
    exercise,
    registers: DELIVERY_REGISTERS,
    // 12.4: nothing is deployable until the red-team card has been answered on it.
    deployable: false,
    beforeDeploying: OUTBOUND_QUESTIONS,
    daylightTest: DAYLIGHT_TEST,
  })
}))

app.get('/api/lab/attempts', async (c) => {
  const userId = c.get('userId')
  const rows = (await c.env.DB.prepare(
    `SELECT id, exercise_type, figure_slug, canon_map_id, answer, why_not_obvious,
            source_room, confidence_before, confidence_after, occurred_on
     FROM rhetoric_attempts WHERE user_id=? ORDER BY occurred_on DESC, id DESC LIMIT 100`,
  ).bind(userId).all()).results
  return c.json({ attempts: rows, exercises: EXERCISE_TYPES, threeVersions: THREE_VERSIONS })
})

// ---------------------------------------------------------------------------
// 12.3 — the inbound analysis card. The defensive half: nine questions asked of
// something SOMEONE ELSE said. All nine are required by the schema, because the last
// two are the ones that do the work and they are the two easiest to skip.
// ---------------------------------------------------------------------------
app.post('/api/lab/inbound', async (c) => withIdempotency(c, 'lab:inbound', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const b = await parseJson(c, inboundCardBodySchema)
  const res = await DB.prepare(
    `INSERT INTO inbound_cards
       (user_id, text, figure_used, emphasis, expectation_created, what_is_repeated,
        what_is_omitted, emotion_activated, action_wanted,
        independently_supported, survives_plain_statement)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(userId, b.text, b.figure_used ?? null, b.emphasis, b.expectation_created,
    b.what_is_repeated, b.what_is_omitted, b.emotion_activated, b.action_wanted,
    b.independently_supported ? 1 : 0, b.survives_plain_statement ? 1 : 0).run()
  return c.json({
    ok: true,
    id: res.meta.last_row_id,
    questions: INBOUND_QUESTIONS,
    // The two answers that decide whether there was an argument underneath the figure.
    verdict: !b.independently_supported && !b.survives_plain_statement
      ? 'Unsupported, and it does not survive plain statement. The figure was carrying the '
        + 'claim rather than decorating it.'
      : !b.survives_plain_statement
        ? 'It does not survive being stated plainly. The force was in the wording.'
        : !b.independently_supported
          ? 'The proposition is not independently supported. Ask for the support before answering it.'
          : null,
  })
}))

app.get('/api/lab/inbound', async (c) => {
  const userId = c.get('userId')
  const rows = (await c.env.DB.prepare(
    `SELECT id, text, figure_used, emphasis, expectation_created, what_is_repeated,
            what_is_omitted, emotion_activated, action_wanted, independently_supported,
            survives_plain_statement, created_at
     FROM inbound_cards WHERE user_id=? ORDER BY id DESC LIMIT 100`,
  ).bind(userId).all()).results
  return c.json({ cards: rows, questions: INBOUND_QUESTIONS })
})

// ---------------------------------------------------------------------------
// 12.4 — the outbound red-team card, run on his OWN draft. The card is the gate: an
// attempt cannot be marked deployed until the four answers exist and none of them is a
// defect. The fourth inverts — a NO on "would it remain defensible if quoted publicly"
// is the Daylight Test failing.
// ---------------------------------------------------------------------------
app.post('/api/lab/outbound', async (c) => withIdempotency(c, 'lab:outbound', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const b = await parseJson(c, outboundCardBodySchema)

  if (b.attempt_id) {
    const attempt = await DB.prepare(
      `SELECT id FROM rhetoric_attempts WHERE id=? AND user_id=?`,
    ).bind(b.attempt_id, userId).first()
    if (!attempt) return c.json({ error: 'no such attempt' }, 404)
  }

  const res = await DB.prepare(
    `INSERT INTO outbound_cards
       (user_id, attempt_id, draft, overstates_certainty, hides_downside,
        pressures_rather_than_persuades, defensible_if_quoted, notes)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).bind(userId, b.attempt_id ?? null, b.draft, b.overstates_certainty ? 1 : 0,
    b.hides_downside ? 1 : 0, b.pressures_rather_than_persuades ? 1 : 0,
    b.defensible_if_quoted ? 1 : 0, b.notes ?? null).run()

  const gate = outboundGate({
    overstates_certainty: b.overstates_certainty,
    hides_downside: b.hides_downside,
    pressures: b.pressures_rather_than_persuades,
    defensible_if_quoted: b.defensible_if_quoted,
  })

  return c.json({
    ok: true,
    id: res.meta.last_row_id,
    ...gate,
    questions: OUTBOUND_QUESTIONS,
    daylightTest: DAYLIGHT_TEST,
    // The card is a finding, not a verdict on him. What it blocks is the deployment.
    blocks: gate.deployable ? null : 'This draft cannot be marked deployed while a red-team '
      + 'answer is outstanding or a defect stands.',
  })
}))

// The transition 12.4 guards. Refused when no red-team card exists for the attempt, and
// refused when the newest card on it still carries a defect.
app.post('/api/lab/attempt/:id/deploy', async (c) =>
  withIdempotency(c, 'lab:deploy', async () => {
    const DB = c.env.DB
    const userId = c.get('userId')
    const id = parseValue(positiveIdSchema, c.req.param('id'))
    const attempt = await DB.prepare(
      `SELECT id, deployed FROM rhetoric_attempts WHERE id=? AND user_id=?`,
    ).bind(id, userId).first<any>()
    if (!attempt) return c.json({ error: 'no such attempt' }, 404)

    const card = await DB.prepare(
      `SELECT overstates_certainty, hides_downside, pressures_rather_than_persuades,
              defensible_if_quoted
       FROM outbound_cards WHERE user_id=? AND attempt_id=? ORDER BY id DESC LIMIT 1`,
    ).bind(userId, id).first<any>()
    if (!card) {
      return c.json({
        error: 'RED-TEAM CARD REQUIRED',
        reason: 'Book 12.4 makes the outbound card mandatory before any draft is marked '
          + 'deployed. It has not been answered for this draft.',
        questions: OUTBOUND_QUESTIONS,
      }, 409)
    }

    const gate = outboundGate({
      overstates_certainty: !!card.overstates_certainty,
      hides_downside: !!card.hides_downside,
      pressures: !!card.pressures_rather_than_persuades,
      defensible_if_quoted: !!card.defensible_if_quoted,
    })
    if (!gate.deployable) {
      return c.json({
        error: 'RED-TEAM CARD NOT CLEAR',
        ...gate,
        daylightTest: DAYLIGHT_TEST,
      }, 409)
    }

    await DB.prepare(
      `UPDATE rhetoric_attempts SET deployed=1, deployed_on=date('now')
       WHERE id=? AND user_id=?`,
    ).bind(id, userId).run()
    return c.json({ ok: true, deployed: true, ...gate, pivots: PIVOT_RULES })
  }))

// ---------------------------------------------------------------------------
// 12.6 — figure detection. The detector PROPOSES; his correction is stored as the
// training signal. `was_correct` stays NULL until he has corrected it, because until
// then nobody has said whether the proposal was right — and a NULL is honest where a
// zero would be a fabricated verdict.
// ---------------------------------------------------------------------------
app.post('/api/lab/detect', async (c) => withIdempotency(c, 'lab:detect', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const b = await parseJson(c, figureDetectionBodySchema)
  const proposed = proposeFigures(b.text)

  // Only propose slugs that are real records, so a tag can always be opened.
  const known = (await DB.prepare(
    `SELECT slug FROM figures`,
  ).all()).results as Array<{ slug: string }>
  const knownSet = new Set(known.map((k) => k.slug))
  const kept = proposed.filter((slug) => knownSet.has(slug))

  const res = await DB.prepare(
    `INSERT INTO figure_detections (user_id, text, proposed, corrected, was_correct)
     VALUES (?,?,?,NULL,NULL)`,
  ).bind(userId, b.text, JSON.stringify(kept)).run()

  return c.json({
    ok: true,
    id: res.meta.last_row_id,
    proposed: kept,
    // The word matters: proposed, not found.
    status: 'PROPOSED',
    detection: DETECTION_IS_A_PROPOSAL,
    correctAt: `/api/lab/detect/${res.meta.last_row_id}/correct`,
  })
}))

app.post('/api/lab/detect/:id/correct', async (c) =>
  withIdempotency(c, 'lab:detect-correct', async () => {
    const DB = c.env.DB
    const userId = c.get('userId')
    const id = parseValue(positiveIdSchema, c.req.param('id'))
    const row = await DB.prepare(
      `SELECT id, proposed FROM figure_detections WHERE id=? AND user_id=?`,
    ).bind(id, userId).first<any>()
    if (!row) return c.json({ error: 'no such detection' }, 404)
    const b = await parseJson(c, figureCorrectionBodySchema)

    for (const slug of b.corrected) {
      const figure = await DB.prepare(`SELECT slug FROM figures WHERE slug=?`)
        .bind(slug).first()
      if (!figure) return c.json({ error: 'no such figure', slug }, 404)
    }

    const proposed: string[] = JSON.parse(row.proposed || '[]')
    const same = proposed.length === b.corrected.length
      && [...proposed].sort().join(',') === [...b.corrected].sort().join(',')

    await DB.prepare(
      `UPDATE figure_detections SET corrected=?, was_correct=? WHERE id=? AND user_id=?`,
    ).bind(JSON.stringify(b.corrected), same ? 1 : 0, id, userId).run()

    return c.json({
      ok: true,
      proposed,
      corrected: b.corrected,
      wasCorrect: same,
      // His correction is the signal. The detector does not get to keep its own answer.
      detection: DETECTION_IS_A_PROPOSAL,
    })
  }))

app.get('/api/lab/detections', async (c) => {
  const userId = c.get('userId')
  const rows = (await c.env.DB.prepare(
    `SELECT id, text, proposed, corrected, was_correct, created_at FROM figure_detections
     WHERE user_id=? ORDER BY id DESC LIMIT 100`,
  ).bind(userId).all()).results as Array<any>
  return c.json({
    detections: rows.map((r) => ({
      ...r,
      proposed: JSON.parse(r.proposed || '[]'),
      corrected: r.corrected ? JSON.parse(r.corrected) : null,
      // Uncorrected rows are unscored, not wrong.
      status: r.was_correct === null ? 'AWAITING HIS CORRECTION' : (r.was_correct ? 'CORRECT' : 'CORRECTED'),
    })),
    detection: DETECTION_IS_A_PROPOSAL,
  })
})

// ---------------------------------------------------------------------------
// 12.7 — the Response Lab. Eleven intents, each an ARCHITECTURE rather than a line, and
// every build carries all four layers: "never give the line alone; give the logic of the
// line so it can be adapted." The intents' architectures and logic live in migration
// 0027, which is their single source; the route serves them rather than restating them.
// ---------------------------------------------------------------------------
app.get('/api/lab/response/intents', async (c) => {
  const rows = (await c.env.DB.prepare(
    `SELECT slug, title, architecture, when_to_use, logic, sort_order
     FROM response_intents ORDER BY sort_order`,
  ).all()).results
  return c.json({
    intents: rows,
    layers: RESPONSE_LAYERS,
    neverTheLineAlone: NEVER_THE_LINE_ALONE,
    assessment: ASSESSMENT_CRITERIA.map((a) => ({ ...a, inverted: criterionIsInverted(a.slug) })),
  })
})

app.post('/api/lab/response', async (c) => withIdempotency(c, 'lab:response', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const b = await parseJson(c, responseBuildBodySchema)

  const intent = await DB.prepare(
    `SELECT slug, title, architecture, when_to_use, logic FROM response_intents WHERE slug=?`,
  ).bind(b.intent_slug).first<any>()
  if (!intent) return c.json({ error: 'no such response intent' }, 404)

  // All four layers, or it is a bare line with a label on it.
  const missing = missingResponseLayers({
    layer_intent: b.layer_intent, layer_truth: b.layer_truth,
    layer_structure: b.layer_structure, layer_delivery: b.layer_delivery,
  })
  if (missing.length) {
    return c.json({
      error: 'RESPONSE INCOMPLETE',
      missing,
      reason: NEVER_THE_LINE_ALONE,
      layers: RESPONSE_LAYERS,
    }, 409)
  }

  const res = await DB.prepare(
    `INSERT INTO response_builds
       (user_id, intent_slug, situation, layer_intent, layer_truth, layer_structure,
        layer_delivery, a_appropriateness, a_clarity, a_proportionality, a_naturalness,
        a_objective_achieved, a_escalation_risk, occurred_on)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(userId, b.intent_slug, b.situation, b.layer_intent, b.layer_truth,
    b.layer_structure, b.layer_delivery,
    b.a_appropriateness ?? null, b.a_clarity ?? null, b.a_proportionality ?? null,
    b.a_naturalness ?? null, b.a_objective_achieved ?? null, b.a_escalation_risk ?? null,
    b.occurred_on).run()

  return c.json({
    ok: true,
    id: res.meta.last_row_id,
    intent,
    // The architecture travels with the build so the structure can be checked against it
    // and, more importantly, adapted rather than recited.
    assessment: ASSESSMENT_CRITERIA.map((a) => ({
      ...a,
      inverted: criterionIsInverted(a.slug),
      score: (b as Record<string, unknown>)[`a_${a.slug}`] ?? null,
    })),
    escalationRiskNote: 'escalation_risk is the one criterion where a higher score is a '
      + 'worse result. No view may render it as progress.',
  })
}))

app.get('/api/lab/responses', async (c) => {
  const userId = c.get('userId')
  const rows = (await c.env.DB.prepare(
    `SELECT b.id, b.intent_slug, b.situation, b.layer_intent, b.layer_truth,
            b.layer_structure, b.layer_delivery, b.a_appropriateness, b.a_clarity,
            b.a_proportionality, b.a_naturalness, b.a_objective_achieved,
            b.a_escalation_risk, b.occurred_on, i.architecture, i.logic
     FROM response_builds b
     JOIN response_intents i ON i.slug = b.intent_slug
     WHERE b.user_id=? ORDER BY b.occurred_on DESC, b.id DESC LIMIT 100`,
  ).bind(userId).all()).results
  return c.json({
    builds: rows,
    layers: RESPONSE_LAYERS,
    neverTheLineAlone: NEVER_THE_LINE_ALONE,
    assessment: ASSESSMENT_CRITERIA.map((a) => ({ ...a, inverted: criterionIsInverted(a.slug) })),
  })
})

}
