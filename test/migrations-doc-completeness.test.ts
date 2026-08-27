import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import migrationsDoc from '../MIGRATIONS.md?raw'
import operationsSrc from '../OPERATIONS.md?raw'
import pkgSrc from '../package.json?raw'
import { migrationPaths } from './setup'

// Book 17 Definition of Done, Documentation (MASTERPROMPT.md): "Add ... MIGRATIONS.md ...
// Make no claim that is not technically guaranteed."
//
// A migration document is the one document that is wrong the day after it is written. Every
// migration added afterwards is a schema change the document denies happened, and the reader
// — an operator about to apply these to production D1 — plans around the document.
//
// So every list, every count and every table-to-migration attribution in MIGRATIONS.md is
// DERIVED from `migrations/` here, and compared in BOTH directions: a migration missing from
// the document is a change the reader never sees, and a row naming a file that does not exist
// is a claim about a migration nobody can apply.
//
// The load-bearing floor is the last assertion of the first test. The derivations below come
// from a static replay of the migration text — CREATE, DROP and RENAME, with comments
// stripped — and a static replay is only worth as much as its parser. So the replayed table
// set is compared against `sqlite_master` in the database `test/setup.ts` actually built. If
// the parser misreads one statement, the two disagree and this file fails there, at the
// parser, instead of quietly comparing the document against a set that was already wrong.
//
// Stripping comments before the replay is not a detail. Nearly every `DROP TABLE` occurrence
// in `migrations/` lives inside a `-- ROLLBACK (manual):` note rather than being a statement —
// two are executed and the rest are notes — and a parser that read those would report tables as
// dropped that are sitting in production holding rows. The exact split is derived below and
// asserted against the document, so it is not restated here as a number that can go stale.

// ------------------------------------------------------------------- derivations

