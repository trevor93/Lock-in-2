import { describe, expect, it } from 'vitest'
import curriculumDoc from '../CURRICULUM_GUIDE.md?raw'
import booksSrc from '../src/books.ts?raw'
import masterySrc from '../src/mastery.ts?raw'
import domainsSrc from '../src/intel-domains.ts?raw'
import readingSrc from '../src/reading.ts?raw'
import rhetoricSrc from '../src/rhetoric.ts?raw'
import shellSrc from '../public/static/app/core/shell.js?raw'
import bundleSrc from '../public/static/bundle.js?raw'
import learnRouteSrc from '../src/routes/learn.ts?raw'
import tongueRouteSrc from '../src/routes/tongue.ts?raw'
import intelLibrarySrc from '../src/routes/intel-library.ts?raw'
import commandersFileSrc from '../src/commanders-file.ts?raw'

// Book 17 Definition of Done, Documentation (MASTERPROMPT.md): "Add ... CURRICULUM_GUIDE.md ...
// Make no claim that is not technically guaranteed."
//
// A curriculum guide is the document most likely to describe a syllabus instead of a program.
// Books 9, 10 and 11 of the master prompt are a specification; this repository is a partial
// implementation of it; and the honest guide is the one that says which is which, per clause,
// without flattering either. So this file derives every count, every list and every named
// constant from source, and — the part that matters — it asserts the ABSENCES too.
//
// An absence is the hardest claim to keep true. A count goes stale loudly: someone adds a
// migration and the number is wrong. An absence goes stale silently in the good direction:
// someone implements the thing, the document keeps calling it missing, and a reader plans
// around a gap that closed. Six of the seven findings recorded in this document are absences.
// Each one is derived from the same grep that found it, so implementing it fails this file and
// forces the document to stop saying it is missing.
//
// Derived here, and compared in BOTH directions wherever it is a set:
//   - the book corpus, from `src/books.ts` against the shipped JSON in `public/static/books/`
//   - the mastery ladder, rubric and thresholds, from `src/mastery.ts`
//   - the six intel domains, from `src/intel-domains.ts`
//   - the five tabs and their segments, from `public/static/app/core/shell.js`
//   - the whole Farnsworth constant set, from `src/rhetoric.ts`
//   - every seeded row count, from a quote-aware replay of `migrations/*.sql`
//   - client reach, from `/api/*` registrations in `src/routes/` against `bundle.js`

// ---------------------------------------------------------------------------- derivations

