import { describe, expect, it } from 'vitest'
import pkgSrc from '../package.json?raw'
import operationsSrc from '../OPERATIONS.md?raw'
import handoffSrc from '../OPERATOR_HANDOFF.md?raw'
import clientConfigSrc from '../vite.client.config.ts?raw'
import gitignoreSrc from '../.gitignore?raw'

// THE DEFECT THIS EXISTS TO PREVENT, stated plainly because it already happened.
//
// The 2026-08-25 audit found fifteen defects with one cause: a hand-written count,
// list, or literal stops being true the moment the thing it describes grows, and
// nothing tells you. Every fix replaced the hand-written thing with a derivation.
//
// The gate that verifies those fixes was itself the same defect, and nothing caught
// it because nothing was looking. `OPERATIONS.md`'s Section 5 preflight — the block
// that every migration subsection routes through — was a hand-written list of
// commands. When a second vitest project was added, the list did not change. It ran
// `npm test`, `vitest.config.ts` excludes `**/*.dom.test.ts`, and so the operator's
// migration gate ran 572 of 620 tests and exited 0. The audit report then recorded
// that "the runbook preflight names both" suites. It did not. A false claim about a
// gate is worse than a missing gate: it is the sentence that stops the search.
//
// So the command list is derived here from the vitest configs that actually exist.
// Add a third project and this file fails until the gate names it.

const pkg = JSON.parse(pkgSrc) as { scripts: Record<string, string> }

// Scripts delegate — `verify` calls `npm test`, which calls `npm run test:dom`.
// Asserting against the literal text of one script would force every config name to
// be repeated in every script that must cover it, which is the hand-written list
// this file exists to forbid. So references are expanded first and the assertions
// run against what the command TRANSITIVELY executes.
function expand(script: string, depth = 0): string {
  if (depth > 4) return script
  return script.replace(/npm (?:run )?([\w:]+)/g, (whole, name) => {
    const body = pkg.scripts[name]
    return body ? expand(body, depth + 1) : whole
  })
}

// Discovered, not listed. Vite resolves this at build time, which is what makes it
// work inside the workers pool — that pool cannot read disk at runtime.
const configModules = import.meta.glob('../vitest*.config.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const configNames = Object.keys(configModules)
  .map((path) => path.replace(/^.*\//, ''))
  .sort()

// The one build output git tracks, read out of the config that writes it instead of
// typed in here a second time. `dist/` — the worker bundle — is gitignored, so
// nothing is committed for it to go stale against.
const clientOutDir = /outDir:\s*'([^']+)'/.exec(clientConfigSrc)?.[1]
const clientEntryFile = /entryFileNames:\s*'([^']+)'/.exec(clientConfigSrc)?.[1]
const clientBundle = `${clientOutDir}/${clientEntryFile}`

