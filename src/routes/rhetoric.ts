// Book 11 — the Farnsworth track routes.
//
// The track is curriculum data that is already running on paper. These routes carry it;
// they never compete with it. Three things are enforced here rather than described:
//
//   11.1 Part III is refused until Parts I and II are installed.
//   11.5 The ladder is the fixed 1/3/7/16/35 and the step is DERIVED from what was
//        answered, never submitted.
//   11.8 The commonplace log records that Tier 1 was copied and when. There is no text
//        field to send, so there is nothing for a client to accidentally absorb.
import { Hono } from 'hono'
import type { Bindings, Variables } from '../env'
import { parseJson, parseValue } from '../validation'
import {
  commonplaceLogBodySchema, cycleDayBodySchema, copiaSessionBodySchema,
  deploymentBodySchema, recordingBodySchema, selfAuditBodySchema,
  rhetoricCardReviewBodySchema, rhetoricCardBodySchema, figureOwnExampleBodySchema,
  positiveIdSchema, slugParamSchema,
} from '../schemas'
import { safeDate, userNow } from '../clock'
import { getSetting } from '../repositories'
import { addDays, daysBetween } from '../time'
import { withIdempotency } from '../request-support'
import {
  ROOT_NODE, PARTS, PART_ORDER_REASON, partIsUnlocked,
  CYCLE_DAYS, cycleDayFor, COPIA_TARGET, TIER_TARGETS, MUST_NOT_ABSORB,
  LADDER, nextLadderInterval, CARD_TYPES, DAILY_REVIEW_MINUTES, DAILY_REVIEW_REASON,
  LADDER_IS_FIXED_REASON, CHAPTER_SLOTS, CONVERSATIONAL_JOBS, jobsForFigure,
  TRACK_METRICS, metricIsInverted, RELISTEN_DAYS, SELF_AUDIT_MARKS, FIELD_DEFAULT,
  TRACK_FIRST_DAY, TRACK_LAST_DAY, REJECTED_VERBATIM_ALLOCATION,
  verbatimAllocationIsRejected,
} from '../rhetoric'

/**
 * Which programme day it is for this user, or null when no start date is set. The same
 * arithmetic the rest of the app uses, so the track cannot drift off the programme.
 */
async function programmeDay(DB: D1Database, userId: number): Promise<number | null> {
  const { date } = await userNow(DB, userId)
  const start = await getSetting(DB, 'start_date', userId)
  if (!start) return null
  return daysBetween(start, date) + 1
}

/** Which chapter (or milestone) a programme day falls in. Rows are the source, not code. */
async function chapterForDay(DB: D1Database, day: number) {
  const chapter = await DB.prepare(
    `SELECT id, phase_code, part, title, figure_slug, day_from, day_to, self_audit
     FROM rhetoric_chapters WHERE ? BETWEEN day_from AND day_to`,
  ).bind(day).first<any>()
  if (chapter) return { kind: 'chapter' as const, ...chapter }
  const milestone = await DB.prepare(
    `SELECT slug, phase_code, title, day_from, day_to, purpose
     FROM rhetoric_milestones WHERE ? BETWEEN day_from AND day_to`,
  ).bind(day).first<any>()
  if (milestone) return { kind: 'milestone' as const, ...milestone }
  return null
}

/** 11.1's gate, resolved against what he has actually completed. */
async function installedParts(DB: D1Database, userId: number): Promise<number[]> {
  // A part is installed when every chapter in it has a completed Day 7 consolidation.
  const rows = (await DB.prepare(
    `SELECT c.part AS part,
            COUNT(*) AS chapters,
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM cycle_days d
              WHERE d.user_id=? AND d.chapter_id=c.id AND d.cycle_day=7
            ) THEN 1 ELSE 0 END) AS consolidated
     FROM rhetoric_chapters c GROUP BY c.part ORDER BY c.part`,
  ).bind(userId).all()).results as Array<{ part: number; chapters: number; consolidated: number }>
  return rows.filter((r) => r.consolidated >= r.chapters).map((r) => r.part)
}