const MIGRATION_SOURCES = import.meta.glob('../migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const ROUTE_SOURCES = import.meta.glob('../src/routes/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const BOOK_JSON = import.meta.glob('../public/static/books/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const CLIENT_MODULES = import.meta.glob('../public/static/app/**/*.js', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const SRC_MODULES = import.meta.glob('../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const norm = (p: string) => p.replace(/^\.\.\//, '')

/** Prose, as a reader takes it: one line. Markdown here is hand-wrapped, so a sentence a
 *  reader sees whole is split by a newline in the file. Matching the raw text would fail a
 *  true document, and would let re-wrapping a paragraph change whether a claim is present. */
const flat = (text: string) => text.replace(/\s+/g, ' ')

const DOC = flat(curriculumDoc)

/** `## N. Title` … up to the next heading of equal-or-shallower depth. Same convention the
 *  other four guarded documents use, so a claim can be anchored to the section that makes it
 *  rather than to the document as a whole — the defect that survived three mutation runs. */
function docSection(heading: string): string {
  const at = curriculumDoc.indexOf(heading)
  if (at === -1) return ''
  const depth = (heading.match(/^#+/) ?? ['##'])[0].length
  const rest = curriculumDoc.slice(at + heading.length)
  const next = rest.search(new RegExp(`\\n#{2,${depth}} `))
  return flat(next === -1 ? rest : rest.slice(0, next))
}

/** Comment-stripping that respects single-quoted strings, so a `--` inside seeded prose does
 *  not truncate the statement around it, and a `-- ROLLBACK` note is never replayed as DDL. */
function stripComments(sql: string): string {
  return sql.split('\n').map((line) => {
    let inString = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === "'") {
        if (inString && line[i + 1] === "'") { i++; continue }
        inString = !inString
        continue
      }
      if (!inString && ch === '-' && line[i + 1] === '-') return line.slice(0, i)
    }
    return line
  }).join('\n')
}

const MIGRATIONS_SQL = Object.fromEntries(
  Object.entries(MIGRATION_SOURCES).map(([p, s]) => [norm(p), stripComments(s)]),
)

/** Top-level `(...)` tuples following one `INSERT INTO t (...) VALUES`, quote-aware. A naive
 *  count of `(` reports every parenthesis inside seeded prose as another seeded row. */
function tupleCount(sql: string, from: number): number {
  let count = 0
  let depth = 0
  let inString = false
  for (let i = from; i < sql.length; i++) {
    const ch = sql[i]
    if (inString) {
      if (ch === "'") {
        if (sql[i + 1] === "'") { i++; continue }
        inString = false
      }
      continue
    }
    if (ch === "'") { inString = true; continue }
    if (ch === '(') { if (depth === 0) count++; depth++; continue }
    if (ch === ')') { depth--; continue }
    if (ch === ';' && depth === 0) break
  }
  return count
}

/** The top-level tuples following one `INSERT … VALUES`, each split into its columns, quote-
 *  aware at every level. A regex over the whole file cannot do this job: `'contradicts'` also
 *  appears in the `CHECK (kind IN (...))` that declares the vocabulary, so counting it across
 *  `ALL_SQL` reports one more contradiction edge than is seeded; and a tuple shape borrowed
 *  from the specimens seed (`'slug', <tier>, '…'`) also matches rows in three other tables,
 *  which reported Tier 1 specimens that do not exist. Both mistakes flatter the document.
 *
 *  A bounded `[\s\S]{0,N}` window is the other way to get this wrong: the figures seed spans
 *  three statements and 458 lines, so a window truncates it — and a truncated set is a shorter
 *  list the document is measured against, which passes. */
function tupleColumns(sql: string, from: number): string[][] {
  const rows: string[][] = []
  let depth = 0
  let inString = false
  let cols: string[] = []
  let buf = ''
  for (let i = from; i < sql.length; i++) {
    const ch = sql[i]
    if (inString) {
      buf += ch
      if (ch === "'") {
        if (sql[i + 1] === "'") { buf += "'"; i++; continue }
        inString = false
      }
      continue
    }
    if (ch === "'") { inString = true; buf += ch; continue }
    if (ch === '(') {
      depth++
      if (depth === 1) { cols = []; buf = '' } else buf += ch
      continue
    }
    if (ch === ')') {
      depth--
      if (depth === 0) { cols.push(buf.trim()); rows.push(cols); buf = '' } else buf += ch
      continue
    }
    if (ch === ',' && depth === 1) { cols.push(buf.trim()); buf = ''; continue }
    if (depth >= 1) buf += ch
    else if (ch === ';') break
  }
  return rows
}

/** Every tuple seeded into one table, across every migration that seeds it. */
function seededRows(table: string): string[][] {
  const re = new RegExp(`INSERT(?:\\s+OR\\s+\\w+)?\\s+INTO\\s+${table}\\s*\\(([^)]*)\\)\\s*VALUES`, 'gi')
  const rows: string[][] = []
  for (const m of ALL_SQL.matchAll(re)) {
    rows.push(...tupleColumns(ALL_SQL, (m.index ?? 0) + m[0].length))
  }
  return rows
}

/** The column names one `INSERT INTO table (...)` names, so a column can be addressed by name
 *  rather than by a position that a later migration can shift. */
function seededColumns(table: string): string[] {
  const m = new RegExp(`INSERT(?:\\s+OR\\s+\\w+)?\\s+INTO\\s+${table}\\s*\\(([^)]*)\\)\\s*VALUES`, 'i')
    .exec(ALL_SQL)
  return m ? m[1].split(',').map((c) => c.trim()) : []
}

/** One column of every seeded row of a table, addressed by name, quotes stripped. */
function seededColumn(table: string, column: string): string[] {
  const at = seededColumns(table).indexOf(column)
  if (at === -1) throw new Error(`${table} is not seeded with a ${column} column`)
  return seededRows(table).map((cols) => (cols[at] ?? '').replace(/^'|'$/g, ''))
}

/** Seeded rows per table across the whole directory. */
const SEEDED: Record<string, number> = {}
for (const sql of Object.values(MIGRATIONS_SQL)) {
  const re = /INSERT(?:\s+OR\s+\w+)?\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*VALUES/gi
  for (const m of sql.matchAll(re)) {
    SEEDED[m[1]] = (SEEDED[m[1]] ?? 0) + tupleCount(sql, m.index! + m[0].length)
  }
}

/** Every `/api/*` route the server registers, with the module that registers it. */
const ROUTES: Array<{ module: string; verb: string; path: string }> = []
for (const [p, src] of Object.entries(ROUTE_SOURCES)) {
  for (const m of src.matchAll(/app\.(get|post|put|delete|patch)\('(\/api\/[^']*)'/g)) {
    ROUTES.push({ module: norm(p), verb: m[1].toUpperCase(), path: m[2] })
  }
}

/** A route's static path prefix, up to the first `:param`. This is the only honest thing to
 *  search a bundle for: the client never contains `/api/mastery/:kind/:id`, it contains
 *  `'/api/mastery/' + kind`. Matching a bare word instead — "cursor", "tone" — finds unrelated
 *  identifiers and reports a route as reachable when nothing calls it. */
const staticPrefix = (route: string) => {
  const out: string[] = []
  for (const seg of route.split('/')) {
    if (seg.startsWith(':')) break
    out.push(seg)
  }
  return out.join('/')
}

const UNREFERENCED = ROUTES.filter((r) => !bundleSrc.includes(staticPrefix(r.path)))
const AGENT_BRIDGE = UNREFERENCED.filter((r) => r.path.startsWith('/api/agent/'))
const UNREACHABLE = UNREFERENCED.filter((r) => !r.path.startsWith('/api/agent/'))

/** A `const NAME = <number>` in a source file. */
function numConst(src: string, name: string): number {
  const m = new RegExp(`${name}\\s*=\\s*(-?[0-9]+(?:\\.[0-9]+)?)`).exec(src)
  if (!m) throw new Error(`constant ${name} is gone from source`)
  return Number(m[1])
}

/** A `const NAME = [ 'a', 'b' ] as const` string array. */
function strList(src: string, name: string): string[] {
  const m = new RegExp(`${name}[^=]*=\\s*\\[([^\\]]*)\\]`).exec(src)
  if (!m) throw new Error(`list ${name} is gone from source`)
  const out = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  if (out.length === 0) throw new Error(`list ${name} parsed to nothing`)
  return out
}

/** `slug: 'x'` inside the array literal assigned to NAME. The opening bracket is found after
 *  the `=`, not after the name: `readonly ChapterSlot[] = [` puts an empty `[]` in the type
 *  annotation first, and taking that one yields an empty slice — a list of no slugs, which
 *  every `for … of` below then passes over without asserting anything. */
function slugsOf(src: string, name: string): string[] {
  const at = src.indexOf(name)
  if (at === -1) throw new Error(`block ${name} is gone from source`)
  const eq = src.indexOf('=', at)
  const open = src.indexOf('[', eq)
  if (eq === -1 || open === -1) throw new Error(`block ${name} is not an array literal`)
  let depth = 0
  let end = open
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++
    else if (src[i] === ']') { depth--; if (depth === 0) { end = i; break } }
  }
  const slugs = [...src.slice(open, end).matchAll(/slug:\s*'([^']+)'/g)].map((m) => m[1])
  if (slugs.length === 0) throw new Error(`block ${name} parsed to no slugs`)
  return slugs
}

const LEVELS = strList(masterySrc, 'export const LEVELS')
const RUBRIC = strList(masterySrc, 'export const RUBRIC_DIMENSIONS')
const DOMAINS = strList(domainsSrc, 'export const DOMAINS')
const LEGACY_DOMAINS = strList(domainsSrc, 'export const LEGACY_DOMAINS')
const CHAPTER_SLOTS = slugsOf(rhetoricSrc, 'export const CHAPTER_SLOTS')
const TRACK_METRICS = slugsOf(rhetoricSrc, 'export const TRACK_METRICS')
const CYCLE_DAYS = slugsOf(rhetoricSrc, 'export const CYCLE_DAYS')
const CARD_TYPES = slugsOf(rhetoricSrc, 'export const CARD_TYPES')
const LADDER_DAYS = [...(/export const LADDER = \[([^\]]*)\]/.exec(rhetoricSrc)?.[1] ?? '')
  .matchAll(/\d+/g)].map((m) => Number(m[0]))
const RELISTEN_DAYS = [...(/RELISTEN_DAYS = \[([^\]]*)\]/.exec(rhetoricSrc)?.[1] ?? '')
  .matchAll(/\d+/g)].map((m) => Number(m[0]))

/** The declared chapter denominators, and the chapter arrays actually shipped. */
const DECLARED_CHAPTERS: Record<string, number> = Object.fromEntries(
  [...(/BOOK_CHAPTER_COUNTS[^=]*=\s*\{([\s\S]*?)\n\}/.exec(booksSrc)?.[1] ?? '')
    .matchAll(/(\w+)\s*:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]),
)
const SHIPPED_CHAPTERS: Record<string, number> = {}
for (const raw of Object.values(BOOK_JSON)) {
  const parsed = JSON.parse(raw) as { id: string; chapters: unknown[] }
  SHIPPED_CHAPTERS[parsed.id] = parsed.chapters.length
}

const ALL_SRC = Object.values(SRC_MODULES).join('\n')
const ALL_SQL = Object.values(MIGRATIONS_SQL).join('\n')
const SELF = (import.meta.url.split('?')[0].split('/').pop() ?? '')

// ------------------------------------------------------------------ Book 9: the interface

