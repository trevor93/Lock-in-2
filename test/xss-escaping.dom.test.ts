import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Extract the REAL escaping helpers from the shipped frontend source and run
// them, rather than reasoning about them. Book 7: esc/nl2br now live in
// app/core/sanitize.js and mdLite in app/features/council.js; those modules can't
// be evaluated wholesale here (they import siblings), so pull out just the pure
// functions under test.
const appSrc = readFileSync(resolve(__dirname, '../public/static/app/core/sanitize.js'), 'utf8')
const app6Src = readFileSync(resolve(__dirname, '../public/static/app/features/council.js'), 'utf8')

const escLine = appSrc.match(/const esc = [^\n]+/)![0]
const nl2brLine = appSrc.match(/const nl2br = [^\n]+/)![0]
const mdLiteFn = app6Src.match(/function mdLite\(s\)\s*\{[\s\S]*?\n\}/)![0]

// eslint-disable-next-line no-new-func
const factory = new Function(
  `${escLine}\n${nl2brLine}\n${mdLiteFn}\nreturn { esc, nl2br, mdLite };`,
)
const { esc, nl2br, mdLite } = factory() as {
  esc: (s: unknown) => string
  nl2br: (s: unknown) => string
  mdLite: (s: string) => string
}

const PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><svg/onload=alert(1)>',
  "javascript:alert(1)//",
  '<iframe src="data:text/html,<script>alert(1)</script>">',
  '</textarea><script>steal()</script>',
]

describe('Book 6 — model/user output escaping', () => {
  it('esc neutralises every angle bracket and quote', () => {
    for (const p of PAYLOADS) {
      const out = esc(p)
      expect(out, p).not.toMatch(/<script|<img|<svg|<iframe/i)
      expect(out).not.toContain('<')
      expect(out).not.toContain('>')
    }
  })

  it('nl2br introduces only <br>, never attacker markup', () => {
    for (const p of PAYLOADS) {
      const out = nl2br(p + '\nsecond line')
      // The only tag it is allowed to add is <br>.
      const tags = out.match(/<[^>]+>/g) || []
      for (const tag of tags) expect(tag).toBe('<br>')
    }
  })

  it('mdLite escapes model output before any formatting', () => {
    for (const p of PAYLOADS) {
      const out = mdLite(p)
      // No RAW markup may survive: every < the payload contained is escaped, so
      // dangerous handlers like onerror remain inert text, never live attributes.
      expect(out, p).not.toMatch(/<script|<img|<svg|<iframe/i)
      // Only the app's own whitelisted formatting tags may appear.
      const tags = (out.match(/<([a-z]+)/gi) || []).map((t) => t.slice(1).toLowerCase())
      for (const tag of tags) expect(['strong', 'p', 'br']).toContain(tag)
    }
  })

  it('mdLite still renders legitimate markdown emphasis', () => {
    const out = mdLite('**forge on**')
    expect(out).toContain('<strong')
    expect(out).toContain('forge on')
  })
})
