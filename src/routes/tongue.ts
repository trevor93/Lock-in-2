// Book 7 refactor — THE TONGUE routes (wise-response armory + memorization).
// Capture, list/edit/delete, the SM-2 drill queue and review, the weekly exam,
// and stats. Idempotency on capture/review/exam; the neglect flag via ../enforcement.
import { z } from 'zod'
import { Hono } from 'hono'
import type { Bindings, Variables } from '../env'
import { parseJson, parseValue, parseEmptyBody } from '../validation'
import { withIdempotency } from '../request-support'
import { safeDate, userNow } from '../clock'
import { addDays, daysBetween } from '../time'
import { addFlag } from '../enforcement'
import { fsrsReview, sm2ToFsrs } from '../fsrs'
import { tongueBodySchema, tongueReviewBodySchema, tongueExamBodySchema, positiveIdSchema, responseCategorySchema } from '../schemas'

export function registerTongueRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {
// ============ THE TONGUE — WISE-RESPONSE ARMORY + SUPREME MEMORIZATION ============
// Mastery ladder: new → learning (3+ correct) → memorized (7+ correct, interval≥7d)
//                 → ingrained (14+ correct, interval≥21d) → reflex (25+ correct, interval≥45d)
function tongueMastery(s: any): string {
  const cr = s.correct_reviews, iv = s.interval_days
  if (cr >= 25 && iv >= 45) return 'reflex'
  if (cr >= 14 && iv >= 21) return 'ingrained'
  if (cr >= 7 && iv >= 7) return 'memorized'
  if (cr >= 3) return 'learning'
  return 'new'
}

// Capture a wise response (the daily field-recording ritual)
app.post('/api/tongue', async (c) => withIdempotency(c, 'tongue:capture', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { situation, trigger_q, response, why_works, source, category } =
    await parseJson(c, tongueBodySchema)
  const today = (await userNow(DB, userId)).date
  const r = await DB.prepare(
    `INSERT INTO captures
       (user_id, kind, situation, trigger_q, response, why_works, source, category)
     VALUES (?,'response',?,?,?,?,?,?)`
  ).bind(userId, situation.trim(), trigger_q.trim(), response.trim(), (why_works || '').trim() || null, (source || '').trim() || null, category || 'wit').run()
  const rid = r.meta.last_row_id
  // Atomic (Book 6): the SRS seeding and the capture reward both hang off the
  // new response id and must commit together.
  await DB.batch([
    DB.prepare(
      `INSERT INTO review_items (user_id, kind, item_id, due_date) VALUES (?,'response',?,?)`,
    ).bind(userId, rid, today),
    DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type, ref_id)
       VALUES (?,?,?,?,?,?)`,
    ).bind(userId, today, 3, `INTEL CAPTURED: recorded a wise response ("${String(trigger_q).slice(0, 50)}…"). +3 pts. Now memorize it.`, 'tongue', rid),
  ])
  return c.json({ ok: true, id: rid })
}))

// List / filter the armory
app.get('/api/tongue', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const category = c.req.query('category')
  const cat = category === undefined || category === 'all'
    ? category
    : parseValue(responseCategorySchema, category)
  const q = c.req.query('q') === undefined
    ? undefined
    : parseValue(z.string().trim().min(1).max(200), c.req.query('q'))
  let sql = `SELECT r.*, s.mastery, s.due_date, s.reps, s.lapses, s.interval_days, s.total_reviews, s.correct_reviews
             FROM captures r JOIN review_items s ON s.item_id=r.id AND s.user_id=r.user_id AND s.kind='response'
             WHERE r.kind='response' AND r.user_id=? AND r.archived=0`
  const binds: any[] = [userId]
  if (cat && cat !== 'all') { sql += ` AND r.category=?`; binds.push(cat) }
  if (q) { sql += ` AND (r.situation LIKE ? OR r.trigger_q LIKE ? OR r.response LIKE ?)`; binds.push(`%${q}%`, `%${q}%`, `%${q}%`) }
  sql += ` ORDER BY r.created_at DESC LIMIT 300`
  const { results } = await DB.prepare(sql).bind(...binds).all()
  return c.json(results)
})

app.put('/api/tongue/:id', async (c) => {
  const DB = c.env.DB
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  const { situation, trigger_q, response, why_works, source, category } =
    await parseJson(c, tongueBodySchema)
  const updated = await DB.prepare(
    `UPDATE captures SET situation=?, trigger_q=?, response=?, why_works=?, source=?, category=?
     WHERE kind='response' AND id=? AND user_id=?`,
  ).bind(situation, trigger_q, response, why_works || null, source || null, category || 'wit', id, c.get('userId')).run()
  if ((updated.meta as any).changes === 0) return c.json({ error: 'not found' }, 404)
  return c.json({ ok: true })
})
app.delete('/api/tongue/:id', async (c) => {
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  await parseEmptyBody(c)
  const updated = await c.env.DB.prepare(
    `UPDATE captures SET archived=1 WHERE kind='response' AND id=? AND user_id=?`,
  ).bind(id, c.get('userId')).run()
  if ((updated.meta as any).changes === 0) return c.json({ error: 'not found' }, 404)
  return c.json({ ok: true })
})

// Due drills — each response is served with a rotating challenge mode so the
// brain is attacked from 5 angles: recall / cloze / first_letters / reverse / delivery
app.get('/api/tongue/due', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const date = await safeDate(DB, c.req.query('date'), userId)
  const { results } = await DB.prepare(
    `SELECT r.*, s.mastery, s.due_date, s.reps, s.lapses, s.interval_days, s.total_reviews, s.correct_reviews, s.last_mode
     FROM captures r JOIN review_items s ON s.item_id=r.id AND s.user_id=r.user_id AND s.kind='response'
     WHERE r.kind='response' AND r.user_id=? AND r.archived=0 AND s.due_date <= ? ORDER BY s.due_date LIMIT 20`
  ).bind(userId, date).all()
  const MODES = ['recall', 'cloze', 'first_letters', 'reverse', 'delivery']
  const out = (results as any[]).map((r: any) => {
    // rotate: never repeat the last mode; deeper mastery gets harder modes more often
    let pool = MODES.filter(m => m !== r.last_mode)
    if (r.mastery === 'ingrained' || r.mastery === 'reflex') pool = pool.filter(m => m !== 'recall')
    const mode = pool[Math.floor(Math.random() * pool.length)] || 'recall'
    return { ...r, drill_mode: mode }
  })
  return c.json(out)
})

// Grade a drill (0 blank | 1 shaky | 2 solid | 3 fluent) — SM-2 with mastery ladder
app.post('/api/tongue/:id/review', async (c) => withIdempotency(c, 'tongue:review', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  const { grade, mode, date } = await parseJson(c, tongueReviewBodySchema)
  const s = await DB.prepare(
    `SELECT s.*, r.archived FROM review_items s
     JOIN captures r ON r.id=s.item_id AND r.user_id=s.user_id AND r.kind='response'
     WHERE s.item_id=? AND s.user_id=? AND s.kind='response'`,
  ).bind(id, userId).first<any>()
  if (!s) return c.json({ error: 'no such response' }, 404)
  const today = await safeDate(DB, date, userId)
  if (s.archived) {
    return c.json({ error: 'RESPONSE ARCHIVED. Terminal records cannot be reviewed.' }, 409)
  }
  if (s.due_date > today) {
    return c.json({ error: 'RESPONSE NOT DUE. Review transitions follow the schedule.' }, 409)
  }
  // FSRS scheduling (Book 7). Stability/Difficulty drive the interval; the SM-2
  // counters (reps/lapses/total/correct) are retained for the mastery ladder and
  // stats. Grades 0..3 map to FSRS ratings 1..4 inside fsrsReview.
  let { reps, lapses, total_reviews, correct_reviews } = s
  total_reviews++
  if (grade === 0) { lapses++; reps = 0 } else { reps++; correct_reviews++ }
  // Prior memory state: the stored FSRS state, or a one-time seed from the SM-2
  // columns for any card not yet migrated (migration 0016 pre-seeds; this is the
  // safety net).
  const prior = (s.stability != null && s.difficulty != null)
    ? { stability: s.stability, difficulty: s.difficulty }
    : sm2ToFsrs({ interval_days: s.interval_days, ease: s.ease, lapses: s.lapses })
  // Days since last seen; treat a never-FSRS-reviewed card as if reviewed on time.
  const elapsed = s.last_review ? daysBetween(s.last_review, today) : (s.interval_days || 0)
  const { state, interval } = fsrsReview(prior, grade, elapsed)
  const interval_days = interval
  const due = addDays(today, interval)
  const mastery = tongueMastery({ correct_reviews, interval_days })
  const prevMastery = s.mastery
  await DB.prepare(
    `UPDATE review_items SET interval_days=?, ease=?, reps=?, lapses=?, due_date=?, mastery=?, total_reviews=?, correct_reviews=?, last_mode=?, stability=?, difficulty=?, last_review=?
     WHERE item_id=? AND user_id=? AND kind='response'`
  ).bind(interval_days, s.ease, reps, lapses, due, mastery, total_reviews, correct_reviews, mode || 'recall', state.stability, state.difficulty, today, id, userId).run()
  await DB.prepare(
    `INSERT INTO tongue_reviews (user_id, response_id, review_date, mode, grade)
     VALUES (?,?,?,?,?)`,
  ).bind(userId, id, today, mode || 'recall', grade).run()
  // Mastery promotion bonuses — real, earned progress
  let promoted: string | null = null
  if (mastery !== prevMastery) {
    const bonus: any = { learning: 2, memorized: 8, ingrained: 15, reflex: 30 }
    if (bonus[mastery]) {
      promoted = mastery
      const r = await DB.prepare(
        `SELECT trigger_q FROM captures WHERE kind='response' AND id=? AND user_id=?`,
      ).bind(id, userId).first<any>()
      await DB.prepare(
        `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type, ref_id)
         VALUES (?,?,?,?,?,?)`,
      ).bind(userId, today, bonus[mastery], `TONGUE ${mastery.toUpperCase()}: "${String(r?.trigger_q || '').slice(0, 50)}…" climbed to ${mastery.toUpperCase()}. +${bonus[mastery]} pts.`, 'tongue', id).run()
    }
  }
  return c.json({ ok: true, next_due: due, mastery, promoted })
}))

// Weekly exam — strict. 10 random armed responses (or all if fewer). Pass ≥ 80%.
app.get('/api/tongue/exam', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { results } = await DB.prepare(
    `SELECT r.id, r.situation, r.trigger_q, r.response, r.category, s.mastery
     FROM captures r JOIN review_items s ON s.item_id=r.id AND s.user_id=r.user_id AND s.kind='response'
     WHERE r.kind='response' AND r.user_id=? AND r.archived=0 AND s.total_reviews > 0 ORDER BY RANDOM() LIMIT 10`
  ).bind(userId).all()
  return c.json(results)
})
app.post('/api/tongue/exam/submit', async (c) => withIdempotency(c, 'tongue:exam', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { total, correct, date } = await parseJson(c, tongueExamBodySchema)
  const today = await safeDate(DB, date, userId)
  const pct = total ? Math.round((correct / total) * 100) : 0
  const passed = pct >= 80 ? 1 : 0
  await DB.prepare(
    `INSERT INTO exams (user_id, kind, exam_date, total, correct, score_pct, passed)
     VALUES (?,'tongue',?,?,?,?,?)`,
  ).bind(userId, today, total, correct, pct, passed).run()
  if (passed) {
    await DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type)
       VALUES (?,?,?,?,?)`,
    ).bind(userId, today, 25, `TONGUE EXAM PASSED: ${correct}/${total} (${pct}%). The armory is in your head. +25 pts.`, 'tongue').run()
  } else {
    await addFlag(DB, userId, today, 'tongue_exam_failed', 'serious',
      `TONGUE EXAM FAILED: ${correct}/${total} (${pct}%). You recorded wisdom you cannot recall — that is decoration, not armament. −10 pts. Drill and retake.`, -10)
  }
  return c.json({ ok: true, score_pct: pct, passed: !!passed })
}))

