import { describe, expect, it } from 'vitest'
import deploymentDoc from '../DEPLOYMENT.md?raw'
import operationsSrc from '../OPERATIONS.md?raw'
import handoffSrc from '../OPERATOR_HANDOFF.md?raw'
import pkgSrc from '../package.json?raw'
import envSrc from '../src/env.ts?raw'
import gitignoreSrc from '../.gitignore?raw'

// Book 17 Definition of Done, Documentation (MASTERPROMPT.md): "Add ... DEPLOYMENT.md ...
// Make no claim that is not technically guaranteed."
//
// A deployment document is read once, under pressure, by an operator who is about to change
// production. Every figure in it is a figure they will act on. And it is the document most
// exposed to drift: a binding added to `src/env.ts`, a script added to `package.json`, a cron
// schedule edited in a `wrangler.jsonc` — each one silently makes a prose deployment guide
// describe a system that no longer exists.
//
// So this document owns FACTS ABOUT THE ARTIFACTS and nothing else. `OPERATIONS.md` owns the
// procedure — the ordered, checkboxed steps an operator performs — and duplicating procedure
// here would create a second copy that nothing tests, which is exactly the drift `SECURITY.md`
// §12 already cost. The rule is enforced below: DEPLOYMENT.md may contain no checkbox steps.
//
// Everything else is DERIVED and compared in BOTH directions:
//   - the deployables, from the `wrangler.jsonc` files that exist
//   - the runtime bindings, from the `Bindings` type and the Cron Worker's `Env` interface
//   - the scripts, from `package.json`
//   - the build artifacts, from the build configs and `.gitignore`
//   - the internal job paths, from the routes that register them and the workers that call them
//
// The last of those is the load-bearing one. The set of `/internal/jobs/*` paths the
// application registers, minus the set any committed scheduler actually calls, is the set of
// job paths that cannot fire in production. Today that difference is not empty, and this file
// makes the document state it. If a scheduler is later added for the missing path, the
// difference changes and this file fails — because a document that keeps warning about a
// closed gap is as wrong as one that hides an open one.

// ---------------------------------------------------------------------------- derivations

/** JSONC, string-aware. `//` appears inside `https://…`, so a naive comment strip corrupts
 *  the one value in these files an operator most needs to be exact. */
function jsonc(raw: string, label: string): any {
  try {
    return JSON.parse(raw)
  } catch (_) {
    let out = ''
    let inString = false
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i]
      if (inString) {
        out += ch
        if (ch === '\\') { out += raw[++i] ?? ''; continue }
        if (ch === '"') inString = false
        continue
      }
      if (ch === '"') { inString = true; out += ch; continue }
      if (ch === '/' && raw[i + 1] === '/') { while (i < raw.length && raw[i] !== '\n') i++; out += '\n'; continue }
      out += ch
    }
    try {
      return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
    } catch (error) {
      throw new Error(`${label} is not parseable as JSONC: ${(error as Error).message}`)
    }
  }
}

