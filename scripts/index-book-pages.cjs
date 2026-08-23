// Book 11.8 — populate book_page_refs from the operator's OWN page captures.
//
// The application references his copies; it does not absorb them. This script therefore
// writes only three things per page: which book, the 0-based position in his capture
// sequence, and the file name on his own machine. No page content is read, no image is
// copied, nothing is uploaded, and the file names live only in his local database —
// they are never committed, because the captures are his personal property.
//
// LOCAL ONLY. It writes into the sqlite file `wrangler pages dev` binds as DB, using the
// same discovery as scripts/preview-db.cjs. It has no path to production and never
// should: production D1 is operator-controlled.
//
// Usage:
//   node scripts/index-book-pages.cjs --dir "C:\captures" --dry-run
//   node scripts/index-book-pages.cjs --dir "C:\captures" --expect 645 --commit
//
// Why --expect is mandatory for --commit: every chapter anchor in migration 0025 is a
// POSITION in this sequence. If the folder gains or loses a file, every anchor after it
// silently points at a different page. Stating the count you expect turns that into a
// refusal instead of a wrong answer.
const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const ROOT = process.cwd()
const D1DIR = path.join(ROOT, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject')
const IMAGE = /\.(png|jpe?g|webp|heic|tiff?)$/i

// The seam: everything before it is the rhetoric book, everything from it on is the
// argument book. Migration 0025 confirmed both sides by reading the pages — capture 370
// is the last rhetoric page and 371 is the argument contents page.
const SEAM_INDEX = 371
const BOOK_BEFORE_SEAM = 'classical_english_rhetoric'
const BOOK_FROM_SEAM = 'classical_english_argument'

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  if (i === -1) return fallback === undefined ? null : fallback
  const value = process.argv[i + 1]
  return value && !value.startsWith('--') ? value : true
}

