// Book 17 Definition of Done, Documentation: "PRIVACY.md including a data-minimisation
// justification for every field the Commander's File emits."
//
// A hand-written field table is the defect this repository keeps finding: correct the day it
// is written, silently incomplete the moment the emitter grows, and nothing tells you. So the
// field list is DERIVED from `src/commanders-file.ts` and PRIVACY.md is required to carry a
// justified row for each. Add a field to the briefing and this suite fails until the field is
// justified in writing — which is the only mechanism that makes "every field" true tomorrow
// as well as today.
//
// Both directions are checked. An undocumented emitted field is an unjustified disclosure; a
// documented field that is no longer emitted is a stale claim about what the application does,
// and this repository has already shipped one of those.
import { describe, it, expect } from 'vitest'
import commandersFileSrc from '../src/commanders-file.ts?raw'
import privacySrc from '../PRIVACY.md?raw'

// Properties that are JavaScript, not data. A property immediately followed by `(` is a call
// and is excluded by the pattern itself; these are the ones that can appear without parens.
const NOT_DATA = new Set(['map', 'join', 'slice', 'length', 'toFixed', 'trim', 'filter', 'replace'])

/** Every interpolated value inside one emitter's template literal. */
function emittedValues(startMarker: string, endMarker: string): string[] {
  const start = commandersFileSrc.indexOf(startMarker)
  const end = commandersFileSrc.indexOf(endMarker)
  expect(start, `could not find ${startMarker} — the emitter was renamed or removed`).toBeGreaterThan(-1)
  expect(end, `could not find ${endMarker} — the emitter was renamed or removed`).toBeGreaterThan(start)
  const tpl = commandersFileSrc.slice(start, end)

  const values = new Set<string>()
  // `obj.field`, including inside parentheses and `??`/`||` fallbacks.
  for (const m of tpl.matchAll(/\b([A-Za-z_$][\w$]*)\s*\??\.\s*([a-z_][a-z0-9_]*)\s*(\()?/g)) {
    const [, obj, prop, isCall] = m
    if (isCall || NOT_DATA.has(prop)) continue
    values.add(`${obj}.${prop}`)
  }
  // Whole values with no property access: `${date}`, `${streak}`.
  for (const m of tpl.matchAll(/\$\{([A-Za-z_$][\w$]*)\}/g)) values.add(m[1])
  return [...values].sort()
}

/**
 * The table rows of PRIVACY.md, keyed by the backticked identifier in the first cell.
 * The value is the row's last cell — the justification — so an empty one is detectable.
 */
function documentedRows(): Map<string, string> {
  const rows = new Map<string, string>()
  for (const line of privacySrc.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue
    const cells = line.split('|').map((c) => c.trim()).filter((c, idx, arr) => !(c === '' && (idx === 0 || idx === arr.length - 1)))
    if (cells.length < 4) continue
    const key = /^`([^`]+)`$/.exec(cells[0])?.[1]
    if (!key) continue
    rows.set(key, cells[cells.length - 1])
  }
  return rows
}

const COMMANDERS_FILE = emittedValues("=== COMMANDER'S FILE", '=== END FILE ===')
const CONTINUITY_BRIEF = emittedValues('=== SESSION CONTINUITY BRIEF ===', '=== END BRIEF ===')

describe('PRIVACY.md justifies every field the Commander\'s File emits', () => {
  // Vacuity floors. If the extractor above ever silently matches nothing, every coverage
  // assertion below passes over an empty set and reports a clean privacy document for an
  // emitter it never read. That is finding 15's defect class — a green result that means
  // nothing — so the count is asserted before the coverage is.
  it('the extractor actually read both emitters', () => {
    expect(
      COMMANDERS_FILE.length,
      'the Commander\'s File extractor found almost nothing, so the coverage checks below '
      + 'would pass over an empty set and prove nothing',
    ).toBeGreaterThanOrEqual(30)
    expect(
      CONTINUITY_BRIEF.length,
      'the Continuity Brief extractor found almost nothing, so its coverage check would '
      + 'pass over an empty set',
    ).toBeGreaterThanOrEqual(12)
  })

  it('every value the Commander\'s File emits has a justified row in PRIVACY.md', () => {
    const rows = documentedRows()
    const undocumented = COMMANDERS_FILE.filter((v) => !rows.has(v))
    expect(
      undocumented,
      `PRIVACY.md has no row for ${undocumented.join(', ')}. Book 17 requires a `
      + 'data-minimisation justification for every field the Commander\'s File emits, so a '
      + 'new field is not shippable until it is justified in writing — or removed.',
    ).toEqual([])
    const unjustified = COMMANDERS_FILE.filter((v) => (rows.get(v) ?? '').length < 20)
    expect(
      unjustified,
      `these rows exist but carry no real justification: ${unjustified.join(', ')}. A row `
      + 'with an empty or one-word last cell documents that a field is emitted without '
      + 'saying why it must be, which is what the clause forbids.',
    ).toEqual([])
  })

  it('every value the Continuity Brief emits has a justified row in PRIVACY.md', () => {
    // Book 14's brief is a second emitter of the same personal record. The clause names the
    // Commander's File, but a document that justified one emitter and stayed silent about the
    // other would be true and misleading at the same time.
    const rows = documentedRows()
    const undocumented = CONTINUITY_BRIEF.filter((v) => !rows.has(v))
    expect(
      undocumented,
      `PRIVACY.md has no row for ${undocumented.join(', ')}, emitted by the Session `
      + 'Continuity Brief',
    ).toEqual([])
  })

  it('PRIVACY.md documents no field that is no longer emitted', () => {
    // The other direction, and the one this repository has actually shipped: prose that
    // describes behaviour the code stopped having. A stale row overstates what is disclosed,
    // which is a false claim about a privacy boundary.
    const emitted = new Set([...COMMANDERS_FILE, ...CONTINUITY_BRIEF])
    const stale = [...documentedRows().keys()].filter((k) => /^[a-z_$][\w$]*\.[a-z_]/.test(k) && !emitted.has(k))
    expect(
      stale,
      `PRIVACY.md documents ${stale.join(', ')} as emitted, but no emitter interpolates `
      + 'them any more. Remove the row or restore the field; a privacy document that '
      + 'overstates disclosure is still inaccurate.',
    ).toEqual([])
  })

  it('PRIVACY.md names both emitters and the prohibition that bounds them', () => {
    expect(privacySrc, 'PRIVACY.md does not name the Commander\'s File').toMatch(/Commander's File/)
    expect(privacySrc, 'PRIVACY.md does not name the Session Continuity Brief').toMatch(/Continuity Brief/)
    // R6/Book 2.3. The one thing this application is permanently forbidden to hold is data
    // about other people's weaknesses. A privacy document that omits the prohibition omits
    // the only limit that is not a matter of preference.
    expect(
      privacySrc,
      'PRIVACY.md does not record the Book 2.3 prohibition on third-party insecurity, '
      + 'dependency, and pressure-point data — the one limit that is absolute',
    ).toMatch(/2\.3/)
  })
})
