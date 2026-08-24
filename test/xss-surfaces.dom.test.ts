import { describe, expect, it, beforeEach } from 'vitest'
import { bootFrontend, waitFor, MINIMAL_STATE } from './helpers/frontend-harness'

// Book 17 test matrix: "XSS: journal, model output, imported notes, and book notes all
// escaped or sanitised."
//
// test/xss-escaping.dom.test.ts already existed and was green. All four of its tests
// call `esc`, `nl2br`, or `mdLite` DIRECTLY and assert the returned string is safe.
// That proves the tools work. It does not prove that any surface USES them — which is
// the same defect shape this audit has now found six times over: a helper, a taxonomy,
// a skip list, or a runbook that is perfectly correct in itself while the thing meant
// to consult it does not. The renderer proved the point earlier in this same audit:
// `esc` was imported and sitting in scope in shell.js the entire time four status
// comparisons were reading a spelling nothing writes.
//
// So this file asserts the SURFACE, end to end. It boots the real shipped bundle,
// serves hostile text from the real endpoints into every live free-text field, and
// then inspects the DOM that came out. Two things must hold for each surface, and the
// second matters as much as the first:
//
//   1. Nothing executable landed — no <script>, no `on*` attribute, no javascript: URL.
//   2. The text DID land, visibly — because a surface that silently dropped the field
//      would satisfy (1) vacuously and this whole file would be guarding nothing.

const SCRIPT = '<script>window.__pwned = 1</script>'
const IMG = '"><img src=x onerror="window.__pwned = 2">'
const SVG = '<svg onload=window.__pwned=3>'
const ANCHOR = '<a href="javascript:window.__pwned=4">counsel</a>'
/** All four in one field, with a newline so the nl2br surfaces exercise their <br> path. */
const HOSTILE = SCRIPT + '\n' + IMG + '\n' + SVG + '\n' + ANCHOR

/**
 * Every way a payload could have become live markup instead of text. Tags first, then
 * attributes: an escaped payload yields NEITHER, because `esc` neutralises the `<` that
 * would have opened the tag and the `"` that would have closed the preceding attribute.
 *
 * `img` and `svg` are deliberately NOT in the tag list. The app is entitled to render
 * either one; what it is never entitled to render is an event handler on one. Flagging
 * the tag would make this scan fire on legitimate markup, and a guard that cries wolf
 * gets deleted by the next reader.
 */
function liveMarkup(root: HTMLElement | null): string[] {
  const out: string[] = []
  if (!root) return out
  for (const el of Array.from(root.querySelectorAll('*')) as HTMLElement[]) {
    const tag = el.tagName.toLowerCase()
    if (['script', 'iframe', 'object', 'embed'].includes(tag)) out.push('<' + tag + '>')
    for (const name of el.getAttributeNames()) {
      const lower = name.toLowerCase()
      if (lower.startsWith('on')) out.push(tag + '[' + lower + ']')
      const value = String(el.getAttribute(name) ?? '').replace(/\s+/g, '').toLowerCase()
      if (['src', 'href', 'formaction', 'xlink:href'].includes(lower) && value.startsWith('javascript:')) {
        out.push(tag + '[' + lower + '=javascript:]')
      }
    }
  }
  return out
}

/** The rendered app, plus the splash the boot harness also installs. */
const rendered = (): HTMLElement | null => document.querySelector('#app')

const AUTH = { setup: true, authed: true, csrfToken: 'test-csrf' }

/** Endpoints every tab touches on first open; each test overrides the ones it poisons. */
const BASE: Record<string, unknown> = {
  'GET /api/auth/status': AUTH,
  'POST /api/tick': MINIMAL_STATE,
  'GET /api/miss-causes': [],
  'GET /api/intel': [],
  'GET /api/hermes/history': [],
}

const block = (over: Record<string, unknown> = {}) => ({
  id: 42, title: 'Deep Work', category: 'deepwork',
  start_time: '09:00', end_time: '10:30', is_non_negotiable: 0,
  points: 10, weight: 1, ratchet_tier: 'mandatory', log_status: 'pending',
  ...over,
})

async function boot(routes: Record<string, unknown>): Promise<void> {
  bootFrontend({ ...BASE, ...routes })
  await waitFor(() => !!document.querySelector('#main-nav'))
  expect(document.querySelector('#main-nav'), 'never reached the authenticated shell').not.toBeNull()
}