describe('CURRICULUM_GUIDE.md describes the surfaces the curriculum is delivered through', () => {
  it('names the five tabs and every face each one merges', () => {
    const block = shellSrc.slice(shellSrc.indexOf('const tabs = ['), shellSrc.indexOf('const markup'))
    const tabs = [...block.matchAll(/\['([a-z]+)','fa-[a-z-]+','([A-Z]+)'\]/g)].map((m) => m[2])
    // A vacuity floor. With an empty list every loop below passes while proving nothing, and
    // the document's central claim — that nine tabs collapsed to five — goes unchecked.
    expect(tabs.length, 'the tab block in shell.js parsed to nothing, so the five-tab claim is '
      + 'asserted about an empty list').toBe(5)
    for (const tab of tabs) {
      expect(DOC, `CURRICULUM_GUIDE.md does not name the ${tab} tab`).toContain(tab)
    }
    const segBlock = shellSrc.slice(
      shellSrc.indexOf('export const SEGMENTS'), shellSrc.indexOf('export function segments'),
    )
    const segments = [...segBlock.matchAll(/\['([a-z]+)','([A-Z ]+)'\]/g)].map((m) => m[2])
    expect(segments.length, 'the SEGMENTS block parsed to nothing, so no sub-view is checked')
      .toBeGreaterThanOrEqual(13)
    const section = docSection('## 2.')
    expect(section.length, 'CURRICULUM_GUIDE.md has no §2, so the tab surfaces are undescribed')
      .toBeGreaterThan(200)
    expect(
      segments.filter((label) => !section.includes(label)),
      'these shipped sub-views are not named in §2, so a reader cannot find where a subject is '
      + 'taught',
    ).toEqual([])
  })

  it('records that Book 9\'s eleven non-rhetoric lesson slots do not exist in code', () => {
    // Derived from the same grep that found it, so IMPLEMENTING the eleven slots fails here and
    // forces the document to stop calling them absent. An absence recorded by hand is the one
    // claim that goes stale silently and in the flattering direction.
    const NAMED_IN_SPEC = [
      'historical_context', 'causal_mechanism', 'naive_misuse', 'defensible_application',
    ]
    const present = NAMED_IN_SPEC.filter((slot) => ALL_SRC.includes(slot))
    const hasRenderer = /LESSON_SLOTS|lessonSlots?\b/.test(ALL_SRC)
    const section = docSection('## 3.')
    expect(section.length, 'CURRICULUM_GUIDE.md has no §3, so the eleven-slot gap is unrecorded')
      .toBeGreaterThan(200)
    if (present.length === 0 && !hasRenderer) {
      expect(
        section,
        '§3 no longer says the eleven-slot lesson format is unimplemented, and no source file '
        + 'implements it — the gap is real and the document has stopped recording it',
      ).toMatch(/not implemented|does not exist|no renderer|unimplemented/i)
      // And the document must not present the gap as harmless: the thirteen-slot rhetoric
      // format DOES exist, and a reader who sees only that concludes the format shipped.
      expect(
        section,
        '§3 does not distinguish the eleven-slot non-rhetoric format (absent) from the '
        + 'thirteen-slot rhetoric format (present), which is the confusion the gap invites',
      ).toMatch(/thirteen/i)
    } else {
      expect(
        section,
        `the eleven-slot lesson format now exists in source (${present.join(', ') || 'a renderer'}), `
        + 'and §3 still describes it as missing',
      ).not.toMatch(/not implemented|does not exist|no renderer|unimplemented/i)
    }
  })

  it('states the six intel domains and that every legacy value maps onto one', () => {
    expect(DOMAINS.length, 'DOMAINS parsed to nothing').toBe(6)
    expect(LEGACY_DOMAINS.length, 'LEGACY_DOMAINS parsed to nothing').toBeGreaterThanOrEqual(16)
    for (const d of DOMAINS) {
      expect(DOC, `CURRICULUM_GUIDE.md does not name the ${d} domain`).toContain(d)
    }
    const section = docSection('## 2.')
    // The count is stated, and it is the derived one. Book 9 says "sixteen collapse to six";
    // the code carries seventeen legacy values because `other` is one of them. Rounding that
    // to sixteen in the document would make the guide agree with the spec and disagree with
    // the software, which is the wrong side to be on.
    expect(
      section,
      `§2 does not state that ${LEGACY_DOMAINS.length} legacy domain values map onto the six`,
    ).toContain(String(LEGACY_DOMAINS.length))
  })
})

// -------------------------------------------------------------- Book 10: the learning engine

