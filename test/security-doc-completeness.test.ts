// Book 17 Definition of Done, Documentation: "Add SECURITY.md ... Make no claim that is not
// technically guaranteed."
//
// A security document is the worst place in a repository for a hand-written list, because a
// stale one does not merely go quiet — it asserts a protection that is no longer there. So
// every list in SECURITY.md is DERIVED from the code that implements it: the agent scopes from
// `AGENT_SCOPES`, the versioned agent routes and their required scopes from `agentRoute`, the
// unauthenticated surface from the route registrations, the hardening headers and every CSP
// relaxation from `setSecurityHeaders`, and each enforced bound from the literal the code
// actually enforces.
//
// Both directions are checked, because a security document can be wrong two ways. Silence
// about a real boundary hides it; a documented boundary the code no longer has is a false
// assurance, which is worse. The clause's own last sentence is the rule: make no claim that
// is not technically guaranteed.
import { describe, it, expect } from 'vitest'
import securitySrc from '../SECURITY.md?raw'
import agentAuthSrc from '../src/agent-auth.ts?raw'
import headersSrc from '../src/security-headers.ts?raw'
import indexSrc from '../src/index.tsx?raw'
import authRoutesSrc from '../src/routes/auth.ts?raw'
import cryptoSrc from '../src/crypto.ts?raw'
import authSrc from '../src/auth.ts?raw'
import aiSrc from '../src/ai.ts?raw'
import schemasSrc from '../src/schemas.ts?raw'

// ---------------------------------------------------------------- derivations

/** The scope vocabulary, from the `AGENT_SCOPES` literal itself. */
function agentScopes(): string[] {
  const block = /export const AGENT_SCOPES = \[([\s\S]*?)\] as const/.exec(agentAuthSrc)
  expect(block, 'AGENT_SCOPES was renamed or removed — this extractor reads it by name').not.toBeNull()
  return [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/** Every versioned agent route and the scope `agentRoute` actually demands for it. */
function agentRouteTable(): Array<{ method: string; path: string; scope: string }> {
  const block = /export function agentRoute\(([\s\S]*?)\n}/.exec(agentAuthSrc)
  expect(block, 'agentRoute was renamed or removed — this extractor reads it by name').not.toBeNull()
  return [...block![1].matchAll(
    /'(GET|POST|PUT|DELETE) ([^']+)':\s*\{\s*route:\s*'[^']*',\s*scope:\s*'([^']+)',?\s*\}/g,
  )].map((m) => ({ method: m[1], path: m[2], scope: m[3] }))
}

/** Every response header `setSecurityHeaders` sets. */
function hardeningHeaders(): string[] {
  const block = /export function setSecurityHeaders\(([\s\S]*?)\n}/.exec(headersSrc)
  expect(block, 'setSecurityHeaders was renamed or removed').not.toBeNull()
  return [...block![1].matchAll(/c\.header\('([^']+)'/g)].map((m) => m[1])
}

/**
 * Everything in the CSP that is a relaxation rather than a restriction: the `unsafe-*`
 * keywords and every external host. These are the claims a comfortable security document
 * leaves out, so they are exactly the ones that must be named.
 */
function cspRelaxations(): string[] {
  const block = /export const CONTENT_SECURITY_POLICY = \[([\s\S]*?)\]\.join/.exec(headersSrc)
  expect(block, 'CONTENT_SECURITY_POLICY was renamed or removed').not.toBeNull()
  const relaxations = new Set<string>()
  for (const m of block![1].matchAll(/'(unsafe-[a-z-]+)'/g)) relaxations.add(m[1])
  for (const m of block![1].matchAll(/https:\/\/([A-Za-z0-9.-]+)/g)) relaxations.add(m[1])
  return [...relaxations].sort()
}

/**
 * Every route reachable with no credential at all: the `/api/auth/*` routes the global guard
 * waves through, plus the routes whose paths `privatePath()` does not cover.
 */
function unauthenticatedRoutes(): string[] {
  const guard = /app\.use\('\/api\/\*',([\s\S]*?)\n}\)/.exec(indexSrc)
  expect(guard, 'the global /api/* guard was restructured — this extractor reads it by name').not.toBeNull()
  expect(
    guard![1],
    'the guard no longer waves /api/auth/ through, so this extractor is reading the wrong '
    + 'exemption and the derived open surface below cannot be trusted',
  ).toMatch(/startsWith\('\/api\/auth\/'\)/)

  const open: string[] = []
  for (const m of authRoutesSrc.matchAll(/app\.(get|post|put|delete)\('(\/api\/auth\/[^']*)'/g)) {
    open.push(m[2])
  }
  for (const m of indexSrc.matchAll(/app\.(get|post|put|delete)\('([^']+)'/g)) {
    const path = m[2]
    const isPrivate = path.startsWith('/api/') || path.startsWith('/internal/')
      || path === '/calendar.ics'
    if (!isPrivate) open.push(path)
  }
  return [...new Set(open)].sort()
}