/** Click a bottom-nav tab and wait for it to actually activate (a throw leaves it inert). */
async function openTab(tab: string): Promise<void> {
  const btn = document.querySelector(`#main-nav [data-tab="${tab}"]`) as HTMLElement
  expect(btn, `nav tab ${tab} missing`).not.toBeNull()
  btn.click()
  await waitFor(() => (document.querySelector(`#main-nav [data-tab="${tab}"]`) as HTMLElement)
    ?.className.includes('active'))
}

async function openFace(face: string): Promise<void> {
  const seg = document.querySelector(`#tab-segments [data-seg="${face}"]`) as HTMLElement
  expect(seg, `segment ${face} missing`).not.toBeNull()
  seg.click()
  await waitFor(() => (document.querySelector(`#tab-segments [data-seg="${face}"]`) as HTMLElement)
    ?.className.includes('text-gold'))
}

beforeEach(() => {
  document.body.innerHTML = ''
  delete (globalThis as unknown as Record<string, unknown>).__pwned
})

describe('B17/B6 the escaping scan can actually see an unescaped payload', () => {
  it('fires on raw markup and stays silent on the escaped form of the same text', () => {
    // A guard built out of a DOM scan has to be shown to fire, or it is a rule nobody
    // enforces. This is the payload every test below sends, injected raw.
    document.body.innerHTML = '<div id="probe"></div>'
    const probe = document.querySelector('#probe') as HTMLElement
    probe.innerHTML = HOSTILE
    const offences = liveMarkup(document.querySelector<HTMLElement>('#probe'))
    expect(offences.some((o) => o === '<script>'), 'the scan cannot see a <script> tag').toBe(true)
    expect(offences.some((o) => o === 'img[onerror]'), 'the scan cannot see an onerror attribute').toBe(true)
    expect(offences.some((o) => o === 'svg[onload]'), 'the scan cannot see an onload attribute').toBe(true)
    expect(offences.some((o) => o === 'a[href=javascript:]'), 'the scan cannot see a javascript: URL').toBe(true)

    // And the escaped form of the SAME string must come back clean, or every pass below
    // would only be telling us the scan is blind.
    const escaped = HOSTILE.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c] as string))
    probe.innerHTML = escaped
    expect(liveMarkup(document.querySelector<HTMLElement>('#probe')), 'the scan over-matches escaped text').toEqual([])
    expect(probe.textContent, 'escaping destroyed the text instead of neutralising it').toContain('<script>')
  })
})

describe("B17/B6 the commander's own free text cannot execute", () => {
  it('a hostile block title renders as text on the NOW face and in the schedule', async () => {
    const b = block({ title: HOSTILE })
    await boot({ 'POST /api/tick': { ...MINIMAL_STATE, current: b, blocks: [b] } })

    expect(liveMarkup(rendered()), 'a block title reached the DOM as markup').toEqual([])
    expect((globalThis as unknown as Record<string, unknown>).__pwned, 'the payload executed').toBeUndefined()
    // (2): it rendered. Without this the surface could be dropping the title entirely.
    expect(document.body.textContent, 'the title never rendered — the pass above is vacuous')
      .toContain('window.__pwned = 1')

    await openFace('schedule')
    expect(liveMarkup(rendered()), 'a block title reached the schedule row as markup').toEqual([])
    expect(document.body.textContent, 'the schedule row never rendered the title').toContain('window.__pwned = 1')
  })

  it('a hostile honesty-engine flag message and a hostile targets note render as text', async () => {
    // Both are stored free text the commander wrote himself, and `yesterdayTargets`
    // goes through nl2br rather than esc — a different helper, so a separate surface.
    await boot({
      'POST /api/tick': {
        ...MINIMAL_STATE,
        flags: [{ id: 7, severity: 2, message: HOSTILE, kind: 'unlogged' }],
        yesterdayTargets: HOSTILE,
      },
    })

    expect(liveMarkup(rendered()), 'a flag message or targets note reached the DOM as markup').toEqual([])
    expect((globalThis as unknown as Record<string, unknown>).__pwned, 'the payload executed').toBeUndefined()
    expect(document.querySelector('#honesty-flags'), 'the flags panel never rendered').not.toBeNull()
    expect(document.querySelector('#honesty-flags')?.textContent, 'the flag message never rendered')
      .toContain('window.__pwned = 1')
    expect(document.body.textContent, 'the targets note never rendered').toContain('window.__pwned=3')
  })
})

