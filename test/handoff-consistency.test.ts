import { describe, expect, it } from 'vitest'
import handoffSrc from '../OPERATOR_HANDOFF.md?raw'
import statusSrc from '../STATUS.md?raw'
import { migrationPaths } from './setup'

// Book 17.5 and the standing rule that STATUS.md is the only progress record: the
// operator handoff is the document a human follows with production credentials in hand.
// Every number in it is an instruction.
//
// Three of its numbers were wrong at the same time, and all three were wrong the same
// way — written true, then never touched as the thing they counted grew:
//
//   1. "475 server tests across 48 files + 25 DOM tests across 6 files green" — the gate
//      at some earlier commit. The real gate is 59 files and 9 DOM files. An operator
//      who ran the suite, saw different numbers, and trusted the document over the
//      output would conclude the working tree was wrong.
//   2. "All five must pass" printed directly beneath a block of SEVEN commands. Which
//      five? The operator has to guess which two do not matter, and the two that look
//      most skippable — the DOM suite and `git diff --check` — are the two the rest of
//      this audit has repeatedly found to be the only thing standing between a defect
//      and production.
//   3. "All seventeen are additive" under a heading that reads `0012`–`0029`. That range
//      is eighteen migrations. The count was true when the range ended at `0028`.
//
// This is the audit's recurring defect in its purest form: a hand-written count that
// stopped being exhaustive the moment the thing it counts grew. Correcting the three
// numbers by hand would be the fourth instance of the same mistake, so this guard
// DERIVES each of them — from the file system, or from the document's own body — and
// fails loudly if a derivation breaks rather than quietly checking less.

// ---------------------------------------------------------------------------
// The lexicon. Not a fact about the app, so it cannot go stale like one.
// ---------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  'twenty-one': 21, 'twenty-two': 22, 'twenty-three': 23, 'twenty-four': 24,
  'twenty-five': 25, 'twenty-six': 26, 'twenty-seven': 27, 'twenty-eight': 28,
  'twenty-nine': 29, thirty: 30,
  // "both" is not a numeral but it is an exact quantifier — it means two and cannot mean
  // anything else, which is the only property this lexicon cares about. It is here
  // because the preflight is now two commands and "All two must pass" is not English.
  both: 2,
}

/**
 * `"seventeen"` → 17, `"17"` → 17, `"**565"` → 565, anything else → null.
 *
 * The emphasis strip is here rather than in each pattern because these are markdown
 * documents and the gate sentence is bold: `**565 server tests across 60 files**`. A
 * `(\S+)` capture in front of "server tests" therefore hands over `**565`, and without
 * this the guard would report "the total is unreadable" for a perfectly readable total —
 * a guard failing on its own formatting rather than on a defect.
 */
function asNumber(token: string): number | null {
  const word = token.trim().replace(/^[*`_]+|[*`_]+$/g, '').toLowerCase()
  if (word in NUMBER_WORDS) return NUMBER_WORDS[word]
  return /^\d+$/.test(word) ? Number(word) : null
}

// ---------------------------------------------------------------------------
// The derivations.
// ---------------------------------------------------------------------------

/**
 * Every test file the two vitest projects actually run.
 *
 * TWO WAYS THIS GLOB UNDER-REPORTS, BOTH OF WHICH BIT.
 *
 * 1. `test/*` is not the whole set. The root config's default include reaches the whole
 *    repository, and there is one test file outside the test directory:
 *    `workers/enforcement-cron/src/index.test.ts`. A guard globbing only `test/**` would
 *    have reported 59 where the runner reports 60 — and then "corrected" a truthful
 *    document into a false one.
 *
 * 2. Vite's `import.meta.glob` EXCLUDES THE FILE THAT CALLS IT. Measured, not assumed:
 *    a probe file globbing `../test/*.test.ts` reported 68 while 69 files sat on disk,
 *    and did not find itself in the list. So this guard is structurally blind to exactly
 *    one file — itself — and every count it derives is one short unless corrected.
 *
 * A guard that is silently one short is the audit's recurring defect wearing the costume
 * of a derivation, so the correction is asserted rather than assumed: the self-exclusion
 * must still be happening, and `SELF` must still be a real path. If Vite ever starts
 * including the importer, `+ SELF` would double-count — so that case fails loudly here
 * instead of quietly shifting every number in the handoff by one.
 */
const SELF = '../test/handoff-consistency.test.ts'

const globbedTestPaths = [
  ...Object.keys(import.meta.glob('../test/*.test.ts', { eager: false })),
  ...Object.keys(import.meta.glob('../workers/**/*.test.ts', { eager: false })),
]

const allTestPaths = [...globbedTestPaths, SELF].sort()

