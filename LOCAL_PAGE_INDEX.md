# Local Task — Build the Book Page Index (Book 11.8)

This is a **local** task on the commander's own machine. It is not an operator task: it
touches no Cloudflare resource, no production D1, no secret, and no deploy. It is written
here because it is the one Book 11 item the repository cannot complete for itself — the
page captures are the commander's personal property and live only on his machine.

Everything below can be run and re-run safely. The script never deletes a row, never reads
the content of an image, never copies or uploads a file, and has no path to production.

---

## 0. What the page index is, and what it is not

Book 11.8 requires that the application **reference** his copies of the two books rather
than absorb them. `book_page_refs` therefore stores exactly three things per page:

| Column | Holds | Does not hold |
| --- | --- | --- |
| `book_slug` | which of the two books | — |
| `page_index` | the 0-based position in his capture sequence | a printed page number |
| `file_name` | the file name on his own machine | the image, a path, or any page text |

`page_index` is a **position in his capture sequence**, not a printed page number. That
distinction is the whole reason section 2 below exists.

The file names are recorded in the local database only. They are never committed: the
capture folder is his, and `.gitignore` keeps `books_raw/` and `.wrangler/` out of git.

---

## 1. Preconditions

- [ ] The capture folder exists and holds every page image for **both** books, in one flat
      folder, in the order the pages were shot. Default location:
      `C:\Users\user\Pictures\Screenshots`
- [ ] Migrations `0024_rhetoric_track.sql` and `0025_rhetoric_seed.sql` have been applied to
      the local database (they create `book_page_refs` and seed `book_chapter_anchors`).
- [ ] `wrangler pages dev` has been started at least once and a route that touches D1 has
      been hit, so the local sqlite file exists. The script finds it the same way
      `scripts/preview-db.cjs` does — the newest `.sqlite` under
      `.wrangler/state/v3/d1/miniflare-D1DatabaseObject`.
- [ ] Node 22 or newer (the script uses the built-in `node:sqlite` module).

---

## 2. The count discrepancy — read this before running anything

**The Phase 8 plan carried a 622-page index. The folder currently holds 645 images.**

That is a 23-page disagreement, and it is not resolved by picking the larger number. One of
these is true, and only the commander can say which:

