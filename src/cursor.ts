// Book 7 refactor — the chapter cursor (Book 16 / R9).
// The cursor is a database value, never a code constant. Reads are read-only
// (Book 5.3): the row is persisted only by POST /api/cursor. When no row exists
// the documented current value is returned so figure selection always has one.

export type ChapterCursor = {
  book: string; part: string; chapter: number; figure: string; cycle_day: number
}

export const DEFAULT_CURSOR: ChapterCursor = {
  book: 'Farnsworth — Classical English Rhetoric',
  part: 'Repetition at the Start',
  chapter: 2,
  figure: 'Anaphora',
  cycle_day: 1,
}

export async function readChapterCursor(DB: D1Database, userId: number): Promise<ChapterCursor> {
  const row = await DB.prepare(
    `SELECT book, part, chapter, figure, cycle_day FROM chapter_cursor WHERE user_id=?`,
  ).bind(userId).first<ChapterCursor>()
  return row ?? { ...DEFAULT_CURSOR }
}