/**
 * Each bound the application enforces, read from the literal that enforces it. A bound stated
 * in prose and changed in code is the defect class this repository keeps finding, so the
 * number in the document has to come from the number in the source.
 */
const BOUNDS = [
  { key: 'pbkdf2', src: cryptoSrc, pattern: /iterations:\s*(\d+)/ },
  { key: 'SESSION_DAYS', src: authSrc, pattern: /SESSION_DAYS = (\d+)/ },
  { key: 'AGENT_RATE_LIMIT', src: agentAuthSrc, pattern: /AGENT_RATE_LIMIT = (\d+)/ },
  { key: 'AGENT_RATE_WINDOW_SECONDS', src: agentAuthSrc, pattern: /AGENT_RATE_WINDOW_SECONDS = (\d+)/ },
  { key: 'bodyLimit', src: indexSrc, pattern: /maxSize: (\d+) \* 1024/ },
  { key: 'locked_until', src: authRoutesSrc, pattern: /\?>=(\d+) THEN datetime\('now','\+(\d+) minutes'\)/ },
  { key: 'MODEL_TOTAL_INPUT_CHARS', src: schemasSrc, pattern: /MODEL_TOTAL_INPUT_CHARS = (\d+)/ },
  { key: 'MODEL_TIMEOUT_MS', src: aiSrc, pattern: /MODEL_TIMEOUT_MS = (\d+)/ },
]

function enforcedBounds(): Array<{ key: string; values: string[] }> {
  return BOUNDS.map(({ key, src, pattern }) => {
    const m = pattern.exec(src)
    expect(m, `could not read the ${key} bound from source — the literal moved or changed shape`).not.toBeNull()
    return { key, values: m!.slice(1).filter(Boolean) }
  })
}

// ------------------------------------------------------------ document access

/**
 * Every markdown table row of SECURITY.md whose first cell is a single backticked identifier,
 * keyed by that identifier. The whole row is kept so a stated bound can be looked for
 * anywhere in it, and the last cell separately so an empty explanation is detectable.
 */