export function registerRhetoricRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {

// The architecture the book never states outright, taught explicitly (11.1), with the
// root node and the reason Part III comes last.
app.get('/api/rhetoric/track', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const phases = (await DB.prepare(
    `SELECT code, sort_order, title, subtitle, day_from, day_to, architecture
     FROM rhetoric_phases ORDER BY sort_order`,
  ).all()).results
  const chapters = (await DB.prepare(
    `SELECT id, phase_code, part, title, figure_slug, day_from, day_to, self_audit
     FROM rhetoric_chapters ORDER BY id`,
  ).all()).results
  const milestones = (await DB.prepare(
    `SELECT slug, phase_code, title, day_from, day_to, purpose
     FROM rhetoric_milestones ORDER BY day_from`,
  ).all()).results
  const parts = await installedParts(DB, userId)
  return c.json({
    rootNode: ROOT_NODE,
    parts: PARTS.map((p) => ({
      ...p,
      installed: parts.includes(p.part),
      ...partIsUnlocked(p.part, parts),
    })),
    partOrderReason: PART_ORDER_REASON,
    firstDay: TRACK_FIRST_DAY,
    lastDay: TRACK_LAST_DAY,
    phases, chapters, milestones,
    cycle: CYCLE_DAYS,
    chapterSlots: CHAPTER_SLOTS,
    selfAuditMarks: SELF_AUDIT_MARKS,
    fieldDefault: FIELD_DEFAULT,
  })
})

// One chapter, in the thirteen-slot format (11.6), with its figure record's both faces
// and its place on the cycle. Part III chapters report the gate rather than hiding it.
app.get('/api/rhetoric/chapter/:id', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  const chapter = await DB.prepare(
    `SELECT id, phase_code, part, title, figure_slug, day_from, day_to, self_audit
     FROM rhetoric_chapters WHERE id=?`,
  ).bind(id).first<any>()
  if (!chapter) return c.json({ error: 'no such chapter' }, 404)

  const figure = await DB.prepare(
    `SELECT * FROM figures WHERE slug=?`,
  ).bind(chapter.figure_slug).first<any>()

  const specimens = (await DB.prepare(
    `SELECT id, tier, text, attribution, year, page_ref FROM specimens
     WHERE figure_slug=? ORDER BY tier, id`,
  ).bind(chapter.figure_slug).all()).results as Array<{ tier: number }>

  const done = (await DB.prepare(
    `SELECT cycle_day, occurred_on, note FROM cycle_days
     WHERE user_id=? AND chapter_id=? ORDER BY cycle_day`,
  ).bind(userId, id).all()).results as Array<{ cycle_day: number }>

  const anchors = (await DB.prepare(
    `SELECT label, page_index, confirmed_by, is_opening FROM book_chapter_anchors
     WHERE book_slug='classical_english_rhetoric' AND chapter_id=? ORDER BY page_index`,
  ).bind(id).all()).results

  const parts = await installedParts(DB, userId)
  const gate = partIsUnlocked(chapter.part, parts)

  return c.json({
    chapter,
    gate,
    figure: figure ? {
      ...figure,
      // 11.7: both faces, in the same record, always returned together. A response that
      // carried legitimate_use without manipulative_misuse would be the corruption the
      // book warns about.
      bothFaces: {
        legitimate: figure.legitimate_use,
        manipulative: figure.manipulative_misuse,
        detectionQuestion: figure.detection_question,
        overuseTells: figure.overuse_tells,
      },
      conversationalJobs: jobsForFigure(chapter.figure_slug),
    } : null,
    specimens: {
      tier1: specimens.filter((s) => s.tier === 1),
      tier2: specimens.filter((s) => s.tier === 2),
      tier3: specimens.filter((s) => s.tier === 3),
      targets: TIER_TARGETS,
    },
    cycle: CYCLE_DAYS.map((d) => ({
      ...d,
      completed: done.some((x) => x.cycle_day === d.day),
    })),
    slots: CHAPTER_SLOTS,
    pageAnchors: anchors,
    // Where the anchors stop, the app says so instead of guessing (never fabricate
    // chapter numbers).
    pageAnchorNote: anchors.length
      ? 'Page indexes are positions in his own capture sequence, confirmed by reading the page.'
      : 'No confirmed page anchor for this chapter. The opening page was not read, so it is '
        + 'not recorded. Nothing here is inferred.',
  })
})

// Where the track stands today, and which cycle day he is on.
app.get('/api/rhetoric/today', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { date } = await userNow(DB, userId)
  const day = await programmeDay(DB, userId)

  const where = day === null ? null : await chapterForDay(DB, day)
  const cycleDay = where && where.kind === 'chapter'
    ? cycleDayFor(day!, where.day_from)
    : null

  return c.json({
    date,
    programmeDay: day,
    inTrack: day !== null && day >= TRACK_FIRST_DAY && day <= TRACK_LAST_DAY,
    where,
    cycleDay,
    fieldDefault: FIELD_DEFAULT,
    dailyReviewMinutes: DAILY_REVIEW_MINUTES,
    dailyReviewReason: DAILY_REVIEW_REASON,
  })
})

