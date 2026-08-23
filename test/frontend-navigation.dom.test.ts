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
  // Book 12.7 — the Response Lab's BUILD face loads the eleven intents and past builds.
  'GET /api/lab/response/intents': {
    intents: [{
      slug: 'boundary', title: 'Boundary',
      architecture: 'observation -> standard -> consequence -> exit',
      when_to_use: 'When a line has been crossed.', logic: 'The observation comes first.',
      sort_order: 1,
    }],
    layers: [
      { slug: 'intent', asks: 'What this response is for.' },
      { slug: 'truth', asks: 'What is actually true.' },
      { slug: 'structure', asks: 'The moves, in order.' },
      { slug: 'delivery', asks: 'Cadence, emphasis, where to stop.' },
    ],
    neverTheLineAlone: 'Never give the line alone.',
    assessment: [
      { slug: 'appropriateness', better: 'higher', inverted: false },
      { slug: 'escalation_risk', better: 'lower', inverted: true },
    ],
  },
  'GET /api/lab/responses': { builds: [], layers: [], assessment: [] },
  // Book 11 — the Farnsworth programme's LEARN face.
  'GET /api/rhetoric/track': {
    rootNode: 'Every figure is a form of controlled repetition or controlled absence.',
    parts: [
      { part: 1, acts_on: 'words', operates_on: 'the ear', why: 'Repetition is percussion.', installed: false, unlocked: true, reason: null },
      { part: 3, acts_on: 'the audience', operates_on: 'stance', why: 'Gaps register against a pattern.', installed: false, unlocked: false, reason: 'Part 3 needs Part 1 and Part 2 first.' },
    ],
    partOrderReason: 'Sound, then structure, then stance.',
    firstDay: 53, lastDay: 204,
    phases: [], chapters: [{ id: 1, phase_code: 'P1', part: 1, title: 'Simple Repetition', figure_slug: 'epizeuxis', day_from: 60, day_to: 66, self_audit: null }],
    milestones: [],
    cycle: [{ day: 1, slug: 'install', title: 'Install', job: 'Taught in full.', constraint: 'He produces nothing.' }],
    chapterSlots: [], selfAuditMarks: [{ mark: 'N', meaning: 'new' }],
    fieldDefault: { rule: 'One figure, used once, never announced.', success: 'They think it was their own.', failure: 'They remember his style.' },
  },
  'GET /api/rhetoric/today': {
    date: '2026-08-21', programmeDay: null, inTrack: false, where: null, cycleDay: null,
    fieldDefault: {}, dailyReviewMinutes: 10, dailyReviewReason: 'Ten minutes daily, non-negotiable.',
  },
  'GET /api/rhetoric/metrics': {
    programmeDay: null,
    metrics: [{
      slug: 'noticed_ratio', title: 'Noticed versus landed invisibly',
      measures: 'The share of deployments the counterpart noticed.', better: 'lower',
      note: 'BEING NOTICED IS THE FAILURE CONDITION.', inverted: true, renderAsProgress: false,
      data: { deployments: 0, noticed: 0, value: null },
    }],
    fieldDefault: { rule: 'One figure, used once, never announced.' },
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

// Book 9: nine tabs collapsed to five, each with faces that used to be tabs.
const TABS = ['today', 'learn', 'practice', 'review', 'more']
// Book 11 adds `rhetoric` to LEARN; Book 12.7 renames the `tongue` face to `response`.
const FACES: Record<string, string[]> = {
  today: ['now', 'schedule'],
  learn: ['campaign', 'books', 'rhetoric'],
  practice: ['cards', 'maxims', 'response'],
  review: ['debrief', 'stats'],
  more: ['council', 'intel', 'settings'],
}

describe('B7 frontend navigation integrity', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('boots into the war room and every bottom-nav tab renders its view without error', async () => {
    bootFrontend(ROUTES)
    await waitFor(() => !!document.querySelector('#main-nav'))
    expect(document.querySelector('#main-nav'), 'did not reach the authenticated shell').not.toBeNull()

    for (const tab of TABS) {
      const btn = document.querySelector(`#main-nav [data-tab="${tab}"]`) as HTMLElement
      expect(btn, `nav tab ${tab} missing`).not.toBeNull()
      btn.click()
      await waitFor(() => (document.querySelector(`#main-nav [data-tab="${tab}"]`) as HTMLElement)?.className.includes('active'))
      const active = document.querySelector(`#main-nav [data-tab="${tab}"]`) as HTMLElement
      expect(active?.className, `tab ${tab} never became active — its view threw during render`).toContain('active')
      expect(document.body.textContent, `tab ${tab} fell into the failure screen`).not.toContain('Failed to load')

      // Every face of the tab must render too: these were the old nine tabs, and
      // Book 9 collapses them without losing any of them.
      for (const face of FACES[tab]) {
        const seg = document.querySelector(`#tab-segments [data-seg="${face}"]`) as HTMLElement
        expect(seg, `tab ${tab} is missing its ${face} segment`).not.toBeNull()
        seg.click()
        await waitFor(() => !!document.querySelector(`#tab-segments [data-seg="${face}"]`)
          && (document.querySelector(`#tab-segments [data-seg="${face}"]`) as HTMLElement).className.includes('text-gold'))
        expect(document.body.textContent, `${tab}/${face} fell into the failure screen`).not.toContain('Failed to load')
        expect(document.querySelector('#main-nav'), `${tab}/${face} lost the shell`).not.toBeNull()
      }
    }
  })
})