const domTestPaths = allTestPaths.filter((p) => p.includes('.dom.test.ts'))
const serverTestPaths = allTestPaths.filter((p) => !p.includes('.dom.test.ts'))

/** `0012` and `0029` → every migration on disk numbered within that inclusive range. */
function migrationsInRange(from: number, to: number): string[] {
  return migrationPaths.filter((p) => {
    const n = Number((p.split('/').pop() ?? '').slice(0, 4))
    return Number.isFinite(n) && n >= from && n <= to
  })
}

/** The fenced block under a `## N. <title>` heading, or '' when the heading moved. */
function fencedBlockUnder(src: string, heading: RegExp): string {
  const after = src.split(heading)[1] ?? ''
  const fence = after.match(/```[a-z]*\n([\s\S]*?)```/)
  return fence ? fence[1] : ''
}

/** The prose of section 2, up to section 3. '' if the heading moved. */
function migrationSection(src: string): string {
  const after = src.split(/^## 2\. Apply migrations[^\n]*\n/m)[1] ?? ''
  return after.split(/^## 3\./m)[0] ?? ''
}

/** Command lines in a shell block: non-blank, not a comment. */
const commandLines = (block: string): string[] =>
  block.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))

describe('B17.5 the operator handoff counts what is actually there', () => {
  it('reads real documents and real globs, so a broken derivation fails loudly', () => {
    // Without this floor every claim below could pass over an empty string or an empty
    // list — the vacuous pass, which in a handoff document means an operator following
    // instructions nothing checked.
    expect(handoffSrc.length, 'OPERATOR_HANDOFF.md came back empty').toBeGreaterThan(3000)
    expect(statusSrc.length, 'STATUS.md came back empty').toBeGreaterThan(3000)
    expect(serverTestPaths.length, 'the server test glob came back empty').toBeGreaterThanOrEqual(50)
    expect(domTestPaths.length, 'the DOM test glob came back empty').toBeGreaterThanOrEqual(9)
    expect(
      allTestPaths.some((p) => p.includes('workers/')),
      'the glob no longer reaches the cron worker test — the file count will under-report',
    ).toBe(true)
    expect(migrationPaths.length, 'the migration glob came back empty').toBeGreaterThanOrEqual(29)
  })

  it('corrects for its own blind spot, and only while that blind spot is real', () => {
    // See the note on SELF. `import.meta.glob` does not return the file that calls it, so
    // this guard adds itself back by hand. A hand-added entry is exactly the kind of thing
    // that rots, so both halves of it are checked here: the file must still be missing
    // from the glob (or `+ SELF` is now a double-count), and it must still be the name
    // this file actually has (or `+ SELF` is inventing a test file that does not exist).
    expect(
      globbedTestPaths.some((p) => p.endsWith('handoff-consistency.test.ts')),
      'import.meta.glob now returns the importing file, so adding SELF double-counts and '
      + 'every derived number here is one too high — drop the `+ SELF`',
    ).toBe(false)
    expect(
      allTestPaths.filter((p) => p === SELF).length,
      'SELF is listed more than once',
    ).toBe(1)
    // And the name in SELF must be this file's real name. `import.meta.url` is the only
    // thing here that cannot be wrong about that.
    expect(
      import.meta.url.endsWith(SELF.replace('../test/', '/test/')),
      `SELF is "${SELF}" but this file is actually ${import.meta.url} — renaming the file `
      + 'without updating SELF would silently count a file that does not exist',
    ).toBe(true)
  })

  it('the lexicon reads both words and digits, and refuses anything else', () => {
    expect(asNumber('seven')).toBe(7)
    expect(asNumber('Eighteen')).toBe(18)
    expect(asNumber('18')).toBe(18)
    expect(asNumber('**565'), 'markdown emphasis made a readable number unreadable').toBe(565)
    expect(asNumber('`60`')).toBe(60)
    expect(asNumber('several'), 'a vague word was accepted as a count').toBeNull()
    expect(asNumber('**'), 'emphasis with no number behind it was accepted').toBeNull()
    expect(asNumber('60-ish'), 'an approximation was accepted as a count').toBeNull()
  })

  it('the preflight says how many commands must pass, and means the number it prints', () => {
    // DEFECT 2. "All five must pass" under seven commands leaves the operator choosing
    // which two to skip.
    const block = fencedBlockUnder(handoffSrc, /^## 1\. Preflight[^\n]*\n/m)
    expect(block, 'the preflight block moved or lost its fence').not.toBe('')
    const commands = commandLines(block)
    // The floor was five when the gate was five commands printed by hand. That list is
    // what went stale — it named `npm test`, which excluded the DOM project, so the block
    // ran 572 of 620 tests and exited 0. The gate is now `npm ci` then `npm run verify`,
    // and this floor exists only to catch a block that has lost one of those two.
    expect(commands.length, 'the preflight block has no commands in it').toBeGreaterThanOrEqual(2)
    // The quantifier can be a digit, a number word, or "Both" — resolved to a number so
    // this keeps working at any list length rather than only at the length it was written for.
    const claim = handoffSrc.match(
      /All (\S+) (?:must pass|of these must pass)|(Both) (?:must pass|of these must pass)/,
    )
    expect(claim, 'the preflight no longer states how many commands must pass').not.toBeNull()
    const quantifier = claim![1] ?? claim![2]
    const claimed = asNumber(quantifier)
    expect(claimed, `"${quantifier}" is not a number this guard can read`).not.toBeNull()
    expect(
      claimed,
      `the preflight prints ${commands.length} commands and then says ${quantifier} must `
      + 'pass. An operator has to guess which ones do not count, and the two that look '
      + 'most skippable are the DOM suite and the whitespace check',
    ).toBe(commands.length)
  })

  it('the migration range and the count of migrations in it are the same number', () => {
    // DEFECT 3. The heading names the range; the sentence beneath counts it. Both are
    // derived from the same directory, so they cannot disagree once this holds.
    const heading = handoffSrc.match(/^## 2\. Apply migrations (\d{4})[–-](\d{4})/m)
    expect(heading, 'the migration section heading moved or lost its range').not.toBeNull()
    const [from, to] = [Number(heading![1]), Number(heading![2])]
    const inRange = migrationsInRange(from, to)
    expect(
      inRange.length,
      `the heading claims ${heading![1]}-${heading![2]} but no migration on disk falls in it`,
    ).toBeGreaterThan(0)
    const claim = handoffSrc.match(/All (\S+) are additive/)
    expect(claim, 'the section no longer says how many migrations it covers').not.toBeNull()
    expect(
      asNumber(claim![1]),
      `the heading covers ${inRange.length} migrations (${heading![1]}-${heading![2]}) and `
      + `the text below it says ${claim![1]}`,
    ).toBe(inRange.length)
    // And the highest migration on disk must be inside the range, or the operator applies
    // a prefix of the pending set and believes the section complete.
    const highest = (migrationPaths[migrationPaths.length - 1].split('/').pop() ?? '').slice(0, 4)
    expect(
      Number(highest) <= to,
      `migration ${highest} exists on disk but the handoff section stops at ${heading![2]}`,
    ).toBe(true)
  })

  it('every migration the operator is told to apply is described by name', () => {
    // The count above says how many; this says which. They are different failures. A
    // section could hold the right number of paragraphs and still never mention the
    // migration that needs the most care, and the operator is told to apply the whole
    // range "in filename order" — so anything unnamed here gets applied blind.
    //
    // Bullets are NOT the unit. §2 describes `0022` and `0023` in one bullet, exactly as
    // OPERATIONS.md §5.18 does, so counting bullets reports seventeen for eighteen
    // migrations. This reads filenames wherever they appear in the section instead, which
    // is what "described by name" actually means.
    const section = migrationSection(handoffSrc)
    expect(section.length, 'section 2 moved or lost its heading').toBeGreaterThan(1000)
    const heading = handoffSrc.match(/^## 2\. Apply migrations (\d{4})[–-](\d{4})/m)!
    const named = new Set(section.match(/00\d{2}[a-z_0-9]*\.sql/g) ?? [])
    const missing = migrationsInRange(Number(heading[1]), Number(heading[2]))
      .map((p) => p.split('/').pop()!)
      .filter((f) => !named.has(f))
    expect(
      missing,
      `section 2 tells the operator to apply ${heading[1]}-${heading[2]} in filename order `
      + 'but never says what these do, so they get applied blind',
    ).toEqual([])
  })

  it('the stated gate matches the test files that exist', () => {
    // DEFECT 1. Test TOTALS are not statically derivable — `it.each` in
    // test/request-validation.test.ts expands one call into several cases, so counting
    // `it(` under-reports. FILE counts are exact, so the file counts are what this guard
    // holds; a new test file therefore forces the sentence to be rewritten, and whoever
    // rewrites it refreshes the totals beside it.
    const gate = handoffSrc.match(
      /(\S+) server tests across (\S+) files \+ (\S+) DOM tests\s*\n?across (\S+) files/,
    )
    expect(gate, 'the handoff no longer states a local gate at all').not.toBeNull()
    expect(
      asNumber(gate![2]),
      `the handoff claims ${gate![2]} server test files; ${serverTestPaths.length} exist `
      + '(including workers/enforcement-cron/src/index.test.ts, which the root vitest '
      + 'config also runs)',
    ).toBe(serverTestPaths.length)
    expect(
      asNumber(gate![4]),
      `the handoff claims ${gate![4]} DOM test files; ${domTestPaths.length} exist`,
    ).toBe(domTestPaths.length)
    // The totals cannot be derived, but they can be sanity-bounded: a suite cannot have
    // fewer tests than it has files, and the DOM total is one `it` per test today.
    const serverTotal = asNumber(gate![1])
    const domTotal = asNumber(gate![3])
    expect(serverTotal, 'the server test total is unreadable').not.toBeNull()
    expect(domTotal, 'the DOM test total is unreadable').not.toBeNull()
    expect(serverTotal!, 'fewer server tests claimed than there are server test files')
      .toBeGreaterThanOrEqual(serverTestPaths.length)
    expect(domTotal!, 'fewer DOM tests claimed than there are DOM test files')
      .toBeGreaterThanOrEqual(domTestPaths.length)
  })

  it('STATUS.md does not contradict the handoff about the same gate', () => {
    // Two records of one fact drift apart the moment only one of them is updated. The
    // standing rule makes STATUS.md the progress record and the handoff the operator's
    // instructions; where they state the same number it must be the same number.
    //
    // STATUS.md states this fact in two phrasings ("48 server test files / 475 tests" and
    // "475 server tests across 48 files"), so both are read. Both were 48.
    //
    // DATED lines are exempt, and deliberately so. STATUS.md is a progress record: "On
    // 2026-08-15 ... the complete suite passed 54/54 across 7 files" is a true statement
    // about that day and rewriting it to today's number would be falsifying history —
    // the opposite of what this guard is for. An undated present-tense count, by
    // contrast, claims to describe the tree as it stands and must therefore be true now.
    // Attaching a date to a claim moves it into the historical record; that is a visible,
    // deliberate edit rather than a way to slip a stale number past this check.
    const gate = handoffSrc.match(/(\S+) server tests across (\S+) files/)!
    const undated = statusSrc
      .split('\n')
      .filter((line) => !/\b20\d\d-\d\d-\d\d\b/.test(line))
      .join('\n')
    const statusClaims = [
      ...undated.matchAll(/(\d+) server test files/g),
      ...undated.matchAll(/server tests across (\d+) files/g),
    ].map((m) => Number(m[1]))
    expect(
      statusClaims.length,
      'STATUS.md no longer states an undated server test file count, so this cross-check '
      + 'is inert. It must state the current gate somewhere, or the handoff is the only '
      + 'record of it and nothing cross-checks the handoff',
    ).toBeGreaterThan(0)
    for (const claimed of statusClaims) {
      expect(
        claimed,
        `STATUS.md says ${claimed} server test files and the handoff says ${gate![2]}; `
        + `${serverTestPaths.length} exist`,
      ).toBe(serverTestPaths.length)
    }
  })

  it('the preflight delegates to the one derived gate instead of listing suites', () => {
    // WHAT THIS USED TO ASSERT, AND WHY IT CHANGED — recorded because the reason is the
    // finding, not a refactor. It required this block to name `npm test` and
    // `vitest run --config vitest.dom.config.ts` literally, on three premises: `npm test`
    // was bare `vitest run`, `vitest.config.ts` excludes `**/*.dom.test.ts`, and there
    // was no CI — so the block was the only place the DOM suite was guaranteed to run.
    // All three are now false.
    //
    // The old form was also the audit's own root cause wearing a guard's clothes: a
    // hand-written list of config names, kept in a second document, that would go stale
    // the moment a third project was added and would then enforce the stale version.
    // Coverage is now asserted by DERIVATION in `test/gate-completeness.test.ts`, which
    // globs `vitest*.config.ts` and fails if the gate misses one — and which also holds
    // the typecheck assertion this guard used to duplicate. What is left here is the part
    // that genuinely belongs to the handoff: that the operator is sent to the whole gate
    // and not to some shorter thing that looks equivalent.
    const block = fencedBlockUnder(handoffSrc, /^## 1\. Preflight[^\n]*\n/m)
    expect(block, 'the preflight lost the single gate command').toMatch(/npm run verify/)
    expect(
      block,
      'the preflight no longer installs from the lockfile, so a green run says nothing '
      + 'about the committed dependency tree',
    ).toMatch(/npm ci/)
    expect(
      block,
      'the preflight calls bare `npm test` beside the gate, which invites an operator to '
      + 'treat the shorter command as sufficient — that is how 572 of 620 tests came to '
      + 'count as a pass',
    ).not.toMatch(/^npm test$/m)
  })
})