// The figure records. Both faces on every row, and the conversational-job index.
app.get('/api/rhetoric/figures', async (c) => {
  const rows = (await c.env.DB.prepare(
    `SELECT slug, canonical_name, classical_name, etymology, plain_definition,
            structural_formula, sub_variants, mechanism, part, chapter_id,
            conversational_job, rhetorical_effect, emotional_effect,
            legitimate_use, manipulative_misuse, detection_question, overuse_tells,
            related_figures, stackable_with, hidden_layer
     FROM figures ORDER BY part, chapter_id, slug`,
  ).all()).results
  return c.json({
    figures: rows,
    conversationalJobs: CONVERSATIONAL_JOBS,
    note: 'Every record carries its misuse boundary beside its legitimate use, because the '
      + 'same device that pre-empts an honest objection can bury a real one (Book 11.7).',
  })
})

app.get('/api/rhetoric/figures/:slug', async (c) => {
  const slug = parseValue(slugParamSchema, c.req.param('slug'))
  const userId = c.get('userId')
  const figure = await c.env.DB.prepare(`SELECT * FROM figures WHERE slug=?`)
    .bind(slug).first<any>()
  if (!figure) return c.json({ error: 'no such figure' }, 404)
  const own = (await c.env.DB.prepare(
    `SELECT id, text, context, created_at FROM figure_own_examples
     WHERE user_id=? AND figure_slug=? ORDER BY id`,
  ).bind(userId, slug).all()).results
  return c.json({
    ...figure,
    // His own examples are HIS, and they are kept apart from the book's.
    ownExamples: own,
    conversationalJobs: jobsForFigure(slug),
  })
})

// Slot 5 of the chapter format: his own example. Stored apart from the book's specimens.
app.post('/api/rhetoric/figures/:slug/own-example', async (c) =>
  withIdempotency(c, 'rhetoric:own-example', async () => {
    const DB = c.env.DB
    const userId = c.get('userId')
    const slug = parseValue(slugParamSchema, c.req.param('slug'))
    const figure = await DB.prepare(`SELECT slug FROM figures WHERE slug=?`).bind(slug).first()
    if (!figure) return c.json({ error: 'no such figure' }, 404)
    const b = await parseJson(c, figureOwnExampleBodySchema)
    const res = await DB.prepare(
      `INSERT INTO figure_own_examples (user_id, figure_slug, text, context) VALUES (?,?,?,?)`,
    ).bind(userId, slug, b.text, b.context ?? null).run()
    return c.json({ ok: true, id: res.meta.last_row_id })
  }))

// ---------------------------------------------------------------------------
// 11.3 — the seven-day cycle. This is where 11.1's Part gate actually bites: a Part III
// chapter cannot be started until Parts I and II are installed, because "a gap only
// registers against an established pattern".
// ---------------------------------------------------------------------------
app.post('/api/rhetoric/cycle-day', async (c) =>
  withIdempotency(c, 'rhetoric:cycle-day', async () => {
    const DB = c.env.DB
    const userId = c.get('userId')
    const b = await parseJson(c, cycleDayBodySchema)
    const chapter = await DB.prepare(
      `SELECT id, part, day_from, day_to FROM rhetoric_chapters WHERE id=?`,
    ).bind(b.chapter_id).first<any>()
    if (!chapter) return c.json({ error: 'no such chapter' }, 404)

    const gate = partIsUnlocked(chapter.part, await installedParts(DB, userId))
    if (!gate.unlocked) return c.json({ error: 'PART LOCKED', reason: gate.reason }, 409)

    const day = CYCLE_DAYS.find((d) => d.day === b.cycle_day)!
    // Book 5.3/6: an event date is bounded to today. This upsert's DO UPDATE would
    // otherwise let a forward date REPLACE a truthful one rather than merely add a
    // false one — the cycle record is evidence of work done, not a plan.
    const occurredOn = await safeDate(DB, b.occurred_on, userId)
    await DB.prepare(
      `INSERT INTO cycle_days (user_id, chapter_id, cycle_day, occurred_on, note)
       VALUES (?,?,?,?,?)
       ON CONFLICT(user_id, chapter_id, cycle_day)
       DO UPDATE SET occurred_on=excluded.occurred_on, note=excluded.note`,
    ).bind(userId, b.chapter_id, b.cycle_day, occurredOn, b.note ?? null).run()

    return c.json({
      ok: true,
      cycleDay: day,
      // Day 1 produces nothing, so a client that expects an artefact is told plainly.
      producesArtefact: b.cycle_day !== 1,
      constraint: day.constraint,
    })
  }))

