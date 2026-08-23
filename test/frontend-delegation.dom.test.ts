import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Book 7 structural guard: the generated frontend must carry NO inline event-handler
// attributes (they are why the CSP still needs script-src 'unsafe-inline'); all
// interactivity flows through the delegated data-act dispatcher. This also proves
// every data-act used in the markup maps to a registered handler, so a typo or a
// forgotten registration can't ship as a silently-dead button.

// Book 7: the frontend is an ES-module tree under public/static/app/ (core/ +
// features/) bundled by Vite, so the guard scans every module.
const FILES = [
  'core/shell.js', 'core/events.js', 'core/sanitize.js',
  'features/campaign.js', 'features/mind.js', 'features/debrief.js',
  'features/library.js', 'features/council.js', 'features/response-lab.js',
  'features/rhetoric.js',
]
const SRC = FILES
  .map((f) => readFileSync(resolve(__dirname, '../public/static/app/', f), 'utf8'))
  .join(String.fromCharCode(10))

// Pull handler names out of each registerActions({...}) object via a brace-balanced
// scan (arrow bodies contain their own braces, so a naive regex would stop short).
function registeredNames(src: string): Set<string> {
  const names = new Set<string>()
  const marker = 'registerActions({'
  let i = src.indexOf(marker)
  while (i !== -1) {
    let depth = 0
    const start = src.indexOf('{', i)
    let j = start
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++
      else if (src[j] === '}') { depth--; if (depth === 0) break }
    }
    const body = src.slice(start + 1, j)
    for (const m of body.matchAll(/(\w+):\s*\(/g)) names.add(m[1])
    i = src.indexOf(marker, j)
  }
  return names
}

describe('B7 frontend delegation integrity', () => {
  it('carries no inline event-handler attributes in any shipped app file', () => {
    const offenders = [...SRC.matchAll(/\son(click|keydown|change|input|submit|mouseover|load|error)\s*=\s*"/g)]
      .map((m) => m[0].trim())
    expect(offenders, 'inline handlers force script-src unsafe-inline').toEqual([])
  })

  it('registers a handler for every data-act referenced in the markup', () => {
    const registered = registeredNames(SRC)
    expect(registered.size, 'no registerActions blocks found').toBeGreaterThan(20)
    const used = new Set<string>()
    for (const m of SRC.matchAll(/data-act(?:-enter|-change)?="([a-zA-Z][\w]*)"/g)) used.add(m[1])
    expect(used.size, 'no data-act attributes found').toBeGreaterThan(20)
    const missing = [...used].filter((name) => !registered.has(name))
    expect(missing, 'these data-act names have no registered handler').toEqual([])
  })
})
