// The shelf, and what "finished" means for each work on it.
//
// A book is complete when every one of its chapters is done. That number differs per book —
// Crito has three chapters, Discourses has a hundred and forty-one — and the code used to
// stand in a single literal for all of them: `HAVING c >= 12`, in `commanders-file.ts` and
// again in `routes/economy.ts`.
//
// It was correct for exactly two of the eleven works. Twelve chapters of Discourses awarded
// MASTER OF TEXTS ("Finish a complete book") with a hundred and twenty-nine chapters unread,
// and the five books shorter than twelve — Enchiridion, Apology, Crito, Republic, Beyond
// Good and Evil — could never be reported finished no matter how completely he read them.
// Congratulating him for a book he has not read and refusing to acknowledge five he has are
// the same defect, and it is the one the honesty engine exists to prevent.
//
// The counts below are the shelf's own, not an assumption about it. The Worker cannot read
// `public/static/books/*.json` at runtime, so they are recorded here and pinned:
// `test/book-completion.test.ts` derives them from those files and fails in both directions
// if this map and the shelf ever disagree. Adding a twelfth book breaks the build until its
// chapter count is written down, which is the only thing that keeps this true later.
export const BOOK_CHAPTER_COUNTS: Record<string, number> = {
  apology: 4,
  art_of_war: 13,
  beyond_good_evil: 10,
  crito: 3,
  discourses: 141,
  enchiridion: 6,
  meditations: 12,
  on_war: 12,
  republic: 4,
  the_prince: 26,
  zarathustra: 25,
}

/**
 * The rows, of per-book counts of chapters marked done, that represent a finished book.
 *
 * Returns rows rather than ids so callers keep whatever else they selected — the Continuity
 * Brief interpolates `b.book_id`, and an accessor is what makes the emitted field visible to
 * `test/privacy-doc-completeness.test.ts`. Flattening to a bare string list here would drop
 * a real disclosure out of PRIVACY.md's derived coverage without any test noticing.
 *
 * `book_progress` carries `UNIQUE(book_id, chapter_idx)`, so a book's done-count cannot
 * exceed its chapter count and reaching the total is genuine completion rather than a
 * coincidence of duplicate rows.
 *
 * A `book_id` with no recorded chapter count is never reported complete. Its denominator is
 * unknown, and claiming a finished book on an unknown denominator is the same unearned
 * congratulation in a new form, so the honest answer is to say nothing about it.
 */
export function completedBooks<T extends { book_id: string; c: number }>(rows: T[]): T[] {
  return rows
    .filter((r) => {
      const total = BOOK_CHAPTER_COUNTS[r.book_id]
      return typeof total === 'number' && total > 0 && r.c >= total
    })
    .sort((a, b) => (a.book_id < b.book_id ? -1 : a.book_id > b.book_id ? 1 : 0))
}
