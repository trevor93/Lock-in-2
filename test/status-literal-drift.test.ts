import { describe, expect, it } from 'vitest'
import shellSrc from '../public/static/app/core/shell.js?raw'
import librarySrc from '../public/static/app/features/library.js?raw'
import campaignSrc from '../public/static/app/features/campaign.js?raw'
import debriefSrc from '../public/static/app/features/debrief.js?raw'
import mindSrc from '../public/static/app/features/mind.js?raw'
import councilSrc from '../public/static/app/features/council.js?raw'
import responseLabSrc from '../public/static/app/features/response-lab.js?raw'
import rhetoricSrc from '../public/static/app/features/rhetoric.js?raw'
import eventsSrc from '../public/static/app/core/events.js?raw'
import storeSrc from '../public/static/app/core/store.js?raw'
import fxSrc from '../public/static/app/core/fx.js?raw'
import morphSrc from '../public/static/app/core/morph.js?raw'
import sanitizeSrc from '../public/static/app/core/sanitize.js?raw'
import blockStatusClientSrc from '../public/static/app/core/block-status.js?raw'
import dayRouteSrc from '../src/routes/day.ts?raw'
import agentV1Src from '../src/routes/agent-v1.ts?raw'
import enforcementSrc from '../src/enforcement.ts?raw'
import { BLOCK_STATUSES } from '../src/block-status'

// Book 8.3, guarded structurally rather than case by case.
//
// This audit has now found the SAME defect five times: a hand-written list of status
// literals that stopped being exhaustive the moment the taxonomy moved. The SQL
// literals that kept saying 'done','partial' after the predicates had moved on. The
// appeal route acknowledging `missed_live`, a flag type nothing had filed since
// 2c07344. The overnight engine's skip list naming exactly one status, which charged a
// diagnosed miss twice and a self-reported miss not at all. And in the renderer,
// `b.log_status==='done'` deciding how to draw a row while the buttons wrote
// `completed` — so every block he logged came back looking untouched.
//
// One test per instance can only ever catch the instance. This catches the SHAPE: an
// equality test against a block-status spelling, anywhere in the shipped client,
// outside the taxonomy module that is allowed to define them.

const CLIENT_MODULES: Array<[string, string]> = [
  ['core/shell.js', shellSrc],
  ['features/library.js', librarySrc],
  ['features/campaign.js', campaignSrc],
  ['features/debrief.js', debriefSrc],
  ['features/mind.js', mindSrc],
  ['features/council.js', councilSrc],
  ['features/response-lab.js', responseLabSrc],
  ['features/rhetoric.js', rhetoricSrc],
  ['core/events.js', eventsSrc],
  ['core/store.js', storeSrc],
  ['core/fx.js', fxSrc],
  ['core/morph.js', morphSrc],
  ['core/sanitize.js', sanitizeSrc],
]

const ALTERNATION = (BLOCK_STATUSES as readonly string[]).join('|')

/**
 * The comparison has to be tied to a BLOCK status, not to any status-shaped word.
 * `unit_progress.status` legitimately takes 'active' (curriculum, Book 10), and a first
 * pass at this regex flagged campaign.js's `u.status==='active'` as a block literal —
 * the same over-match that read a day-scoped flag as block-scoped in
 * test/appeal-flag-clearing.test.ts. So the left side must be `log_status` itself, or a
 * local whose declaration in the same source reads `= <something>.log_status`.
 */
function statusLiteralMatcher(src: string): RegExp {
  const aliases = new Set<string>(['log_status'])
  const decl = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*\.log_status/g
  for (const m of src.matchAll(decl)) aliases.add(m[1])
  const holder = [...aliases].join('|')
  return new RegExp(
    `(?:${holder})\\s*[=!]==\\s*'(?:${ALTERNATION})'`
    + `|'(?:${ALTERNATION})'\\s*[=!]==\\s*(?:${holder})`,
    'g',
  )
}

/**
 * Blank every comment out, keeping the line count so an offence still reports the line
 * it sits on. Per-line stripping is not enough: a block comment spans lines, and the
 * continuation lines of this audit's own explanation — the one recording WHY the
 * auto-cancel language was removed — were reported as offences by the first version of
 * this scan. A comment explaining the removal is the opposite of a claim that the engine
 * still auto-cancels.
 *
 * The line-comment pass leaves `//` alone when a colon precedes it, so a URL inside a
 * string does not blank out the rest of a real line of code.
 */
function stripComments(src: string): string {
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ')
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + blank(m.slice(p1.length)))
}

/** The scanned lines of one source: comments blanked, numbering intact. */
const codeLines = (src: string): string[] => stripComments(src).split('\n')

