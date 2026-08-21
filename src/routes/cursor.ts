// Book 7 refactor — the chapter-cursor + Continuity Brief routes (Books 16/14).
// The read-only cursor accessor and default live in ../cursor; the brief
// serialiser in ../commanders-file. GET routes never write; POST upserts.
import { Hono } from 'hono'
import { z } from 'zod'
import type { Bindings, Variables } from '../env'
import { parseJson } from '../validation'
import { requestId, auditEvent } from '../request-support'
import { userNow } from '../clock'
import { type ChapterCursor, DEFAULT_CURSOR, readChapterCursor } from '../cursor'
import { continuityBrief } from '../commanders-file'

export function registerCursorRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {
// ============ BOOK 16 / R9 — THE CHAPTER CURSOR ============

const cursorBodySchema = z.strictObject({
  book: z.string().trim().min(1).max(200).optional(),
  part: z.string().trim().min(1).max(200).optional(),
  chapter: z.number().int().min(1).max(999).optional(),
  figure: z.string().trim().min(1).max(200).optional(),
  cycle_day: z.number().int().min(1).max(7).optional(),
})

// ChapterCursor/DEFAULT_CURSOR/readChapterCursor extracted to ./cursor (Book 7).

app.get('/api/cursor', async (c) => {
  const cur = await readChapterCursor(c.env.DB, c.get('userId'))
  return c.json(cur)
})

app.post('/api/cursor', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const b = await parseJson(c, cursorBodySchema)
  const cur = await readChapterCursor(DB, userId)   // read-only; default if unset
  const next: ChapterCursor = {
    book: b.book ?? cur.book,
    part: b.part ?? cur.part,
    chapter: b.chapter ?? cur.chapter,
    figure: b.figure ?? cur.figure,
    cycle_day: b.cycle_day ?? cur.cycle_day,
  }
  // Single upsert — the only place the cursor is persisted (a write route).
  await DB.prepare(
    `INSERT INTO chapter_cursor (user_id, book, part, chapter, figure, cycle_day, updated_at)
     VALUES (?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       book=excluded.book, part=excluded.part, chapter=excluded.chapter,
       figure=excluded.figure, cycle_day=excluded.cycle_day, updated_at=datetime('now')`,
  ).bind(userId, next.book, next.part, next.chapter, next.figure, next.cycle_day).run()
  const rid = requestId(c)
  if (rid) {
    await auditEvent(DB, {
      userId, actorType: 'user', requestId: rid,
      action: 'cursor.set', entityType: 'chapter_cursor', entityId: userId,
      before: cur, after: next,
    })
  }
  return c.json(next)
})

// ============ BOOK 14 — THE CONTINUITY BRIEF ============

// Plain-text session-continuity brief in the format the operator already keeps
// by hand. Second output mode of the Commander's File serialiser: it survives
// conversation compaction in any external tool. Read-only.
// continuityBrief extracted to ./commanders-file (Book 7).

app.get('/api/continuity-brief', async (c) => {
  const { date } = await userNow(c.env.DB, c.get('userId'))
  const text = await continuityBrief(c.env.DB, c.get('userId'), date)
  return c.body(text, 200, { 'Content-Type': 'text/plain; charset=utf-8' })
})
}