describe('CURRICULUM_GUIDE.md describes the learning engine that exists', () => {
  it('states the measured-reading thresholds, and they are the ones in source', () => {
    const wpm = numConst(readingSrc, 'MAX_PLAUSIBLE_WPM')
    const dwell = numConst(readingSrc, 'MIN_DWELL_SECONDS')
    const scroll = numConst(readingSrc, 'MIN_SCROLL_PCT')
    const section = docSection('## 4.')
    expect(section.length, 'CURRICULUM_GUIDE.md has no §4, so measured reading is undescribed')
      .toBeGreaterThan(200)
    for (const [label, value] of [['words per minute', wpm], ['dwell seconds', dwell],
      ['scroll percent', scroll]] as const) {
      expect(section, `§4 does not state the ${label} threshold (${value})`)
        .toContain(String(value))
    }
    // The thing a reader of a curriculum guide would otherwise assume: that slow reading is
    // penalised. It is not, and the source says why.
    expect(
      section,
      '§4 does not say that unusually slow reading passes — the asymmetry is the design, and a '
      + 'reader who assumes symmetry will think a paused tab costs him the unit',
    ).toMatch(/slow/i)
  })

  it('states the six ladder levels and the nine rubric dimensions, in both directions', () => {
    expect(LEVELS.length, 'LEVELS parsed to nothing, so the ladder is asserted about an empty '
      + 'list').toBe(6)
    expect(RUBRIC.length, 'RUBRIC_DIMENSIONS parsed to nothing').toBe(9)
    const section = docSection('## 5.')
    expect(section.length, 'CURRICULUM_GUIDE.md has no §5, so the ladder is undescribed')
      .toBeGreaterThan(400)
    for (const level of LEVELS) {
      expect(section, `§5 does not name the "${level}" level`).toContain(level)
    }
    for (const dim of RUBRIC) {
      expect(section, `§5 does not name the "${dim}" rubric dimension`).toContain(dim)
    }
    // Reverse: a level named in the document that the code does not have is a rung a reader
    // will look for and not find.
    const claimed = [...section.matchAll(/\*\*`([a-z_]+)`\*\*/g)].map((m) => m[1])
    expect(
      claimed.filter((c) => !LEVELS.includes(c) && !RUBRIC.includes(c)),
      '§5 names these levels or dimensions in bold code and src/mastery.ts has neither',
    ).toEqual([])
    expect(section, `§5 does not state the integrated threshold `
      + `(${numConst(masterySrc, 'INTEGRATED_MIN_MEAN')})`)
      .toContain(String(numConst(masterySrc, 'INTEGRATED_MIN_MEAN')))
    expect(section, '§5 does not state the explanation word band')
      .toContain(String(numConst(masterySrc, 'EXPLANATION_MIN_WORDS')))
    expect(section, '§5 does not state the explanation word band')
      .toContain(String(numConst(masterySrc, 'EXPLANATION_MAX_WORDS')))
    // 10.2's hardest line, and the one an implementation quietly breaks: self-scoring is
    // never a gate. Derived, not promised — `admitEvidence` must not read `self_score`.
    const admit = masterySrc.slice(masterySrc.indexOf('export function admitEvidence'))
    const body = admit.slice(0, admit.indexOf('\n}\n') + 1)
    expect(body.length, 'admitEvidence is gone from src/mastery.ts').toBeGreaterThan(100)
    expect(
      /self_score|selfScore/.test(body),
      'admitEvidence now reads the self-score, so §5\'s claim that self-scoring is never a gate '
      + 'is false in the one function that decides',
    ).toBe(false)
    expect(section, '§5 does not state that self-scoring is never a gate')
      .toMatch(/self-scoring is never a gate|self-score(?:s|d)? (?:is|are) never/i)
  })

  it('states that the second Brier score exists and costs nothing', () => {
    const section = docSection('## 6.')
    expect(section.length, 'CURRICULUM_GUIDE.md has no §6, so calibration is undescribed')
      .toBeGreaterThan(200)
    expect(section, '§6 does not name the Brier score').toMatch(/Brier/)
    // Book 10.3: "never as a penalty." A curriculum guide that leaves this out invites the
    // reader to under-report confidence, which destroys the measurement it is taken for.
    expect(
      section,
      '§6 does not say that calibration never costs points, which is the fact that makes honest '
      + 'confidence reporting safe',
    ).toMatch(/never (?:costs|a penalt)|no penalt|not a penalt/i)
  })

  it('states the split scheduler exactly as it is, not as the spec wants it', () => {
    // Finding 7, and the only finding here about a claim the software already prints. R11 says
    // FSRS governs the general queue. `src/routes/tongue.ts` calls fsrsReview; `src/routes/
    // learn.ts` still runs SM-2 over flashcards.interval_days/ease. Derived from the imports,
    // so wiring learn.ts to FSRS fails this and forces the document to stop reporting a split.
    const learnUsesFsrs = /fsrsReview/.test(learnRouteSrc)
    const tongueUsesFsrs = /fsrsReview/.test(tongueRouteSrc)
    const learnUsesSm2 = /interval_days\s*=|ease\s*=\s*Math\.max/.test(learnRouteSrc)
    // One pattern, asserted positively while the split exists and negatively once it is gone.
    // Two patterns is the stale-in-the-flattering-direction bug: `/SM-2/` to require the claim
    // and `/still SM-2|remains SM-2/` to forbid it means wiring learn.ts to FSRS leaves every
    // sentence naming SM-2 standing, and the document keeps reporting a split that was fixed.
    const SPLIT_CLAIM = /SM-2/
    expect(tongueUsesFsrs, 'src/routes/tongue.ts no longer calls fsrsReview, so the half of the '
      + 'scheduler this section calls FSRS is gone').toBe(true)
    const section = docSection('## 7.')
    expect(section.length, 'CURRICULUM_GUIDE.md has no §7, so spaced return is undescribed')
      .toBeGreaterThan(300)
    expect(section, '§7 does not name R0, and Book 10.4 says no lesson closes without it')
      .toMatch(/\bR0\b/)
    for (const day of LADDER_DAYS) {
      expect(section, `§7 does not state the ${day}-day rung of the Farnsworth ladder`)
        .toContain(String(day))
    }
    if (!learnUsesFsrs && learnUsesSm2) {
      expect(
        section,
        '§7 does not record that the maxim queue is still SM-2 while the response queue is FSRS '
        + '— the discrepancy R11 requires to be logged rather than smoothed over',
      ).toMatch(SPLIT_CLAIM)
      expect(
        section,
        '§7 names SM-2 but not the file that runs it, so a reader cannot check the claim',
      ).toContain('src/routes/learn.ts')
      // And the emitted claim that is ahead of the code. src/commanders-file.ts prints
      // "FSRS general queue"; for the maxim queue that is not yet true.
      expect(
        /FSRS general queue/.test(commandersFileSrc),
        'src/commanders-file.ts no longer prints "FSRS general queue", so §7 is describing an '
        + 'emitted claim that is gone',
      ).toBe(true)
      expect(
        section,
        '§7 does not record that the Commander\'s File prints "FSRS general queue" while half '
        + 'the queue is SM-2',
      ).toMatch(/commanders-file|Commander's File/i)
    } else {
      expect(
        section,
        'src/routes/learn.ts now schedules with FSRS, and §7 still reports the queue as split',
      ).not.toMatch(SPLIT_CLAIM)
    }
  })

  it('states the book corpus, derived, and never a denominator the shipped JSON contradicts', () => {
    const ids = Object.keys(SHIPPED_CHAPTERS)
    expect(ids.length, 'no book JSON was found, so every corpus claim below is asserted about '
      + 'nothing').toBeGreaterThanOrEqual(11)
    const section = docSection('## 8.')
    expect(section.length, 'CURRICULUM_GUIDE.md has no §8, so the corpus is undescribed')
      .toBeGreaterThan(400)
    // The declared denominators and the shipped chapter arrays must agree, and the document
    // must state the agreed number. `src/books.ts` carries a post-mortem about a `HAVING c >= 12`
    // that reported books complete because the denominator was wrong; the check that prevents
    // its return is this one, not a comment.
    expect(
      Object.keys(DECLARED_CHAPTERS)
        .filter((id) => DECLARED_CHAPTERS[id] !== SHIPPED_CHAPTERS[id]),
      'BOOK_CHAPTER_COUNTS disagrees with the shipped JSON for these books, so completion is '
      + 'measured against a denominator that does not exist',
    ).toEqual([])
    for (const id of ids) {
      expect(section, `§8 does not name the book "${id}"`).toContain(id)
      expect(section, `§8 does not state ${id}'s chapter count (${SHIPPED_CHAPTERS[id]})`)
        .toContain(String(SHIPPED_CHAPTERS[id]))
    }
    // Reverse: a book named in §8 that is not shipped is a reading assignment nobody can open.
    const named = [...section.matchAll(/`([a-z_]+\.json)`/g)].map((m) => m[1].replace('.json', ''))
    expect(
      [...new Set(named)].filter((id) => !(id in SHIPPED_CHAPTERS)),
      '§8 names these book files and public/static/books/ has no such JSON',
    ).toEqual([])
  })

  it('records that the eleven shipped works have no provenance row, and no mojibake sweep exists', () => {
    // Two absences from Book 10.5, both derived. `sources` is seeded with the two Farnsworth
    // bibliographic records only; `source_editions`, `source_sections` and `section_variants`
    // are written by nothing at all, while src/routes/mastery.ts SELECTs from source_sections.
    const NEVER_WRITTEN = ['source_editions', 'source_sections', 'section_variants']
    const writers = NEVER_WRITTEN.filter((t) => new RegExp(`INSERT[^;]*INTO\\s+${t}\\b`, 'i')
      .test(`${ALL_SQL}\n${ALL_SRC}`))
    const section = docSection('## 9.')
    expect(section.length, 'CURRICULUM_GUIDE.md has no §9, so source metadata is undescribed')
      .toBeGreaterThan(300)
    expect(SEEDED.sources, 'no `sources` rows are seeded at all, so §9 describes a table that '
      + 'is empty for a different reason than it says').toBeGreaterThan(0)
    if (writers.length === 0) {
      for (const t of NEVER_WRITTEN) {
        expect(section, `§9 does not name \`${t}\`, which nothing writes`).toContain(t)
      }
      expect(
        section,
        '§9 does not state that the provenance tables are never written, which is the fact that '
        + 'makes Book 10.5 unmet rather than partially met',
      ).toMatch(/never written|no row is ever written|nothing writes/i)
      // The consequence, which is the part a reader acts on: cloze generation reads a table
      // with no rows, so the cheap half of adversarial grading cannot run on shipped text.
      expect(
        /FROM source_sections/.test(ALL_SRC),
        'nothing reads source_sections any more, so §9 is warning about a consequence that is gone',
      ).toBe(true)
      expect(section, '§9 does not state that cloze generation reads source_sections and '
        + 'therefore has nothing to read').toMatch(/cloze/i)
    } else {
      expect(
        section,
        `these provenance tables are now written (${writers.join(', ')}), and §9 still says nothing `
        + 'writes them',
      ).not.toMatch(/never written|no row is ever written|nothing writes/i)
    }
    // The mojibake sweep. Book 10.5 orders a sweep; the shipped text happens to be clean, and
    // a fact is not a guarantee. The document must say which of the two it has.
    const hasSweep = /mojibake|virtÃ|Unicode corruption/i.test(ALL_SRC)
    if (!hasSweep) {
      expect(
        section,
        '§9 does not record that no Unicode-corruption sweep exists in source — Book 10.5 orders '
        + 'one, the text is currently clean by luck rather than by check',
      ).toMatch(/no sweep|sweep does not exist|unswept|no automated sweep/i)
    }
  })

  it('states the Sun Tzu chapter model, the struck framing, and the immune columns', () => {
    const section = docSection('## 10.')
    expect(section.length, 'CURRICULUM_GUIDE.md has no §10, so the Sun Tzu model is undescribed')
      .toBeGreaterThan(400)
    // The five factors, from the `slug` column of the seeded concepts rather than from the
    // prose — and rather than from a grep for `'sunzi_%'`, which also matches every reference
    // to a concept from the graph seed and the component seed.
    const factors = [...new Set(seededColumn('concepts', 'slug'))]
    expect(factors.length, 'no concept slug is seeded, so §10 is asserted about nothing')
      .toBe(SEEDED.concepts)
    for (const slug of factors) {
      expect(section, `§10 does not name the seeded concept \`${slug}\``).toContain(slug)
    }
    // 將 is the one concept scored on the lowest of its components, and the components are
    // seeded rather than described. Five of them, all on `sunzi_jiang`.
    const components = seededRows('concept_components')
    expect(components.length, 'no 將 component is seeded, so "the lowest of five" is asserted '
      + 'about nothing').toBe(SEEDED.concept_components)
    expect(section, `§10 does not state how many components 將 is scored across `
      + `(${components.length})`).toContain(String(components.length))
    // 將 is scored on the lowest of five, and the outward redefinition is struck. Both are in
    // src/principles.ts as code, so the document states what the code enforces.
    expect(section, '§10 does not state that 將 is scored on the lowest of the five components')
      .toMatch(/lowest/i)
    expect(section, '§10 does not record that the outward 將 framing is struck')
      .toMatch(/struck/i)
    const immuneCols = ['naive_reading', 'master_reading', 'detection_tells', 'inversion_trap',
      'less_obvious_application', 'stop_test', 'cost_of_naive']
    const declared = immuneCols.filter((c) => new RegExp(`\\b${c}\\b`).test(ALL_SQL))
    expect(declared.length, 'the immune-table columns are gone from migrations/, so §10 describes '
      + 'a schema that does not exist').toBe(immuneCols.length)
    for (const col of immuneCols) {
      expect(section, `§10 does not name the immune-table column \`${col}\``).toContain(col)
    }
    expect(section, `§10 does not state how many principle rows are seeded `
      + `(${SEEDED.principles})`).toContain(String(SEEDED.principles))
  })

  it('states the principle graph, derived from the seeded nodes and edges', () => {
    const section = docSection('## 11.')
    expect(section.length, 'CURRICULUM_GUIDE.md has no §11, so the graph is undescribed')
      .toBeGreaterThan(300)
    expect(SEEDED.graph_nodes, 'no graph nodes are seeded').toBeGreaterThan(20)
    expect(SEEDED.graph_edges, 'no graph edges are seeded').toBeGreaterThan(10)
    expect(section, `§11 does not state the seeded node count (${SEEDED.graph_nodes})`)
      .toContain(String(SEEDED.graph_nodes))
    expect(section, `§11 does not state the seeded edge count (${SEEDED.graph_edges})`)
      .toContain(String(SEEDED.graph_edges))
    // The contradiction edges are the point of Book 10.10 — "so the interface can show where
    // authors disagree." Their count is derived from the `kind` column of the seeded rows, not
    // from a grep for `'contradicts'` across the SQL: that string also appears in the CHECK
    // that declares the edge vocabulary, which reports one edge more than is seeded.
    const contradicts = seededColumn('graph_edges', 'kind').filter((k) => k === 'contradicts').length
    expect(contradicts, 'no contradiction edge is seeded, so the graph cannot show disagreement')
      .toBeGreaterThan(0)
    expect(section, `§11 does not state how many contradiction edges are seeded (${contradicts})`)
      .toContain(String(contradicts))
    const edgeKinds = [...(/kind\s+TEXT[^,]*CHECK\s*\(\s*kind\s+IN\s*\(([^)]*)\)/i
      .exec(ALL_SQL)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect(edgeKinds.length, 'the graph_edges kind CHECK parsed to nothing, so the edge '
      + 'vocabulary is asserted about an empty list').toBeGreaterThanOrEqual(5)
    for (const kind of edgeKinds) {
      expect(section, `§11 does not name the \`${kind}\` edge kind the schema permits`)
        .toContain(kind)
    }
  })

  it('records Greene as flagged hypotheses only, and the Discourses strike with its exception', () => {
    const section = docSection('## 12.')
    expect(section.length, 'CURRICULUM_GUIDE.md has no §12, so the canon strike is unrecorded')
      .toBeGreaterThan(300)
    expect(SEEDED.hypotheses, 'no hypothesis row is seeded, so §12 describes an empty catalogue')
      .toBeGreaterThan(0)
    expect(section, `§12 does not state how many hypothesis rows are seeded (${SEEDED.hypotheses})`)
      .toContain(String(SEEDED.hypotheses))
    // The two schema-level guarantees behind "may not examine on it": examinable is pinned to
    // 0 and defensive_only to 1 by CHECK, not by convention. Derived, because a document that
    // says "cannot be examined on" and is backed only by prose is a promise.
    expect(
      /examinable\s+INTEGER[^,]*CHECK\s*\(\s*examinable\s*=\s*0\s*\)/i.test(ALL_SQL),
      'the CHECK pinning hypotheses.examinable to 0 is gone, so §12\'s claim that Greene cannot '
      + 'be examined on is no longer enforced by the schema',
    ).toBe(true)
    expect(section, '§12 does not state that the schema pins hypotheses to unexaminable')
      .toMatch(/examinable/)
    // R1 struck Discourses on Livy from the active curriculum. It is still shipped and still
    // readable — and src/routes/intel-library.ts still gives it an active phase code. Derived
    // from that line, so correcting it fails here and the document must stop reporting it.
    const discoursesPhase = /\{\s*id:\s*'discourses'[^}]*phase:\s*'([A-Z0-9]+)'/
      .exec(intelLibrarySrc)?.[1]
    expect(discoursesPhase, 'the discourses row is gone from BOOKS_META, so §12 describes a '
      + 'mismatch that no longer exists').toBeTruthy()
    expect(
      section,
      `§12 does not record that BOOKS_META still assigns discourses the active phase `
      + `${discoursesPhase} although R1 struck it from the active curriculum`,
    ).toContain(String(discoursesPhase))
  })
})

// ------------------------------------------------------ Book 11: the Farnsworth programme

describe('CURRICULUM_GUIDE.md carries the Farnsworth programme as fixed data', () => {
  it('states the syllabus as seeded, in both directions', () => {
    const section = docSection('## 13.')
    expect(section.length, 'CURRICULUM_GUIDE.md has no §13, so the syllabus is undescribed')
      .toBeGreaterThan(400)
    expect(SEEDED.rhetoric_chapters, 'no rhetoric chapter is seeded, so §13 is asserted about '
      + 'an empty syllabus').toBeGreaterThan(0)
    for (const [label, n] of [
      ['chapters', SEEDED.rhetoric_chapters],
      ['phases', SEEDED.rhetoric_phases],
      ['milestones', SEEDED.rhetoric_milestones],
      ['figure records', SEEDED.figures],
      ['specimens', SEEDED.specimens],
      ['book chapter anchors', SEEDED.book_chapter_anchors],
    ] as const) {
      expect(section, `§13 does not state the seeded ${label} count (${n})`).toContain(String(n))
    }
    const first = numConst(rhetoricSrc, 'TRACK_FIRST_DAY')
    const last = numConst(rhetoricSrc, 'TRACK_LAST_DAY')
    expect(section, `§13 does not state the track's first day (${first})`).toContain(String(first))
    expect(section, `§13 does not state the track's last day (${last})`).toContain(String(last))
    // Every figure slug that has a seeded record must be findable in the document, and every
    // slug the document names in code ticks must have a record. A figure named here with no
    // record is a chapter a reader will look for and not find; a record not named here is a
    // figure the guide silently omits from a programme it claims to carry.
    const seededFigures = [...new Set(seededColumn('figures', 'slug'))]
    expect(seededFigures.length, 'no figure slug parsed out of the figures seed').toBe(SEEDED.figures)
    expect(
      seededFigures.filter((slug) => !section.includes(slug)),
      '§13 does not name these seeded figures',
    ).toEqual([])
  })

  it('states the seven-day cycle and the thirteen chapter slots, in both directions', () => {
    expect(CYCLE_DAYS.length, 'CYCLE_DAYS parsed to nothing').toBe(numConst(rhetoricSrc, 'CYCLE_LENGTH'))
    expect(CHAPTER_SLOTS.length, 'CHAPTER_SLOTS parsed to nothing').toBe(13)
    const section = docSection('## 14.')
    expect(section.length, 'CURRICULUM_GUIDE.md has no §14, so the cycle is undescribed')
      .toBeGreaterThan(400)
    for (const day of CYCLE_DAYS) {
      expect(section, `§14 does not name the cycle day \`${day}\``).toContain(day)
    }
    for (const slot of CHAPTER_SLOTS) {
      expect(section, `§14 does not name the chapter slot \`${slot}\``).toContain(slot)
    }
    const claimedSlots = [...section.matchAll(/`([a-z][a-z_]{4,})`/g)].map((m) => m[1])
    expect(
      claimedSlots.filter((s) => /_/.test(s)
        && !CHAPTER_SLOTS.includes(s) && !CYCLE_DAYS.includes(s)
        && !TRACK_METRICS.includes(s) && !CARD_TYPES.includes(s)),
      '§14 names these snake_case slots in code ticks and src/rhetoric.ts has no such slot, '
      + 'cycle day, metric or card type',
    ).toEqual([])
    expect(section, `§14 does not state the daily review minutes `
      + `(${numConst(rhetoricSrc, 'DAILY_REVIEW_MINUTES')})`)
      .toContain(String(numConst(rhetoricSrc, 'DAILY_REVIEW_MINUTES')))
  })

  it('states the tier targets and that the thousand-verbatim allocation stays rejected', () => {
    const section = docSection('## 15.')
    expect(section.length, 'CURRICULUM_GUIDE.md has no §15, so the tier system is undescribed')
      .toBeGreaterThan(300)
    const targets = [...rhetoricSrc.matchAll(/tier:\s*(\d)\s*,\s*name:\s*'([A-Za-z]+)'\s*,\s*per_figure:\s*'([^']+)'\s*,\s*total:\s*(\d+)/g)]
      .map((m) => ({ tier: Number(m[1]), name: m[2], per: m[3], total: Number(m[4]) }))
    expect(targets.length, 'TIER_TARGETS parsed to nothing, so every tier claim below is asserted '
      + 'about an empty list').toBe(3)
    for (const t of targets) {
      expect(section, `§15 does not name tier ${t.tier} ("${t.name}")`).toContain(t.name)
      expect(section, `§15 does not state tier ${t.tier}'s total (${t.total})`)
        .toContain(String(t.total))
      expect(section, `§15 does not state tier ${t.tier}'s per-figure target (${t.per})`)
        .toContain(t.per)
    }
    // Book 11.4: memorising a thousand specimens verbatim was considered and REJECTED, and
    // "the application must not silently reintroduce it." The number is derived from the
    // constant that records the rejection, so the document cannot state a different one.
    const rejected = numConst(rhetoricSrc, 'REJECTED_VERBATIM_ALLOCATION')
    expect(section, `§15 does not state the rejected allocation (${rejected} verbatim specimens)`)
      .toContain(String(rejected))
    expect(section, '§15 does not say the rejected allocation must not be reintroduced')
      .toMatch(/reject|not.{0,20}reintroduc/i)
    // And the fact that makes it more than a sentence: Tier 1 is seeded EMPTY, because Tier 1
    // is his. Derived from the tier column of the specimens seed, addressed by column name —
    // a tuple-shaped regex over the whole SQL matched rows in other tables and reported two
    // Tier 1 specimens that do not exist.
    const tiers = seededColumn('specimens', 'tier').map(Number)
    expect(tiers.length, 'no specimen tier parsed out of the seed').toBe(SEEDED.specimens)
    expect(
      tiers.filter((t) => t === 1).length,
      'Tier 1 specimens are now seeded, and Book 11.4 says Tier 1 is his — six to eight per '
      + 'figure, chosen and copied by hand',
    ).toBe(0)
    expect(section, '§15 does not state that Tier 1 is seeded empty').toMatch(/empty|seeded none|no Tier 1/i)
  })

  it('states the fixed ladder, why it is not FSRS, and that there is no sixth rung', () => {
    const section = docSection('## 16.')
    expect(section.length, 'CURRICULUM_GUIDE.md has no §16, so the ladder is undescribed')
      .toBeGreaterThan(300)
    expect(LADDER_DAYS.length, 'LADDER parsed to nothing').toBe(5)
    for (const day of LADDER_DAYS) {
      expect(section, `§16 does not state the ${day}-day rung`).toContain(String(day))
    }
    for (const type of CARD_TYPES) {
      expect(section, `§16 does not name the card type \`${type}\``).toContain(type)
    }
    // The deliberate divergence. FSRS would compute its own intervals and override the book —
    // that is why the rhetoric cards have their own tables instead of joining review_items.
    // Asserted against the route as well as the module, because the comment is not the code.
    expect(
      /fsrsReview/.test(ROUTE_SOURCES['../src/routes/rhetoric.ts'] ?? ''),
      'src/routes/rhetoric.ts now schedules the rhetoric cards with FSRS, and §16 says the book '
      + 'fixes the intervals — one of the two is now false',
    ).toBe(false)
    expect(section, '§16 does not say the ladder is deliberately not FSRS').toMatch(/FSRS/)
    expect(
      section,
      '§16 does not state that there is no sixth rung — nextLadderInterval stays on the last one, '
      + 'and a reader who assumes extrapolation will expect a schedule the code never produces',
    ).toMatch(/sixth|no further rung|stays on the last/i)
  })

  it('states what the application must not absorb, and the inverted metric', () => {
    const section = docSection('## 17.')
    expect(section.length, 'CURRICULUM_GUIDE.md has no §17, so Law 22 is unrecorded')
      .toBeGreaterThan(300)
    const mustNot = slugsOf(rhetoricSrc, 'export const MUST_NOT_ABSORB')
    expect(mustNot.length, 'MUST_NOT_ABSORB parsed to nothing').toBeGreaterThanOrEqual(4)
    for (const slug of mustNot) {
      expect(section, `§17 does not name the \`${slug}\` boundary`).toContain(slug)
    }
    // Book 11.8's four columns, derived from the route that enforces them. A fifth column
    // would make the deployment log a substitute surface for the commonplace book.
    const permitted = [...(/permittedColumns:\s*\[([^\]]*)\]/
      .exec(ROUTE_SOURCES['../src/routes/rhetoric.ts'] ?? '')?.[1] ?? '')
      .matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect(permitted.length, 'the deployment log\'s permitted columns are gone from '
      + 'src/routes/rhetoric.ts, so §17 describes an enforcement that is not there').toBe(4)
    for (const col of permitted) {
      expect(section, `§17 does not name the permitted deployment-log column \`${col}\``)
        .toContain(col)
    }
    expect(TRACK_METRICS.length, 'TRACK_METRICS parsed to nothing').toBe(6)
    for (const metric of TRACK_METRICS) {
      expect(section, `§17 does not name the track metric \`${metric}\``).toContain(metric)
    }
    // The one metric whose direction is the opposite of every other number in the app. Derived
    // from the `better: 'lower'` field, so if the direction is ever flipped in source the
    // document cannot keep claiming it.
    const invertedBlock = rhetoricSrc.slice(rhetoricSrc.indexOf('export const TRACK_METRICS'))
    const inverted = [...invertedBlock.matchAll(
      /slug:\s*'([a-z_]+)'[\s\S]{0,600}?better:\s*'(lower|higher)'/g,
    )].filter((m) => m[2] === 'lower').map((m) => m[1])
    expect(inverted, 'no track metric is marked better-when-lower any more, so §17\'s claim that '
      + 'being noticed is the failure condition is no longer in the data').toEqual(['noticed_ratio'])
    expect(
      section,
      '§17 does not state that being noticed is the failure condition, which is the one metric a '
      + 'progress view would render backwards',
    ).toMatch(/failure condition/i)
  })

  it('states the measurement schedule of the track, derived', () => {
    const section = docSection('## 18.')
    expect(section.length, 'CURRICULUM_GUIDE.md has no §18, so track measurement is undescribed')
      .toBeGreaterThan(200)
    for (const [label, value] of [
      ['baseline minutes', numConst(rhetoricSrc, 'BASELINE_MINUTES')],
      ['written baseline words', numConst(rhetoricSrc, 'WRITTEN_BASELINE_WORDS')],
      ['recording interval days', numConst(rhetoricSrc, 'RECORDING_INTERVAL_DAYS')],
    ] as const) {
      expect(section, `§18 does not state the ${label} (${value})`).toContain(String(value))
    }
    expect(RELISTEN_DAYS.length, 'RELISTEN_DAYS parsed to nothing').toBe(2)
    for (const day of RELISTEN_DAYS) {
      expect(section, `§18 does not state the Day ${day} re-listen`).toContain(String(day))
    }
    const marks = [...(/export const SELF_AUDIT_MARKS[\s\S]{0,400}?\n\]/.exec(rhetoricSrc)?.[0] ?? '')
      .matchAll(/mark:\s*'([A-Z])'/g)].map((m) => m[1])
    expect(marks, 'the self-audit marks are gone from src/rhetoric.ts').toEqual(['U', 'R', 'N'])
    for (const mark of marks) {
      expect(section, `§18 does not state the self-audit mark ${mark}`)
        .toMatch(new RegExp(`\\b${mark}\\b`))
    }
  })
})

// ------------------------------------------- what is built but not yet reachable, and honesty

describe('CURRICULUM_GUIDE.md states what is built but cannot be reached', () => {
  it('records the empty progression tables, and that a clean install has no curriculum', () => {
    // Finding 1, and the one with the largest consequence: `phases`, `units` and `laws` are
    // created by migration 0001 and seeded by NOTHING. `ensureUnlocks` walks empty tables, so
    // the progress lock has nothing to lock and the campaign has no first unit. The only rows
    // that exist anywhere come from `test/setup.ts`'s legacy-schema seeder, which is a fixture.
    const UNSEEDED = ['phases', 'units', 'laws']
    const seeders = UNSEEDED.filter((t) => new RegExp(
      `INSERT(?:\\s+OR\\s+\\w+)?\\s+INTO\\s+${t}\\b`, 'i',
    ).test(`${ALL_SQL}\n${ALL_SRC}`))
    // One pattern, used positively while the tables are empty and negatively once they are not.
    // Two separate patterns is how this assertion goes stale in the flattering direction: seeding
    // `phases` in a migration left the emptiness claim standing, because the phrase the if-branch
    // demanded ("clean install") was not among the phrases the else-branch forbade.
    const EMPTY_CLAIM = /clean install|fresh install|empty on install|no migration (?:and no route )?seeds|seeded by nothing|no campaign at all/i
    const section = docSection('## 19.')
    expect(section.length, 'CURRICULUM_GUIDE.md has no §19, so the empty-curriculum finding is '
      + 'unrecorded').toBeGreaterThan(300)
    if (seeders.length === 0) {
      for (const t of UNSEEDED) {
        expect(section, `§19 does not name \`${t}\`, which no migration and no route seeds`)
          .toContain(t)
      }
      expect(
        section,
        '§19 does not state that a clean install has no curriculum rows at all, which is the '
        + 'consequence a reader plans around',
      ).toMatch(EMPTY_CLAIM)
      // The mechanism, so the claim is checkable: ensureUnlocks walks these tables.
      expect(
        /FROM phases/.test(ALL_SRC),
        'nothing reads the phases table any more, so §19 describes a walk that no longer happens',
      ).toBe(true)
      expect(section, '§19 does not name the function that walks the empty tables')
        .toMatch(/ensureUnlocks/)
    } else {
      expect(
        section,
        `these curriculum tables are now seeded (${seeders.join(', ')}), and §19 still reports the `
        + 'progression as empty',
      ).not.toMatch(EMPTY_CLAIM)
    }
  })

  it('states the reachability arithmetic, derived, with the rule it was derived by', () => {
    const section = docSection('## 20.')
    expect(section.length, 'CURRICULUM_GUIDE.md has no §20, so reachability is unrecorded')
      .toBeGreaterThan(400)
    // Vacuity floors on both halves. With no routes the subtraction is 0 - 0; with an empty
    // bundle every route reads as unreachable and the figure is meaningless.
    expect(ROUTES.length, 'no /api route parsed out of src/routes/, so the reachability figures '
      + 'below are asserted about an empty set').toBeGreaterThan(100)
    expect(bundleSrc.length, 'the committed bundle is empty, so every route reads as unreachable')
      .toBeGreaterThan(50_000)
    expect(section, `§20 does not state the number of /api routes the server registers `
      + `(${ROUTES.length})`).toContain(String(ROUTES.length))
    expect(section, `§20 does not state how many of them the bundle never references `
      + `(${UNREFERENCED.length})`).toContain(String(UNREFERENCED.length))
    expect(section, `§20 does not separate out the ${AGENT_BRIDGE.length} agent-bridge routes, `
      + 'which are not meant to be called by the client and are therefore not dead')
      .toContain(String(AGENT_BRIDGE.length))
    expect(section, `§20 does not state the remainder (${UNREACHABLE.length}) — the routes that `
      + 'are client-facing by design and unreferenced in fact')
      .toContain(String(UNREACHABLE.length))
    // The derivation rule must be stated, because the figure is only as good as the rule and a
    // reader who assumes a bare-word grep will get four different numbers. This is the exact
    // mistake made while measuring: "cursor", "tone" and "state" all appear in the bundle as
    // unrelated identifiers, which reported reachable routes that nothing calls.
    expect(
      section,
      '§20 does not state the matching rule (a route\'s static path prefix up to the first '
      + ':param), so the figures cannot be reproduced or challenged',
    ).toMatch(/static (?:path )?prefix/i)
    // Every module with unreachable routes must be named, and no module may be named that has
    // none. A guide that lists a clean module as unreachable sends someone to fix nothing.
    const modules = [...new Set(UNREACHABLE.map((r) => r.module))]
    expect(modules.length, 'no module has unreachable routes, so this section describes nothing')
      .toBeGreaterThan(0)
    for (const m of modules) {
      expect(section, `§20 does not name \`${m}\`, which registers routes the bundle never calls`)
        .toContain(m)
    }
    const namedModules = [...new Set([...section.matchAll(/`(src\/routes\/[a-z-]+\.ts)`/g)]
      .map((m) => m[1]))]
    expect(
      namedModules.filter((m) => !modules.includes(m)),
      '§20 names these route modules as having unreachable routes and every route they register '
      + 'is referenced by the bundle',
    ).toEqual([])
    // And the specific consequence for the learning engine, which is the reason this section is
    // in a curriculum guide rather than in ARCHITECTURE.md: the measured-reading gate and the
    // R0 gate are both enforced, and neither surface that satisfies them is reachable, so a
    // non-exam unit cannot be advanced from the shipped client.
    expect(
      /plausible=1/.test(learnRouteSrc),
      'src/routes/learn.ts no longer requires a plausible reading session, so §20\'s consequence '
      + 'is gone',
    ).toBe(true)
    expect(
      section,
      '§20 does not state that a non-exam unit cannot be advanced from the shipped client, which '
      + 'is what the arithmetic means for the curriculum',
    ).toMatch(/cannot be advanced|cannot advance|no way to advance/i)
  })

  it('names the tests that hold it up, and they exist', () => {
    const referenced = [...curriculumDoc.matchAll(/`(test\/[a-z0-9-]+\.test\.ts)`/g)].map((m) => m[1])
    expect(referenced.length, 'CURRICULUM_GUIDE.md names no test, so nothing in it is checkable '
      + 'by a reader').toBeGreaterThanOrEqual(2)
    // `import.meta.glob` excludes the module doing the globbing, so this file would otherwise
    // be reported as a test that does not exist. The self name comes from `import.meta.url`
    // rather than written out, so renaming this file cannot make the check pass by naming a
    // file that is gone.
    const globbed = Object.keys(import.meta.glob('./*.test.ts', { eager: false }))
      .map((p) => `test/${p.slice(2)}`)
    expect(globbed.length, 'the test-file glob came back empty, so nothing below is checked')
      .toBeGreaterThanOrEqual(60)
    const present = new Set([`test/${SELF}`, ...globbed])
    expect(
      [...new Set(referenced)].filter((t) => !present.has(t)),
      'CURRICULUM_GUIDE.md points at tests that do not exist',
    ).toEqual([])
  })

  it('makes the non-claims explicit, in the section that owns them', () => {
    const section = docSection('## 21.')
    expect(section.length, 'CURRICULUM_GUIDE.md has no §21, so the non-claims are missing')
      .toBeGreaterThan(300)
    // Six things a curriculum guide must never be read as asserting. Each is checked inside
    // §21 rather than document-wide: the whole reason this convention exists is that a
    // document-wide `toContain` was satisfied three times by an unrelated sentence elsewhere
    // in the file while the claim itself had been deleted.
    const NON_CLAIMS: ReadonlyArray<readonly [RegExp, string]> = [
      [/does not claim|makes no claim/i, 'that this document does not claim what follows'],
      [/no lesson content|does not contain the lessons|not the lessons themselves/i,
        'that the guide is not the curriculum content'],
      [/spec|MASTERPROMPT/i, 'that Books 9-11 are a specification this repository partly implements'],
      [/Farnsworth/i, 'that no text from Farnsworth is reproduced'],
      [/no (?:claim about|assertion of) (?:the )?operator|has not been (?:taught|run|used)/i,
        'that no claim is made about what the commander has actually studied'],
      [/deploy/i, 'that nothing here has been deployed'],
    ]
    for (const [pattern, what] of NON_CLAIMS) {
      expect(section, `§21 does not state ${what}`).toMatch(pattern)
    }
    // The Law 22 boundary belongs here too, because the temptation a curriculum guide creates
    // is to make the application the curriculum.
    expect(section, '§21 does not restate that the paper programme is not replaced')
      .toMatch(/handwritten|paper|physical/i)
  })
})




