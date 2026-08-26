// A book is complete when every one of its chapters is done. "Every" is a different number
// for each of the eleven works on the shelf, and the code used a single literal — `HAVING
// c >= 12` — to stand in for all of them, in two places.
//
// That literal is correct for exactly two books. Its consequences are not cosmetic:
//
//   Discourses has 141 chapters. Twelve done awarded MASTER OF TEXTS — "Finish a complete
//   book" — with 129 chapters unread. The comment directly above that medal block reads
//   "earned, never given".
//
//   Enchiridion (6), Apology (4), Crito (3), Republic (4), and Beyond Good and Evil (10)
//   have fewer than twelve chapters, so finishing them completely awarded nothing and they
//   could never appear in the Continuity Brief's completed-works line.
//
// Congratulating him for a book he has not read and refusing to acknowledge five he has are
// the same defect, and it is the defect the honesty engine exists to prevent. So the counts
// are DERIVED from the shelf rather than assumed, and this suite fails if the derivation and
// the shelf ever disagree — which is what keeps it true when a twelfth book is added.
import { describe, it, expect } from 'vitest'
import { BOOK_CHAPTER_COUNTS, completedBooks } from '../src/books'

// Discovered, not listed. Vite resolves this at build time, so it works inside the workers
// pool, which cannot read disk at runtime.
const bookModules = import.meta.glob('../public/static/books/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** The finished books' ids. `completedBooks` returns rows so the emitter keeps `b.book_id`. */
const ids = (rows: { book_id: string; c: number }[]) => completedBooks(rows).map((b) => b.book_id)

/** book id → chapter count, read from the shelf itself. */
const shelf = new Map<string, number>()
for (const [path, raw] of Object.entries(bookModules)) {
  const parsed = JSON.parse(raw)
  const id = String(parsed.id || path.replace(/^.*\//, '').replace(/\.json$/, ''))
  shelf.set(id, Array.isArray(parsed.chapters) ? parsed.chapters.length : -1)
}

describe('a book is complete when all of its chapters are done', () => {
  it('the shelf was actually read', () => {
    // Vacuity floor. Without it a broken glob leaves `shelf` empty, every comparison below
    // iterates nothing, and the suite reports a verified chapter map for a shelf it never
    // opened — a green result that means nothing.
    expect(
      shelf.size,
      'the books glob found almost nothing, so every comparison below would pass over an '
      + 'empty set and prove nothing about the chapter counts',
    ).toBeGreaterThanOrEqual(11)
    expect(
      [...shelf].filter(([, n]) => n < 1).map(([id]) => id),
      'these book files have no chapters array, so their count cannot be derived',
    ).toEqual([])
  })

  it('the chapter map matches the shelf in both directions', () => {
    // A hand-maintained map is the defect this repository keeps finding. Adding a twelfth
    // book must break the build until its count is recorded, and removing one must break it
    // until the stale entry goes — otherwise the map silently describes a shelf that moved.
    const missing = [...shelf.keys()].filter((id) => !(id in BOOK_CHAPTER_COUNTS))
    expect(
      missing,
      `BOOK_CHAPTER_COUNTS has no entry for ${missing.join(', ')}. A book with no recorded `
      + 'chapter count can never be reported complete, so it is silently unfinishable.',
    ).toEqual([])

    const stale = Object.keys(BOOK_CHAPTER_COUNTS).filter((id) => !shelf.has(id))
    expect(
      stale,
      `BOOK_CHAPTER_COUNTS lists ${stale.join(', ')}, which is not on the shelf`,
    ).toEqual([])

    const wrong = [...shelf].filter(([id, n]) => BOOK_CHAPTER_COUNTS[id] !== n)
      .map(([id, n]) => `${id}: shelf has ${n}, map says ${BOOK_CHAPTER_COUNTS[id]}`)
    expect(
      wrong,
      `the recorded chapter counts disagree with the shelf — ${wrong.join('; ')}`,
    ).toEqual([])
  })

  it('does not report a book complete before its last chapter', () => {
    // The exact falsehood the literal produced, in the worst case on the shelf.
    expect(
      ids([{ book_id: 'discourses', c: 12 }]),
      '12 of Discourses\' 141 chapters was reported as a completed work and awarded '
      + 'MASTER OF TEXTS',
    ).toEqual([])
    // And the near miss, which is the case a reader would most easily believe.
    expect(
      ids([{ book_id: 'art_of_war', c: 12 }]),
      '12 of The Art of War\'s 13 chapters is not the whole book',
    ).toEqual([])
  })

  it('reports a short book complete when it actually is', () => {
    // Five books are shorter than the old threshold, so finishing them earned nothing.
    expect(
      ids([{ book_id: 'enchiridion', c: 6 }]),
      'Enchiridion has 6 chapters; finishing all of them is finishing the book',
    ).toEqual(['enchiridion'])
    expect(
      ids([{ book_id: 'crito', c: 3 }]),
      'Crito has 3 chapters',
    ).toEqual(['crito'])
  })

  it('still reports the books the old threshold happened to get right', () => {
    // Meditations and On War have exactly twelve chapters. The fix must not trade one
    // wrong answer for a different wrong answer.
    expect(ids([{ book_id: 'meditations', c: 12 }])).toEqual(['meditations'])
    expect(ids([{ book_id: 'on_war', c: 12 }])).toEqual(['on_war'])
  })

  it('refuses to report a book it cannot count', () => {
    // An id with no recorded chapter count cannot be shown to be finished. Awarding a medal
    // on an unknown denominator is the same unearned congratulation in a new form.
    expect(
      ids([{ book_id: 'not_on_the_shelf', c: 9999 }]),
      'a book with no known chapter count must not be reported complete',
    ).toEqual([])
  })

  it('sorts and handles the whole set at once', () => {
    expect(ids([
      { book_id: 'on_war', c: 12 },
      { book_id: 'discourses', c: 140 },
      { book_id: 'apology', c: 4 },
    ])).toEqual(['apology', 'on_war'])
    expect(ids([])).toEqual([])
  })
})
