// Book 17 Definition of Done, Documentation: "Add ... ARCHITECTURE.md ... Make no claim that is
// not technically guaranteed."
//
// An architecture document is the first thing a new reader trusts and the first thing a growing
// repository invalidates. A module added after the document was written is not merely
// undocumented — it is a part of the system the map denies exists, and the reader plans around
// the map.
//
// So the map is DERIVED. Every module of `src/`, `workers/` and `public/static/app/` must have a
// row; the number of routes each route module registers is read from the module; the global
// middleware chain is read in order from `src/index.tsx`; the build and test topology is read
// from the configs and the `verify` script; and each stated count comes from a glob rather than
// from a hand count.
//
// Both directions are checked. Silence about a module hides it. A row for a module that no
// longer exists, a pointer to a document that was never written, or an "unreachable" note on a
// module the build does reach are all false claims, and the clause forbids those specifically.
import { describe, it, expect } from 'vitest'
import architectureSrc from '../ARCHITECTURE.md?raw'
import indexSrc from '../src/index.tsx?raw'
import packageSrc from '../package.json?raw'

// ---------------------------------------------------------------- derivations

/** Discovered, not listed. Vite resolves these at build time, which is what lets them work
 *  inside the workers pool — that pool cannot read disk at runtime. */
const norm = (p: string) => p.replace(/^\.\.\//, '')

const SERVER_MODULES = Object.keys(import.meta.glob('../src/**/*.{ts,tsx}', { eager: false }))
  .map(norm)
  .filter((p) => !p.endsWith('.d.ts'))
  .sort()

const WORKER_MODULES = Object.keys(import.meta.glob('../workers/**/*.ts', { eager: false }))
  .map(norm)
  .filter((p) => !p.endsWith('.test.ts') && !p.endsWith('.d.ts'))
  .sort()

const FRONTEND_MODULES = Object.keys(
  import.meta.glob('../public/static/app/**/*.js', { eager: false }),
).map(norm).sort()

/** Route-module sources, read whole so the route count can be derived from each. */
const ROUTE_SOURCES = Object.fromEntries(
  Object.entries(
    import.meta.glob('../src/routes/*.ts', { query: '?raw', import: 'default', eager: true }),
  ).map(([p, src]) => [norm(p), src as string]),
) as Record<string, string>

/**
 * How many routes each route module registers. Every registration in this repository has the
 * same shape — `app.<method>('<path>'` at the start of a line — verified by grepping for the
 * alternatives (`app.on`, `app.all`, `app.route`) and finding none.
 */
function routeCounts(): Array<{ path: string; count: number }> {
  return Object.entries(ROUTE_SOURCES)
    .map(([path, src]) => ({
      path,
      count: [...src.matchAll(/^\s*app\.(get|post|put|delete)\(/gm)].length,
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * The global middleware chain, in the order `src/index.tsx` installs it. Order is the whole
 * architectural claim here: security headers before the body limit means an oversized body is
 * rejected with the headers already set, and the CSRF check sitting inside the first layer
 * means it runs before any route body is read.
 */
function globalChain(): string[] {
  return [...indexSrc.matchAll(/app\.use\(\s*'([^']+)'/g)].map((m) => m[1])
}

/**
 * Each route module paired with the position at which `src/index.tsx` calls its register
 * function. The register name is read out of the module itself rather than guessed from the
 * filename, so a module whose registration is never called is detectable rather than assumed.
 *
 * Registration order is load-bearing: Hono matches in registration order, so where a module
 * sits relative to the global `/api/*` guard decides whether the guard runs for its routes at
 * all. `registerAuthRoutes` is deliberately called before that guard.
 */
function registrations(): Array<{ path: string; name: string; at: number }> {
  return Object.entries(ROUTE_SOURCES).map(([path, src]) => {
    const m = /export function (register\w+)\(/.exec(src)
    expect(m, `${path} exports no register function — this extractor reads it by name`).not.toBeNull()
    // The call has to sit at the start of a line. A substring search finds it inside
    // `// registerFooRoutes(app)` too, and would read a commented-out registration as live.
    return { path, name: m![1], at: indexSrc.search(new RegExp(`^${m![1]}\\(app\\)`, 'm')) }
  }).sort((a, b) => a.at - b.at)
}

/** Middleware installed for a single path rather than globally — currently `/calendar.ics`. */
const PER_ROUTE_MIDDLEWARE = Object.entries(ROUTE_SOURCES).flatMap(([, src]) =>
  [...src.matchAll(/app\.use\(\s*'([^']+)'/g)].map((m) => m[1]),
).sort()

/** Every stage of the one gate command, read out of `package.json` rather than retyped. */
function verifyStages(): string[] {
  const scripts = JSON.parse(packageSrc).scripts as Record<string, string>
  expect(scripts.verify, 'the `verify` script was renamed or removed').toBeTruthy()
  return scripts.verify.split('&&').map((s) => s.trim())
}

/**
 * A `.tsx` module shadowed by a same-basename `.ts` sibling that nothing imports by its
 * explicit extension. TypeScript and Vite both resolve a bare `./renderer` to `renderer.ts`,
 * so such a file is present in the repository and absent from the build. The document has to
 * say so — an unreachable module read as live is how a reader comes to edit a file that cannot
 * affect the running system.
 */
function unreachableModules(): string[] {
  const bare = new Set(SERVER_MODULES.map((p) => p.replace(/\.tsx?$/, '')))
  const explicitTsxImports = new Set<string>()
  for (const src of [indexSrc, ...Object.values(ROUTE_SOURCES)]) {
    for (const m of src.matchAll(/from '([^']*\.tsx)'/g)) explicitTsxImports.add(m[1])
  }
  return SERVER_MODULES.filter((p) => {
    if (!p.endsWith('.tsx')) return false
    if (p === 'src/index.tsx') return false // the entry; the build names it directly
    const stem = p.slice(0, -4)
    if (!bare.has(stem) || !SERVER_MODULES.includes(`${stem}.ts`)) return false
    const base = p.replace(/^.*\//, '')
    return ![...explicitTsxImports].some((s) => s.endsWith(base))
  })
}

/** Counts a reader wants and a hand count gets wrong. Each key is a row key in the document. */
const COUNTS: Array<{ key: string; value: number }> = [
  { key: 'src/', value: SERVER_MODULES.length },
  { key: 'src/routes/', value: Object.keys(ROUTE_SOURCES).length },
  { key: 'public/static/app/', value: FRONTEND_MODULES.length },
  { key: 'migrations/', value: Object.keys(import.meta.glob('../migrations/*.sql')).length },
  {
    key: 'public/static/books/',
    value: Object.keys(import.meta.glob('../public/static/books/*.json')).length,
  },
  { key: 'workers/', value: WORKER_MODULES.length },
]

/** Every root-level document that exists, so a pointer to one that does not can be caught. */
const REAL_DOCS = new Set(
  Object.keys(import.meta.glob('../*.md', { eager: false })).map((p) => p.replace(/^.*\//, '')),
)

// ------------------------------------------------------------ document access

/**
 * Every markdown table row whose first cell is a single backticked identifier, keyed by it.
 * The whole row is kept so a derived number can be looked for inside that row specifically,
 * and the last cell separately so an empty description is detectable.
 */
function docRows(): Map<string, { row: string; cells: string[]; description: string }> {
  const rows = new Map<string, { row: string; cells: string[]; description: string }>()
  for (const line of architectureSrc.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue
    const cells = line.split('|').map((c) => c.trim())
      .filter((c, idx, arr) => !(c === '' && (idx === 0 || idx === arr.length - 1)))
    if (cells.length < 2) continue
    const key = /^`([^`]+)`$/.exec(cells[0])?.[1]
    if (!key) continue
    rows.set(key, { row: line, cells, description: cells[cells.length - 1] })
  }
  return rows
}

/** `48000` written as `48000` or `48,000` — both are the same claim. */
function statesNumber(text: string, value: number): boolean {
  const plain = String(value)
  const grouped = plain.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return new RegExp(`(^|[^\\d,])${plain}([^\\d,]|$)`).test(text)
    || new RegExp(`(^|[^\\d,])${grouped}([^\\d,]|$)`).test(text)
}

const ROUTE_COUNTS = routeCounts()
const CHAIN = globalChain()
const REGISTRATIONS = registrations()
const VERIFY_STAGES = verifyStages()
const UNREACHABLE = unreachableModules()
const ALL_MODULES = [...SERVER_MODULES, ...WORKER_MODULES, ...FRONTEND_MODULES]

describe('ARCHITECTURE.md maps the system that exists', () => {
  // Vacuity floors. Every check below is a filter over a derived list, and a filter over an
  // empty list passes. A broken glob would therefore certify an architecture document it never
  // compared against anything — the audit's recurring defect wearing the costume of a
  // derivation. The counts are asserted before the coverage is.
  it('the extractors actually read the repository', () => {
    expect(SERVER_MODULES.length, 'the src/ module glob found almost nothing').toBeGreaterThanOrEqual(50)
    expect(Object.keys(ROUTE_SOURCES).length, 'the route-source glob found almost nothing').toBeGreaterThanOrEqual(20)
    expect(FRONTEND_MODULES.length, 'the frontend glob found almost nothing').toBeGreaterThanOrEqual(14)
    expect(WORKER_MODULES.length, 'the workers/ glob found nothing').toBeGreaterThanOrEqual(1)
    expect(CHAIN.length, 'the middleware-chain extractor found almost nothing').toBeGreaterThanOrEqual(4)
    expect(PER_ROUTE_MIDDLEWARE.length, 'the per-route middleware extractor found nothing').toBeGreaterThanOrEqual(1)
    expect(VERIFY_STAGES.length, 'the verify-script extractor found almost nothing').toBeGreaterThanOrEqual(5)
    expect(
      ROUTE_COUNTS.reduce((n, r) => n + r.count, 0),
      'the route counter found almost nothing, so every per-module count below is vacuous',
    ).toBeGreaterThanOrEqual(100)
    expect(
      docRows().size,
      'ARCHITECTURE.md carries almost no keyed table rows, so every check below would be '
      + 'comparing the derived lists against nothing',
    ).toBeGreaterThanOrEqual(70)
  })

  it('gives every server module a row and a stated responsibility', () => {
    const rows = docRows()
    const undocumented = [...SERVER_MODULES, ...WORKER_MODULES].filter((p) => !rows.has(p))
    expect(
      undocumented,
      `ARCHITECTURE.md has no row for ${undocumented.join(', ')}. A module the map omits is a `
      + 'part of the system the reader plans around as if it were absent.',
    ).toEqual([])
    const unexplained = [...SERVER_MODULES, ...WORKER_MODULES]
      .filter((p) => (rows.get(p)?.description ?? '').length < 20)
    expect(
      unexplained,
      `these rows name a module without saying what it is responsible for: ${unexplained.join(', ')}.`,
    ).toEqual([])
  })

  it('gives every frontend module a row and a stated responsibility', () => {
    const rows = docRows()
    const undocumented = FRONTEND_MODULES.filter((p) => !rows.has(p))
    expect(
      undocumented,
      `ARCHITECTURE.md has no row for ${undocumented.join(', ')}. The client is a module graph `
      + 'bundled into one file; a module missing from the map is invisible to the reader.',
    ).toEqual([])
    const unexplained = FRONTEND_MODULES.filter((p) => (rows.get(p)?.description ?? '').length < 20)
    expect(
      unexplained,
      `these rows name a module without saying what it is responsible for: ${unexplained.join(', ')}.`,
    ).toEqual([])
  })

  it('describes no source file that does not exist', () => {
    const real = new Set(ALL_MODULES)
    const phantom = [...docRows().keys()]
      .filter((k) => /\.(ts|tsx|js)$/.test(k) && !k.includes('*'))
      .filter((k) => !real.has(k) && !k.endsWith('bundle.js') && !k.startsWith('dist/'))
    expect(
      phantom,
      `ARCHITECTURE.md has rows for ${phantom.join(', ')}, which do not exist. A map describing `
      + 'files that are gone cannot be trusted about the ones that remain.',
    ).toEqual([])
  })

  it('states how many routes each route module registers', () => {
    const rows = docRows()
    const wrong = ROUTE_COUNTS
      .filter((r) => rows.has(r.path) && !statesNumber(rows.get(r.path)!.row, r.count))
      .map((r) => `${r.path} registers ${r.count}`)
    expect(
      wrong,
      `these rows do not state the number of routes the module registers: ${wrong.join('; ')}. `
      + 'A route added without touching this document is a route the map denies.',
    ).toEqual([])
  })

  it('lists the route modules in the order index.tsx registers them', () => {
    // Hono matches in registration order, so a module's position relative to the global
    // `/api/*` guard decides whether that guard runs for its routes at all. A table in
    // alphabetical or arbitrary order would look like documentation and describe nothing.
    const uncalled = REGISTRATIONS.filter((r) => r.at < 0)
    expect(
      uncalled.map((r) => `${r.path} exports ${r.name}`),
      `these route modules are never registered in src/index.tsx: `
      + `${uncalled.map((r) => r.path).join(', ')}. Their routes cannot be reached at all.`,
    ).toEqual([])
    const documented = [...architectureSrc.matchAll(/^\|\s*`(src\/routes\/[^`]+)`/gm)].map((m) => m[1])
    expect(
      documented,
      'the route table is not in registration order (or lists a module twice). The order is the '
      + 'claim: it is what decides which middleware a route has already passed.',
    ).toEqual(REGISTRATIONS.map((r) => r.path))
  })

  it('records the global middleware chain in the order the code installs it', () => {    const literal = CHAIN.join(' → ')
    expect(
      architectureSrc,
      `ARCHITECTURE.md does not contain the derived middleware chain "${literal}". Order is the `
      + 'architectural claim: it decides what a request has already passed before a route body '
      + 'is read.',
    ).toContain(literal)
    const missing = [...new Set(PER_ROUTE_MIDDLEWARE)].filter((p) => !architectureSrc.includes(p))
    expect(
      missing,
      `${missing.join(', ')} has middleware of its own that the global chain does not describe, `
      + 'and ARCHITECTURE.md does not mention it — so the document implies that path is covered '
      + 'only by the global layers.',
    ).toEqual([])
  })

  it('names the build outputs, the configs, and every stage of the gate', () => {
    const artifacts = [
      'public/static/bundle.js', 'dist/_worker.js', 'wrangler.jsonc',
      'vite.config.ts', 'vite.client.config.ts', 'vitest.config.ts', 'vitest.dom.config.ts',
    ]
    const missingArtifacts = artifacts.filter((a) => !architectureSrc.includes(a))
    expect(
      missingArtifacts,
      `ARCHITECTURE.md does not name ${missingArtifacts.join(', ')}. A reader who cannot see `
      + 'what the build emits cannot tell which files are authored and which are generated.',
    ).toEqual([])
    const missingStages = VERIFY_STAGES.filter((s) => !architectureSrc.includes(s))
    expect(
      missingStages,
      `the gate runs ${missingStages.join(' and ')} and ARCHITECTURE.md does not say so.`,
    ).toEqual([])
  })

  it('states each derived count with the value the repository has', () => {
    const rows = docRows()
    const missing = COUNTS.filter((c) => !rows.has(c.key)).map((c) => c.key)
    expect(missing, `ARCHITECTURE.md has no row for ${missing.join(', ')}.`).toEqual([])
    const wrong = COUNTS
      .filter((c) => rows.has(c.key) && !statesNumber(rows.get(c.key)!.row, c.value))
      .map((c) => `${c.key} holds ${c.value}`)
    expect(
      wrong,
      `these rows do not state the count the repository has: ${wrong.join('; ')}. A hand-counted `
      + 'number is the defect class this repository keeps finding.',
    ).toEqual([])
  })

  it('records a module the build cannot reach, and calls none unreachable that it reaches', () => {
    const rows = docRows()
    const UNREACHABLE_NOTE = /unreachable|not reached|dead|no importer/i
    const silent = UNREACHABLE.filter((p) => !UNREACHABLE_NOTE.test(rows.get(p)?.row ?? ''))
    expect(
      silent,
      `${silent.join(', ')} is shadowed by a same-name .ts sibling, so nothing can import it and `
      + 'the build does not contain it — and ARCHITECTURE.md presents it as part of the system.',
    ).toEqual([])
    // The other direction: a module marked unreachable that the build does reach sends a
    // reader away from live code.
    const wronglyMarked = [...rows.entries()]
      .filter(([k]) => ALL_MODULES.includes(k) && !UNREACHABLE.includes(k))
      .filter(([, v]) => UNREACHABLE_NOTE.test(v.row))
      .map(([k]) => k)
    expect(
      wronglyMarked,
      `ARCHITECTURE.md calls ${wronglyMarked.join(', ')} unreachable, but the build does reach `
      + 'them. Marking live code dead is how a reader stops maintaining it.',
    ).toEqual([])
  })

  it('points only at documents that exist, and names the operator boundary', () => {
    const pointed = [...new Set([...architectureSrc.matchAll(/`([A-Z_]+\.md)`/g)].map((m) => m[1]))]
    const phantom = pointed.filter((d) => !REAL_DOCS.has(d))
    expect(
      phantom,
      `ARCHITECTURE.md points at ${phantom.join(', ')}, which does not exist in this repository. `
      + 'Referring a reader to an unwritten document is a claim that it is written.',
    ).toEqual([])
    // Everything at the edge — deploy, secrets, Access, the Cron trigger — belongs to a
    // separate operator. An architecture document that described those as part of this
    // repository's guarantees would be claiming work this repository does not do.
    expect(
      architectureSrc,
      'ARCHITECTURE.md does not identify the operator-scoped boundary, so its account of the '
      + 'deployed system reads as broader than what this repository controls',
    ).toMatch(/separate\s+operator|operator[-\s]scoped/i)
    expect(
      architectureSrc,
      'ARCHITECTURE.md does not name Cloudflare, so a reader cannot tell which platform '
      + 'behaviour the design depends on',
    ).toMatch(/Cloudflare/)
  })
})
