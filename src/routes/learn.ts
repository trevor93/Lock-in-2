// Book 7 refactor — the learning routes: campaign progression (progress-locked
// units), maxims + spaced-repetition flashcards, and honesty-flag ack/history.
import { Hono } from 'hono'
import type { Bindings, Variables } from '../env'
import { parseJson, parseValue, parseEmptyBody } from '../validation'
import { withIdempotency } from '../request-support'
import { readingVerdict } from '../reading'
import { safeDate, userNow } from '../clock'
import { addDays } from '../time'
import { addFlag } from '../enforcement'
import { ensureUnlocks, ensureCards } from '../curriculum'
import {
  unitStepBodySchema, maximBodySchema, myWordsBodySchema,
  cardReviewBodySchema, positiveIdSchema,
} from '../schemas'

export function registerLearnRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {
// ============ CAMPAIGN (progress-locked) ============
// ensureUnlocks extracted to ./curriculum (Book 7).

app.get('/api/campaign', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const phases = (await DB.prepare(`SELECT * FROM phases ORDER BY sort_order`).all()).results as any[]
  const out = []
  for (const p of phases) {
    const units = (await DB.prepare(
      `SELECT u.*, up.status, up.reading_done_at, up.drill_done_at, up.drill_report, up.debrief_answer,
              up.exam_answers, up.exam_self_score, up.completed_at, up.attempts
       FROM units u JOIN unit_progress up ON up.unit_id=u.id
       WHERE up.user_id=? AND u.phase_id=? ORDER BY u.sort_order`
    ).bind(userId, p.id).all()).results as any[]
    const complete = units.filter(u => u.status === 'complete').length
    out.push({ ...p, units, progress: units.length ? Math.round((complete / units.length) * 100) : 0, complete, total: units.length })
  }
  return c.json(out)
})

