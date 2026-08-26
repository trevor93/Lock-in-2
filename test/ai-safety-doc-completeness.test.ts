import { describe, expect, it } from 'vitest'
import safetyDocRaw from '../AI_SAFETY.md?raw'
import aiSrcRaw from '../src/ai.ts?raw'
import schemasSrcRaw from '../src/schemas.ts?raw'
import hermesRouteSrcRaw from '../src/routes/hermes.ts?raw'
import councilSrcRaw from '../public/static/app/features/council.js?raw'
import sanitizeSrcRaw from '../public/static/app/core/sanitize.js?raw'
import modelMigrationSrcRaw from '../migrations/0007_model_security.sql?raw'

// Book 17 Definition of Done, Documentation (MASTERPROMPT.md): "Add ... AI_SAFETY.md ... Make
// no claim that is not technically guaranteed."
//
// An AI safety document is the one most likely to describe intentions. The model's own system
// prompt contains an ethics paragraph; a document that quotes it as a safety property has
// mistaken a wish for a mechanism. So every claim here is derived from the code that enforces
// it, and the document is required to say which of its guarantees are structural (a schema, a
// CHECK, a trigger, an escape) and which are only text sent to a provider.
//
// The absences matter more than the counts, and they are asserted in BOTH directions. A count
// goes stale loudly. An absence goes stale silently and in the flattering direction: someone
// closes the gap, the document keeps calling it open, and a reader plans around a weakness that
// is gone — or, worse, someone opens a new path and the document keeps promising it is closed.
//
// Derived here:
//   - the pinned model, every bound and every audit event, from `src/ai.ts`
//   - the input ceilings, from `src/schemas.ts`
//   - the fence labels and the number of model call sites, from `src/routes/hermes.ts`
//   - the budgets and the append-only triggers, from `migrations/0007_model_security.sql`
//   - the escape-before-format order, from `public/static/app/features/council.js`

// `?raw` hands back the working tree byte-for-byte, so on a Windows checkout with
// `core.autocrlf=true` every source below arrives CRLF-terminated. A pattern anchored on `\n\n`
// then matches nothing, and a derivation that returns nothing is the worst possible failure for a
// guard: it does not complain, it just stops guarding. Normalise once here, and give every
// derived list a floor below so an empty one fails out loud rather than passing vacuously.
const lf = (text: string) => text.replace(/\r\n/g, '\n')
const safetyDoc = lf(safetyDocRaw)
const aiSrc = lf(aiSrcRaw)
const schemasSrc = lf(schemasSrcRaw)
const hermesRouteSrc = lf(hermesRouteSrcRaw)
const councilSrc = lf(councilSrcRaw)
const sanitizeSrc = lf(sanitizeSrcRaw)
const modelMigrationSrc = lf(modelMigrationSrcRaw)

const flat = (text: string) => text.replace(/\s+/g, ' ')
const DOC = flat(safetyDoc)

/** `## N. Title` … up to the next heading of equal-or-shallower depth. Same convention as the
 *  other five documentation guards: a claim is checked inside the section that makes it,
 *  because a document-wide `toContain` is satisfied by an unrelated sentence elsewhere. */