const norm = (p: string) => p.replace(/^\.\.\//, '')
const raws = (glob: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(glob).map(([k, v]) => [norm(k), v as string]))

/** Discovered, not listed. One `wrangler.jsonc` per deployable is the whole inventory. */
const WRANGLER_SOURCES = {
  ...raws(import.meta.glob('../wrangler.jsonc', { query: '?raw', import: 'default', eager: true })),
  ...raws(import.meta.glob('../workers/*/wrangler.jsonc', { query: '?raw', import: 'default', eager: true })),
} as Record<string, string>

const DEPLOYABLES = Object.entries(WRANGLER_SOURCES)
  .map(([path, raw]) => ({ path, config: jsonc(raw, path) }))
  .sort((a, b) => a.path.localeCompare(b.path))

const PAGES = DEPLOYABLES.find((d) => d.path === 'wrangler.jsonc')
const CRON = DEPLOYABLES.find((d) => d.path.startsWith('workers/'))

const PKG = JSON.parse(pkgSrc) as { scripts: Record<string, string> }
const SCRIPTS = PKG.scripts ?? {}

/**
 * `export type Bindings = { ... }` and `interface Env { ... }` both, because the two
 * deployables declare their environment in the two different ways TypeScript allows and the
 * document has to be right about both. Comment lines are dropped: `src/env.ts` explains what
 * absent VAPID keys mean in a `//` comment directly above the field.
 */
function declaredFields(src: string, name: string): Array<{ name: string; optional: boolean }> {
  const at = src.search(new RegExp(`(?:export\\s+)?(?:type\\s+${name}\\s*=\\s*|interface\\s+${name}\\s*)\\{`))
  if (at === -1) return []
  const body = src.slice(src.indexOf('{', at) + 1)
  const end = body.indexOf('\n}')
  const fields: Array<{ name: string; optional: boolean }> = []
  for (const line of body.slice(0, end === -1 ? undefined : end).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//')) continue
    const m = /^([A-Za-z_][A-Za-z0-9_]*)(\??)\s*:/.exec(trimmed)
    if (m) fields.push({ name: m[1], optional: m[2] === '?' })
  }
  return fields
}

const CRON_SOURCES = raws(
  import.meta.glob('../workers/**/*.ts', { query: '?raw', import: 'default', eager: true }),
) as Record<string, string>

const PAGES_BINDINGS = declaredFields(envSrc, 'Bindings')
const CRON_BINDINGS = declaredFields(
  Object.values(CRON_SOURCES).find((s) => /interface\s+Env\s*\{/.test(s)) ?? '', 'Env')

/** Every `/internal/jobs/*` the application registers, from the modules that register them. */
const SERVER_SOURCES = raws(
  import.meta.glob('../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
) as Record<string, string>

const REGISTERED_JOBS = [...new Set(
  Object.values(SERVER_SOURCES).flatMap((src) =>
    [...src.matchAll(/app\.(?:post|get|all)\(\s*'(\/internal\/jobs\/[a-z-]+)'/g)].map((m) => m[1])),
)].sort()

/** Every `/internal/jobs/*` a committed scheduler actually targets — source AND config, since
 *  the URL the worker posts to is a `vars` entry rather than a literal in its code. */
const SCHEDULER_SOURCES = {
  ...CRON_SOURCES,
  ...raws(import.meta.glob('../workers/*/wrangler.jsonc', { query: '?raw', import: 'default', eager: true })),
} as Record<string, string>

const CALLED_JOBS = [...new Set(
  Object.values(SCHEDULER_SOURCES).flatMap((src) =>
    [...src.matchAll(/\/internal\/jobs\/[a-z-]+/g)].map((m) => m[0])),
)].sort()

const UNTRIGGERED_JOBS = REGISTERED_JOBS.filter((p) => !CALLED_JOBS.includes(p))

// ---------------------------------------------------------------------------- document parsing

/** The body of one heading, up to the next heading of the same or shallower depth. */
function docSection(heading: string): string {
  const at = deploymentDoc.indexOf(heading)
  if (at === -1) return ''
  const depth = (heading.match(/^#+/) ?? ['##'])[0].length
  const rest = deploymentDoc.slice(at + heading.length)
  const next = rest.search(new RegExp(`\\n#{2,${depth}} `))
  return next === -1 ? rest : rest.slice(0, next)
}

/** `| \`NAME\` | required | … |` — table rows only, never prose. */
function bindingRows(section: string): Array<{ name: string; optional: boolean }> {
  const rows: Array<{ name: string; optional: boolean }> = []
  for (const line of section.split('\n')) {
    const m = /^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|\s*(required|optional)\s*\|/.exec(line.trim())
    if (m) rows.push({ name: m[1], optional: m[2] === 'optional' })
  }
  return rows
}

/** Prose, as a reader takes it: one line. Markdown here is hand-wrapped, so a sentence a
 *  reader sees whole — "does not perform it" — is split by a newline in the file. Matching
 *  the raw text would fail a true document, and would let re-wrapping a paragraph change
 *  whether a claim counts as present. */
const flat = (text: string) => text.replace(/\s+/g, ' ')

const SELF = (import.meta.url.split('/').pop() ?? '').replace(/\?.*$/, '')

describe('DEPLOYMENT.md describes the deployables that exist', () => {
  it('names every deployable, and no deployable that does not exist', () => {
    // A vacuity floor: if the globs resolve to nothing, every set comparison below is between
    // empty sets and passes while proving nothing.
    expect(
      DEPLOYABLES.length,
      'no wrangler.jsonc was found at all, so every comparison below is between empty sets',
    ).toBeGreaterThan(0)
    expect(PAGES, 'the root wrangler.jsonc is gone, so the Pages deployable cannot be checked')
      .toBeTruthy()
    expect(CRON, 'no worker under workers/ has a wrangler.jsonc, so the second deployable cannot '
      + 'be checked').toBeTruthy()

    // Forward: every config path and every configured name must appear.
    for (const { path, config } of DEPLOYABLES) {
      expect(deploymentDoc, `DEPLOYMENT.md does not mention ${path}`).toContain(path)
      expect(
        deploymentDoc,
        `DEPLOYMENT.md does not state the configured name "${config.name}" of ${path}`,
      ).toContain(config.name)
    }

    // Reverse: a config path stated in the document that is not on disk is a claim about a
    // deployable nobody can deploy.
    const stated = [...deploymentDoc.matchAll(/`((?:workers\/[a-z0-9-]+\/)?wrangler\.jsonc)`/g)]
      .map((m) => m[1])
    expect(
      [...new Set(stated)].filter((p) => !WRANGLER_SOURCES[p]),
      'DEPLOYMENT.md names these wrangler configs and they do not exist',
    ).toEqual([])
  })

  it('states the Pages fields an operator has to get right, including the placeholder id', () => {
    const d1 = (PAGES!.config.d1_databases ?? [])[0] ?? {}
    expect(d1.binding, 'the root config no longer declares a D1 binding').toBeTruthy()
    for (const value of [
      PAGES!.config.compatibility_date,
      PAGES!.config.pages_build_output_dir,
      d1.binding,
      d1.database_name,
      d1.database_id,
    ]) {
      expect(
        deploymentDoc,
        `DEPLOYMENT.md does not state the configured value "${value}"`,
      ).toContain(String(value))
    }
    for (const flag of PAGES!.config.compatibility_flags ?? []) {
      expect(deploymentDoc, `DEPLOYMENT.md does not state the compatibility flag "${flag}"`)
        .toContain(String(flag))
    }
    // The committed database_id is not a real one. An operator who deploys with it deployed a
    // Pages project bound to nothing, and the failure surfaces as broken reads, not as a
    // configuration error. The document must say so where it states the value.
    expect(
      String(d1.database_id),
      'the committed database_id is no longer a placeholder; DEPLOYMENT.md explains that it is '
      + 'one and that explanation is now false',
    ).toBe('local-placeholder')
    // Checked inside §3, in words the value cannot supply. A bare /placeholder/ against the
    // document is satisfied by `local-placeholder` itself: the assertion would be guarding a
    // claim with a string the claim is about, and would pass a document that states the id
    // and explains nothing. A mutation that deleted the whole explanation proved exactly that.
    const pagesSection = docSection('## 3.')
    expect(pagesSection.length, 'DEPLOYMENT.md has no §3, so the section that has to explain '
      + 'the placeholder database_id does not exist').toBeGreaterThan(200)
    expect(
      flat(pagesSection),
      'the section that states the placeholder database_id does not say it is a placeholder in '
      + 'words the value itself does not supply',
    ).toMatch(/is a placeholder|a placeholder,|not a real database id|placeholder, not/i)
    expect(
      flat(pagesSection),
      'the section that states the placeholder database_id does not say who supplies the real '
      + 'one, so a reader cannot tell whether the gap is a defect or a boundary',
    ).toMatch(/operator-supplied|supplied by the operator|the operator (?:replaces|supplies|provides)/i)
  })

  it('states the Cron Worker schedule, entry point and target, all from its config', () => {
    const crons = CRON!.config.triggers?.crons ?? []
    expect(crons.length, 'the Cron Worker config declares no cron trigger').toBeGreaterThan(0)
    for (const schedule of crons) {
      expect(deploymentDoc, `DEPLOYMENT.md does not state the cron schedule "${schedule}"`)
        .toContain(String(schedule))
    }
    expect(deploymentDoc, 'DEPLOYMENT.md does not state the Cron Worker entry point')
      .toContain(String(CRON!.config.main))
    const url = String(CRON!.config.vars?.ENFORCEMENT_JOB_URL ?? '')
    expect(url, 'the Cron Worker config no longer declares ENFORCEMENT_JOB_URL').toMatch(/^https:/)
    expect(deploymentDoc, 'DEPLOYMENT.md does not state the URL the Cron Worker posts to')
      .toContain(url)
  })
})

describe('DEPLOYMENT.md describes the runtime contract of both deployables', () => {
  it('has a row for every Pages binding, with required/optional taken from the type', () => {
    expect(PAGES_BINDINGS.length, 'no fields were parsed out of the Bindings type, so every '
      + 'comparison below is between empty sets').toBeGreaterThan(0)
    const rows = bindingRows(docSection('## 5.'))
    expect(rows.length, 'the §5 binding table parsed to no rows at all').toBeGreaterThan(0)

    const declared = new Map(PAGES_BINDINGS.map((b) => [b.name, b.optional]))
    const documented = new Map(rows.map((r) => [r.name, r.optional]))

    expect(
      PAGES_BINDINGS.filter((b) => !documented.has(b.name)).map((b) => b.name),
      'these bindings are read by the application and have no row in §5, so an operator '
      + 'configuring from this document configures an incomplete environment',
    ).toEqual([])

    // Reverse, restricted to names the type could plausibly own: a row for a binding the
    // application does not read tells an operator to create a secret nothing consumes.
    const cronOnly = new Set(CRON_BINDINGS.map((b) => b.name))
    expect(
      rows.map((r) => r.name).filter((n) => !declared.has(n) && !cronOnly.has(n)),
      'these §5 rows name bindings that nothing in src/ or workers/ declares',
    ).toEqual([])

    // And required/optional must match the type, in both directions. Calling a required
    // binding optional is the more dangerous half: it invites an operator to skip it.
    expect(
      PAGES_BINDINGS
        .filter((b) => documented.has(b.name) && documented.get(b.name) !== b.optional)
        .map((b) => `${b.name} is ${b.optional ? 'optional' : 'required'} in src/env.ts`),
      'these bindings are documented with the wrong requiredness',
    ).toEqual([])
  })

  it('has a row for every Cron Worker binding', () => {
    expect(CRON_BINDINGS.length, 'no fields were parsed out of the Cron Worker Env interface')
      .toBeGreaterThan(0)
    const rows = bindingRows(docSection('## 6.'))
    expect(rows.length, 'the §6 Cron Worker binding table parsed to no rows at all')
      .toBeGreaterThan(0)
    const documented = new Map(rows.map((r) => [r.name, r.optional]))
    expect(
      CRON_BINDINGS.filter((b) => !documented.has(b.name)).map((b) => b.name),
      'the Cron Worker reads these and §6 has no row for them',
    ).toEqual([])
    expect(
      CRON_BINDINGS
        .filter((b) => documented.get(b.name) !== b.optional)
        .map((b) => `${b.name} is ${b.optional ? 'optional' : 'required'} in the Env interface`),
      'these Cron Worker bindings are documented with the wrong requiredness',
    ).toEqual([])
  })

  it('states what the code actually does when a binding is absent, in the code\'s own words', () => {
    // Not paraphrased. Each of these strings is the literal the application returns, so a
    // reader can grep the source for the phrase this document told them to expect.
    const app = Object.values(SERVER_SOURCES).join('\n')
    for (const literal of [
      'MODEL SERVICE OFFLINE',
      'INVALID INTERNAL CREDENTIAL',
      'PUSH SERVICE OFFLINE',
    ]) {
      expect(app, `the application no longer returns "${literal}"`).toContain(literal)
      expect(
        deploymentDoc,
        `DEPLOYMENT.md does not state the failure "${literal}" the code returns`,
      ).toContain(literal)
    }
    // The three of those are 503, 401, 503 — and which one an operator sees decides what they
    // fix. The document must carry the status codes, not just the phrases.
    for (const code of ['401', '503']) {
      expect(deploymentDoc, `DEPLOYMENT.md does not state the ${code} response`).toContain(code)
    }
  })

  it('states that the job secret must match across two deployables, and what a mismatch looks like', () => {
    const shared = PAGES_BINDINGS.map((b) => b.name)
      .filter((n) => CRON_BINDINGS.some((c) => c.name === n))
    expect(
      shared,
      'no binding is declared by both deployables any more, so the "must match" claim in this '
      + 'document is about a value that is no longer shared',
    ).toContain('ENFORCEMENT_JOB_SECRET')
    const section = docSection('## 7.')
    expect(section.length, 'DEPLOYMENT.md has no §7').toBeGreaterThan(200)
    for (const name of shared) {
      expect(section, `§7 does not name the shared value ${name}`).toContain(name)
    }
    expect(
      flat(section),
      '§7 does not state that the two copies of the shared secret must be equal',
    ).toMatch(/must match|must be (?:the same|equal|identical)|the only binding both/i)
    // The specific trap: the credential check precedes openJobRun in both internal routes, so
    // a wrong secret writes no job_runs row and looks exactly like a Cron that never ran.
    expect(
      section,
      '§7 does not explain that a wrong secret leaves no job_runs row, which is what makes it '
      + 'indistinguishable from a scheduler that never called',
    ).toMatch(/job_runs/)
  })
})

describe('DEPLOYMENT.md describes what the repository builds', () => {
  it('names every npm script, and no script that does not exist', () => {
    expect(Object.keys(SCRIPTS).length, 'package.json declares no scripts').toBeGreaterThan(0)
    for (const name of Object.keys(SCRIPTS)) {
      expect(deploymentDoc, `DEPLOYMENT.md does not name the script \`npm run ${name}\``)
        .toContain(`npm run ${name}`)
    }
    const stated = [...deploymentDoc.matchAll(/npm run ([a-z][a-z0-9:-]*)/g)].map((m) => m[1])
    expect(
      [...new Set(stated)].filter((n) => !(n in SCRIPTS)),
      'DEPLOYMENT.md names these npm scripts and package.json does not declare them',
    ).toEqual([])
  })

  it('separates the committed artifact from the one rebuilt at deploy time', () => {
    // Two build outputs with opposite handling, and confusing them is a real operator error:
    // one is in git and gate-compared byte for byte, the other is gitignored and must exist
    // on the machine that deploys.
    expect(gitignoreSrc, 'dist/ is no longer gitignored, so this document\'s account of which '
      + 'artifact is committed is wrong').toMatch(/^dist\/$/m)
    expect(deploymentDoc, 'DEPLOYMENT.md does not name the gitignored build output')
      .toContain('dist/')
    expect(deploymentDoc, 'DEPLOYMENT.md does not name the committed client bundle')
      .toContain('public/static/bundle.js')
    expect(
      SCRIPTS.verify ?? '',
      'the verify script no longer compares the committed bundle against a rebuild, so the '
      + 'claim that the shipped bundle matches its source is no longer guaranteed',
    ).toContain('public/static/bundle.js')
    expect(
      deploymentDoc,
      'DEPLOYMENT.md does not state that the gate compares the committed bundle against a rebuild',
    ).toMatch(/git diff --exit-code/)
  })

  it('states that CI runs the gate and holds no credentials, and points at the test that enforces it', () => {
    const ci = raws(import.meta.glob('../.github/workflows/*.yml', {
      query: '?raw', import: 'default', eager: true,
    })) as Record<string, string>
    expect(Object.keys(ci).length, 'no workflow exists, so §9\'s account of CI is about nothing')
      .toBeGreaterThan(0)
    const ciSection = docSection('## 9.')
    expect(ciSection.length, 'DEPLOYMENT.md has no §9, so its account of CI does not exist')
      .toBeGreaterThan(200)
    for (const path of Object.keys(ci)) {
      expect(ciSection, `§9 does not name the workflow ${path}`).toContain(path)
    }
    // Deferred, not restated: gate-completeness owns the forbidden-token sweep. This document
    // states the guarantee and names the file that enforces it, so a reader can check the
    // claim rather than believe it.
    expect(
      ciSection,
      'the section that claims CI performs no deploy does not name the test that enforces it. '
      + 'Checked here and not document-wide: §12 names the same test, so a document-wide check '
      + 'passes a §9 that makes the claim and points at nothing',
    ).toContain('test/gate-completeness.test.ts')
    expect(
      flat(ciSection),
      'the section that describes CI does not state that it holds no credentials and performs '
      + 'no deploy, which is the claim the named test enforces',
    ).toMatch(/no credentials.{0,80}no deploy|performs no deploy/i)
  })
})

describe('DEPLOYMENT.md records where the repository disagrees with itself', () => {
  it('names every internal job path, and exactly the ones no committed scheduler calls', () => {
    expect(REGISTERED_JOBS.length, 'no /internal/jobs path was found in src/, so every '
      + 'comparison below is between empty sets').toBeGreaterThan(0)
    for (const path of REGISTERED_JOBS) {
      expect(deploymentDoc, `DEPLOYMENT.md does not name the internal job path ${path}`)
        .toContain(path)
    }
    // The derivation this document exists for. Not "documented as a caveat" — computed.
    expect(
      UNTRIGGERED_JOBS,
      'the set of internal job paths with no committed scheduler changed. If it shrank, a '
      + 'scheduler was added and this document still warns about a closed gap; if it grew, a '
      + 'job path was added that cannot fire and the document does not say so',
    ).toEqual(['/internal/jobs/alarms'])
    const section = docSection('## 10.')
    expect(section.length, 'DEPLOYMENT.md has no §10').toBeGreaterThan(400)
    for (const path of UNTRIGGERED_JOBS) {
      expect(
        section,
        `§10 does not record that ${path} has no committed scheduler, so an operator deploying `
        + 'only what is in this repository gets an endpoint that never fires',
      ).toContain(path)
    }
  })

  it('records the project-name divergence between the config and the runbook command', () => {
    const configured = String(PAGES!.config.name)
    const deployed = (/--project-name\s+([a-z0-9-]+)/.exec(operationsSrc) ?? [])[1] ?? ''
    expect(deployed, 'OPERATIONS.md no longer states a --project-name, so the divergence this '
      + 'section records cannot be derived').toBeTruthy()
    expect(
      configured === deployed,
      `wrangler.jsonc "name" and the runbook's --project-name now agree (${configured}). The `
      + 'divergence §10 warns about is closed, and the warning is now false',
    ).toBe(false)
    const section = docSection('## 10.')
    expect(section, `§10 does not state the configured project name "${configured}"`)
      .toContain(configured)
    expect(section, `§10 does not state the deployed project name "${deployed}"`)
      .toContain(deployed)
    // The consequence is the point: `npm run deploy` carries no --project-name, so it takes
    // the name from the config and would target the wrong project.
    expect(
      SCRIPTS.deploy ?? '',
      'the deploy script no longer runs wrangler pages deploy, so this warning is stale',
    ).toContain('wrangler pages deploy')
    expect(
      SCRIPTS.deploy ?? '',
      'the deploy script now pins a project name, which closes the trap §10 describes',
    ).not.toContain('--project-name')
    expect(
      flat(section),
      '§10 does not warn that the bare deploy script takes the project name from the config',
    ).toMatch(/npm run deploy[^.]{0,200}(?:no --project-name|carries no|takes the name from)/i)
  })

  it('records that the committed scheduler and the handoff\'s scheduler are not the same worker', () => {
    // OPERATOR_HANDOFF.md §4 walks an operator through pasting a Worker that calls both job
    // paths on two schedules. `workers/enforcement-cron/` is a different worker: one path, one
    // schedule, and under version control. An operator following both deploys two.
    const handoffCalls = [...new Set(
      [...handoffSrc.matchAll(/\/internal\/jobs\/[a-z-]+/g)].map((m) => m[0]))].sort()
    expect(
      handoffCalls.length > CALLED_JOBS.length,
      'OPERATOR_HANDOFF.md and the committed worker now describe the same set of job paths, so '
      + 'the divergence §10 records is closed',
    ).toBe(true)
    const section = docSection('## 10.')
    expect(section, '§10 does not name the committed worker\'s configured name')
      .toContain(String(CRON!.config.name))
    expect(
      flat(section),
      '§10 does not point at the handoff section that describes the other scheduler',
    ).toMatch(/OPERATOR_HANDOFF\.md`?\s*§4/)
  })
})

describe('DEPLOYMENT.md keeps procedure and production where they belong', () => {
  it('contains no operator procedure, because OPERATIONS.md owns it', () => {
    // The no-second-copy rule, enforced structurally rather than by judgement. A checkbox is
    // a step someone performs; steps live in one file so there is one thing to keep true.
    const checkboxes = [...deploymentDoc.matchAll(/^\s*-\s*\[[ x]\]/gm)]
    expect(
      checkboxes.length,
      'DEPLOYMENT.md has started keeping its own operator checklist. Procedure belongs to '
      + 'OPERATIONS.md; a second copy here is a copy nothing tests',
    ).toBe(0)
    // And it must actually hand off, by section number, to sections that exist.
    const referenced = [...new Set(
      [...deploymentDoc.matchAll(/OPERATIONS\.md`?\s*§(\d+)/g)].map((m) => m[1]))]
    expect(
      referenced.length,
      'DEPLOYMENT.md points at no OPERATIONS.md section, so it either duplicates the procedure '
      + 'or leaves the reader without it',
    ).toBeGreaterThanOrEqual(3)
    expect(
      referenced.filter((n) => !new RegExp(`^## ${n}\\.`, 'm').test(operationsSrc)),
      'DEPLOYMENT.md points at OPERATIONS.md sections that do not exist',
    ).toEqual([])
  })

  it('keeps production on the operator side of the boundary', () => {
    const boundary = docSection('## 11.')
    expect(boundary.length, 'DEPLOYMENT.md has no §11, so the section carrying the operator '
      + 'boundary is gone').toBeGreaterThan(300)
    expect(
      flat(boundary),
      'the section that owns the operator boundary does not say that deploying is the '
      + 'operator\'s action',
    ).toMatch(/is an \*{0,2}operator action|the operator (?:deploys|applies|performs)|performed by the operator/i)
    expect(
      flat(boundary),
      'the section that owns the operator boundary does not say that this repository does not '
      + 'perform the deploy',
    ).toMatch(/does not perform|never performs|does not deploy|never deploys/i)
    // A runnable command against production may not appear where that framing is absent. The
    // scripts table names `npm run deploy` as a script that exists — that is a fact about
    // package.json. `wrangler pages deploy` against the live project is an instruction.
    const PROD_CMD = /wrangler pages deploy\s+\S/g
    expect(
      [...deploymentDoc.matchAll(PROD_CMD)].length - [...boundary.matchAll(PROD_CMD)].length,
      'DEPLOYMENT.md states a runnable production deploy command outside §11, where the '
      + 'sentence that makes deploying the operator\'s action does not appear',
    ).toBe(0)
  })

  it('states what it does not claim, and points only at tests that exist', () => {
    const nonClaims = docSection('## 12.')
    expect(nonClaims.length, 'DEPLOYMENT.md has no §12 non-claims section').toBeGreaterThan(300)
    expect(
      flat(nonClaims),
      'the non-claims section does not disclaim that any deployment has happened, which is '
      + 'the one thing a deployment document must not be read as asserting',
    ).toMatch(/does not claim (?:any|that any) deployment has happened/i)
    expect(
      [...nonClaims.matchAll(/^-\s/gm)].length,
      'the non-claims section lists fewer than four things, which is fewer than this document '
      + 'has reason to disclaim',
    ).toBeGreaterThanOrEqual(4)

    // `import.meta.glob` deliberately excludes the module doing the globbing, so this file
    // would report itself as nonexistent. The self name is derived rather than written out:
    // renaming this file must not be able to make the check pass by naming a file that is gone.
    const tests = new Set([
      ...Object.keys(raws(import.meta.glob('./*.test.ts', { eager: false }))).map((p) => `test/${p.replace('./', '')}`),
      `test/${SELF}`,
    ])
    expect(tests.has(`test/${SELF}`), 'the self name could not be derived from import.meta.url')
      .toBe(true)
    const named = [...new Set([...deploymentDoc.matchAll(/`(test\/[a-z0-9.-]+\.test\.ts)`/g)]
      .map((m) => m[1]))]
    expect(named.length, 'DEPLOYMENT.md names no test, so nothing it claims is checkable')
      .toBeGreaterThan(0)
    expect(
      named.filter((t) => !tests.has(t)),
      'DEPLOYMENT.md points at tests that do not exist',
    ).toEqual([])
  })
})