app.post('/api/units/:id/step', async (c) => withIdempotency(c, 'unit:step', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  const {
    step, drill_report, debrief_answer, exam_answers, exam_self_score, date,
  } = await parseJson(c, unitStepBodySchema)
  const up = await DB.prepare(
    `SELECT * FROM unit_progress WHERE user_id=? AND unit_id=?`,
  ).bind(userId, id).first<any>()
  const unit = await DB.prepare(`SELECT * FROM units WHERE id=?`).bind(id).first<any>()
  if (!up || !unit) return c.json({ error: 'not found' }, 404)
  if (up.status === 'locked') return c.json({ error: 'UNIT LOCKED. Finish the previous unit first — this system is progress-based, no skipping.' }, 400)
  if (up.status === 'complete') {
    return c.json({ error: 'UNIT COMPLETE. Terminal records cannot be rewritten.' }, 409)
  }
  // Book 10.1: "reading_done is dwell time plus traversal, never a button." The
  // step may still be requested, but it is only granted when a MEASURED reading
  // session for this unit passed the application's own plausibility test. There is
  // no endpoint anywhere that lets a client simply declare a chapter read.
  if (step === 'reading') {
    const measured = await DB.prepare(
      `SELECT dwell_seconds, max_scroll_pct, word_count FROM reading_sessions
       WHERE user_id=? AND unit_id=? AND plausible=1
       ORDER BY dwell_seconds DESC LIMIT 1`,
    ).bind(userId, id).first<any>()
    if (!measured) {
      const best = await DB.prepare(
        `SELECT dwell_seconds, max_scroll_pct, word_count FROM reading_sessions
         WHERE user_id=? AND unit_id=? ORDER BY dwell_seconds DESC LIMIT 1`,
      ).bind(userId, id).first<any>()
      const verdict = best ? readingVerdict(best) : null
      return c.json({
        error: 'READING NOT RECORDED. Reading is measured, not clicked: open the chapter and read it through.',
        reason: verdict ? verdict.reason : 'No reading session has been opened for this unit yet.',
        needsReading: true,
        ...(verdict ? {
          dwellSeconds: verdict.dwellSeconds,
          requiredSeconds: verdict.requiredSeconds,
          scrollPct: verdict.scrollPct,
        } : {}),
      }, 409)
    }
  }

  const allowedUnitSteps: Record<string, string[]> = unit.is_exam
    ? { active: ['complete'] }
    : {
        active: ['reading'],
        reading_done: unit.field_drill ? ['drill'] : ['complete'],
        drill_done: ['complete'],
      }
  if (!allowedUnitSteps[up.status]?.includes(step)) {
    return c.json({ error: 'ILLEGAL UNIT TRANSITION. Complete each gate in order.' }, 409)
  }
  const today = date || (await userNow(c.env.DB, userId)).date

  if (step === 'reading') {
    await DB.prepare(
      `UPDATE unit_progress SET status='reading_done', reading_done_at=datetime('now')
       WHERE unit_id=? AND user_id=?`,
    ).bind(id, userId).run()
    await DB.prepare(
      `INSERT INTO points_ledger (user_id,log_date,points,reason,ref_type,ref_id)
       VALUES (?,?,?,?,?,?)`,
    ).bind(userId, today, 20, `Reading complete: ${unit.title} (+20)`, 'unit', id).run()
  } else if (step === 'drill') {
    if (!drill_report || drill_report.trim().length < 30) {
      return c.json({ error: 'DRILL REPORT TOO THIN. A field drill without a real report is a skipped drill — write at least a few honest sentences about what you actually DID and what happened.' }, 400)
    }
    await DB.prepare(
      `UPDATE unit_progress SET status='drill_done', drill_done_at=datetime('now'), drill_report=?
       WHERE unit_id=? AND user_id=?`,
    ).bind(drill_report, id, userId).run()
    await DB.prepare(
      `INSERT INTO points_ledger (user_id,log_date,points,reason,ref_type,ref_id)
       VALUES (?,?,?,?,?,?)`,
    ).bind(userId, today, 30, `Field drill executed: ${unit.title} (+30)`, 'unit', id).run()
  } else if (step === 'complete') {
    if (unit.is_exam) {
      if (!exam_answers) return c.json({ error: 'Exam answers required.' }, 400)
      const score = Number(exam_self_score ?? 0)
      await DB.prepare(
        `UPDATE unit_progress SET exam_answers=?, exam_self_score=?, attempts=attempts+1
         WHERE unit_id=? AND user_id=?`,
      ).bind(JSON.stringify(exam_answers), score, id, userId).run()
      if (score < 70) {
        await addFlag(DB, userId, today, 'exam_failed', 'serious',
          `EXAM NOT PASSED: ${unit.title} — self-score ${score}/100 (pass: 70). No shame: the weak chapters are now visible. Re-study them, retake when ready. The gate stays closed until earned. -10 pts.`, -10)
        return c.json({ ok: false, failed: true, message: `Score ${score}/100. Pass mark is 70. The honesty engine has logged this attempt. Restudy your weak chapters and retake — the next phase stays locked until you EARN it.` })
      }
      await DB.prepare(
        `UPDATE unit_progress SET status='complete', completed_at=datetime('now')
         WHERE unit_id=? AND user_id=?`,
      ).bind(id, userId).run()
      await DB.prepare(
        `INSERT INTO points_ledger (user_id,log_date,points,reason,ref_type,ref_id)
         VALUES (?,?,?,?,?,?)`,
      ).bind(userId, today, 100, `EXAM PASSED (${score}/100): ${unit.title} (+100)`, 'exam', id).run()
    } else {
      if (up.status !== 'drill_done' && up.status !== 'reading_done') {
        return c.json({ error: 'Mark the reading done first.' }, 400)
      }
      if (up.status === 'reading_done' && unit.field_drill) {
        return c.json({ error: 'FIELD DRILL NOT REPORTED. Reading without application is entertainment, not training. Execute the drill, file the report, then complete.' }, 400)
      }
      await DB.prepare(
        `UPDATE unit_progress SET status='complete', completed_at=datetime('now'),
         debrief_answer=COALESCE(?,debrief_answer) WHERE unit_id=? AND user_id=?`,
      ).bind(debrief_answer || null, id, userId).run()
      await DB.prepare(
        `INSERT INTO points_ledger (user_id,log_date,points,reason,ref_type,ref_id)
         VALUES (?,?,?,?,?,?)`,
      ).bind(userId, today, 50, `UNIT CONQUERED: ${unit.title} (+50)`, 'unit', id).run()
    }
    await ensureUnlocks(DB, userId)
  }
  return c.json({ ok: true })
}))

