import { describe, expect, it, beforeEach } from 'vitest'
import { bootFrontend, waitFor, findCall, MINIMAL_STATE } from './helpers/frontend-harness'

// Book 8.3 / 8.4 in the INTERFACE. The server has accepted the ten doctrinal
// statuses since Book 8.3 and has refused a status on an unreported block since
// Book 8.4 ("Record the cause before rescheduling" — src/routes/day.ts answers 409
// with needsCause). Neither was reachable from the shipped client: statusBtns()
// offered only the three legacy synonyms, and nothing in the app tree called
// GET /api/miss-causes or POST /api/blocks/:id/cause, so the commander could be
// handed a refusal with no control that could answer it.
//
// These drive the real shipped buttons, so they fail if the client goes back to
// writing only 'done'/'partial'/'skipped' or loses the cause panel.

const AUTH = { setup: true, authed: true, csrfToken: 'test-csrf' }

const CAUSES = [
  { cause: 'forgotten_log', dimension: 'record', action: 'Repair the record — the work happened, the log did not.', escalates: false },
  { cause: 'low_energy', dimension: 'timing', action: 'Move this block to where your energy actually is.', escalates: false },
  { cause: 'avoidance', dimension: 'investigation', action: 'Name what you are avoiding, in one line.', escalates: true },
]

const block = (log_status: string) => ({
  id: 42, title: 'Deep Work', category: 'deepwork',
  start_time: '09:00', end_time: '10:30', log_status,
  is_non_negotiable: 0, points: 10, weight: 1, ratchet_tier: 'mandatory',
})

function bootWith(log_status: string, extra: Record<string, unknown> = {}) {
  const b = block(log_status)
  return bootFrontend({
    'GET /api/auth/status': AUTH,
    'POST /api/tick': { ...MINIMAL_STATE, current: b, blocks: [b] },
    'GET /api/miss-causes': CAUSES,
    'POST /api/blocks/42/cause': {
      ok: true, cause: 'low_energy', correction: CAUSES[1],
      statusSetTo: null, pointsApplied: -5, investigation: null,
    },
    'POST /api/blocks/42/log': { ok: true },
    ...extra,
  })
}

const argsOf = (el: Element) => el.getAttribute('data-args') || ''

describe('B8.3 the interface writes the doctrinal statuses', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('offers completed / partial / intentionally_canceled, not only the legacy trio', async () => {
    bootWith('pending')
    await waitFor(() => !!document.querySelector('[data-act="logBlock"]'))
    const args = Array.from(document.querySelectorAll('[data-act="logBlock"]')).map(argsOf).join(' ')
    expect(args, 'the doctrine names `completed` first').toContain('completed')
    expect(args).toContain('partial')
    expect(args, '`intentionally_canceled` is the honest cancellation').toContain('intentionally_canceled')
  })

  it('posts the doctrinal spelling to /api/blocks/:id/log', async () => {
    const { calls } = bootWith('pending')
    await waitFor(() => !!document.querySelector('[data-act="logBlock"]'))
    const done = Array.from(document.querySelectorAll('[data-act="logBlock"]'))
      .find((b) => argsOf(b).includes('"completed"')) as HTMLElement
    expect(done, 'no button writes `completed`').toBeTruthy()
    done.click()
    await waitFor(() => !!findCall(calls, 'POST', '/api/blocks/42/log'))
    expect((findCall(calls, 'POST', '/api/blocks/42/log')!.data as { status: string }).status).toBe('completed')
  })

  it('still recognises a legacy `done` row as landed, so history keeps its meaning', async () => {
    bootWith('done')
    await waitFor(() => !!document.querySelector('[data-act="logBlock"]'))
    // The active button is the one that would toggle back to 'pending'.
    const args = Array.from(document.querySelectorAll('[data-act="logBlock"]')).map(argsOf).join(' ')
    expect(args, 'a legacy done row must read as landed, not as untouched').toContain('"pending"')
  })
})

describe('B8.4 the miss-diagnosis flow is reachable', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('an unreported block offers the cause control', async () => {
    bootWith('unreported')
    await waitFor(() => !!document.querySelector('[data-act="openCause"]'))
    expect(document.querySelector('[data-act="openCause"]'), 'no way to answer the prompt').not.toBeNull()
  })

  it('opening it loads the taxonomy from the server rather than inventing causes', async () => {
    const { calls } = bootWith('unreported')
    await waitFor(() => !!document.querySelector('[data-act="openCause"]'))
    ;(document.querySelector('[data-act="openCause"]') as HTMLElement).click()
    await waitFor(() => !!findCall(calls, 'GET', '/api/miss-causes'))
    expect(findCall(calls, 'GET', '/api/miss-causes'), 'the client must not hardcode the causes').toBeTruthy()
    await waitFor(() => document.querySelectorAll('[data-act="recordCause"]').length >= 3)
    const shown = Array.from(document.querySelectorAll('[data-act="recordCause"]')).map(argsOf).join(' ')
    for (const c of CAUSES) expect(shown).toContain(c.cause)
  })

  it('choosing a cause records it against the block', async () => {
    const { calls } = bootWith('unreported')
    await waitFor(() => !!document.querySelector('[data-act="openCause"]'))
    ;(document.querySelector('[data-act="openCause"]') as HTMLElement).click()
    await waitFor(() => document.querySelectorAll('[data-act="recordCause"]').length >= 3)
    const pick = Array.from(document.querySelectorAll('[data-act="recordCause"]'))
      .find((b) => argsOf(b).includes('low_energy')) as HTMLElement
    expect(pick).toBeTruthy()
    pick.click()
    await waitFor(() => !!findCall(calls, 'POST', '/api/blocks/42/cause'))
    const sent = findCall(calls, 'POST', '/api/blocks/42/cause')!
    expect((sent.data as { cause: string }).cause).toBe('low_energy')
  })
})
