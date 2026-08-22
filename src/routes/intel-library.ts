// Book 7 refactor — LIFE INTEL (the Council log) and the BOOKS library routes.
// Filing/reading intel (with the Book 13.2 heat brake), verdicts, the library
// listing, and chapter progress. The gate/idempotency/audit live in
// ../request-support; validation in ../validation.
import { Hono } from 'hono'
import type { Bindings, Variables } from '../env'
import { parseJson, parseValue, RequestValidationError } from '../validation'
import { withIdempotency, requestId, altGate, recordAltExplanation, auditEvent } from '../request-support'
import { safeDate, userNow } from '../clock'
import { collapseDomain, DOMAINS, DOMAIN_LABELS } from '../intel-domains'
import {
  intelBodySchema, intelVerdictBodySchema, intelDomainSchema,
  bookProgressBodySchema, positiveIdSchema, chapterIndexSchema,
} from '../schemas'

export function registerIntelLibraryRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {
// ============ LIFE INTEL (The Council) ============
app.get('/api/intel', async (c) => {
  const userId = c.get('userId')
  const domain = c.req.query('domain') === undefined
    ? undefined
    : parseValue(intelDomainSchema, c.req.query('domain'))
  const q = domain
    ? c.env.DB.prepare(
      `SELECT * FROM captures WHERE kind='intel' AND user_id=?
       ORDER BY log_date DESC, id DESC LIMIT 100`,
    ).bind(userId)
    : c.env.DB.prepare(
      `SELECT * FROM captures WHERE kind='intel' AND user_id=? ORDER BY log_date DESC, id DESC LIMIT 100`,
    ).bind(userId)
  // Book 9: every row reports which of the six domains it belongs to, so a legacy
  // value stays findable, and a domain filter matches on that collapsed group rather
  // than on the exact stored string.
  const rows = ((await q.all()).results as any[])
    .map((r) => ({ ...r, domain_group: collapseDomain(r.domain) }))
  const filtered = domain
    ? rows.filter((r) => r.domain_group === collapseDomain(domain))
    : rows
  return c.json(filtered)
})

// The six domains and their labels (Book 9).
app.get('/api/intel/domains', (c) =>
  c.json(DOMAINS.map((d) => ({ domain: d, label: DOMAIN_LABELS[d] }))))

app.post('/api/intel', async (c) => withIdempotency(c, 'intel:file', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const b = await parseJson(c, intelBodySchema)
  // Book 13.2 brake: a heated capture cannot be filed without an alternative.
  const gated = altGate(c, b.heat, b.alternative_explanation)
  if (gated) return gated
  // Book 5.3/6: clamp a client date never-future (safeDate) so a filed intel
  // entry can be honestly back-dated but its +15 can never land on a future day.
  const logDate = await safeDate(DB, b.log_date, userId)
  const r = await DB.prepare(
    `INSERT INTO captures
       (user_id, kind, log_date, domain, title, situation, my_move, outcome, verdict,
        principle_used, lesson, people, heat, alternative_explanation)
     VALUES (?,'intel',?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(userId, logDate, b.domain, b.title, b.situation || null,
    b.my_move || null, b.outcome || null, b.verdict || 'pending', b.principle_used || null,
    b.lesson || null, b.people || null, b.heat || null, b.alternative_explanation || null).run()
  await DB.prepare(
    `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type, ref_id)
     VALUES (?,?,?,?,?,?)`,
  ).bind(userId, logDate, 15, `Intel filed: [${b.domain}] ${b.title} (+15)`, 'intel', r.meta.last_row_id).run()
  // Count the brake (and the "none plausible" tell) when heat is non-calm.
  if (b.heat && b.heat !== 'calm' && b.alternative_explanation) {
    await recordAltExplanation(DB, {
      userId, entityType: 'capture', entityId: r.meta.last_row_id,
      heat: b.heat, text: b.alternative_explanation,
    })
  }
  const rid = requestId(c)
  if (rid) {
    await auditEvent(DB, {
      userId, actorType: 'user', requestId: rid,
      action: 'intel.file', entityType: 'intel_entry', entityId: r.meta.last_row_id,
      after: { domain: b.domain, log_date: logDate, points: 15, heat: b.heat || 'calm' },
    })
  }
  return c.json({ ok: true, id: r.meta.last_row_id })
}))

app.post('/api/intel/:id/verdict', async (c) => {
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  const { verdict, lesson } = await parseJson(c, intelVerdictBodySchema)
  const entry = await c.env.DB.prepare(
    `SELECT verdict FROM captures WHERE kind='intel' AND id=? AND user_id=?`,
  ).bind(id, c.get('userId')).first<{ verdict: string | null }>()
  if (!entry) return c.json({ error: 'not found' }, 404)
  if (entry.verdict && entry.verdict !== 'pending') {
    return c.json({ error: 'VERDICT FINAL. Terminal records cannot be rewritten.' }, 409)
  }
  await c.env.DB.prepare(
    `UPDATE captures SET verdict=?, lesson=COALESCE(?,lesson)
     WHERE kind='intel' AND id=? AND user_id=?`,
  ).bind(verdict, lesson || null, id, c.get('userId')).run()
  return c.json({ ok: true })
})

// ============ BOOK PROGRESS (real books library) ============
const BOOKS_META = [
  { id: 'art_of_war', title: 'The Art of War', author: 'Sun Tzu', phase: 'P1', chapters: 13 },
  { id: 'the_prince', title: 'The Prince', author: 'Machiavelli', phase: 'P2', chapters: 26 },
  { id: 'discourses', title: 'Discourses on Livy', author: 'Machiavelli', phase: 'P2B', chapters: 141 },
  { id: 'on_war', title: 'On War (Book I)', author: 'Clausewitz', phase: 'P3', chapters: 12 },
  { id: 'meditations', title: 'Meditations', author: 'Marcus Aurelius', phase: 'PHIL', chapters: 12 },
  { id: 'enchiridion', title: 'The Enchiridion', author: 'Epictetus', phase: 'PHIL', chapters: 6 },
  { id: 'apology', title: 'Apology', author: 'Plato', phase: 'PHIL', chapters: 4 },
  { id: 'crito', title: 'Crito', author: 'Plato', phase: 'PHIL', chapters: 3 },
  { id: 'republic', title: 'The Republic (I–IV)', author: 'Plato', phase: 'PHIL', chapters: 4 },
  { id: 'zarathustra', title: 'Thus Spake Zarathustra (Pt.1)', author: 'Nietzsche', phase: 'PHIL', chapters: 25 },
  { id: 'beyond_good_evil', title: 'Beyond Good and Evil', author: 'Nietzsche', phase: 'PHIL', chapters: 10 },
]

app.get('/api/library', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT book_id, chapter_idx, status, last_para FROM book_progress WHERE user_id=?`,
  ).bind(c.get('userId')).all()
  const prog: Record<string, any[]> = {}
  for (const r of results as any[]) (prog[r.book_id] ||= []).push(r)
  return c.json(BOOKS_META.map(b => {
    const rows = prog[b.id] || []
    const done = rows.filter(r => r.status === 'done').length
    const reading = rows.find(r => r.status === 'reading')
    return { ...b, chaptersDone: done, currentChapter: reading?.chapter_idx ?? null, lastPara: reading?.last_para ?? 0 }
  }))
})

