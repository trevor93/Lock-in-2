import { describe, expect, it, beforeEach } from 'vitest'
import { bootFrontend, waitFor, MINIMAL_STATE } from './helpers/frontend-harness'

// Book 8.3 in the SCHEDULE, and Book 8.7 in the copy it writes.
//
// Two defects live on the same lines of core/shell.js, and both are the failure this
// audit keeps finding: a hand-written list of status literals that stopped being
// exhaustive the moment the taxonomy moved.
//
// 1. THE STALE RENDER. viewToday() decided how to draw each row with
//    `b.log_status==='done'` / `'partial'` / `'skipped'` / `'missed'`. STATUS_BUTTONS
//    writes the DOCTRINAL spellings ('completed', 'partial', 'intentionally_canceled'),
//    so every block the commander logged through the shipped interface came back and
//    rendered as UNTOUCHED - no strikethrough, no colour, and the row still advertising
//    the points he had already earned. The fix that made the buttons doctrinal is what
//    exposed it: two lists, one updated.
//
// 2. THE UNTRUE PENALTY COPY. Those same lines claimed 'WINDOW CLOSED - AUTO-CANCELED.
//    PENALTY APPLIED.' and 'MISSED - WINDOW CLOSED - PENALTY TAKEN'. Book 8.3: "A block
//    is never auto-cancelled merely because its window passed. unreported is a data
//    state, not a moral one; it carries a prompt, not a penalty." The same-day engine
//    writes `unreported` and moves no points, so the auto-cancel sentence describes an
//    engine that no longer exists, and the penalty sentence names a charge that was
//    never taken. Book 8.7 reserves red for genuine risk or failure, "never ordinary
//    incompletion".
//
// These drive the real shipped renderer, so they fail again if either list drifts.

const AUTH = { setup: true, authed: true, csrfToken: 'test-csrf' }

const block = (log_status: string, over: Record<string, unknown> = {}) => ({
  id: 42, title: 'Deep Work', category: 'deepwork',
  start_time: '09:00', end_time: '10:30', log_status,
  is_non_negotiable: 0, points: 10, weight: 1, ratchet_tier: 'mandatory', ...over,
})

function bootWith(log_status: string) {
  const b = block(log_status)
  return bootFrontend({
    'GET /api/auth/status': AUTH,
    'POST /api/tick': { ...MINIMAL_STATE, current: b, blocks: [b] },
    'GET /api/miss-causes': [],
  })
}

/** Switch TODAY to its schedule face - the FULL DAY PLAN - and return that row. */
async function scheduleRow(log_status: string): Promise<HTMLElement> {
  bootWith(log_status)
  await waitFor(() => !!document.querySelector('#tab-segments [data-seg="schedule"]'))
  ;(document.querySelector('#tab-segments [data-seg="schedule"]') as HTMLElement).click()
  await waitFor(() => !!document.querySelector('#today-schedule article'))
  return document.querySelector('#today-schedule article') as HTMLElement
}

describe('B8.3 the schedule draws the doctrinal statuses', () => {
  beforeEach(() => { document.body.innerHTML = '' })


  // The pending row reads `+N pts` in grey. A landed row must not be indistinguishable
  // from it - it still names the points (they were EARNED), but as a credit, in green.
  const PENDING_LINE = 'class="text-[10px] text-gray-500">+10 pts'

  it('draws a `completed` block as landed, not as untouched', async () => {
    const row = await scheduleRow('completed')
    expect(row.innerHTML, 'a completed block renders exactly like an untouched one')
      .not.toContain(PENDING_LINE)
    expect(row.innerHTML, 'the points are not shown as earned').toContain('✔ +10 pts')
    expect(row.innerHTML, 'a completed block is not struck through - it reads as untouched')
      .toContain('line-through')
  })

  it('still draws a legacy `done` block as landed, so history keeps its meaning', async () => {
    const row = await scheduleRow('done')
    expect(row.innerHTML).toContain('line-through')
    expect(row.innerHTML, 'a legacy done row reads as untouched').not.toContain(PENDING_LINE)
    expect(row.innerHTML).toContain('✔ +10 pts')
  })

  it('draws `completed_late` as landed too', async () => {
    const row = await scheduleRow('completed_late')
    expect(row.innerHTML, 'completed_late earns full credit (Book 8.3)').toContain('line-through')
  })

  it('draws an `intentionally_canceled` block as the honest cancellation', async () => {
    const row = await scheduleRow('intentionally_canceled')
    expect(row.innerHTML, 'the honest cancellation renders as untouched').toContain('text-red-400')
    expect(row.innerHTML, 'a cancelled block still advertises its points').not.toContain('+10 pts')
  })

  it('draws a `partial` block as partial', async () => {
    const row = await scheduleRow('partial')
    expect(row.innerHTML, 'partial credit is not shown').toContain('partial')
  })
})

describe('B8.3 / B8.7 the interface claims no penalty the engine did not take', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  const UNTRUE = ['AUTO-CANCELED', 'PENALTY APPLIED', 'PENALTY TAKEN']

  it('an unreported block is not called an auto-cancellation on the NOW face', async () => {
    bootWith('unreported')
    await waitFor(() => !!document.querySelector('[data-act="openCause"]'))
    const html = document.body.innerHTML
    for (const phrase of UNTRUE) {
      expect(html, `an unreported window took no penalty - "${phrase}" is untrue (Book 8.3)`)
        .not.toContain(phrase)
    }
  })

  it('an unreported block is not called an auto-cancellation in the schedule either', async () => {
    const row = await scheduleRow('unreported')
    for (const phrase of UNTRUE) {
      expect(row.innerHTML, `"${phrase}" is untrue of an unreported window`).not.toContain(phrase)
    }
  })

  it('a `missed` block is not called an auto-cancellation on the NOW face either', async () => {
    // The NOW face carries its own banner, separate from the schedule row. Asserting
    // only the schedule left this one uncovered: a mutation restoring the old
    // 'WINDOW CLOSED — AUTO-CANCELED. PENALTY APPLIED.' line passed the whole file.
    bootWith('missed')
    await waitFor(() => !!document.querySelector('#today-schedule, .now-ring'))
    const html = document.body.innerHTML
    for (const phrase of UNTRUE) {
      expect(html, `the NOW face claims "${phrase}" (Book 8.3 removed the auto-cancellation)`)
        .not.toContain(phrase)
    }
    expect(html, 'the NOW face must still say it was missed').toContain('MISSED')
  })

  it('a `missed` block reads as a miss, without claiming it was auto-cancelled', async () => {
    // A `missed` row is only reachable when the commander set it himself. Since this
    // audit's enforcement fix it draws the ordinary overnight -10 and stays appealable,
    // so calling it an AUTO-CANCELLATION names an engine that no longer exists.
    const row = await scheduleRow('missed')
    expect(row.innerHTML, 'a missed block must still read as a miss').toContain('MISSED')
    for (const phrase of UNTRUE) {
      expect(row.innerHTML, `"${phrase}" describes the pre-Book-8.3 engine`).not.toContain(phrase)
    }
  })

  it('no shipped view claims an auto-cancellation for any status', async () => {
    for (const st of ['unreported', 'missed', 'intentionally_canceled', 'completed']) {
      document.body.innerHTML = ''
      const row = await scheduleRow(st)
      expect(row.innerHTML, `${st} draws an auto-cancel claim`).not.toContain('AUTO-CANCELED')
    }
  })
})
