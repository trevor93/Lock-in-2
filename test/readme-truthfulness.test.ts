import { describe, expect, it } from 'vitest'
import readmeRaw from '../README.md?raw'
import shellRaw from '../public/static/app/core/shell.js?raw'
import rendererRaw from '../src/renderer.ts?raw'
import booksRaw from '../src/books.ts?raw'
import agentV1Raw from '../src/routes/agent-v1.ts?raw'

// Book 17 Definition of Done, Documentation (MASTERPROMPT.md): "Rewrite the README truthfully.
// ... Make no claim that is not technically guaranteed."
//
// The README is the first thing a reader believes and the last thing anybody updates, so it is
// the document most likely to be describing a repository that no longer exists. The one it
// replaced claimed eight tabs when the code shipped five, thirty-three tables across seven
// migrations when there are far more of both, a live sandbox URL nobody can reach, and a
// "Last Updated" date months behind the work. None of that was a lie when it was written. That
// is exactly the problem: a hand-maintained README decays into falsehood without anybody
// deciding to make it false.
//
// So the same rule as the other seven documents applies here, and one rule more. B17.13 requires
// the tab discrepancy to be RECORDED rather than silently corrected — quietly writing "five"
// over "eight" would erase the evidence that this document was wrong for months, and the record
// of having been wrong is the only reason to trust the next number in it.
//
// Derived here:
//   - the bottom-bar tabs and their faces, from `public/static/app/core/shell.js`
//   - the migration count and the live table count, from `migrations/`
//   - the shelf and its chapter counts, from `src/books.ts`
//   - the agent v1 surface, from `src/routes/agent-v1.ts`
//   - the gate figures, from the test files that exist
//   - whether the service worker versions its cache, from `src/renderer.ts`

// `?raw` returns the working tree byte-for-byte, and on a Windows checkout with
// `core.autocrlf=true` that is CRLF. A `\n`-anchored derivation then silently matches nothing,
// which is the one failure mode a guard must not have. Normalise once, floor everything.
const lf = (text: string) => text.replace(/\r\n/g, '\n')
const readme = lf(readmeRaw)
const shellSrc = lf(shellRaw)
const rendererSrc = lf(rendererRaw)
const booksSrc = lf(booksRaw)
const agentV1Src = lf(agentV1Raw)

const flat = (text: string) => text.replace(/\s+/g, ' ')
const DOC = flat(readme)

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`${what} could not be derived from source, so this guard is inert`)
  }
  return value
}

/** `## Title` … up to the next heading of equal-or-shallower depth. Same convention as the
 *  seven other documentation guards: a claim is checked inside the section that makes it. */