// 11.3 Day 2 — Tier 1 was copied BY HAND. The app records that it happened and when.
// There is no text field in the body or the table: Book 11.8, and Law 22.
app.post('/api/rhetoric/commonplace', async (c) =>
  withIdempotency(c, 'rhetoric:commonplace', async () => {
    const DB = c.env.DB
    const userId = c.get('userId')
    const b = await parseJson(c, commonplaceLogBodySchema)
    const figure = await DB.prepare(`SELECT slug FROM figures WHERE slug=?`)
      .bind(b.figure_slug).first()
    if (!figure) return c.json({ error: 'no such figure' }, 404)
    if (b.specimen_id) {
      const specimen = await DB.prepare(
        `SELECT id, tier FROM specimens WHERE id=? AND figure_slug=?`,
      ).bind(b.specimen_id, b.figure_slug).first<any>()
      if (!specimen) return c.json({ error: 'no such specimen for that figure' }, 404)
      // Only Tier 1 is copied verbatim. Tier 2 is structure and Tier 3 is the ear.
      if (specimen.tier !== 1) {
        return c.json({
          error: 'NOT A TIER 1 SPECIMEN',
          reason: 'Only Tier 1 is copied verbatim into the commonplace book. Tier 2 is '
            + 'structure to be refilled and Tier 3 is read aloud once.',
        }, 409)
      }
    }
    // Book 5.3/6: an event date is bounded to today. The commonplace book is read back
    // ORDER BY copied_on DESC LIMIT 100; one forward row sits at the top of it until the
    // date arrives, and at a hundred such rows real entries fall off the end.
    const copiedOn = await safeDate(DB, b.copied_on, userId)
    await DB.prepare(
      `INSERT INTO commonplace_log (user_id, figure_slug, specimen_id, copied_on, page_of_book)
       VALUES (?,?,?,?,?)`,
    ).bind(userId, b.figure_slug, b.specimen_id ?? null, copiedOn, b.page_of_book ?? null).run()

    // 11.4's rejected allocation is reported, never silently approached.
    const tier1 = await DB.prepare(
      `SELECT COUNT(DISTINCT specimen_id) AS n FROM commonplace_log
       WHERE user_id=? AND specimen_id IS NOT NULL`,
    ).bind(userId).first<{ n: number }>()
    const copied = tier1?.n ?? 0
    return c.json({
      ok: true,
      tier1Copied: copied,
      tier1Target: TIER_TARGETS[0].total,
      rejectedAllocation: REJECTED_VERBATIM_ALLOCATION,
      warning: verbatimAllocationIsRejected(copied)
        ? 'This has reached the thousand-specimen verbatim allocation Book 11.4 considered '
          + 'and rejected as a wrong allocation of effort.'
        : null,
      handwritten: 'The text is not stored here. The commonplace book stays handwritten.',
    })
  }))

app.get('/api/rhetoric/commonplace', async (c) => {
  const userId = c.get('userId')
  const rows = (await c.env.DB.prepare(
    `SELECT id, figure_slug, specimen_id, copied_on, page_of_book FROM commonplace_log
     WHERE user_id=? ORDER BY copied_on DESC, id DESC LIMIT 200`,
  ).bind(userId).all()).results
  return c.json({ entries: rows, mustNotAbsorb: MUST_NOT_ABSORB })
})

// ---------------------------------------------------------------------------
// 11.3 Day 5 — the copia drill. Bad renderings are SUBMITTED and marked, not withheld:
// "volume is the trainer, not quality."
// ---------------------------------------------------------------------------
app.post('/api/rhetoric/copia', async (c) =>
  withIdempotency(c, 'rhetoric:copia', async () => {
    const DB = c.env.DB
    const userId = c.get('userId')
    const b = await parseJson(c, copiaSessionBodySchema)
    const figure = await DB.prepare(`SELECT slug FROM figures WHERE slug=?`)
      .bind(b.figure_slug).first()
    if (!figure) return c.json({ error: 'no such figure' }, 404)

    // Book 5.3/6: an event date is bounded to today.
    const occurredOn = await safeDate(DB, b.occurred_on, userId)
    const session = await DB.prepare(
      `INSERT INTO copia_sessions (user_id, figure_slug, seed_sentence, occurred_on)
       VALUES (?,?,?,?)`,
    ).bind(userId, b.figure_slug, b.seed_sentence, occurredOn).run()
    const sessionId = session.meta.last_row_id as number

    for (const r of b.renderings) {
      await DB.prepare(
        `INSERT INTO copia_renderings (session_id, user_id, text, self_marked_bad)
         VALUES (?,?,?,?)`,
      ).bind(sessionId, userId, r.text, r.self_marked_bad ? 1 : 0).run()
    }

    const bad = b.renderings.filter((r) => r.self_marked_bad).length
    return c.json({
      ok: true,
      id: sessionId,
      count: b.renderings.length,
      target: COPIA_TARGET,
      selfMarkedBad: bad,
      // The count is the measure. A session with no bad renderings is a session that
      // stopped early, not a perfect one.
      note: 'Bad renderings are kept and counted. Volume is the trainer, not quality.',
      shortOfTarget: b.renderings.length < COPIA_TARGET
        ? `${COPIA_TARGET - b.renderings.length} short of the twenty the drill asks for.`
        : null,
    })
  }))