function findServerDb() {
  if (!fs.existsSync(D1DIR)) return null
  const files = fs.readdirSync(D1DIR)
    .filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite')
    .map((f) => ({ f, m: fs.statSync(path.join(D1DIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
  return files.length ? path.join(D1DIR, files[0].f) : null
}

/**
 * The capture ORDER is the whole point, and it has to be the order he actually shot the
 * pages in. Windows screenshot names carry a sortable timestamp, so that decides when
 * every file has one; otherwise the file's own mtime decides, and the fallback is
 * announced rather than assumed.
 */
function orderedCaptures(dir) {
  const entries = fs.readdirSync(dir)
    .filter((f) => IMAGE.test(f))
    .map((f) => {
      const stamp = f.match(/(\d{4})-(\d{2})-(\d{2})[ _-]+(\d{2})(\d{2})(\d{2})/)
      return {
        file: f,
        stamped: stamp ? stamp.slice(1).join('') : null,
        mtime: fs.statSync(path.join(dir, f)).mtimeMs,
      }
    })
  const allStamped = entries.length > 0 && entries.every((e) => e.stamped)
  const sorted = allStamped
    ? entries.slice().sort((a, b) => (a.stamped < b.stamped ? -1 : a.stamped > b.stamped ? 1 : 0))
    : entries.slice().sort((a, b) => a.mtime - b.mtime)
  return { captures: sorted, orderedBy: allStamped ? 'filename timestamp' : 'file mtime' }
}

const dir = arg('--dir')
if (!dir || dir === true) {
  console.error('  --dir is required: the folder holding his own page captures.')
  process.exit(2)
}
if (!fs.existsSync(dir)) {
  console.error('  no such folder: ' + dir)
  process.exit(2)
}

const commit = process.argv.includes('--commit')
const expect = arg('--expect')
const ordered = orderedCaptures(dir)
const captures = ordered.captures

console.log('')
console.log('  captures found     : ' + captures.length)
console.log('  ordered by         : ' + ordered.orderedBy)
console.log('  seam at index      : ' + SEAM_INDEX
  + '  (' + BOOK_BEFORE_SEAM + ' -> ' + BOOK_FROM_SEAM + ')')

if (!captures.length) {
  console.error('  nothing to index.')
  process.exit(1)
}

if (commit && !expect) {
  console.error('')
  console.error('  --commit requires --expect <count>. Every chapter anchor in migration 0025 is')
  console.error('  a position in this sequence, so a changed count silently re-points all of')
  console.error('  them. State the count you expect and let a mismatch be a refusal.')
  process.exit(2)
}
if (expect && Number(expect) !== captures.length) {
  console.error('')
  console.error('  REFUSED: expected ' + expect + ' captures, found ' + captures.length + '.')
  console.error('  Nothing was written. Either the folder changed or the expectation is stale.')
  console.error('  Confirm which before re-running: the page indexes depend on it.')
  process.exit(1)
}

const rows = captures.map(function (c, index) {
  return {
    book_slug: index < SEAM_INDEX ? BOOK_BEFORE_SEAM : BOOK_FROM_SEAM,
    page_index: index,
    file_name: c.file,
  }
})

const byBook = {}
for (const r of rows) byBook[r.book_slug] = (byBook[r.book_slug] || 0) + 1
console.log('  pages per book     : ' + JSON.stringify(byBook))

if (!commit) {
  console.log('')
  console.log('  DRY RUN. Nothing written. The first and last three positions:')
  for (const r of rows.slice(0, 3).concat(rows.slice(-3))) {
    console.log('    ' + String(r.page_index).padStart(4) + '  ' + r.book_slug)
  }
  console.log('')
  console.log('  Re-run with --expect ' + rows.length + ' --commit to write them.')
  process.exit(0)
}

const DBFILE = findServerDb()
if (!DBFILE) {
  console.error('  server db not found. Start `wrangler pages dev` once, hit a route that')
  console.error('  touches D1, then re-run.')
  process.exit(1)
}
console.log('  target db          : ' + path.basename(DBFILE))

const db = new DatabaseSync(DBFILE)
db.exec('PRAGMA journal_mode=WAL')
db.exec('PRAGMA foreign_keys=ON')

// UNIQUE(book_slug, page_index) makes this idempotent: re-running updates the file name
// at a position rather than duplicating the position.
const insert = db.prepare(
  'INSERT INTO book_page_refs (book_slug, page_index, file_name, captured_at)'
  + " VALUES (?, ?, ?, date('now'))"
  + ' ON CONFLICT(book_slug, page_index) DO UPDATE SET file_name = excluded.file_name',
)
let written = 0
for (const r of rows) {
  insert.run(r.book_slug, r.page_index, r.file_name)
  written++
}

// Every confirmed anchor must land on a real page, or it is pointing at nothing.
const anchors = db.prepare(
  'SELECT a.book_slug, a.label, a.page_index,'
  + '   (SELECT COUNT(*) FROM book_page_refs p'
  + '     WHERE p.book_slug = a.book_slug AND p.page_index = a.page_index) AS resolved'
  + ' FROM book_chapter_anchors a ORDER BY a.page_index',
).all()

db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
const total = db.prepare('SELECT COUNT(*) AS n FROM book_page_refs').get().n
db.close()

console.log('')
console.log('  rows written       : ' + written)
console.log('  book_page_refs     : ' + total)
console.log('')
console.log('  anchor resolution:')
let unresolved = 0
for (const a of anchors) {
  if (!a.resolved) unresolved++
  console.log('    ' + (a.resolved ? 'ok  ' : 'MISS') + ' '
    + String(a.page_index).padStart(4) + '  ' + a.book_slug + '  ' + a.label)
}
if (unresolved) {
  console.log('')
  console.log('  ' + unresolved + ' anchor(s) point at a position this folder does not contain.')
  console.log('  That is a real disagreement between the anchors and the captures, not a')
  console.log('  formatting problem. Do not adjust the anchors to make it go away: each one')
  console.log('  was confirmed by reading the page.')
  process.exit(1)
}
console.log('')
console.log('  Every confirmed anchor resolves. The file names stay in this local database')
console.log('  only, and are never committed.')