describe('B8.3 no shipped client module compares a block status to a literal', () => {
  it('scans a non-empty body of source, so a broken import fails loudly', () => {
    // Without this floor an import that resolved to '' would report zero findings and
    // the guard would pass while guarding nothing — the same failure mode as an empty
    // regex match in test/block-status-mirror.test.ts.
    for (const [name, src] of CLIENT_MODULES) {
      expect(src.length, `${name} came back empty`).toBeGreaterThan(50)
    }
    expect(CLIENT_MODULES.length, 'the module list shrank').toBeGreaterThanOrEqual(13)
  })

  it('the matcher really catches the defect it exists for, so the rule is enforced not assumed', () => {
    // A guard built out of a regex has to be shown to fire. This is the exact line the
    // renderer carried until this audit, fed through the same matcher the scan uses.
    const sample = "  const done = b.log_status==='done', part = b.log_status==='partial';"
    expect(
      [...sample.matchAll(statusLiteralMatcher(sample))].length,
      'the matcher cannot see the defect it exists for',
    ).toBeGreaterThanOrEqual(2)
    // And it must NOT fire on the curriculum's own status column.
    const unit = "  if (u.status === 'active') return stepForm(u);"
    expect(
      [...unit.matchAll(statusLiteralMatcher(unit))].length,
      'unit_progress.status is not a block status',
    ).toBe(0)
  })

  it('the comment stripper keeps line numbering, so an offence reports its real line', () => {
    const src = ['a', '/* two', 'three */', 'four'].join('\n')
    const out = stripComments(src).split('\n')
    expect(out).toHaveLength(4)
    expect(out[0]).toBe('a')
    expect(out[1].trim(), 'a block comment survived the strip').toBe('')
    expect(out[2].trim()).toBe('')
    expect(out[3]).toBe('four')
    // A URL is not a comment.
    expect(stripComments("const u = 'https://x.test/y'")).toContain('https://x.test/y')
  })

  it("finds no `=== '<status>'` outside core/block-status.js", () => {
    const offences: string[] = []
    for (const [name, src] of CLIENT_MODULES) {
      const pattern = statusLiteralMatcher(src)
      codeLines(src).forEach((line, i) => {
        for (const m of line.matchAll(pattern)) offences.push(`${name}:${i + 1} ${m[0].trim()}`)
      })
    }
    expect(
      offences,
      'ask core/block-status.js instead: a literal here is how a `completed` block came to render as untouched',
    ).toEqual([])
  })

  it('the taxonomy module is the one place allowed to name them', () => {
    // It defines the spellings, so it necessarily contains them. This asserts the
    // exemption is real rather than assumed — if the predicates moved out of this file,
    // the scan above would be enforcing a rule with no home.
    expect(blockStatusClientSrc).toContain("'unreported'")
    expect(blockStatusClientSrc, 'the predicates left the taxonomy module').toContain('export const isUnreported')
    expect(blockStatusClientSrc).toContain('export const isMissed')
  })
})

describe('B8.3 nothing shipped claims an auto-cancellation or a penalty it did not take', () => {
  // "A block is never auto-cancelled merely because its window passed. unreported is a
  // data state, not a moral one; it carries a prompt, not a penalty." The same-day close
  // writes `unreported` and moves no points, so an interface line or an API error that
  // announces an auto-cancellation with the penalty applied describes the engine
  // 2c07344 replaced. `missed` survives only as a status the commander sets himself,
  // and since this audit's enforcement fix it draws the ordinary overnight −10 and stays
  // appealable — which is a verdict, not an automatic cancellation.
  //
  // The first version of this list named `auto-cancel` alone, and the audit's own sweep
  // then found `'WINDOW CLOSED. Auto-missed blocks require an appeal.'` sitting in the
  // Hermes log route - the SAME untrue claim in a spelling the list had not thought of,
  // told to an agent rather than to the commander. So the pattern now covers any verb the
  // engine is said to apply to a block by itself, not one chosen wording of it.
  const UNTRUE = [
    /auto-?(cancel|miss|fail|penalis|penaliz|forfeit)/i,
    /automatically (cancel|miss|penalis|penaliz|forfeit)/i,
    /penalty applied/i, /penalty taken/i, /the penalty stands/i,
  ]

  it('no client module and no route message uses the auto-cancel language', () => {
    const scanned: Array<[string, string]> = [
      ...CLIENT_MODULES,
      ['src/routes/day.ts', dayRouteSrc],
      ['src/routes/agent-v1.ts', agentV1Src],
    ]
    const offences: string[] = []
    for (const [name, src] of scanned) {
      codeLines(src).forEach((line, i) => {
        for (const rx of UNTRUE) {
          if (rx.test(line)) offences.push(`${name}:${i + 1} ${line.trim().slice(0, 110)}`)
        }
      })
    }
    expect(offences, 'Book 8.3 removed the auto-cancellation; this language outlived it').toEqual([])
  })

  it('the pattern catches both spellings this audit actually found in shipped code', () => {
    // Not hypothetical strings: these are the two lines that were live when this guard
    // was written - one aimed at the commander, one at an agent. A guard built out of a
    // regex has to be shown to fire on the real defect, or it is a rule nobody enforces.
    const REAL = [
      "error: 'WINDOW CLOSED. \"' + block.title + '\" was auto-canceled unlogged'",
      "return c.json({ error: 'WINDOW CLOSED. Auto-missed blocks require an appeal.' }, 409)",
      "FX.toast('AUTO-CANCELED — PENALTY APPLIED', 'bad')",
    ]
    for (const line of REAL) {
      expect(
        UNTRUE.some((rx) => rx.test(line)),
        `the pattern cannot see: ${line}`,
      ).toBe(true)
    }
    // And it must not fire on a line that merely uses the word `missed` truthfully.
    expect(
      UNTRUE.some((rx) => rx.test("error: 'RECORDED AS MISSED by the commander.'")),
      'the pattern over-matches an honest message',
    ).toBe(false)
  })

  it('and the engine still records the rule in its own comment', () => {
    expect(enforcementSrc).toMatch(/never auto-cancelled merely/i)
  })
})