// ============ MAXIMS + FLASHCARDS ============
app.get('/api/maxims', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, source, principle, naive_reading, master_reading, my_words, unit_id, created_by_user
     FROM captures WHERE kind='maxim' AND user_id=? ORDER BY source, id`,
  ).bind(c.get('userId')).all()
  return c.json(results)
})
app.post('/api/maxims', async (c) => {
  const userId = c.get('userId')
  const b = await parseJson(c, maximBodySchema)
  const r = await c.env.DB.prepare(
    `INSERT INTO captures
       (user_id, kind, source, principle, naive_reading, master_reading, my_words, created_by_user)
     VALUES (?,'maxim',?,?,?,?,?,1)`
  ).bind(userId, b.source, b.principle, b.naive_reading || '(write it)', b.master_reading || '(write it)', b.my_words || null).run()
  await c.env.DB.prepare(
    `INSERT INTO flashcards (user_id, maxim_id) VALUES (?,?)`,
  ).bind(userId, r.meta.last_row_id).run()
  return c.json({ ok: true, id: r.meta.last_row_id })
})
app.post('/api/maxims/:id/my-words', async (c) => {
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  const body = await parseJson(c, myWordsBodySchema)
  const updated = await c.env.DB.prepare(
    `UPDATE captures SET my_words=? WHERE kind='maxim' AND id=? AND user_id=?`,
  ).bind(myWordsOrNull(body), id, c.get('userId')).run()
  if ((updated.meta as any).changes === 0) return c.json({ error: 'not found' }, 404)
  return c.json({ ok: true })
})

function myWordsOrNull(body: any): string | null {
  return body.my_words ?? null
}

// ensureCards extracted to ./curriculum (Book 7).
app.get('/api/cards/due', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const date = await safeDate(DB, c.req.query('date'), userId)
  const { results } = await DB.prepare(
    `SELECT f.*, m.source, m.principle, m.naive_reading, m.master_reading, m.my_words
     FROM flashcards f JOIN captures m ON m.id=f.maxim_id AND m.user_id=f.user_id AND m.kind='maxim'
     WHERE f.user_id=? AND f.due_date <= ? ORDER BY f.due_date LIMIT 15`
  ).bind(userId, date).all()
  return c.json(results)
})
app.post('/api/cards/:maximId/review', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const mid = parseValue(positiveIdSchema, c.req.param('maximId'))
  const { grade, date } = await parseJson(c, cardReviewBodySchema)
  const card = await DB.prepare(
    `SELECT * FROM flashcards WHERE maxim_id=? AND user_id=?`,
  ).bind(mid, userId).first<any>()
  if (!card) return c.json({ error: 'no card' }, 404)
  const today = await safeDate(DB, date, userId)
  if (card.due_date > today) {
    return c.json({ error: 'CARD NOT DUE. Review transitions follow the schedule.' }, 409)
  }
  let { interval_days, ease, reps, lapses } = card
  if (grade === 0) { lapses++; reps = 0; interval_days = 0; ease = Math.max(1.3, ease - 0.2) }
  else {
    reps++
    ease = Math.max(1.3, ease + (grade === 3 ? 0.1 : grade === 1 ? -0.15 : 0))
    if (reps === 1) interval_days = 1
    else if (reps === 2) interval_days = 3
    else interval_days = Math.round(interval_days * ease * (grade === 1 ? 0.8 : grade === 3 ? 1.3 : 1))
  }
  const due = addDays(today, Math.max(interval_days, grade === 0 ? 0 : 1))
  // Atomic (Book 6): the schedule advance and the review log land together or
  // not at all, so a mid-write failure can never desync them.
  await DB.batch([
    DB.prepare(
      `UPDATE flashcards SET interval_days=?, ease=?, reps=?, lapses=?, due_date=?
       WHERE maxim_id=? AND user_id=?`,
    ).bind(interval_days, ease, reps, lapses, due, mid, userId),
    DB.prepare(
      `INSERT INTO card_reviews (user_id, maxim_id, grade) VALUES (?,?,?)`,
    ).bind(userId, mid, grade),
  ])
  return c.json({ ok: true, next_due: due })
})

// ============ FLAGS ============
app.post('/api/flags/:id/ack', async (c) => {
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  await parseEmptyBody(c)
  const updated = await c.env.DB.prepare(
    `UPDATE honesty_flags SET acknowledged=1 WHERE id=? AND user_id=?`,
  ).bind(id, c.get('userId')).run()
  if ((updated.meta as any).changes === 0) return c.json({ error: 'not found' }, 404)
  return c.json({ ok: true })
})
app.get('/api/flags/history', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM honesty_flags WHERE user_id=? ORDER BY created_at DESC LIMIT 100`,
  ).bind(c.get('userId')).all()
  return c.json(results)
})
}