describe('Book 17 gate completeness', () => {
  it('found the vitest projects on disk', () => {
    // A floor, so a broken glob fails loudly instead of quietly checking nothing.
    // Two projects exist today: the workers pool and happy-dom.
    expect(configNames.length, 'the vitest config glob came back empty').toBeGreaterThanOrEqual(2)
    expect(configNames).toContain('vitest.config.ts')
    expect(configNames).toContain('vitest.dom.config.ts')
  })

  it('npm test runs every vitest project, so it cannot report green on a subset', () => {
    expect(pkg.scripts.test, 'package.json has no test script').toBeTruthy()
    const test = expand(pkg.scripts.test)
    for (const name of configNames) {
      // The default config is the one vitest picks with no --config flag, so the
      // bare `vitest run` covers it. Every OTHER config must be named explicitly
      // or its tests never run.
      if (name === 'vitest.config.ts') continue
      expect(
        test,
        `npm test does not run ${name}, so it reports green while that project's `
        + 'tests never execute — this is exactly how the DOM suite sat outside the gate',
      ).toContain(name)
    }
  })

  it('npm run verify is the whole gate in one command', () => {
    expect(pkg.scripts.verify, 'package.json has no verify script').toBeTruthy()
    const verify = expand(pkg.scripts.verify)
    // Every project, by derivation.
    for (const name of configNames) {
      if (name === 'vitest.config.ts') continue
      expect(verify, `verify does not run ${name}`).toContain(name)
    }
    // The build must precede the DOM suite: those tests import the BUILT bundle,
    // not the source, so verifying against a stale bundle proves nothing about the
    // source that was actually committed.
    const buildAt = verify.indexOf('build')
    const domAt = verify.indexOf('vitest.dom.config.ts')
    expect(buildAt, 'verify never builds').toBeGreaterThanOrEqual(0)
    expect(
      buildAt,
      'verify runs the DOM suite before the build, so it tests a stale bundle',
    ).toBeLessThan(domAt)
    expect(verify, 'verify does not typecheck').toContain('tsc --noEmit')
    expect(verify, 'verify does not check for whitespace damage').toContain('git diff --check')
    // THE REPRODUCIBILITY CHECK. `git diff --exit-code` after a build fails when the
    // committed artefacts disagree with the committed source. That disagreement is
    // the shape of the audit's first CRITICAL finding — a bundle that had stopped
    // matching the code it was built from — and it is what made one intermediate
    // commit on this branch unreproducible. Verified by hand once; a check that runs
    // once is a claim, so it runs every time now.
    expect(
      verify,
      'verify does not detect a committed artefact that disagrees with its source',
    ).toContain('git diff --exit-code')
  })

  it('the reproducibility check is scoped to the artefact git actually tracks', () => {
    // Derived, so a moved outDir cannot leave this checking a path that no longer exists.
    expect(clientOutDir, 'could not read outDir out of vite.client.config.ts').toBeTruthy()
    expect(
      clientEntryFile,
      'could not read entryFileNames out of vite.client.config.ts',
    ).toBeTruthy()

    // `dist/` is gitignored, so the worker bundle has no committed copy to disagree
    // with and cannot be diffed at all. If that ever changes it becomes a second
    // committed artefact, and this fails until the check below covers it.
    expect(
      gitignoreSrc,
      'dist/ is no longer gitignored, so the worker bundle is now committed and the '
      + 'reproducibility check has to cover it too',
    ).toMatch(/^dist\/$/m)

    // ONE MESSAGE, ONE CAUSE. An unscoped `git diff --exit-code` also fires on any
    // unrelated uncommitted edit, so its failure cannot distinguish "the committed
    // bundle is stale" from "you have work in progress." That is finding 15 of the
    // audit exactly: an assertion whose message cannot name its cause teaches an
    // operator to re-run the gate until it goes green.
    const verify = expand(pkg.scripts.verify)
    expect(
      verify,
      'the reproducibility check is not path-scoped, so its failure cannot say whether '
      + 'the committed bundle is stale or the operator merely has uncommitted work',
    ).toMatch(/git diff --exit-code\s+--\s+\S/)
    expect(
      verify,
      `the reproducibility check does not name ${clientBundle}, the one build output git tracks`,
    ).toContain(clientBundle)
  })

  it('the runbook preflight delegates to the derived gate instead of listing commands', () => {
    // Locate the preflight block, then require it to call the single command rather
    // than re-listing the pieces. A second hand-written list is a second thing to
    // forget.
    const at = operationsSrc.indexOf('**Preflight')
    expect(at, 'the Section 5 preflight block is gone from OPERATIONS.md').toBeGreaterThan(-1)
    const preflight = operationsSrc.slice(at, at + 1200)
    expect(
      preflight,
      'the preflight lists test commands by hand instead of calling npm run verify, '
      + 'so it can go stale again the way it already did',
    ).toContain('npm run verify')
    expect(
      preflight,
      'the preflight still calls bare `npm test` alongside verify, which invites an '
      + 'operator to treat the shorter one as sufficient',
    ).not.toMatch(/^npm test$/m)
  })

  it('the operator handoff gate agrees with package.json', () => {
    // The handoff is the document an operator reads first. It had the right list
    // when the runbook did not; it must not drift the other way now.
    expect(handoffSrc, 'the handoff does not name the single gate command').toContain('npm run verify')
  })

  it('CI runs the same command, so the gate is not a matter of remembering', () => {
    const workflows = import.meta.glob('../.github/workflows/*.yml', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    const bodies = Object.values(workflows)
    expect(
      bodies.length,
      'no GitHub Actions workflow exists, so the only gate is a human choosing to run it',
    ).toBeGreaterThanOrEqual(1)
    const all = bodies.join('\n')
    expect(all, 'no workflow runs npm run verify').toContain('npm run verify')
    expect(all, 'no workflow installs from the lockfile').toContain('npm ci')
    // The forbidden-token sweep below runs against EXECUTABLE lines only. A YAML
    // comment cannot deploy anything, and the workflow documents its own scope
    // boundary in prose that necessarily names the tools it refuses to use — so
    // scanning raw text would forbid the file from explaining itself. Full-line
    // comments are dropped; anything that can actually run is still checked.
    const executable = all
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n')
    // SCOPE BOUNDARY, ENFORCED. Cloudflare belongs to a separate operator agent and
    // deploys are permanently outside this agent's scope. CI is a test runner: if a
    // deploy step or a credential ever appears in a workflow, this fails.
    for (const forbidden of ['wrangler', 'CLOUDFLARE_API_TOKEN', 'secrets.', 'pages deploy', 'npm run deploy']) {
      expect(
        executable,
        `a workflow step references "${forbidden}" — CI must never deploy or hold credentials`,
      ).not.toContain(forbidden)
    }
  })
})
