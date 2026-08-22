import { describe, expect, it, beforeEach } from 'vitest'
import { bootFrontend, flush, waitFor, findCall, MINIMAL_STATE } from './helpers/frontend-harness'

// Book 7 frontend restructure — interaction net. These drive REAL user actions
// (typing, clicking the shipped buttons) and assert the resulting endpoint traffic
// and view transitions. They exercise the handler paths end to end, so the
// onclick -> event-delegation conversion and the de-globalisation of window.*
// handlers must keep them green: same user action, same effect.

const AUTHED = {
  'GET /api/auth/status': { setup: true, authed: true, csrfToken: 'test-csrf' },
  'POST /api/tick': MINIMAL_STATE,
}

describe('B7 frontend interaction integrity', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('the SETUP gate submits the new password to /api/auth/setup and enters the war room', async () => {
    const { calls } = bootFrontend({
      'GET /api/auth/status': { setup: false, authed: false },
      'POST /api/auth/setup': { ok: true, csrfToken: 'fresh-csrf' },
      'POST /api/tick': MINIMAL_STATE,
    })
    await waitFor(() => !!document.querySelector('#login-pass'))

    const input = document.querySelector('#login-pass') as HTMLInputElement
    expect(input, 'password field missing').not.toBeNull()
    input.value = 'a-strong-new-password'
    const submit = document.querySelector('#login-screen button') as HTMLElement
    submit.click()
    await waitFor(() => !document.querySelector('#login-screen') && !!document.querySelector('#main-nav'))

    const setup = findCall(calls, 'POST', '/api/auth/setup')
    expect(setup, '/api/auth/setup was not called').toBeTruthy()
    expect((setup!.data as { password: string }).password).toBe('a-strong-new-password')
    expect(
      document.querySelector('#login-screen'),
      `still on the gate after setup; calls=${calls.map((c) => c.method + ' ' + c.url).join(' | ')}`,
    ).toBeNull()
    expect(document.querySelector('#main-nav'), 'did not enter the war room').not.toBeNull()
  })

  it('the LOGIN gate submits the password to /api/auth/login', async () => {
    const { calls } = bootFrontend({
      'GET /api/auth/status': { setup: true, authed: false },
      'POST /api/auth/login': { ok: true, csrfToken: 'fresh-csrf' },
      'POST /api/tick': MINIMAL_STATE,
    })
    await waitFor(() => !!document.querySelector('#login-pass'))

    ;(document.querySelector('#login-pass') as HTMLInputElement).value = 'my-password'
    ;(document.querySelector('#login-screen button') as HTMLElement).click()
    await waitFor(() => !!findCall(calls, 'POST', '/api/auth/login'))

    const login = findCall(calls, 'POST', '/api/auth/login')
    expect(login, '/api/auth/login was not called').toBeTruthy()
    expect((login!.data as { password: string }).password).toBe('my-password')
  })

  it('the bottom nav switches the active view when a tab is clicked', async () => {
    bootFrontend(AUTHED)
    await waitFor(() => !!document.querySelector('#main-nav'))

    const nav = document.querySelector('#main-nav')
    expect(nav, 'nav missing').not.toBeNull()
    // Book 9: five tabs. TODAY is the initial one; PRACTICE holds the old MIND drill.
    const practice = nav!.querySelector('[data-tab="practice"]') as HTMLElement
    expect(practice, 'the PRACTICE tab is missing').not.toBeNull()
    expect((nav!.querySelector('[data-tab="today"]') as HTMLElement).className).toContain('active')
    practice.click()
    await waitFor(() => (document.querySelector('#main-nav [data-tab="practice"]') as HTMLElement)?.className.includes('active'))

    const activeAfter = document.querySelector('#main-nav [data-tab="practice"]') as HTMLElement
    expect(activeAfter.className, 'PRACTICE did not become the active tab').toContain('active')
  })

  it('clicking a block status button logs it to /api/blocks/:id/log with the right status (data-args encoding)', async () => {
    const current = {
      id: 42, title: 'Deep Work', category: 'deepwork',
      start_time: '09:00', end_time: '10:30', log_status: 'pending',
      is_non_negotiable: 0, points: 10,
    }
    const { calls } = bootFrontend({
      'GET /api/auth/status': { setup: true, authed: true, csrfToken: 'test-csrf' },
      'POST /api/tick': { ...MINIMAL_STATE, current, blocks: [current] },
      'POST /api/blocks/42/log': { ok: true },
    })
    await waitFor(() => !!document.querySelector('[data-act="logBlock"]'))

    // The current-block card renders done/partial/skipped via statusBtns(); the
    // "done" button carries data-act="logBlock" data-args='[42,"done"]'.
    const buttons = Array.from(document.querySelectorAll('[data-act="logBlock"]')) as HTMLElement[]
    const done = buttons.find((b) => (b.getAttribute('data-args') || '').includes('done'))
    expect(done, 'the done button did not render').toBeTruthy()
    done!.click()
    await waitFor(() => !!findCall(calls, 'POST', '/api/blocks/42/log'))

    const logged = findCall(calls, 'POST', '/api/blocks/42/log')
    expect(logged, '/api/blocks/42/log was not called').toBeTruthy()
    expect((logged!.data as { status: string }).status).toBe('done')
  })

  it('the MIND drill flips a card and grading it posts to /api/cards/:id/review', async () => {
    const card = {
      maxim_id: 7, source: 'Sun Tzu', principle: 'Win first, then go to war.',
      naive_reading: 'prepare', master_reading: 'decide it before the field',
      my_words: null, mastery: 'new', due_date: '2026-08-20', reps: 0, lapses: 0,
      interval_days: 0, total_reviews: 0, correct_reviews: 0,
    }
    const { calls } = bootFrontend({
      'GET /api/auth/status': { setup: true, authed: true, csrfToken: 'test-csrf' },
      'POST /api/tick': MINIMAL_STATE,
      'GET /api/cards/due': [card],
      'GET /api/maxims': [],
      'POST /api/cards/7/review': { ok: true },
    })
    await waitFor(() => !!document.querySelector('#main-nav [data-tab="practice"]'))

    ;(document.querySelector('#main-nav [data-tab="practice"]') as HTMLElement).click()
    await waitFor(() => !!document.querySelector('[data-act="flipCard"]'))
    // Grade buttons only appear once the card is flipped.
    const flip = document.querySelector('[data-act="flipCard"]') as HTMLElement
    expect(flip, 'flip card not rendered in the drill').not.toBeNull()
    flip.click()
    await waitFor(() => !!document.querySelector('[data-act="gradeCard"]'))

    const good = Array.from(document.querySelectorAll('[data-act="gradeCard"]'))
      .find((b) => (b.getAttribute('data-args') || '').includes(',2]')) as HTMLElement
    expect(good, 'GOOD grade button not rendered after flip').toBeTruthy()
    good.click()
    await waitFor(() => !!findCall(calls, 'POST', '/api/cards/7/review'))

    const graded = findCall(calls, 'POST', '/api/cards/7/review')
    expect(graded, '/api/cards/7/review was not called').toBeTruthy()
    expect((graded!.data as { grade: number }).grade).toBe(2)
  })
})
