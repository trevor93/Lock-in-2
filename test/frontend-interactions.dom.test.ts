import { describe, expect, it, beforeEach } from 'vitest'
import { bootFrontend, flush, findCall, MINIMAL_STATE } from './helpers/frontend-harness'

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
    await flush()

    const input = document.querySelector('#login-pass') as HTMLInputElement
    expect(input, 'password field missing').not.toBeNull()
    input.value = 'a-strong-new-password'
    const submit = document.querySelector('#login-screen button') as HTMLElement
    submit.click()
    await flush()

    const setup = findCall(calls, 'POST', '/api/auth/setup')
    expect(setup, '/api/auth/setup was not called').toBeTruthy()
    expect((setup!.data as { password: string }).password).toBe('a-strong-new-password')
    expect(document.querySelector('#login-screen'), 'still on the gate after setup').toBeNull()
    expect(document.querySelector('#main-nav'), 'did not enter the war room').not.toBeNull()
  })

  it('the LOGIN gate submits the password to /api/auth/login', async () => {
    const { calls } = bootFrontend({
      'GET /api/auth/status': { setup: true, authed: false },
      'POST /api/auth/login': { ok: true, csrfToken: 'fresh-csrf' },
      'POST /api/tick': MINIMAL_STATE,
    })
    await flush()

    ;(document.querySelector('#login-pass') as HTMLInputElement).value = 'my-password'
    ;(document.querySelector('#login-screen button') as HTMLElement).click()
    await flush()

    const login = findCall(calls, 'POST', '/api/auth/login')
    expect(login, '/api/auth/login was not called').toBeTruthy()
    expect((login!.data as { password: string }).password).toBe('my-password')
  })

  it('the bottom nav switches the active view when a tab is clicked', async () => {
    bootFrontend(AUTHED)
    await flush()

    const nav = document.querySelector('#main-nav')
    expect(nav, 'nav missing').not.toBeNull()
    const mind = nav!.querySelector('[data-tab="mind"]') as HTMLElement
    expect(mind, 'the MIND tab is missing').not.toBeNull()

    // "now" is the initial tab; clicking MIND must re-render to that tab as active.
    expect((nav!.querySelector('[data-tab="now"]') as HTMLElement).className).toContain('active')
    mind.click()
    await flush()

    const activeAfter = document.querySelector('#main-nav [data-tab="mind"]') as HTMLElement
    expect(activeAfter.className, 'MIND did not become the active tab').toContain('active')
  })
})
