// Book 10.1 — the reading routes. A chapter is opened, traversed and anchored; the
// application decides whether that was reading. There is deliberately no endpoint
// that lets a client declare a chapter read.
import { Hono } from 'hono'
import type { Bindings, Variables } from '../env'
import { parseJson, parseValue } from '../validation'
import {
  chapterIndexSchema, readingOpenBodySchema, readingProgressBodySchema,
  readingCloseBodySchema,
} from '../schemas'
import { readingVerdict, dwellIncrement, requiredSeconds } from '../reading'

export function registerReadingRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {

// Open a reading session for a chapter. word_count comes from the shipped book JSON
// the client is displaying; it is recorded so the verdict is about THIS text.
app.post('/api/reading/open', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const b = await parseJson(c, readingOpenBodySchema)
  const r = await DB.prepare(
    `INSERT INTO reading_sessions
       (user_id, edition_id, book_id, chapter_idx, unit_id, word_count, last_event_at)
     VALUES (?,?,?,?,?,?,datetime('now'))`,
  ).bind(userId, b.edition_id || null, b.book_id, b.chapter_idx, b.unit_id || null, b.word_count).run()
  return c.json({
    ok: true,
    session_id: Number(r.meta.last_row_id),
    requiredSeconds: requiredSeconds(b.word_count),
  })
})

// A heartbeat from the reader: how far down, which anchor, how long since the last
// one. Dwell is accumulated server-side from these, and a gap that means the reader
// walked away contributes nothing.
app.post('/api/reading/progress', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const b = await parseJson(c, readingProgressBodySchema)
  const session = await DB.prepare(
    `SELECT id, word_count, dwell_seconds, max_scroll_pct, closed_at
     FROM reading_sessions WHERE id=? AND user_id=?`,
  ).bind(b.session_id, userId).first<any>()
  if (!session) return c.json({ error: 'no such reading session' }, 404)
  if (session.closed_at) return c.json({ error: 'READING SESSION CLOSED.' }, 409)

  const add = dwellIncrement(b.elapsed_ms)
  await DB.batch([
    DB.prepare(
      `INSERT INTO reading_events (session_id, user_id, anchor, scroll_pct, elapsed_ms)
       VALUES (?,?,?,?,?)`,
    ).bind(b.session_id, userId, b.anchor || null, b.scroll_pct, b.elapsed_ms),
    DB.prepare(
      `UPDATE reading_sessions
       SET dwell_seconds = dwell_seconds + ?,
           max_scroll_pct = MAX(max_scroll_pct, ?),
           sections_seen = (SELECT COUNT(DISTINCT anchor) FROM reading_events
                            WHERE session_id=? AND anchor IS NOT NULL),
           last_event_at = datetime('now')
       WHERE id=? AND user_id=?`,
    ).bind(add, b.scroll_pct, b.session_id, b.session_id, userId),
  ])

  const updated = await DB.prepare(
    `SELECT dwell_seconds, max_scroll_pct, word_count, sections_seen
     FROM reading_sessions WHERE id=? AND user_id=?`,
  ).bind(b.session_id, userId).first<any>()
  const verdict = readingVerdict(updated)
  return c.json({ ok: true, ...verdict })
})

// Close the session and record the verdict. Closing does NOT decide anything on the
// client's word: the same measurement runs here.
app.post('/api/reading/close', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { session_id } = await parseJson(c, readingCloseBodySchema)
  const session = await DB.prepare(
    `SELECT id, dwell_seconds, max_scroll_pct, word_count, sections_seen, book_id, chapter_idx
     FROM reading_sessions WHERE id=? AND user_id=?`,
  ).bind(session_id, userId).first<any>()
  if (!session) return c.json({ error: 'no such reading session' }, 404)
  const verdict = readingVerdict(session)
  await DB.prepare(
    `UPDATE reading_sessions SET closed_at=datetime('now'), plausible=? WHERE id=? AND user_id=?`,
  ).bind(verdict.plausible ? 1 : 0, session_id, userId).run()
  return c.json({ ok: true, ...verdict })
})

// What the application knows about this chapter's reading: the best session so far,
// and whether the reading requirement is met. The curriculum gate reads the same row.
app.get('/api/reading/:bookId/:chapterIdx', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const bookId = c.req.param('bookId')
  // chapter 0 is legitimate, so the chapter schema (not a positive id) is used
  const chapterIdx = parseValue(chapterIndexSchema, c.req.param('chapterIdx'))
  const best = await DB.prepare(
    `SELECT dwell_seconds, max_scroll_pct, word_count, sections_seen, plausible, started_at, closed_at
     FROM reading_sessions
     WHERE user_id=? AND book_id=? AND chapter_idx=?
     ORDER BY plausible DESC, dwell_seconds DESC LIMIT 1`,
  ).bind(userId, bookId, chapterIdx).first<any>()
  if (!best) {
    return c.json({ read: false, reason: 'No reading recorded for this chapter yet.', sessions: 0 })
  }
  const verdict = readingVerdict(best)
  return c.json({ read: !!best.plausible || verdict.plausible, ...verdict, startedAt: best.started_at })
})
}