function docSection(heading: string): string {
  const at = readme.indexOf(heading)
  if (at === -1) return ''
  const depth = must(heading.match(/^#+/), 'the heading depth')[0].length
  const rest = readme.slice(at + heading.length)
  const next = rest.search(new RegExp(`\\n#{2,${depth}} `))
  return flat(next === -1 ? rest : rest.slice(0, next))
}

const TAB_IDS = [...must(
  /const tabs = \[([\s\S]*?)\n\s*\]/.exec(shellSrc), 'the bottom-bar tab list',
)[1].matchAll(/\['([a-z]+)'/g)].map((m) => m[1])

const FACES = [...must(
  /export const SEGMENTS = \{([\s\S]*?)\n\}/.exec(shellSrc), 'the SEGMENTS face map',
)[1].matchAll(/\['([a-z-]+)',\s*'([A-Z ]+)'\]/g)].map((m) => m[2])

const BOOK_CHAPTERS = Object.fromEntries([...must(
  /BOOK_CHAPTER_COUNTS: Record<string, number> = \{([\s\S]*?)\n\}/.exec(booksSrc),
  'BOOK_CHAPTER_COUNTS',
)[1].matchAll(/(\w+):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]))

const AGENT_V1 = [...new Set(
  [...agentV1Src.matchAll(/\.(?:get|post)\(\s*'(\/api\/agent\/v1[^']*)'/g)].map((m) => m[1]),
)].sort()

describe('Book 17 documentation — README.md describes the repository that exists', () => {
  it('is a document, is sectioned, and points at the seven documents that carry the detail', () => {
    expect(readme.length, 'README.md is empty or missing').toBeGreaterThan(3000)
    expect([...readme.matchAll(/^## /gm)].length, 'README.md has no sections')
      .toBeGreaterThanOrEqual(8)
    // The README's job is to be true and to hand off. Each of these owns a claim the README
    // must not restate in its own words, because a second copy is a copy that drifts.
    for (const doc of [
      'SECURITY.md', 'PRIVACY.md', 'ARCHITECTURE.md', 'MIGRATIONS.md', 'DEPLOYMENT.md',
      'CURRICULUM_GUIDE.md', 'AI_SAFETY.md', 'OPERATIONS.md', 'STATUS.md',
    ]) {
      expect(DOC, `README.md does not point at ${doc}`).toContain(doc)
    }
  })

  it('states the navigation that ships, and records the count it used to claim', () => {
    expect(TAB_IDS.length, 'no bottom-bar tabs were derived, so this check is inert')
      .toBeGreaterThanOrEqual(5)
    expect(FACES.length, 'no segmented-control faces were derived, so this check is inert')
      .toBeGreaterThanOrEqual(10)
    const section = docSection('## The navigation')
    expect(section.length, 'README.md has no navigation section').toBeGreaterThan(300)
    // Both numbers, because either alone misleads: five is the bar, thirteen is what the
    // commander can actually reach. The count is accepted as the digit or as its own English
    // word and nothing else — an alternation that also accepted the neighbouring words would
    // let the exact defect this file is being rewritten to remove pass unnoticed.
    const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
    const spelled = must(WORDS[TAB_IDS.length] ?? null, `the English word for ${TAB_IDS.length}`)
    expect(section, `the navigation section does not state the ${TAB_IDS.length} bottom-bar tabs`)
      .toMatch(new RegExp(`\\b(${TAB_IDS.length}|${spelled})\\b`, 'i'))
    // And the tabs by name, so "five tabs" cannot stand over a bar that renamed one.
    for (const id of TAB_IDS) {
      expect(section, `the navigation section does not name the ${id} tab`)
        .toMatch(new RegExp(`\\b${id}\\b`, 'i'))
    }
    expect(section, `the navigation section does not state the ${FACES.length} faces`)
      .toContain(String(FACES.length))
    for (const face of FACES) {
      expect(section, `the navigation section does not name the ${face} face`).toContain(face)
    }
    // B17.13: the discrepancy is RECORDED, not corrected away. Writing "five" over "eight"
    // and saying nothing would delete the evidence that this file was wrong for months.
    expect(section, 'the navigation section does not record that this README claimed eight tabs')
      .toMatch(/claimed eight|said eight|eight tabs/i)
    expect(section, 'the navigation section does not record the nine tabs that were collapsed')
      .toMatch(/nine/i)
  })

  it('states the schema size as the migrations actually leave it', async () => {
    const SQL = import.meta.glob('../migrations/*.sql', {
      query: '?raw', import: 'default', eager: true,
    }) as Record<string, string>
    const files = Object.keys(SQL).sort()
    expect(files.length, 'no migrations were globbed, so this check is inert')
      .toBeGreaterThanOrEqual(20)
    // Comments first. `-- ROLLBACK …: DROP TABLE x;` is a note to a human, not a statement
    // SQLite runs, and counting those makes this directory look an order of magnitude more
    // destructive than it is. MIGRATIONS.md §5 makes the same split for the same reason.
    const strip = (sql: string) => lf(sql).split('\n')
      .filter((line) => !/^\s*--/.test(line)).join('\n')
    const created = new Set<string>()
    const dropped = new Set<string>()
    const renamedFrom = new Set<string>()
    const renamedTo = new Set<string>()
    for (const path of files) {
      const sql = strip(SQL[path])
      for (const m of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? ([a-z0-9_]+)/g)) created.add(m[1])
      for (const m of sql.matchAll(/DROP TABLE(?: IF EXISTS)? ([a-z0-9_]+)/g)) dropped.add(m[1])
      for (const m of sql.matchAll(/ALTER TABLE ([a-z0-9_]+) RENAME TO ([a-z0-9_]+)/g)) {
        renamedFrom.add(m[1])
        renamedTo.add(m[2])
      }
    }
    const live = [...created, ...renamedTo]
      .filter((name) => !dropped.has(name) || renamedTo.has(name))
      .filter((name) => !renamedFrom.has(name))
    const liveCount = new Set(live).size
    expect(created.size, 'no CREATE TABLE statements were parsed, so this check is inert')
      .toBeGreaterThanOrEqual(20)
    const section = docSection('## The data')
    expect(section.length, 'README.md has no data section').toBeGreaterThan(200)
    expect(section, `the data section does not state the ${files.length} migrations`)
      .toContain(String(files.length))
    expect(section, `the data section does not state the ${liveCount} live tables`)
      .toContain(String(liveCount))
    // The specific stale claim this rewrite exists to remove. It was true at 0007.
    expect(DOC, 'README.md still claims 33 tables across 7 migrations')
      .not.toMatch(/33 tables across 7 migrations/)
  })

  it('states the shelf and every chapter count the code pins, in both directions', () => {
    const titles = Object.keys(BOOK_CHAPTERS)
    expect(titles.length, 'no book chapter counts were derived, so this check is inert')
      .toBeGreaterThanOrEqual(11)
    const section = docSection('## The books')
    expect(section.length, 'README.md has no books section').toBeGreaterThan(200)
    expect(section, `the books section does not state that the shelf holds ${titles.length}`)
      .toContain(String(titles.length))
    // Every count, because "11 books" plus a wrong per-book number is still a false README,
    // and because the old one implied a flat twelve-chapter book everywhere.
    for (const [book, chapters] of Object.entries(BOOK_CHAPTERS)) {
      expect(
        section,
        `the books section does not state the chapter count for ${book} (${chapters})`,
      ).toContain(String(chapters))
    }
  })

  it('lists the agent surface the router actually declares, in both directions', () => {
    expect(AGENT_V1.length, 'no agent v1 routes were derived, so this check is inert')
      .toBeGreaterThanOrEqual(8)
    const section = docSection('## The Hermes bridge')
    expect(section.length, 'README.md has no bridge section').toBeGreaterThan(300)
    for (const route of AGENT_V1) {
      expect(section, `the bridge section does not list ${route}`).toContain(route)
    }
    // The other direction: a path listed here that the router no longer serves is an
    // instruction to call something that will 404.
    const listed = [...new Set(
      [...section.matchAll(/(\/api\/agent\/v1[a-z/-]*)/g)].map((m) => m[1]),
    )].sort()
    expect(listed, 'README.md lists agent routes src/routes/agent-v1.ts does not declare')
      .toEqual(AGENT_V1)
  })

  it('states the gate as the test files that exist, not as a remembered number', async () => {
    const SERVER = import.meta.glob('../test/**/*.test.ts', {
      query: '?raw', import: 'default', eager: true,
    }) as Record<string, string>
    const CRON = import.meta.glob('../workers/**/*.test.ts', {
      query: '?raw', import: 'default', eager: true,
    }) as Record<string, string>
    // Vite's `import.meta.glob` does not return the file that calls it, so this glob is
    // structurally blind to exactly one path — this one — and every count derived from it
    // is one short. `test/handoff-consistency.test.ts` was bitten by this and records the
    // measurement; the correction is the same here, and asserted rather than assumed,
    // because if Vite ever starts including the importer then `+ SELF` silently
    // double-counts and shifts the README's figure by one in the flattering direction.
    const SELF = '../test/readme-truthfulness.test.ts'
    const globbed = Object.keys(SERVER)
    expect(
      globbed.some((path) => path.endsWith('readme-truthfulness.test.ts')),
      'import.meta.glob now returns the importing file, so adding SELF double-counts',
    ).toBe(false)
    const dom = globbed.filter((p) => p.endsWith('.dom.test.ts'))
    const server = [...globbed, SELF].filter((p) => !p.endsWith('.dom.test.ts'))
      .concat(Object.keys(CRON))
    expect(server.length, 'no server test files were globbed, so this check is inert')
      .toBeGreaterThanOrEqual(50)
    expect(dom.length, 'no DOM test files were globbed, so this check is inert')
      .toBeGreaterThanOrEqual(5)
    // The cron worker test lives outside `test/`, and a guard that globs only `test/**`
    // reports one fewer file than `vitest run` does. Prove the glob still reaches it.
    expect(
      Object.keys(CRON).length,
      'the glob no longer reaches the cron worker test, so the file count under-reports',
    ).toBeGreaterThanOrEqual(1)
    const section = docSection('## The gate')
    expect(section.length, 'README.md has no gate section').toBeGreaterThan(200)
    expect(section, `the gate section does not state the ${server.length} server test files`)
      .toContain(String(server.length))
    expect(section, `the gate section does not state the ${dom.length} DOM test files`)
      .toContain(String(dom.length))
    expect(section, 'the gate section does not name the one command that is the gate')
      .toContain('npm run verify')
  })

  it('records that the service worker cache is unversioned, and stops once it is not', () => {
    const worker = must(
      /export const SERVICE_WORKER = `([\s\S]*?)`\n/.exec(rendererSrc), 'SERVICE_WORKER',
    )[1]
    // The condition: the worker names one fixed cache and never enumerates or deletes the
    // old ones on activate. While that holds a stale asset can outlive a deploy, and the
    // README is required to say so. The moment `activate` starts purging, the README is
    // forbidden to keep warning about it. One pattern, both directions — the shape the
    // curriculum guard had to be repaired into.
    const purges = /caches\.keys\(\)/.test(worker) && /caches\.delete\(/.test(worker)
    const STALE_CLAIM = /cache is not versioned|unversioned|does not purge|never purge|no cache invalidation/i
    const section = docSection('## Known gaps')
    expect(section.length, 'README.md has no known-gaps section').toBeGreaterThan(200)
    if (!purges) {
      expect(section, 'the known-gaps section does not record the unversioned service-worker cache')
        .toMatch(STALE_CLAIM)
    } else {
      expect(
        section,
        'the service worker now purges old caches, and the README still calls the cache unversioned',
      ).not.toMatch(STALE_CLAIM)
    }
  })

  it('claims no deployment, and carries no URL it cannot stand behind', () => {
    // The sandbox host in the old README was unreachable and unverifiable, and a URL in a
    // README is read as an invitation. Nothing outside this repository may be presented as
    // live, because repository work cannot verify it.
    expect(DOC, 'README.md still advertises the sandbox host')
      .not.toMatch(/sandbox\.novita\.ai/)
    expect(DOC, 'README.md advertises a live http(s) host as the running application')
      .not.toMatch(/\bhttps?:\/\/(?!fonts\.|github\.com|www\.gutenberg\.org|creativecommons\.org)/)
    const section = docSection('## Deployment')
    expect(section.length, 'README.md has no deployment section').toBeGreaterThan(200)
    expect(section, 'the deployment section does not state that nothing has been deployed')
      .toMatch(/not (?:been )?deploy|no deploy|never been deployed/i)
    expect(section, 'the deployment section does not state the operator boundary')
      .toMatch(/operator/i)
  })

  it('closes with what it does not claim, in the section that owns them', () => {
    const section = docSection('## What this README does not claim')
    expect(section.length, 'README.md has no non-claims section').toBeGreaterThan(300)
    const NON_CLAIMS: ReadonlyArray<readonly [RegExp, string]> = [
      [/does not claim|makes no claim/i, 'that the README does not claim what follows'],
      [/deploy/i, 'that nothing here has been deployed'],
      [/audit|review|certif/i, 'that it is not an audit or a certification'],
      [/silence|absence|not name/i, 'that its silence is not a guarantee'],
    ]
    for (const [pattern, what] of NON_CLAIMS) {
      expect(section, `the non-claims section does not state ${what}`).toMatch(pattern)
    }
  })
})