function docRows(): Map<string, { row: string; cells: string[]; explanation: string }> {
  const rows = new Map<string, { row: string; cells: string[]; explanation: string }>()
  for (const line of securitySrc.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue
    const cells = line.split('|').map((c) => c.trim())
      .filter((c, idx, arr) => !(c === '' && (idx === 0 || idx === arr.length - 1)))
    if (cells.length < 2) continue
    const key = /^`([^`]+)`$/.exec(cells[0])?.[1]
    if (!key) continue
    rows.set(key, { row: line, cells, explanation: cells[cells.length - 1] })
  }
  return rows
}

/** `100000` written as `100000` or `100,000` — both are the same claim. */
function statesNumber(text: string, value: string): boolean {
  const grouped = value.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return new RegExp(`(^|[^\\d,])${value}([^\\d,]|$)`).test(text)
    || new RegExp(`(^|[^\\d,])${grouped}([^\\d,]|$)`).test(text)
}

const SCOPES = agentScopes()
const ROUTES = agentRouteTable()
const HEADERS = hardeningHeaders()
const RELAXATIONS = cspRelaxations()
const OPEN = unauthenticatedRoutes()
const BOUNDS_FOUND = enforcedBounds()

describe('SECURITY.md claims exactly what the code guarantees', () => {
  // Vacuity floors. Every coverage assertion below is a filter over a derived list, and a
  // filter over an empty list passes. A broken extractor would therefore certify a clean
  // security document it never checked anything against — finding 15's defect class, and the
  // most dangerous possible place for it. The counts are asserted before the coverage is.
  it('the extractors actually read the source', () => {
    expect(SCOPES.length, 'the AGENT_SCOPES extractor found almost nothing').toBeGreaterThanOrEqual(9)
    expect(ROUTES.length, 'the agentRoute extractor found almost nothing').toBeGreaterThanOrEqual(9)
    expect(HEADERS.length, 'the hardening-header extractor found almost nothing').toBeGreaterThanOrEqual(4)
    expect(RELAXATIONS.length, 'the CSP relaxation extractor found almost nothing').toBeGreaterThanOrEqual(5)
    expect(OPEN.length, 'the unauthenticated-route extractor found almost nothing').toBeGreaterThanOrEqual(7)
    expect(BOUNDS_FOUND.length, 'the enforced-bound extractor found almost nothing').toBeGreaterThanOrEqual(8)
    expect(
      docRows().size,
      'SECURITY.md carries almost no keyed table rows, so every coverage check below would '
      + 'be comparing the derived lists against nothing',
    ).toBeGreaterThanOrEqual(20)
  })

  it('documents what every agent scope permits', () => {
    const rows = docRows()
    const undocumented = SCOPES.filter((s) => !rows.has(s))
    expect(
      undocumented,
      `SECURITY.md has no row for the ${undocumented.join(', ')} scope. A scope the document `
      + 'does not describe is a permission the commander cannot reason about before granting it.',
    ).toEqual([])
    const unexplained = SCOPES.filter((s) => (rows.get(s)?.explanation ?? '').length < 20)
    expect(
      unexplained,
      `these scope rows carry no real explanation: ${unexplained.join(', ')}. Naming a scope `
      + 'without saying what it opens documents nothing.',
    ).toEqual([])
  })

  it('documents every versioned agent route with the scope the code actually requires', () => {
    const rows = docRows()
    const missing = ROUTES.filter((r) => !rows.has(r.path))
    expect(
      missing.map((r) => r.path),
      `SECURITY.md has no row for ${missing.map((r) => r.path).join(', ')}. An agent route `
      + 'absent from the document is an undocumented way into personal data.',
    ).toEqual([])
    // The scope in the row must be the scope the guard enforces, and it must be its own cell.
    // Accepting the string anywhere in the row would let a table mislabel the required-scope
    // column and still pass on a passing mention in the prose beside it — and a document that
    // understates a credential's permission is worse than one that names none: it tells the
    // commander a credential is narrower than it is.
    const wrongScope = ROUTES.filter((r) => !rows.get(r.path)!.cells.includes(`\`${r.scope}\``))
    expect(
      wrongScope.map((r) => `${r.path} needs ${r.scope}`),
      'these rows do not name the scope the code enforces: '
      + `${wrongScope.map((r) => `${r.path} requires ${r.scope}`).join('; ')}. `
      + 'A document that understates a credential permission is a false assurance.',
    ).toEqual([])
    const paths = new Set(ROUTES.map((r) => r.path))
    const stale = [...rows.keys()].filter((k) => k.startsWith('/api/agent/v1/') && !paths.has(k))
    expect(
      stale,
      `SECURITY.md documents ${stale.join(', ')} but agentRoute no longer routes them. A `
      + 'security document describing routes that do not exist cannot be trusted about the '
      + 'ones that do.',
    ).toEqual([])
  })

  it('documents every route reachable without authentication', () => {
    const rows = docRows()
    const undocumented = OPEN.filter((p) => !rows.has(p))
    expect(
      undocumented,
      `SECURITY.md has no row for the unauthenticated route${undocumented.length === 1 ? '' : 's'} `
      + `${undocumented.join(', ')}. The open surface is the first thing a reader needs and `
      + 'the first thing that grows by accident.',
    ).toEqual([])
    const registered = new Set(OPEN)
    const stale = [...rows.keys()].filter((k) => k.startsWith('/api/auth/') && !registered.has(k))
    expect(
      stale,
      `SECURITY.md documents ${stale.join(', ')} as open, but no such route is registered.`,
    ).toEqual([])
  })

  it('names every hardening header the application sets', () => {
    const missing = HEADERS.filter((h) => !securitySrc.includes(h))
    expect(
      missing,
      `SECURITY.md does not name ${missing.join(', ')}, which setSecurityHeaders sets on `
      + 'every response.',
    ).toEqual([])
  })

  it('discloses every CSP relaxation, and claims none the CSP does not carry', () => {
    const undisclosed = RELAXATIONS.filter((r) => !securitySrc.includes(r))
    expect(
      undisclosed,
      `the Content-Security-Policy permits ${undisclosed.join(', ')} and SECURITY.md does `
      + 'not say so. A policy document that lists only its restrictions and omits its '
      + 'relaxations describes a stricter application than the one that ships.',
    ).toEqual([])
    // And the other direction. If the CSP is tightened later, a document still confessing a
    // weakness that was removed is also inaccurate — understating protection is a smaller
    // harm than overstating it, but it is still a false claim.
    const carried = new Set(RELAXATIONS)
    const phantom = [...new Set([...securitySrc.matchAll(/\b(unsafe-[a-z-]+)\b/g)].map((m) => m[1]))]
      .filter((r) => !carried.has(r))
    expect(
      phantom,
      `SECURITY.md discusses ${phantom.join(', ')}, which the CSP no longer contains.`,
    ).toEqual([])
  })

  it('states each enforced bound with the value the code enforces', () => {
    const rows = docRows()
    const missing = BOUNDS_FOUND.filter((b) => !rows.has(b.key))
    expect(
      missing.map((b) => b.key),
      `SECURITY.md has no row for ${missing.map((b) => b.key).join(', ')}.`,
    ).toEqual([])
    // The value has to be inside that identifier's own row, not merely somewhere in the
    // document, so a number cannot be satisfied by an unrelated sentence that happens to
    // contain it.
    const wrong: string[] = []
    for (const bound of BOUNDS_FOUND) {
      const row = rows.get(bound.key)
      if (!row) continue
      for (const value of bound.values) {
        if (!statesNumber(row.row, value)) wrong.push(`${bound.key} enforces ${value}`)
      }
    }
    expect(
      wrong,
      `these rows do not state the value the code enforces: ${wrong.join('; ')}. A documented `
      + 'bound that no longer matches its literal is the exact defect this repository keeps '
      + 'finding — prose that stopped being true and said nothing when it did.',
    ).toEqual([])
  })

  it('records the operator boundary rather than claiming operator work', () => {
    // Everything at the edge of the repository — Access, secrets, rotation, deploy — belongs
    // to a separate operator. A SECURITY.md that described those as done would be claiming
    // protections this repository cannot provide, which is the one thing the clause forbids.
    expect(
      securitySrc,
      'SECURITY.md does not name Cloudflare Access, so a reader cannot tell which layer of '
      + 'the protection is outside this repository',
    ).toMatch(/Cloudflare Access/)
    expect(
      securitySrc,
      'SECURITY.md does not identify the operator-scoped boundary (secrets, credential '
      + 'rotation, deployment), so its guarantees read as broader than they are',
    ).toMatch(/operator/i)
  })
})