app.get('/api/rhetoric/copia/:id', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  const session = await DB.prepare(
    `SELECT id, figure_slug, seed_sentence, occurred_on FROM copia_sessions
     WHERE id=? AND user_id=?`,
  ).bind(id, userId).first<any>()
  if (!session) return c.json({ error: 'no such copia session' }, 404)
  const renderings = (await DB.prepare(
    `SELECT id, text, self_marked_bad FROM copia_renderings
     WHERE session_id=? AND user_id=? ORDER BY id`,
  ).bind(id, userId).all()).results
  return c.json({ ...session, renderings, target: COPIA_TARGET })
})

// ---------------------------------------------------------------------------
// 11.3 Day 6 + 12.5 — live fire. Three deployments per cycle: one where it FITS, one
// where it BARELY fits, one where it FAILS. The failure is required, not tolerated.
// The four-column deployment log is the one paper artefact 11.8 permits in the app.
// ---------------------------------------------------------------------------
app.post('/api/rhetoric/deployment', async (c) =>
  withIdempotency(c, 'rhetoric:deployment', async () => {
    const DB = c.env.DB
    const userId = c.get('userId')
    const b = await parseJson(c, deploymentBodySchema)
    const figure = await DB.prepare(`SELECT slug FROM figures WHERE slug=?`)
      .bind(b.figure_slug).first()
    if (!figure) return c.json({ error: 'no such figure' }, 404)

    // Book 5.3/6: an event date is bounded to today. A deployment is a thing he DID.
    const occurredOn = await safeDate(DB, b.occurred_on, userId)
    const res = await DB.prepare(
      `INSERT INTO deployments
         (user_id, figure_slug, occurred_on, context, what_happened, fit,
          counterpart_noticed, script, delivery_notation, never_list)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(userId, b.figure_slug, occurredOn, b.context, b.what_happened, b.fit,
      b.counterpart_noticed ? 1 : 0, b.script ?? null,
      b.delivery_notation ?? null, b.never_list ?? null).run()
    const id = res.meta.last_row_id as number

    let order = 0
    for (const p of b.pivots ?? []) {
      await DB.prepare(
        `INSERT INTO deployment_pivots (deployment_id, user_id, trigger, response, sort_order)
         VALUES (?,?,?,?,?)`,
      ).bind(id, userId, p.trigger, p.response, order++).run()
    }

    // Which of the three the cycle still owes. A cycle with no failure logged is an
    // incomplete cycle (11.9), so the response says so rather than congratulating him.
    const fits = (await DB.prepare(
      `SELECT fit, COUNT(*) AS n FROM deployments
       WHERE user_id=? AND figure_slug=? GROUP BY fit`,
    ).bind(userId, b.figure_slug).all()).results as Array<{ fit: string; n: number }>
    const have = new Set(fits.map((f) => f.fit))
    const missing = ['fits', 'barely', 'fails'].filter((f) => !have.has(f))

    return c.json({
      ok: true,
      id,
      pivots: (b.pivots ?? []).length,
      missingForThisFigure: missing,
      cycleComplete: missing.length === 0,
      // 11.9's inversion, stated at the point of entry so no view can render it as a win.
      noticedIsFailure: b.counterpart_noticed
        ? 'Logged as noticed. Being noticed is the failure condition (11.9), not a result to '
          + 'count upward.'
        : null,
      failureRequired: missing.includes('fails')
        ? 'The cycle still owes the deployment where the figure FAILS. The failure teaches '
          + 'the boundary and is required, not tolerated.'
        : null,
    })
  }))

app.get('/api/rhetoric/deployments', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const rows = (await DB.prepare(
    `SELECT id, figure_slug, occurred_on, context, what_happened, fit, counterpart_noticed,
            script, delivery_notation, never_list
     FROM deployments WHERE user_id=? ORDER BY occurred_on DESC, id DESC LIMIT 200`,
  ).bind(userId).all()).results as Array<{ id: number }>
  const pivots = (await DB.prepare(
    `SELECT deployment_id, trigger, response, sort_order FROM deployment_pivots
     WHERE user_id=? ORDER BY deployment_id, sort_order`,
  ).bind(userId).all()).results as Array<{ deployment_id: number }>
  return c.json({
    deployments: rows.map((d) => ({
      ...d,
      pivots: pivots.filter((p) => p.deployment_id === d.id),
    })),
    // 11.8: this log is permitted in the app, and it is four columns.
    permittedColumns: ['occurred_on', 'figure_slug', 'context', 'what_happened'],
  })
})

// ---------------------------------------------------------------------------
// 11.5 — spaced repetition on the FIXED 1/3/7/16/35 ladder. This is deliberately not
// FSRS: Book 11.5 names five intervals, so they are the schedule and there is no sixth
// to extrapolate. The step is derived from what was answered and is never submitted.
// ---------------------------------------------------------------------------
app.get('/api/rhetoric/review/due', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { date } = await userNow(DB, userId)
  const due = (await DB.prepare(
    `SELECT c.id, c.card_type, c.figure_slug, c.specimen_id, c.ladder_step, c.due_date,
            c.lapses, c.total_reviews, c.correct_reviews,
            f.canonical_name, f.plain_definition, f.structural_formula,
            s.text AS specimen_text
     FROM rhetoric_cards c
     JOIN figures f ON f.slug = c.figure_slug
     LEFT JOIN specimens s ON s.id = c.specimen_id
     WHERE c.user_id=? AND c.due_date <= ?
     ORDER BY c.due_date, c.id LIMIT 200`,
  ).bind(userId, date).all()).results as Array<Record<string, unknown>>
  return c.json({
    date,
    due: due.map((card) => ({
      ...card,
      // The answer is not sent with the prompt: sending it would make the card a
      // reading exercise. name_to_definition is the one type whose prompt IS the name.
      prompt: card.card_type === 'name_to_definition' ? card.canonical_name
        : card.card_type === 'skeleton_to_example' ? card.structural_formula
          : card.specimen_text ?? card.plain_definition,
      plain_definition: undefined,
      specimen_text: undefined,
    })),
    ladder: LADDER,
    ladderIsFixed: LADDER_IS_FIXED_REASON,
    cardTypes: CARD_TYPES,
    dailyMinutes: DAILY_REVIEW_MINUTES,
    dailyReason: DAILY_REVIEW_REASON,
  })
})

app.post('/api/rhetoric/cards', async (c) => withIdempotency(c, 'rhetoric:card', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const b = await parseJson(c, rhetoricCardBodySchema)
  const figure = await DB.prepare(`SELECT slug FROM figures WHERE slug=?`)
    .bind(b.figure_slug).first()
  if (!figure) return c.json({ error: 'no such figure' }, 404)
  const { date } = await userNow(DB, userId)
  await DB.prepare(
    `INSERT OR IGNORE INTO rhetoric_cards
       (user_id, card_type, figure_slug, specimen_id, ladder_step, due_date)
     VALUES (?,?,?,?,0,?)`,
  ).bind(userId, b.card_type, b.figure_slug, b.specimen_id ?? null, b.due_date || date).run()
  const card = await DB.prepare(
    `SELECT id, card_type, figure_slug, specimen_id, ladder_step, due_date
     FROM rhetoric_cards
     WHERE user_id=? AND card_type=? AND figure_slug=? AND COALESCE(specimen_id,0)=?`,
  ).bind(userId, b.card_type, b.figure_slug, b.specimen_id ?? 0).first<any>()
  return c.json({ ok: true, card, ladder: LADDER })
}))

app.post('/api/rhetoric/review/:id', async (c) =>
  withIdempotency(c, 'rhetoric:review', async () => {
    const DB = c.env.DB
    const userId = c.get('userId')
    const id = parseValue(positiveIdSchema, c.req.param('id'))
    const b = await parseJson(c, rhetoricCardReviewBodySchema)
    const card = await DB.prepare(
      `SELECT id, ladder_step, lapses, total_reviews, correct_reviews
       FROM rhetoric_cards WHERE id=? AND user_id=?`,
    ).bind(id, userId).first<any>()
    if (!card) return c.json({ error: 'no such card' }, 404)

    // He drills on paper and records it afterwards, so a PAST reviewed_on is the whole
    // point of the field. Nothing bounded it FORWARD, though: a date that has not
    // happened both parked the card outside the due queue (nextDue is derived from it)
    // and wrote a review dated in the future into an append-only log. safeDate clamps
    // forward to today and passes a past date through untouched, which is what the other
    // nine route files do and what tongue.ts already does for its own review log.
    const reviewedOn = await safeDate(DB, b.reviewed_on, userId)
    const stepBefore = card.ladder_step as number

    // The rung is DERIVED. A correct answer advances one rung and never skips; a wrong
    // answer returns to the first, because the ladder measures retention rather than mood.
    const stepAfter = b.correct ? Math.min(LADDER.length, stepBefore + 1) : 1
    const currentInterval = stepBefore >= 1 ? LADDER[stepBefore - 1] : null
    const interval = b.correct ? nextLadderInterval(currentInterval) : LADDER[0]
    const nextDue = addDays(reviewedOn, interval)

    await DB.prepare(
      `INSERT INTO rhetoric_card_reviews
         (card_id, user_id, reviewed_on, correct, produced, step_before, step_after)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(id, userId, reviewedOn, b.correct ? 1 : 0, b.produced ?? null,
      stepBefore, stepAfter).run()

    await DB.prepare(
      `UPDATE rhetoric_cards
       SET ladder_step=?, due_date=?, lapses=lapses + ?,
           total_reviews=total_reviews + 1, correct_reviews=correct_reviews + ?
       WHERE id=? AND user_id=?`,
    ).bind(stepAfter, nextDue, b.correct ? 0 : 1, b.correct ? 1 : 0, id, userId).run()

    return c.json({
      ok: true,
      stepBefore,
      stepAfter,
      intervalDays: interval,
      dueDate: nextDue,
      ladder: LADDER,
      ladderIsFixed: LADDER_IS_FIXED_REASON,
    })
  }))

// ---------------------------------------------------------------------------
// 11.9 — recordings are FILES THE APP REFERENCES (11.8), never uploads. The baseline is
// not listened back until Day 143 and Day 204, and the route enforces the wait instead
// of trusting him to remember it under curiosity.
// ---------------------------------------------------------------------------
app.post('/api/rhetoric/recording', async (c) =>
  withIdempotency(c, 'rhetoric:recording', async () => {
    const DB = c.env.DB
    const userId = c.get('userId')
    const b = await parseJson(c, recordingBodySchema)
    // Book 5.3/6: an event date is bounded to today. A recording exists or it does not.
    const madeOn = await safeDate(DB, b.made_on, userId)
    const res = await DB.prepare(
      `INSERT INTO recordings
         (user_id, kind, file_reference, made_on, programme_day, duration_seconds,
          relisten_allowed_on_day, word_count)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).bind(userId, b.kind, b.file_reference, madeOn, b.programme_day ?? null,
      b.duration_seconds ?? null, b.kind === 'baseline' ? RELISTEN_DAYS[0] : null,
      b.word_count ?? null).run()
    return c.json({
      ok: true,
      id: res.meta.last_row_id,
      relistenDays: RELISTEN_DAYS,
      storage: 'The file stays on his own machine. The application stores the reference only.',
      note: b.kind === 'baseline'
        ? `The baseline is not listened back before Day ${RELISTEN_DAYS[0]}.`
        : null,
    })
  }))

app.get('/api/rhetoric/recordings', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const rows = (await DB.prepare(
    `SELECT id, kind, file_reference, made_on, programme_day, duration_seconds,
            relisten_allowed_on_day, relistened_on, word_count
     FROM recordings WHERE user_id=? ORDER BY made_on DESC, id DESC`,
  ).bind(userId).all()).results
  return c.json({ recordings: rows, relistenDays: RELISTEN_DAYS })
})

// The scheduled re-listen. Refused before Day 143, because 11.9 schedules the comparison
// at two points and only those two.
app.post('/api/rhetoric/recording/:id/relisten', async (c) =>
  withIdempotency(c, 'rhetoric:relisten', async () => {
    const DB = c.env.DB
    const userId = c.get('userId')
    const id = parseValue(positiveIdSchema, c.req.param('id'))
    const rec = await DB.prepare(
      `SELECT id, kind, relistened_on FROM recordings WHERE id=? AND user_id=?`,
    ).bind(id, userId).first<any>()
    if (!rec) return c.json({ error: 'no such recording' }, 404)

    const day = await programmeDay(DB, userId)
    if (day !== null && day < RELISTEN_DAYS[0]) {
      return c.json({
        error: 'RELISTEN NOT DUE',
        reason: 'The comparison is scheduled at Day ' + RELISTEN_DAYS[0] + ' and Day '
          + RELISTEN_DAYS[1] + ' and at no other point. Today is Day ' + day + '.',
        programmeDay: day,
        relistenDays: RELISTEN_DAYS,
      }, 409)
    }
    const { date } = await userNow(DB, userId)
    await DB.prepare(
      `UPDATE recordings SET relistened_on=? WHERE id=? AND user_id=?`,
    ).bind(date, id, userId).run()
    return c.json({ ok: true, relistenedOn: date, programmeDay: day })
  }))

// 11.9's self-audit mark on a chapter: U, R, or N. It weights the early cycles; it is
// not a score, and nothing is added to or subtracted from it.
app.post('/api/rhetoric/chapter/:id/self-audit', async (c) =>
  withIdempotency(c, 'rhetoric:self-audit', async () => {
    const DB = c.env.DB
    const id = parseValue(positiveIdSchema, c.req.param('id'))
    const b = await parseJson(c, selfAuditBodySchema)
    const chapter = await DB.prepare(`SELECT id FROM rhetoric_chapters WHERE id=?`)
      .bind(id).first()
    if (!chapter) return c.json({ error: 'no such chapter' }, 404)
    await DB.prepare(`UPDATE rhetoric_chapters SET self_audit=? WHERE id=?`)
      .bind(b.self_audit, id).run()
    const mark = SELF_AUDIT_MARKS.find((m) => m.mark === b.self_audit)!
    return c.json({ ok: true, mark: mark.mark, meaning: mark.meaning })
  }))

// ---------------------------------------------------------------------------
// 11.9 — measurement. Six metrics, all falsifiable, and one of them inverts: the share
// of deployments the counterpart NOTICED. Every metric is returned with its `better`
// direction attached so no view can render a rising noticed_ratio as progress.
// ---------------------------------------------------------------------------
app.get('/api/rhetoric/metrics', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')

  const detect = await DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(was_correct),0) AS ok
     FROM figure_detections WHERE user_id=? AND was_correct IS NOT NULL`,
  ).bind(userId).first<{ n: number; ok: number }>()

  const construction = await DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(r.correct),0) AS ok
     FROM rhetoric_card_reviews r
     JOIN rhetoric_cards c ON c.id = r.card_id
     WHERE r.user_id=? AND c.card_type='skeleton_to_example'`,
  ).bind(userId).first<{ n: number; ok: number }>()

  const copia = await DB.prepare(
    `SELECT COUNT(DISTINCT s.id) AS sessions,
            COUNT(r.id) AS renderings,
            COUNT(DISTINCT r.text) AS distinct_renderings,
            COALESCE(SUM(r.self_marked_bad),0) AS marked_bad
     FROM copia_sessions s LEFT JOIN copia_renderings r ON r.session_id = s.id
     WHERE s.user_id=?`,
  ).bind(userId).first<any>()

  const fits = (await DB.prepare(
    `SELECT fit, COUNT(*) AS n FROM deployments WHERE user_id=? GROUP BY fit`,
  ).bind(userId).all()).results as Array<{ fit: string; n: number }>

  const noticed = await DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(counterpart_noticed),0) AS noticed
     FROM deployments WHERE user_id=?`,
  ).bind(userId).first<{ n: number; noticed: number }>()

  const relistens = (await DB.prepare(
    `SELECT id, kind, made_on, programme_day, relistened_on FROM recordings
     WHERE user_id=? AND relistened_on IS NOT NULL ORDER BY relistened_on`,
  ).bind(userId).all()).results

  const day = await programmeDay(DB, userId)
  const ratio = (num: number, den: number) => (den ? num / den : null)

  const values: Record<string, unknown> = {
    identification_accuracy: {
      attempts: detect?.n ?? 0, correct: detect?.ok ?? 0,
      value: ratio(detect?.ok ?? 0, detect?.n ?? 0),
    },
    construction_accuracy: {
      attempts: construction?.n ?? 0, correct: construction?.ok ?? 0,
      value: ratio(construction?.ok ?? 0, construction?.n ?? 0),
    },
    copia_volume: {
      sessions: copia?.sessions ?? 0,
      renderings: copia?.renderings ?? 0,
      distinct: copia?.distinct_renderings ?? 0,
      selfMarkedBad: copia?.marked_bad ?? 0,
      target: COPIA_TARGET,
      value: copia?.renderings ?? 0,
    },
    deployment_outcomes: {
      fits: fits.find((f) => f.fit === 'fits')?.n ?? 0,
      barely: fits.find((f) => f.fit === 'barely')?.n ?? 0,
      fails: fits.find((f) => f.fit === 'fails')?.n ?? 0,
      value: fits.reduce((a, f) => a + f.n, 0),
    },
    noticed_ratio: {
      deployments: noticed?.n ?? 0,
      noticed: noticed?.noticed ?? 0,
      value: ratio(noticed?.noticed ?? 0, noticed?.n ?? 0),
    },
    recording_comparison: {
      relistens,
      scheduledDays: RELISTEN_DAYS,
      dueNow: day !== null && RELISTEN_DAYS.includes(day as 143 | 204),
      value: relistens.length,
    },
  }

  return c.json({
    programmeDay: day,
    metrics: TRACK_METRICS.map((m) => ({
      ...m,
      inverted: metricIsInverted(m.slug),
      // A rising noticed_ratio is a worsening result. The direction travels with the
      // number so a renderer cannot lose it.
      renderAsProgress: !metricIsInverted(m.slug),
      data: values[m.slug],
    })),
    fieldDefault: FIELD_DEFAULT,
  })
})

}
