import { describe, expect, it } from 'vitest'
import operationsSrc from '../OPERATIONS.md?raw'
import { migrationPaths } from './setup'

// Book 17.5: "Every schema change ships with a migration and a rollback note, tested
// against a local schema copy."
//
// The rollback notes were all written. What was NOT maintained was the sentence at the
// top of the gate telling the operator WHICH migrations the section covers. It said
// `0005`, `0006`, and `0007` — true when it was written, and never touched again as
// §5.4 through §5.24 were appended below it. An operator reading it would have applied
// three migrations to production D1, run the verification, seen it pass, and stopped,
// with twenty-two migrations still pending and every table they create absent.
//
// That is the same defect this whole audit keeps finding: a hand-written list that
// stopped being exhaustive the moment the thing it lists grew. The fix is the same one
// `test/setup.ts` already uses for the migrations themselves — DERIVE the list from the
// directory, and let a broken derivation fail loudly instead of silently covering less.

/** `0005_sessions_and_ownership.sql` → `0005`. */
const numberOf = (path: string): string => (path.split('/').pop() ?? '').slice(0, 4)

/**
 * `0001`–`0004` are the inherited baseline: authored and applied before this
 * remediation began, creating the tables the commander's history lives in. A rollback
 * note for `0001` would be an instruction to drop that history, which the standing rule
 * against deleting user data forbids. OPERATIONS.md §5 states this in prose; this
 * constant is the same adjudication in code, so the exemption is explicit rather than
 * an accident of a regex that happened not to match them.
 */
const INHERITED_BASELINE = ['0001', '0002', '0003', '0004']

const ALL = migrationPaths.map(numberOf)
const REMEDIATION = ALL.filter((n) => !INHERITED_BASELINE.includes(n))

describe('B17.5 every remediation migration has an operator runbook entry', () => {
  it('reads a real migrations directory and a real runbook, so a broken import fails loudly', () => {
    // Without this floor, a glob that resolved to nothing would find zero uncovered
    // migrations and this guard would pass while guarding nothing.
    expect(ALL.length, 'the migration glob came back empty').toBeGreaterThanOrEqual(29)
    expect(operationsSrc.length, 'OPERATIONS.md came back empty').toBeGreaterThan(5000)
    expect(REMEDIATION.length, 'the baseline exemption swallowed everything').toBeGreaterThanOrEqual(25)
  })

  it('names every migration from 0005 onward in a runbook subsection', () => {
    // The subsection headings are `### 5.N \`migrations/0024_rhetoric_track.sql\``, and
    // §5.18 deliberately covers two migrations in one heading. So the check is that the
    // migration's FILENAME appears under some `### 5.` heading — not that the count of
    // headings equals the count of migrations, which was never true.
    const sections = operationsSrc.split(/^### 5\./m).slice(1).join('\n')
    const uncovered = migrationPaths
      .map((p) => (p.split('/').pop() ?? ''))
      .filter((name) => !INHERITED_BASELINE.includes(name.slice(0, 4)))
      .filter((name) => !sections.includes(name))
    expect(uncovered, 'a migration ships with no rollback note in OPERATIONS.md §5').toEqual([])
  })

  it('every runbook subsection carries an actual rollback note, not just a heading', () => {
    // A subsection that exists but says nothing about reversal is worse than none: it
    // reads as covered. Each `### 5.N` block must contain a `**Rollback**` marker.
    const blocks = operationsSrc.split(/^### 5\./m).slice(1)
    const noNote = blocks
      .map((b) => b.split('\n')[0].trim())
      .filter((_, i) => !/\*\*Rollback/.test(blocks[i]))
    expect(noNote, 'a §5 subsection has no rollback note').toEqual([])
  })

  it('the gate preamble states the full range it covers, not the range it once covered', () => {
    // THE DEFECT ITSELF. The preamble is the operator's entry point; if it under-states
    // the range, the subsections below it are never reached. It must name the highest
    // migration on disk.
    const preamble = operationsSrc.split(/^### 5\.1 /m)[0]
    const highest = REMEDIATION[REMEDIATION.length - 1]
    expect(
      preamble,
      `the §5 preamble does not mention ${highest}, the highest migration on disk — `
      + 'an operator following it would stop short and believe the gate satisfied',
    ).toContain(highest)
  })

  it('the inherited baseline is adjudicated in writing rather than silently skipped', () => {
    // An exemption that exists only in this test file is an exemption the operator never
    // sees. OPERATIONS.md has to say why 0001-0004 have no rollback note, or the next
    // reader will record it as an outstanding gap and try to close it by writing one.
    const preamble = operationsSrc.split(/^### 5\.1 /m)[0]
    for (const n of INHERITED_BASELINE) {
      expect(preamble, `the runbook never explains why ${n} has no rollback note`)
        .toMatch(new RegExp(n))
    }
    expect(preamble).toMatch(/inherited baseline/i)
  })
})