const MIGRATION_SOURCES = import.meta.glob('../migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const FILES = migrationPaths.map((p) => p.split('/').pop() ?? '')

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/**
 * The English word for a count, so a guard can accept the prose spelling without carrying
 * the spelling as a literal. A literal goes stale silently the moment the count moves, and
 * the alternation then passes on the old word — which is the defect, not the guard.
 */
export function numberWord(n: number): string {
  if (n < 0 || n > 99 || !Number.isInteger(n)) {
    throw new Error(`numberWord covers 0-99 and was given ${n}`)
  }
  if (n < 20) return ONES[n]
  const tens = TENS[Math.floor(n / 10)]
  const ones = n % 10
  return ones === 0 ? tens : `${tens}-${ONES[ones]}`
}

/** Comment-stripping that respects single-quoted strings, so a `--` inside seeded prose
 *  does not truncate the statement around it. Same rule `test/setup.ts` applies. */
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

const EXECUTED = Object.fromEntries(
  migrationPaths.map((p) => [p.split('/').pop() ?? '', stripComments(MIGRATION_SOURCES[p] ?? '')]),
) as Record<string, string>
const RAW = Object.fromEntries(
  migrationPaths.map((p) => [p.split('/').pop() ?? '', MIGRATION_SOURCES[p] ?? '']),
) as Record<string, string>

const CREATE_TABLE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?/gi
const DROP_TABLE = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["`]?(\w+)["`]?/gi
const RENAME_TABLE = /ALTER\s+TABLE\s+["`]?(\w+)["`]?\s+RENAME\s+TO\s+["`]?(\w+)["`]?/gi

const count = (text: string, re: RegExp) => [...text.matchAll(re)].length

/**
 * Replay the whole directory in filename order. `live` maps each surviving table to the
 * migration that gave it its current name — which for the two cutover tables is the
 * migration that built the replacement, not the one that first created the name.
 */
function replay() {
  const live = new Map<string, string>()
  let creates = 0
  const dropped: Array<{ file: string; table: string }> = []
  const renamed: Array<{ file: string; from: string; to: string }> = []
  for (const file of FILES) {
    const sql = EXECUTED[file]
    for (const m of sql.matchAll(CREATE_TABLE)) { live.set(m[1], file); creates++ }
    for (const m of sql.matchAll(DROP_TABLE)) { live.delete(m[1]); dropped.push({ file, table: m[1] }) }
    for (const m of sql.matchAll(RENAME_TABLE)) {
      const origin = live.get(m[1]) ?? file
      live.delete(m[1])
      live.set(m[2], origin)
      renamed.push({ file, from: m[1], to: m[2] })
    }
  }
  return { live, creates, dropped, renamed }
}

const { live: LIVE, creates: CREATE_STATEMENTS, dropped: DROPPED, renamed: RENAMED } = replay()
const LIVE_TABLES = [...LIVE.keys()].sort()

/** Migration filename -> the live tables it is responsible for, alphabetical. */
const TABLES_BY_MIGRATION = new Map<string, string[]>()
for (const [table, file] of [...LIVE.entries()].sort()) {
  if (!TABLES_BY_MIGRATION.has(file)) TABLES_BY_MIGRATION.set(file, [])
  TABLES_BY_MIGRATION.get(file)!.push(table)
}
const CREATORS = FILES.filter((f) => TABLES_BY_MIGRATION.has(f))
const NO_NEW_TABLE = FILES.filter((f) => !TABLES_BY_MIGRATION.has(f))

/**
 * Applying one of these a second time is an error, not a no-op: SQLite has no
 * `ADD COLUMN IF NOT EXISTS`, and a `RENAME TO` finds nothing to rename. That is what makes
 * "exactly once, in filename order" a rule rather than a preference, so the document has to
 * name them.
 */
const NOT_RERUNNABLE = FILES.filter(
  (f) => /^\s*ALTER\s+TABLE\s+.*\bADD\s+COLUMN\b/im.test(EXECUTED[f])
    || /^\s*ALTER\s+TABLE\s+.*\bRENAME\s+TO\b/im.test(EXECUTED[f]),
)

const TRIGGER_STATEMENTS = FILES.reduce((n, f) => n + count(EXECUTED[f], /CREATE\s+TRIGGER\b/gi), 0)
const INDEX_STATEMENTS = FILES.reduce(
  (n, f) => n + count(EXECUTED[f], /CREATE\s+(?:UNIQUE\s+)?INDEX\b/gi), 0)
const UNIQUE_INDEX_STATEMENTS = FILES.reduce(
  (n, f) => n + count(EXECUTED[f], /CREATE\s+UNIQUE\s+INDEX\b/gi), 0)
const DROP_TABLE_TOTAL = FILES.reduce((n, f) => n + count(RAW[f], /DROP\s+TABLE\b/gi), 0)

/**
 * Trigger and index NAMES, not just counts. A count floor cannot catch a statement written
 * in a syntax the regex cannot read: the count stays at the floor, and the document goes on
 * stating a number that is now too low. Names can be compared against `sqlite_master`, which
 * turns "the parser read enough" into "the parser read all of it".
 */
function names(re: RegExp): Set<string> {
  const out = new Set<string>()
  for (const f of FILES) for (const m of EXECUTED[f].matchAll(re)) out.add(m[1])
  return out
}
const TRIGGER_NAMES = names(
  /CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?/gi)
const INDEX_NAMES = names(
  /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?/gi)

/**
 * Names written more than once. `names()` returns a set and so loses multiplicity, and the
 * gap between 100 `CREATE INDEX` statements and 96 indexes IS the multiplicity. §6 has to
 * name the repeats: a stated count a reader cannot check against anything is a number to
 * be believed, and the four names are what make it checkable.
 */
function repeated(re: RegExp): string[] {
  const seen = new Map<string, number>()
  for (const f of FILES) {
    for (const m of EXECUTED[f].matchAll(re)) seen.set(m[1], (seen.get(m[1]) ?? 0) + 1)
  }
  return [...seen].filter(([, n]) => n > 1).map(([k]) => k).sort()
}
const INDEX_NAME_REPEATS = repeated(
  /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?/gi)

// ------------------------------------------------------------------- document parsing

/** The body of one heading, up to the next heading of the same or shallower depth. */
function docSection(heading: string): string {
  const at = migrationsDoc.indexOf(heading)
  if (at === -1) return ''
  const depth = (heading.match(/^#+/) ?? ['##'])[0].length
  const rest = migrationsDoc.slice(at + heading.length)
  const next = rest.search(new RegExp(`\\n#{2,${depth}} `))
  return next === -1 ? rest : rest.slice(0, next)
}

/** `| \`0001_initial_schema.sql\` | 15 | \`a\`, \`b\` |` — table rows only, never prose. */
function mappingRows(section: string): Array<{ file: string; n: number; tables: string[] }> {
  const rows: Array<{ file: string; n: number; tables: string[] }> = []
  for (const line of section.split('\n')) {
    const m = /^\|\s*`(\d{4}_[a-z0-9_]+\.sql)`\s*\|\s*(\d+)\s*\|(.*)\|\s*$/.exec(line.trim())
    if (!m) continue
    rows.push({
      file: m[1],
      n: Number(m[2]),
      tables: [...m[3].matchAll(/`(\w+)`/g)].map((x) => x[1]).sort(),
    })
  }
  return rows
}

/** Every migration filename the document mentions anywhere, backticked. */
const NAMED_IN_DOC = new Set(
  [...migrationsDoc.matchAll(/`(?:migrations\/)?(\d{4}_[a-z0-9_]+\.sql)`/g)].map((m) => m[1]),
)

const CATALOGUE = docSection('## 3.')
const MAPPING = docSection('## 4.')

// ------------------------------------------------------------------- the guard

describe('B17 MIGRATIONS.md is derived from migrations/, in both directions', () => {
  it('spells a count the way the prose does, at any count', () => {
    // `numberWord` is what lets the assertions above accept the prose spelling without
    // carrying the spelling. If it is wrong, the guard rejects a document that is right --
    // so it is proven here rather than assumed, including across the boundary the directory
    // just crossed.
    expect(numberWord(29)).toBe('twenty-nine')
    expect(numberWord(30)).toBe('thirty')
    expect(numberWord(31)).toBe('thirty-one')
    expect(numberWord(7)).toBe('seven')
    expect(numberWord(13)).toBe('thirteen')
    expect(numberWord(20)).toBe('twenty')
    expect(numberWord(99)).toBe('ninety-nine')
    // Out of range is a throw rather than a wrong word, because a wrong word here would
    // fail somewhere else entirely and read as a documentation defect.
    expect(() => numberWord(100)).toThrow()
    expect(() => numberWord(1.5)).toThrow()
  })

  it('read a real directory, a real database and a real document, so a broken read fails here', async () => {
    expect(FILES.length, 'the migration glob came back empty').toBeGreaterThanOrEqual(29)
    expect(migrationsDoc.length, 'MIGRATIONS.md came back empty').toBeGreaterThan(6000)
    expect(operationsSrc.length, 'OPERATIONS.md came back empty').toBeGreaterThan(5000)
    expect(LIVE_TABLES.length, 'the replay produced no tables').toBeGreaterThanOrEqual(92)
    expect(CREATE_STATEMENTS, 'no CREATE TABLE statements were read').toBeGreaterThanOrEqual(94)
    expect(TRIGGER_STATEMENTS, 'no CREATE TRIGGER statements were read').toBeGreaterThanOrEqual(27)
    expect(INDEX_STATEMENTS, 'no CREATE INDEX statements were read').toBeGreaterThanOrEqual(100)
    expect(DROPPED.length, 'the replay found no executed DROP TABLE').toBe(2)
    expect(RENAMED.length, 'the replay found no executed RENAME').toBe(2)
    expect(NOT_RERUNNABLE.length, 'no migration was found non-re-runnable').toBeGreaterThanOrEqual(9)
    expect(NO_NEW_TABLE.length, 'every migration was credited with a table').toBeGreaterThanOrEqual(7)
    expect(CATALOGUE.length, 'MIGRATIONS.md has no section 3').toBeGreaterThan(2000)
    expect(MAPPING.length, 'MIGRATIONS.md has no section 4').toBeGreaterThan(1000)

    // THE PARSER FLOOR. Everything above is a static reading of SQL text. This is the only
    // assertion that proves the reading is right: the replayed set must equal the tables the
    // migrations actually produced when applied to a database. A parser that misses a
    // statement fails here rather than shrinking the set the document is then measured
    // against — which would let the document omit a table and still be called complete.
    const rows = (await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table'
         AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`,
    ).all()).results as Array<{ name: string }>
    const actual = rows.map((r) => r.name).sort()
    expect(actual.length, 'the database came back with no tables').toBeGreaterThanOrEqual(92)
    expect(
      LIVE_TABLES,
      'the static replay of migrations/ disagrees with the database those migrations built, '
      + 'so every derived list below is unsafe to compare a document against',
    ).toEqual(actual)

    // Same floor for triggers and indexes, by name rather than by count. The counts above are
    // only floors, and a floor is satisfied by a parser that reads too little: a trigger the
    // regex cannot see keeps the count at 27 while the schema holds 28, and the document goes
    // on claiming 27 with the guard green. Comparing names against sqlite_master removes that
    // hole in both directions.
    const trg = (await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name`,
    ).all()).results as Array<{ name: string }>
    const idx = (await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='index'
         AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    ).all()).results as Array<{ name: string }>
    expect(trg.length, 'the database reports no triggers').toBeGreaterThanOrEqual(27)
    expect(idx.length, 'the database reports no indexes').toBeGreaterThanOrEqual(96)
    expect(
      trg.map((r) => r.name).sort(),
      'the parser did not read every CREATE TRIGGER in migrations/, so the trigger count this '
      + 'document states is measured against an incomplete reading',
    ).toEqual([...TRIGGER_NAMES].sort())
    expect(
      idx.map((r) => r.name).sort(),
      'the parser did not read every CREATE INDEX in migrations/, so the index counts this '
      + 'document states are measured against an incomplete reading',
    ).toEqual([...INDEX_NAMES].sort())
  })

  it('catalogues all 29 migrations and no migration that does not exist', () => {
    const listed = [...CATALOGUE.matchAll(/^\|\s*`(\d{4}_[a-z0-9_]+\.sql)`\s*\|/gm)].map((m) => m[1])
    expect(
      FILES.filter((f) => !listed.includes(f)),
      'these migrations are on disk and absent from the §3 catalogue — a reader planning an '
      + 'upgrade would not know they exist',
    ).toEqual([])
    expect(
      listed.filter((f) => !FILES.includes(f)),
      'the §3 catalogue names these files and they are not in migrations/',
    ).toEqual([])
    expect(listed.length, 'a migration is catalogued twice').toBe(new Set(listed).size)

    // Every row must actually say something. A filename with an empty purpose column reads
    // as covered and tells the reader nothing.
    const thin = CATALOGUE.split('\n')
      .map((l) => /^\|\s*`(\d{4}_[a-z0-9_]+\.sql)`\s*\|(.*)\|\s*$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .filter((m) => m[2].replace(/\|/g, '').trim().length < 24)
      .map((m) => m[1])
    expect(thin, 'these §3 rows state no purpose').toEqual([])

    // The count is stated in words as well, and a stated count is the thing that goes stale.
    // The accepted word is DERIVED from the count rather than spelled into the pattern: an
    // alternation carrying a literal `twenty-nine` kept passing after the directory reached
    // thirty files, which is this document's own recurring defect wearing a guard's clothes.
    expect(
      migrationsDoc,
      `MIGRATIONS.md does not state that there are ${FILES.length} migrations `
      + `(as the digits or as "${numberWord(FILES.length)}")`,
    ).toMatch(new RegExp(`(${numberWord(FILES.length)}|${FILES.length})\\s+migrations`, 'i'))
  })

  it('attributes every live table to the migration that produced it, and nothing else', () => {
    const rows = mappingRows(MAPPING)
    // A vacuity floor, and nothing more. Set to `CREATORS.length` it stops being a floor and
    // becomes an exactness check that runs first: deleting one §4 row then fails here, with
    // an arithmetic message about a table that has 21 rows, and the loop below — which would
    // name the migration whose row is gone — never runs. Exactness is that loop's job.
    expect(rows.length, 'the §4 mapping table parsed to no rows at all, so every comparison '
      + 'below is between empty sets').toBeGreaterThan(0)

    const byFile = new Map(rows.map((r) => [r.file, r]))
    const problems: string[] = []
    for (const file of CREATORS) {
      const derived = TABLES_BY_MIGRATION.get(file)!
      const row = byFile.get(file)
      if (!row) { problems.push(`${file}: no §4 row, though it leaves ${derived.length} tables`); continue }
      const missing = derived.filter((t) => !row.tables.includes(t))
      const extra = row.tables.filter((t) => !derived.includes(t))
      if (missing.length) problems.push(`${file}: row omits ${missing.join(', ')}`)
      if (extra.length) problems.push(`${file}: row claims ${extra.join(', ')}`)
      if (row.n !== derived.length) problems.push(`${file}: row says ${row.n}, schema says ${derived.length}`)
    }
    for (const row of rows) {
      if (!CREATORS.includes(row.file)) {
        problems.push(`${row.file}: has a §4 row but leaves no table of its own`)
      }
    }
    expect(
      problems,
      'the §4 table-to-migration mapping does not match migrations/. A table attributed to '
      + 'the wrong migration sends an operator to the wrong rollback',
    ).toEqual([])

    // Both directions: no live table may be missing from the mapping, and the mapping may
    // not invent one.
    const named = [...new Set(rows.flatMap((r) => r.tables))].sort()
    expect(named, 'the set of tables named in §4 is not the set of live tables').toEqual(LIVE_TABLES)

    // The total is stated in prose, and prose counts are what rot.
    expect(
      migrationsDoc,
      `MIGRATIONS.md does not state the live table count (${LIVE_TABLES.length})`,
    ).toMatch(new RegExp(`\\b${LIVE_TABLES.length}\\b`))
    expect(
      migrationsDoc,
      `MIGRATIONS.md does not state the CREATE TABLE statement count (${CREATE_STATEMENTS})`,
    ).toMatch(new RegExp(`\\b${CREATE_STATEMENTS}\\b`))
  })

  it('names the migrations that create no table of their own', () => {
    // Seven of the twenty-nine add columns, install triggers, backfill or seed. A document
    // that only mapped tables would leave them looking like no-ops.
    const rows = mappingRows(MAPPING).map((r) => r.file)
    for (const file of NO_NEW_TABLE) {
      expect(
        NAMED_IN_DOC.has(file),
        `${file} creates no table and MIGRATIONS.md never names it, so it reads as a no-op`,
      ).toBe(true)
      expect(rows, `${file} has a mapping row but creates no table`).not.toContain(file)
    }
    expect(
      migrationsDoc,
      `MIGRATIONS.md does not state how many migrations create no table (${NO_NEW_TABLE.length})`,
    ).toMatch(new RegExp(`(seven|${NO_NEW_TABLE.length})\\s+(of the\\s+\\S+\\s+)?migrations?`, 'i'))
  })

  it('states both executed DROP TABLEs, and that every other one is a comment', () => {
    // The honest version of "forward-only and additive". Two tables really were dropped, and
    // a document that said "nothing is ever dropped" would be false; one that said nothing
    // would leave a reader who greps for DROP with twenty-one hits and no way to tell which
    // two run.
    for (const { file, table } of DROPPED) {
      const line = EXECUTED[file].split('\n')
        .findIndex((l) => new RegExp(`^\\s*DROP\\s+TABLE\\s+(IF\\s+EXISTS\\s+)?${table}\\b`, 'i').test(l)) + 1
      expect(
        migrationsDoc,
        `MIGRATIONS.md does not state that ${file} drops ${table} (line ${line})`,
      ).toMatch(new RegExp(`${file.replace(/[.]/g, '\\.')}[\\s\\S]{0,400}?\`?${table}\`?`))
      expect(migrationsDoc, `MIGRATIONS.md never names the dropped table ${table}`)
        .toContain(`\`${table}\``)
    }
    for (const { from, to } of RENAMED) {
      expect(migrationsDoc, `MIGRATIONS.md does not state the ${from} -> ${to} rename`)
        .toMatch(new RegExp(`\`${from}\`[\\s\\S]{0,200}?\`${to}\``))
    }
    expect(
      migrationsDoc,
      'MIGRATIONS.md does not state how many DROP TABLE occurrences are rollback comments '
      + `rather than statements (${DROP_TABLE_TOTAL} total, ${DROPPED.length} executed)`,
    ).toMatch(new RegExp(`\\b${DROP_TABLE_TOTAL - DROPPED.length}\\b`))
  })

  it('names every migration that cannot safely be applied twice', () => {
    for (const file of NOT_RERUNNABLE) {
      expect(
        NAMED_IN_DOC.has(file),
        `${file} contains ADD COLUMN or RENAME TO — applying it twice errors — and `
        + 'MIGRATIONS.md never names it',
      ).toBe(true)
    }
    const section = docSection('## 2.')
    expect(section.length, 'MIGRATIONS.md has no section 2').toBeGreaterThan(800)
    const unlisted = NOT_RERUNNABLE.filter((f) => !section.includes(f))
    expect(
      unlisted,
      'these migrations error on a second application and §2, which states the rules, does '
      + 'not list them',
    ).toEqual([])
    expect(section, '§2 does not state that migrations are applied in filename order')
      .toMatch(/filename order|order of (their )?filename/i)
    expect(section, '§2 does not state the forward-only rule').toMatch(/forward[-\s]only/i)
  })

  it('states the trigger and index counts it claims, and defers the guarantees to SECURITY.md', () => {
    expect(migrationsDoc, `the stated trigger count is not ${TRIGGER_STATEMENTS}`)
      .toMatch(new RegExp(`\\b${TRIGGER_STATEMENTS}\\b[\\s\\S]{0,80}?trigger`, 'i'))
    expect(migrationsDoc, `the stated index count is not ${INDEX_STATEMENTS}`)
      .toMatch(new RegExp(`\\b${INDEX_STATEMENTS}\\b[\\s\\S]{0,80}?index`, 'i'))
    // Statements and indexes are different numbers here — four index names are created twice,
    // each by the cutover that rebuilt the table those indexes sit on. A document that stated
    // only the statement count would leave a reader who counts indexes in the live database
    // four short and no way to tell why.
    // Anchored to the claim rather than to the document. A bare search for the number is
    // satisfied by any other sentence containing it — including the sentence that tells a
    // reader they will "find 96, not 100", which kept this green while §6 said 100 distinct.
    expect(
      migrationsDoc,
      `the stated distinct index-name count is not ${INDEX_NAMES.size}`,
    ).toMatch(new RegExp(`\\b${INDEX_NAMES.size}\\b[^\\n]{0,12}?distinct index`, 'i'))
    expect(
      INDEX_STATEMENTS - INDEX_NAMES.size,
      'the number of repeated index names changed; §6 explains the gap and must be updated',
    ).toBe(4)
    expect(
      INDEX_NAME_REPEATS.length,
      'the gap is no longer four names written twice — one is now written three times, and '
      + '§6 states a four-row table that no longer accounts for the arithmetic',
    ).toBe(4)
    // The count on its own is a number to be believed. Naming the repeats is what lets a
    // reader who counts 96 indexes in the database see where the other four statements went.
    expect(
      INDEX_NAME_REPEATS.filter((n) => !migrationsDoc.includes(n)),
      'the gap between CREATE INDEX statements and distinct indexes is explained by naming '
      + 'the repeated indexes, and these repeats are not named',
    ).toEqual([])
    expect(migrationsDoc, `the stated UNIQUE index count is not ${UNIQUE_INDEX_STATEMENTS}`)
      .toMatch(new RegExp(`\\b${UNIQUE_INDEX_STATEMENTS}\\b[\\s\\S]{0,60}?(are\\s+)?\`?UNIQUE`, 'i'))

    // SECURITY.md §12 is the derived, guarded statement of which tables are append-only and
    // under what condition. Restating it here would create a second copy to drift, and the
    // §12 correction is exactly what a drifting copy costs.
    expect(migrationsDoc, 'MIGRATIONS.md does not point at SECURITY.md for the append-only guarantees')
      .toMatch(/SECURITY\.md/)
  })

  it('defers rollback to OPERATIONS.md §5 instead of keeping a second copy', () => {
    expect(migrationsDoc, 'MIGRATIONS.md does not point at the operator runbook for rollback')
      .toMatch(/OPERATIONS\.md/)
    // A second set of rollback instructions is a second thing to maintain, and the one that
    // is not the operator's entry point is the one that goes stale. `test/migration-runbook-
    // coverage.test.ts` guards §5; nothing would guard a copy here.
    expect(
      [...migrationsDoc.matchAll(/\*\*Rollback\*\*/g)].length,
      'MIGRATIONS.md has started keeping its own rollback notes; OPERATIONS.md §5 is the one '
      + 'place they live, and it is the one place a test guards',
    ).toBe(0)
    // The 0001-0004 exemption is adjudicated in OPERATIONS.md. A reader of MIGRATIONS.md who
    // does not know that will record it as a gap and try to close it by writing a note that
    // drops the commander's history.
    expect(migrationsDoc, 'MIGRATIONS.md does not explain why 0001-0004 have no rollback note')
      .toMatch(/inherited baseline/i)
  })

  it('names the tests that hold it up, and they exist', () => {
    const referenced = [...migrationsDoc.matchAll(/`(test\/[a-z0-9-]+\.test\.ts)`/g)].map((m) => m[1])
    expect(referenced.length, 'MIGRATIONS.md names no test').toBeGreaterThanOrEqual(3)
    // `import.meta.glob` deliberately excludes the module doing the globbing, so this file
    // would otherwise be reported as a test that does not exist. The self name is taken from
    // `import.meta.url` rather than written out, so renaming this file cannot make the check
    // pass by naming a file that is gone.
    const self = (import.meta.url.split('?')[0].split('/').pop() ?? '')
    const globbed = Object.keys(import.meta.glob('./*.test.ts', { eager: false }))
      .map((p) => `test/${p.slice(2)}`)
    expect(globbed.length, 'the test-file glob came back empty, so nothing below is checked')
      .toBeGreaterThanOrEqual(60)
    const present = new Set([`test/${self}`, ...globbed])
    expect(
      [...new Set(referenced)].filter((t) => !present.has(t)),
      'MIGRATIONS.md points at tests that do not exist',
    ).toEqual([])
    expect(migrationsDoc, 'MIGRATIONS.md does not name the harness that applies the migrations')
      .toMatch(/test\/setup\.ts/)
  })

  it('keeps production application on the operator side of the boundary', () => {
    // Book 17.4 and the standing constraint: the repository never applies a migration to
    // production D1 and never claims to have. A document that reads as though it did is the
    // one that gets an unbacked-up database migrated.
    // Checked inside the section that carries the command, not anywhere in the document. A
    // document-wide search for the word "operator" is satisfied by an unrelated sentence:
    // "an operator-owned backup", three lines below, kept this green after the boundary
    // statement itself had been deleted — the single failure this test exists to prevent.
    const apply = docSection('## 9.')
    expect(
      apply.length,
      'MIGRATIONS.md has no §9, so the section carrying the operator boundary is gone',
    ).toBeGreaterThan(200)
    expect(
      apply,
      'the section that names the wrangler apply command does not say that applying these to '
      + 'production is the operator\'s action',
    ).toMatch(/is an\s+\*{0,2}operator action|the operator applies|applied by the operator/i)
    expect(
      apply,
      'the section that names the wrangler apply command does not say that this repository '
      + 'does not perform it',
    ).toMatch(/does not perform|never performs|does not apply|never applies/i)
    // And no runnable command against production may be stated anywhere that framing is
    // absent. Matched on the database name, not the subcommand: §2 names `wrangler d1
    // migrations apply` while explaining why the filename prefix is the order of application,
    // which is a fact about ordering and not an instruction to migrate anything.
    const PROD_CMD = /wrangler d1 migrations (?:apply|list)\s+webapp-production/g
    expect(
      [...migrationsDoc.matchAll(PROD_CMD)].length - [...apply.matchAll(PROD_CMD)].length,
      'MIGRATIONS.md states a runnable command against production D1 outside §9, where the '
      + 'sentence that makes applying it the operator\'s action does not appear',
    ).toBe(0)
    expect(
      [...apply.matchAll(PROD_CMD)].length,
      '§9 no longer states the operator\'s commands, so the boundary is asserted about a '
      + 'section that no longer tells an operator what to run',
    ).toBeGreaterThanOrEqual(2)

    // And the claim itself, derived rather than promised. §9 states that nothing in
    // package.json, in CI or in any test applies a migration or executes SQL against a remote
    // database. A sentence like that is worth exactly as much as the check behind it: without
    // one, a convenience script that migrated production would leave the document asserting
    // the opposite, in the section an operator reads to decide what is safe to run.
    const REMOTE = /d1 migrations apply|d1 execute|--remote/
    const pkg = JSON.parse(pkgSrc) as { scripts?: Record<string, string> }
    const scriptNames = Object.keys(pkg.scripts ?? {})
    expect(scriptNames.length, 'package.json declares no scripts, so the first third of §9\'s '
      + 'claim is asserted about nothing').toBeGreaterThan(5)
    expect(
      Object.entries(pkg.scripts ?? {}).filter(([, cmd]) => REMOTE.test(cmd)).map(([n]) => n),
      'these package.json scripts reach a remote database, and §9 claims none does',
    ).toEqual([])
    const workflows = import.meta.glob('../.github/workflows/*.yml', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    expect(Object.keys(workflows).length, 'no workflow exists, so the CI third of §9\'s claim '
      + 'is asserted about nothing').toBeGreaterThan(0)
    expect(
      Object.entries(workflows).flatMap(([path, src]) => src.split(/\r?\n/)
        .filter((line) => !/^\s*#/.test(line) && REMOTE.test(line))
        .map((line) => `${path.replace(/^\.\.\//, '')}: ${line.trim()}`)),
      'these CI steps reach a remote database, and §9 claims none does',
    ).toEqual([])
    const testSources = import.meta.glob('./*.test.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    expect(Object.keys(testSources).length, 'the test-source glob came back empty, so the test '
      + 'third of §9\'s claim is asserted about nothing').toBeGreaterThanOrEqual(60)
    expect(
      Object.entries(testSources)
        .filter(([, src]) => src.split(/\r?\n/).some((line) => !/^\s*(?:\/\/|\*)/.test(line)
          && REMOTE.test(line)))
        .map(([path]) => `test/${path.slice(2)}`),
      'these tests reach a remote database, and §9 claims none does',
    ).toEqual([])
  })
})