app.post('/api/library/:bookId/chapter/:idx', async (c) => withIdempotency(c, 'library:chapter', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const bookId = c.req.param('bookId')
  const book = BOOKS_META.find((candidate) => candidate.id === bookId)
  if (!book) throw new RequestValidationError()
  const idx = parseValue(chapterIndexSchema, c.req.param('idx'))
  if (idx >= book.chapters) throw new RequestValidationError()
  const { status, last_para, notes, date } =
    await parseJson(c, bookProgressBodySchema)
  const prev = await DB.prepare(
    `SELECT id, status, last_para FROM book_progress
     WHERE user_id=? AND book_id=? AND chapter_idx=?`,
  ).bind(userId, bookId, idx).first<{
    id: number
    status: string
    last_para: number
  }>()
  const nextStatus = status || 'reading'
  if ((!prev || prev.status === 'unread') && nextStatus !== 'reading') {
    return c.json({ error: 'READING REQUIRED. Chapters must be opened before completion.' }, 409)
  }
  if (prev?.status === 'done') {
    return c.json({ error: 'CHAPTER COMPLETE. Terminal records cannot be rewritten.' }, 409)
  }
  if (prev?.status === 'reading' && nextStatus !== 'reading' && nextStatus !== 'done') {
    return c.json({ error: 'ILLEGAL CHAPTER TRANSITION.' }, 409)
  }
  if (prev) {
    await DB.prepare(
      `UPDATE book_progress SET status=?, last_para=?, notes=COALESCE(?,notes),
         completed_at=CASE WHEN ?='done' THEN datetime('now') ELSE completed_at END
       WHERE id=? AND user_id=?`,
    ).bind(nextStatus, last_para ?? prev.last_para, notes || null, nextStatus, prev.id, userId).run()
  } else {
    await DB.prepare(
      `INSERT INTO book_progress
         (user_id, book_id, chapter_idx, status, last_para, notes, completed_at)
       VALUES (?,?,?,?,?,?,NULL)`,
    ).bind(userId, bookId, idx, 'reading', last_para ?? 0, notes || null).run()
  }
  if (nextStatus === 'done') {
    await DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type)
       VALUES (?,?,?,?,?)`,
    ).bind(userId, date || (await userNow(DB, userId)).date, 20, `Real chapter finished: ${bookId} ch.${idx + 1} (+20)`, 'book').run()
  }
  return c.json({ ok: true })
}))
}