1. Twenty-three pages were captured **after** the 622 figure was written down (a re-shoot of
   blurred pages, a missed spread, the second book's endmatter). The index is 645 and the
   plan's number is stale.
2. Twenty-three files in the folder are **not** book pages (an unrelated screenshot, a
   duplicate, a crop). They must be moved out of the folder before the index is built.

The difference matters because **every anchor in migration 0025 is a position in this
sequence.** If twenty-three stray files sit anywhere before position 461, the anchor for
`Chapter 12 — Deduction and Induction` stops pointing at chapter 12, and so does every
anchor after the stray file. Nothing errors; the index is just quietly wrong.

So the script refuses `--commit` unless you state the count you expect (section 4). Do not
adjust the number to whatever the script reports — check the folder first.

**How to check:** run section 3, then open the three positions the seam depends on — 370,
371, and 461 — and confirm each shows the page the anchor claims. See section 5.

---

## 3. Dry run (always first — writes nothing)

```bash
node scripts/index-book-pages.cjs --dir "C:\Users\user\Pictures\Screenshots" --dry-run
```

Output as of 2026-08-23:

```
  captures found     : 645
  ordered by         : filename timestamp
  seam at index      : 371  (classical_english_rhetoric -> classical_english_argument)
  pages per book     : {"classical_english_rhetoric":371,"classical_english_argument":274}

  DRY RUN. Nothing written. The first and last three positions:
       0  classical_english_rhetoric
       1  classical_english_rhetoric
       2  classical_english_rhetoric
     642  classical_english_argument
     643  classical_english_argument
     644  classical_english_argument

  Re-run with --expect 645 --commit to write them.
```

Three lines to check before going further:

- **`captures found`** must equal the number of book pages you believe are in the folder.
- **`ordered by`** should say `filename timestamp`. Windows screenshot names carry a sortable
  timestamp, so that ordering is the order he shot the pages in. If it says `file mtime`
  instead, at least one file has no timestamp in its name and the ordering has fallen back to
  modification time — which a copy, a sync, or an edit can change. Fix the folder rather than
  trusting the fallback.
- **`seam at index`** must be `371`. That is the boundary between the two books and it is
  hard-coded, because it was established by reading the pages: capture 370 is the last page of
  the rhetoric book and capture 371 is the argument book's contents page.

---

## 4. Commit the index

```bash
node scripts/index-book-pages.cjs --dir "C:\Users\user\Pictures\Screenshots" --expect 645 --commit
```

`--expect` is mandatory with `--commit`, and it is mandatory for the reason in section 2: a
count that has drifted re-points every anchor after the drift without producing an error.
Stating the count turns a changed folder into a refusal:

```
  REFUSED: expected 645 captures, found 646.
  Nothing was written. Either the folder changed or the expectation is stale.
  Confirm which before re-running: the page indexes depend on it.
```

The write is **idempotent**. `UNIQUE(book_slug, page_index)` plus
`ON CONFLICT ... DO UPDATE SET file_name = excluded.file_name` means re-running updates the
file name at a position rather than duplicating the position. Nothing is ever deleted.

---

## 5. The anchor-resolution check (the part that must not be "fixed")

After writing, the script checks every row in `book_chapter_anchors` against the index it
just wrote, and prints one line per anchor:

```
  anchor resolution:
    ok      0  classical_english_rhetoric  Contents
    ok      9  classical_english_rhetoric  Chapter 1 — Simple Repetition
    ok     26  classical_english_rhetoric  Chapter 2 — Anaphora
    ok     67  classical_english_rhetoric  Chapter 6 — Polyptoton
    ok    182  classical_english_rhetoric  Chapter 10 — Polysyndeton
    ok    370  classical_english_rhetoric  Contents and Bibliographic Note (last captured page)
    ok    371  classical_english_argument  Contents
    ok    461  classical_english_argument  Chapter 12 — Deduction and Induction
```

A `MISS` exits non-zero with:

> That is a real disagreement between the anchors and the captures, not a formatting
> problem. Do not adjust the anchors to make it go away: each one was confirmed by reading
> the page.

This is worth stating plainly. Every one of those eight anchors carries a `confirmed_by`
sentence in migration 0025 recording what was actually visible on that page — the definition
sentence that opens Chapter 2 on capture 26, the specimens in Chapter 1's body on capture 9,
the seam at 370/371. Editing an anchor to silence a `MISS` replaces a confirmed reading with
a guess, and the guess is invisible afterwards. When an anchor misses, the folder is what
changed; open the page it names and find out which position it moved to.

An `ok` means only that the position exists in the index. It does **not** re-verify the
page's content — the script never reads an image. If you have reordered or re-shot pages,
open positions 370, 371, and 461 yourself and confirm they still show the seam and chapter
12 before trusting the rest.

---

## 6. Verifying the result by hand

```bash
node scripts/preview-db.cjs
```

or, against the sqlite file directly:

```sql
SELECT book_slug, COUNT(*) AS pages, MIN(page_index) AS first, MAX(page_index) AS last
  FROM book_page_refs GROUP BY book_slug;
```

Expected after a 645-capture run:

| book_slug | pages | first | last |
| --- | --- | --- | --- |
| `classical_english_rhetoric` | 371 | 0 | 370 |
| `classical_english_argument` | 274 | 371 | 644 |

```sql
-- Every anchor resolves. Expected: 0 rows.
SELECT a.book_slug, a.label, a.page_index FROM book_chapter_anchors a
 WHERE NOT EXISTS (SELECT 1 FROM book_page_refs p
   WHERE p.book_slug = a.book_slug AND p.page_index = a.page_index);
```

---

## 7. Rollback

The index holds no personal record — only which book, which position, and a file name — so
it can be rebuilt from the folder at any time.

```sql
DELETE FROM book_page_refs;
```

Then re-run section 4. `book_chapter_anchors` is seeded by migration 0025 and is not touched
by this script, so it survives the delete and does not need re-seeding.

If a single book is wrong, scope the delete rather than clearing both:

```sql
DELETE FROM book_page_refs WHERE book_slug = 'classical_english_argument';
```

---

## 8. What this task does not do

- It does not transcribe, OCR, summarise, or store any page text. The application's figure
  records (migration 0026) are written from standard classical-rhetoric reference knowledge;
  the books supply the syllabus and the page index, never the prose.
- It does not touch production. There is no production page index and there should not be
  one — the captures are local and personal.
- It does not create the chapter anchors. Those were confirmed by reading pages and live in
  migration 0025. Only the commander can add another one, and only after reading the page.
