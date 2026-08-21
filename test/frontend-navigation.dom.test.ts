import { describe, expect, it, beforeEach } from 'vitest'
import { bootFrontend, flush, waitFor, MINIMAL_STATE } from './helpers/frontend-harness'

// Book 7 frontend restructure — navigation characterisation net. Before the
// globals->ES-module + Vite-bundle rewrite, this locks the render contract: every
// bottom-nav tab, given representative data, renders its view without throwing.
// A view that threw would leave the clicked tab un-activated (shell() re-renders
// the nav with the active tab only after the view builds), so "tab becomes active"
// is the proof each view function rendered. The rewrite must keep all of these green.

// Representative payloads for every endpoint a tab loads on first open.
const ROUTES: Record<string, unknown> = {
  'GET /api/auth/status': { setup: true, authed: true, csrfToken: 'test-csrf' },
  'POST /api/tick': MINIMAL_STATE,
  'GET /api/campaign': [],
  'GET /api/library': [],
  'GET /api/intel': [],
  'GET /api/hermes/history': [],
  'GET /api/cards/due': [],
  'GET /api/maxims': [],
  'GET /api/tongue': [],
  'GET /api/tongue/due': [],
  'GET /api/tongue/stats': {
    total: 0, due: 0, byMastery: [], byCat: [], reviews7: 0, solid7: 0,
    captured7: 0, exams: [], weekExamDone: false,
  },
  'GET /api/debriefs': [],
  'GET /api/rewards': [],
  'GET /api/predictions': [],
  'GET /api/predictions/calibration': { brier: null, buckets: [] },
  'GET /api/changelog': [],
  'GET /api/stats': {
    total: 0, due: 0, nonePlausible: 0,
    days: [], medals: [], categories: [], flagCounts: [], ledger: [], unitStats: [],
    cardStats: { new: 0, learning: 0, memorized: 0, ingrained: 0, reflex: 0 },
    alternativeExplanations: { total: 0, nonePlausible: 0 },
    byMastery: [], byCat: [], exams: [],
  },
}

const TABS = ['today', 'campaign', 'library', 'council', 'mind', 'tongue', 'debrief', 'stats']

describe('B7 frontend navigation integrity', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('boots into the war room and every bottom-nav tab renders its view without error', async () => {
    bootFrontend(ROUTES)
    await flush()
    expect(document.querySelector('#main-nav'), 'did not reach the authenticated shell').not.toBeNull()

    for (const tab of TABS) {
      const btn = document.querySelector(`#main-nav [data-tab="${tab}"]`) as HTMLElement
      expect(btn, `nav tab ${tab} missing`).not.toBeNull()
      btn.click()
      await waitFor(() => (document.querySelector(`#main-nav [data-tab="${tab}"]`) as HTMLElement)?.className.includes('active'))
      const active = document.querySelector(`#main-nav [data-tab="${tab}"]`) as HTMLElement
      expect(active?.className, `tab ${tab} never became active — its view threw during render`).toContain('active')
      expect(document.body.textContent, `tab ${tab} fell into the failure screen`).not.toContain('Failed to load')
    }
  })
})