describe('B17/B6 model output cannot execute', () => {
  it("Hermes's answer renders as text through mdLite, formatting intact", async () => {
    // The row Book 6 is actually about: text this app did not write and cannot vet,
    // arriving from an upstream model, passed through a formatter that emits real HTML.
    // mdLite escapes FIRST and only then introduces <strong>/<p>/<br>; if that order
    // ever inverted, the formatter itself would become the injection vector.
    await boot({
      'GET /api/hermes/history': [
        { role: 'user', content: HOSTILE, created_at: '2026-08-24T08:59:00' },
        {
          role: 'assistant',
          content: '### Counsel\n**Hold the line.**\n' + HOSTILE,
          created_at: '2026-08-24T09:00:00',
        },
      ],
    })
    await openTab('more')
    await waitFor(() => !!document.querySelector('#hermes-log'))

    const log = document.querySelector('#hermes-log')
    expect(log, 'the Hermes log never rendered').not.toBeNull()
    expect(liveMarkup(rendered()), 'model output reached the DOM as markup').toEqual([])
    expect((globalThis as unknown as Record<string, unknown>).__pwned, 'model output executed').toBeUndefined()
    expect(log?.textContent, 'the answer never rendered').toContain('window.__pwned = 1')
    expect(log?.textContent, "the commander's own message never rendered").toContain('window.__pwned = 2')
    // The legitimate markdown still works — escaping must neutralise the attack without
    // flattening the formatting Hermes is expected to use.
    expect(log?.querySelector('strong')?.textContent, 'mdLite stopped rendering emphasis')
      .toContain('Hold the line.')
  })

  it('a hostile Hermes analysis on an intel entry renders as text', async () => {
    await boot({
      'GET /api/intel': [{
        id: 3, log_date: '2026-08-24', domain: 'family', title: HOSTILE,
        verdict: 'smart', people: HOSTILE, situation: HOSTILE, my_move: HOSTILE,
        outcome: HOSTILE, principle_used: HOSTILE, lesson: HOSTILE,
        hermes_analysis: '**Read again.**\n' + HOSTILE,
      }],
    })
    await openTab('more')
    await openFace('intel')
    await waitFor(() => !!document.querySelector('details'))

    expect(liveMarkup(rendered()), 'an intel field reached the DOM as markup').toEqual([])
    expect((globalThis as unknown as Record<string, unknown>).__pwned, 'an intel field executed').toBeUndefined()
    const entry = document.querySelector('details')
    expect(entry, 'the intel entry never rendered').not.toBeNull()
    expect(entry?.textContent, 'the intel entry rendered none of its hostile fields')
      .toContain('window.__pwned = 1')
    expect(entry?.textContent, 'the Hermes analysis never rendered').toContain('window.__pwned=4')
  })
})

describe('B17/B6 library and curriculum text cannot execute', () => {
  it('a hostile book title and a hostile unit title render as text', async () => {
    // Book notes (migrations/0002: `notes TEXT`) have no render surface yet — nothing
    // reads that column on the client, so there is no surface here to guard. What DOES
    // render from the library is the book and unit titles, which arrive from an import
    // rather than from a form, and are therefore the "imported notes" of the matrix row
    // as the app actually stands today.
    await boot({
      'POST /api/tick': {
        ...MINIMAL_STATE,
        activeUnits: [{ id: 1, title: HOSTILE, phase: 'P1', status: 'active', book_title: HOSTILE }],
      },
      'GET /api/library': [{
        id: 1, title: HOSTILE, author: HOSTILE, phase_code: 'P1',
        total: 1, done: 0, units: [{ id: 1, title: HOSTILE, status: 'active' }],
      }],
    })

    expect(liveMarkup(rendered()), 'a unit title reached the DOM as markup').toEqual([])
    expect(document.body.textContent, 'the active unit never rendered').toContain('window.__pwned = 1')

    await openTab('more')
    await openFace('settings')
    await waitFor(() => document.body.textContent?.includes('window.__pwned') === true)
    expect(liveMarkup(rendered()), 'a library title reached the DOM as markup').toEqual([])
    expect((globalThis as unknown as Record<string, unknown>).__pwned, 'a library title executed').toBeUndefined()
  })
})