function docSection(heading: string): string {
  const at = safetyDoc.indexOf(heading)
  if (at === -1) return ''
  const depth = (heading.match(/^#+/) ?? ['##'])[0].length
  const rest = safetyDoc.slice(at + heading.length)
  const next = rest.search(new RegExp(`\\n#{2,${depth}} `))
  return flat(next === -1 ? rest : rest.slice(0, next))
}

/** A derivation that silently returns nothing is a guard that silently stops guarding, and a
 *  bare `!` reports only `Cannot read properties of null`. Name what went missing. */
function must(match: RegExpExecArray | null, what: string): RegExpExecArray {
  if (match === null) throw new Error(`${what} could not be derived from source, so this guard is inert`)
  return match
}

const constant = (src: string, name: string): string => {
  const m = new RegExp(`export const ${name} = ([^\\n]+)`).exec(src)
  expect(m, `${name} is gone from source, so this guard cannot derive it`).not.toBeNull()
  return m![1].replace(/'/g, '').trim()
}

const MODEL_ROUTES = [...(
  must(/export type ModelRoute =([^\n]+)/.exec(aiSrc), 'the ModelRoute union')[1]
    .matchAll(/'([a-z:]+)'/g)
)].map((m) => m[1])

const AUDIT_EVENTS = [...(
  must(/export type ModelAuditEvent =([\s\S]*?)\n\n/.exec(aiSrc), 'the ModelAuditEvent union')[1]
    .matchAll(/'([a-z_]+)'/g)
)].map((m) => m[1])

const FENCE_LABELS = [...new Set([...hermesRouteSrc.matchAll(
  /fencedModelData\(\s*'?([A-Z_]+)'?/g,
)].map((m) => m[1]))].sort()

const CALL_SITES = [...hermesRouteSrc.matchAll(/\bcallModel\(/g)].length

const POLICY = must(
  /export const MODEL_POLICY = `([\s\S]*?)`\n/.exec(aiSrc), 'MODEL_POLICY',
)[1]
const POLICY_RULES = [...POLICY.matchAll(/^- /gm)].length

describe('Book 17 documentation — AI_SAFETY.md is derived from the model boundary', () => {
  it('exists, is numbered, and states that it is derived rather than written by hand', () => {
    expect(safetyDoc.length, 'AI_SAFETY.md is empty or missing').toBeGreaterThan(4000)
    const headings = [...safetyDoc.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1]))
    expect(headings.length, 'AI_SAFETY.md has no numbered sections').toBeGreaterThanOrEqual(12)
    expect(headings, 'AI_SAFETY.md sections are not numbered 1..N in order')
      .toEqual(headings.map((_, idx) => idx + 1))
    expect(docSection('## 1.'), '§1 does not name the test that derives this document')
      .toMatch(/ai-safety-doc-completeness/)
  })

  it('states the pinned model and every numeric bound, from the constants that enforce them', () => {
    const BOUNDS: ReadonlyArray<readonly [string, string, string]> = [
      [constant(aiSrc, 'PINNED_MODEL'), 'the pinned model', 'src/ai.ts'],
      [constant(aiSrc, 'MODEL_OUTPUT_TOKENS'), 'the output token ceiling', 'src/ai.ts'],
      [constant(aiSrc, 'MODEL_OUTPUT_CHARS'), 'the answer character ceiling', 'src/ai.ts'],
      [constant(aiSrc, 'MODEL_TIMEOUT_MS'), 'the per-attempt timeout', 'src/ai.ts'],
      [constant(aiSrc, 'MODEL_MAX_ATTEMPTS'), 'the attempt ceiling', 'src/ai.ts'],
      [constant(schemasSrc, 'MODEL_USER_INPUT_CHARS'), 'the user-input ceiling', 'src/schemas.ts'],
      [constant(schemasSrc, 'MODEL_TOTAL_INPUT_CHARS'), 'the total-input ceiling', 'src/schemas.ts'],
    ]
    for (const [value, what, where] of BOUNDS) {
      expect(DOC, `AI_SAFETY.md does not state ${what} (${value}, from ${where})`)
        .toContain(value)
    }
  })

  it('names every model route and every audit event, in both directions', () => {
    expect(MODEL_ROUTES.length, 'no ModelRoute values were derived, so this check is inert')
      .toBeGreaterThanOrEqual(3)
    expect(AUDIT_EVENTS.length, 'no ModelAuditEvent values were derived, so this check is inert')
      .toBeGreaterThanOrEqual(9)
    for (const route of MODEL_ROUTES) {
      expect(DOC, `AI_SAFETY.md does not name the model route \`${route}\``).toContain(route)
    }
    for (const event of AUDIT_EVENTS) {
      expect(DOC, `AI_SAFETY.md does not name the audit event \`${event}\``).toContain(event)
    }
    // The other direction: a route or event named here that source no longer has is a claim
    // about a boundary that has moved.
    const named = [...DOC.matchAll(/`([a-z_]+:[a-z_]+|[a-z]+_[a-z_]+)`/g)].map((m) => m[1])
    const stale = named.filter((token) =>
      /^(hermes|intel|model):/.test(token) && !MODEL_ROUTES.includes(token))
    expect(stale, 'AI_SAFETY.md names model routes that src/ai.ts no longer declares')
      .toEqual([])
  })

  it('names every untrusted fence label the callers actually use, in both directions', () => {
    expect(FENCE_LABELS.length, 'no fence labels were derived, so this check is inert')
      .toBeGreaterThanOrEqual(3)
    for (const label of FENCE_LABELS) {
      expect(DOC, `AI_SAFETY.md does not name the fence \`UNTRUSTED_${label}\``)
        .toContain(label)
    }
    const documented = [...new Set(
      [...DOC.matchAll(/UNTRUSTED_([A-Z_]+)/g)].map((m) => m[1].replace(/>$/, '')),
    )].sort()
    expect(documented, 'AI_SAFETY.md documents fences the callers do not build')
      .toEqual(FENCE_LABELS)
  })

  it('states the layer order as source builds it, not as the policy wishes it', () => {
    const section = docSection('## 3.')
    expect(section.length, 'AI_SAFETY.md has no §3, so the trust order is undocumented')
      .toBeGreaterThan(300)
    // The order the provider actually receives: two system messages, then the user request,
    // then the fenced layers in the order `callModel`'s caller passes them.
    const order = ['HERMES_SYSTEM', 'MODEL_POLICY']
    for (const layer of order) {
      expect(section, `§3 does not name the \`${layer}\` layer`).toContain(layer)
    }
    expect(section.indexOf('HERMES_SYSTEM'), '§3 states the policy layer before the system layer')
      .toBeLessThan(section.indexOf('MODEL_POLICY'))
    expect(section, '§3 does not state how many rules the application policy carries')
      .toContain(String(POLICY_RULES))
  })

  it('states that authorisation lives outside the model, and every write derived from an answer', () => {
    const section = docSection('## 4.')
    expect(section.length, 'AI_SAFETY.md has no §4, so the authorisation boundary is undocumented')
      .toBeGreaterThan(300)
    // Every statement in the repository that persists model output, derived rather than listed.
    const writes = [...new Set([...hermesRouteSrc.matchAll(
      /(INSERT INTO (\w+)|UPDATE (\w+))/g,
    )].map((m) => m[2] ?? m[3]))].sort()
    expect(writes.length, 'no model-output writes were derived, so this check is inert')
      .toBeGreaterThan(0)
    for (const table of writes) {
      expect(section, `§4 does not name \`${table}\`, which stores model output`)
        .toContain(table)
    }
    expect(section, '§4 does not state that the model authorises nothing')
      .toMatch(/authoris|authoriz/i)
  })

  it('states the budgets the trigger enforces, and that the trigger is where they live', () => {
    const section = docSection('## 7.')
    expect(section.length, 'AI_SAFETY.md has no §7, so the budgets are undocumented')
      .toBeGreaterThan(200)
    const trigger = must(
      /CREATE TRIGGER IF NOT EXISTS trg_model_requests_budget([\s\S]*?)\nEND;/
        .exec(modelMigrationSrc), 'the budget trigger',
    )[1]
    const limits = [...trigger.matchAll(/\) >= (\d+)/g)].map((m) => m[1])
    const tokenCaps = [...trigger.matchAll(/NEW\.reserved_tokens > (\d+)/g)].map((m) => m[1])
    expect(limits.length + tokenCaps.length, 'no budget numbers were derived from the trigger')
      .toBeGreaterThanOrEqual(5)
    for (const value of [...limits, ...tokenCaps]) {
      const pretty = Number(value).toLocaleString('en-US')
      expect(
        section.includes(value) || section.includes(pretty),
        `§7 does not state the budget limit ${value} that the trigger enforces`,
      ).toBe(true)
    }
    expect(section, '§7 does not state that the limit is enforced inside the INSERT')
      .toMatch(/trigger/i)
  })

  it('states that the audit tables hold metadata only, and derives the columns to prove it', () => {
    const section = docSection('## 10.')
    expect(section.length, 'AI_SAFETY.md has no §10, so the audit evidence is undocumented')
      .toBeGreaterThan(200)
    const table = must(
      /CREATE TABLE IF NOT EXISTS model_audit_events \(([\s\S]*?)\n\);/
        .exec(modelMigrationSrc), 'the model_audit_events table definition',
    )[1]
    const columns = table.split('\n')
      .map((line) => /^\s{2}([a-z_]+)\s/.exec(line)?.[1])
      .filter((name): name is string => Boolean(name))
    expect(columns.length, 'no audit columns were derived, so this check is inert')
      .toBeGreaterThanOrEqual(10)
    // The claim is that no column holds prompt text, answer text, or a credential. It is
    // derived from the column names, so adding such a column fails here rather than leaving
    // the document asserting a privacy property it no longer has.
    const CONTENT_COLUMN = /prompt_text|answer|content|body|message|api_key|token_value/
    const contentful = columns.filter((name) => CONTENT_COLUMN.test(name))
    if (contentful.length === 0) {
      expect(section, '§10 does not state that the audit rows are metadata only')
        .toMatch(/metadata[- ]only|no prompt|never stores the prompt/i)
    } else {
      expect(
        section,
        `model_audit_events now has content columns (${contentful.join(', ')}), and §10 still `
        + 'claims the audit evidence is metadata only',
      ).not.toMatch(/metadata[- ]only|no prompt|never stores the prompt/i)
    }
    for (const trigger of ['trg_model_audit_no_update', 'trg_model_audit_no_delete']) {
      expect(
        modelMigrationSrc,
        `${trigger} is gone from the migration, so append-only is no longer enforced`,
      ).toContain(trigger)
      expect(section, `§10 does not name ${trigger}`).toContain(trigger)
    }
  })

  it('states the escape-before-format order that makes model output safe in the browser', () => {
    const section = docSection('## 11.')
    expect(section.length, 'AI_SAFETY.md has no §11, so the render path is undocumented')
      .toBeGreaterThan(200)
    const mdLite = must(
      /export function mdLite\(s\)\s*\{([\s\S]*?)\n\}/.exec(councilSrc), 'mdLite',
    )[1]
    const escapesFirst = /return\s+esc\(s\)/.test(mdLite)
    // One pattern, asserted positively while the order holds and negatively if it is ever
    // inverted. Two patterns is how this assertion goes stale in the flattering direction.
    const ORDER_CLAIM = /escapes? (?:the answer )?first|escape[- ]before[- ]format|esc\(s\) runs first/i
    if (escapesFirst) {
      expect(section, '§11 does not state that mdLite escapes before it formats')
        .toMatch(ORDER_CLAIM)
    } else {
      expect(
        section,
        'mdLite no longer escapes before formatting, and §11 still claims that order',
      ).not.toMatch(ORDER_CLAIM)
    }
    expect(sanitizeSrc, 'core/sanitize.js no longer escapes the five HTML metacharacters')
      .toMatch(/&amp;|&lt;/)
    expect(section, '§11 does not name mdLite, the function that renders the answer')
      .toContain('mdLite')
  })

  it('records that the fence markers are not escaped, and stops claiming it once they are', () => {
    const fence = must(
      /export function fencedModelData\([\s\S]*?\n\}/.exec(aiSrc), 'fencedModelData',
    )[0]
    // The honest weakness: the fence wraps content in `<UNTRUSTED_…>` markers and does not
    // neutralise the same markers appearing inside that content. One pattern, required while
    // the gap is open and forbidden once it closes.
    const escapes = /replace|sanitiz|strip|escape/i.test(fence)
    const GAP_CLAIM = /does not (?:escape|neutralise|strip)|not escaped|can be forged|is not sanitised/i
    const section = docSection('## 14.')
    expect(section.length, 'AI_SAFETY.md has no §14, so the weaknesses are undocumented')
      .toBeGreaterThan(300)
    if (!escapes) {
      expect(section, '§14 does not record that fencedModelData never escapes its own markers')
        .toMatch(GAP_CLAIM)
    } else {
      expect(
        section,
        'fencedModelData now neutralises content, and §14 still reports the marker gap as open',
      ).not.toMatch(GAP_CLAIM)
    }
  })

  it('records that the model is called from exactly one module, in both directions', () => {
    const SRC = import.meta.glob('../src/**/*.{ts,tsx}', {
      query: '?raw', import: 'default', eager: true,
    }) as Record<string, string>
    const callers = Object.entries(SRC)
      .filter(([path, src]) => !path.endsWith('/ai.ts') && /\bcallModel\(/.test(src))
      .map(([path]) => path.replace(/^\.\.\//, ''))
      .sort()
    expect(callers, 'the model is now called from modules other than src/routes/hermes.ts')
      .toEqual(['src/routes/hermes.ts'])
    expect(DOC, 'AI_SAFETY.md does not name src/routes/hermes.ts as the only caller')
      .toContain('src/routes/hermes.ts')
    expect(CALL_SITES, 'no callModel call sites were derived, so this check is inert')
      .toBeGreaterThanOrEqual(3)
    expect(DOC, `AI_SAFETY.md does not state the number of model call sites (${CALL_SITES})`)
      .toContain(String(CALL_SITES))
  })

  it('records that the enforcement engines never call a model, and stops claiming it if one does', () => {
    const ENGINES = [
      'src/enforcement.ts', 'src/scoring.ts', 'src/streak.ts', 'src/ratchet.ts',
      'src/block-status.ts', 'src/calibration.ts',
    ]
    const SRC = import.meta.glob('../src/**/*.{ts,tsx}', {
      query: '?raw', import: 'default', eager: true,
    }) as Record<string, string>
    const modelUsing = ENGINES.filter((engine) => {
      const src = SRC[`../${engine}`]
      return typeof src === 'string' && /\bcallModel\(|OPENAI_API_KEY/.test(src)
    })
    const section = docSection('## 12.')
    expect(section.length, 'AI_SAFETY.md has no §12, so engine independence is undocumented')
      .toBeGreaterThan(200)
    // One pattern, both directions. If an engine ever reaches for the model, the sentence
    // saying none does must disappear rather than survive as a comforting leftover.
    const INDEPENDENCE_CLAIM = /no model call|never calls? (?:a|the) model|without (?:a|any) model|model-free/i
    if (modelUsing.length === 0) {
      expect(section, '§12 does not state that the enforcement engines make no model call')
        .toMatch(INDEPENDENCE_CLAIM)
    } else {
      expect(
        section,
        `these engines now reach the model (${modelUsing.join(', ')}), and §12 still claims `
        + 'the honesty path is model-free',
      ).not.toMatch(INDEPENDENCE_CLAIM)
    }
    for (const engine of ENGINES) {
      expect(section, `§12 does not name ${engine}`).toContain(engine.replace('src/', ''))
    }
  })

  it('separates the persona from the mechanism, and does not cite the ethics text as a guarantee', () => {
    const section = docSection('## 13.')
    expect(section.length, 'AI_SAFETY.md has no §13, so the persona is undocumented')
      .toBeGreaterThan(300)
    const system = must(
      /export const HERMES_SYSTEM = `([\s\S]*?)`\n/.exec(aiSrc), 'HERMES_SYSTEM',
    )[1]
    const doctrine = [...system.matchAll(/^\d+\. /gm)].length
    expect(doctrine, 'no doctrine points were derived from HERMES_SYSTEM').toBeGreaterThanOrEqual(7)
    expect(section, `§13 does not state how many doctrine points the persona carries (${doctrine})`)
      .toContain(String(doctrine))
    expect(section, '§13 does not say that the persona text is not an enforced constraint')
      .toMatch(/not (?:a )?(?:an )?(?:enforced|guarantee|mechanism)|no(?:t)? enforced|cannot be enforced|is prose/i)
  })

  it('closes with explicit non-claims, in the section that owns them', () => {
    const last = [...safetyDoc.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1])).pop()!
    const section = docSection(`## ${last}. `)
    expect(section.length, 'the final section of AI_SAFETY.md is not the non-claims')
      .toBeGreaterThan(300)
    const NON_CLAIMS: ReadonlyArray<readonly [RegExp, string]> = [
      [/does not claim|makes no claim/i, 'that this document does not claim what follows'],
      [/not (?:a )?safety (?:certification|audit)|no(?:t)? an audit|is not a certification/i,
        'that the document is not a safety certification'],
      [/provider|upstream/i, 'that the provider’s own behaviour is outside this repository'],
      [/deploy/i, 'that nothing described here has been deployed'],
      [/align|refus|behave/i, 'that no claim is made about the model’s behaviour'],
    ]
    for (const [pattern, what] of NON_CLAIMS) {
      expect(section, `the non-claims section does not state ${what}`).toMatch(pattern)
    }
  })
})