// Tongue stats — the real-progress dashboard
app.get('/api/tongue/stats', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const date = await safeDate(DB, c.req.query('date'), userId)
  const byMastery = (await DB.prepare(
    `SELECT s.mastery, COUNT(*) n FROM review_items s
     JOIN captures r ON r.id=s.item_id AND r.user_id=s.user_id AND r.kind='response'
     WHERE s.kind='response' AND r.user_id=? AND r.archived=0 GROUP BY s.mastery`
  ).bind(userId).all()).results
  const totals = await DB.prepare(
    `SELECT COUNT(*) total FROM captures WHERE kind='response' AND user_id=? AND archived=0`,
  ).bind(userId).first<any>()
  const due = await DB.prepare(
    `SELECT COUNT(*) n FROM review_items s
     JOIN captures r ON r.id=s.item_id AND r.user_id=s.user_id AND r.kind='response'
     WHERE s.kind='response' AND r.user_id=? AND r.archived=0 AND s.due_date<=?`,
  ).bind(userId, date).first<any>()
  const reviews7 = await DB.prepare(
    `SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN grade>=2 THEN 1 ELSE 0 END),0) solid
     FROM tongue_reviews WHERE user_id=? AND review_date >= ?`,
  ).bind(userId, addDays(date, -7)).first<any>()
  const exams = (await DB.prepare(
    `SELECT * FROM exams WHERE kind='tongue' AND user_id=? ORDER BY created_at DESC LIMIT 8`,
  ).bind(userId).all()).results
  const captured7 = await DB.prepare(
    `SELECT COUNT(*) n FROM captures
     WHERE kind='response' AND user_id=? AND archived=0 AND created_at >= datetime(?, '-7 days')`,
  ).bind(userId, date + ' 00:00:00').first<any>()
  const byCat = (await DB.prepare(
    `SELECT category, COUNT(*) n FROM captures
     WHERE kind='response' AND user_id=? AND archived=0 GROUP BY category ORDER BY n DESC`,
  ).bind(userId).all()).results
  const lastExam = (exams as any[])[0] || null
  const weekExamDone = lastExam && (lastExam as any).exam_date >= addDays(date, -6)
  return c.json({
    total: totals?.total ?? 0, due: due?.n ?? 0, byMastery, byCat,
    reviews7: reviews7?.n ?? 0, solid7: reviews7?.solid ?? 0,
    captured7: captured7?.n ?? 0, exams, weekExamDone: !!weekExamDone
  })
})
}
