import { describe, expect, it, beforeEach } from 'vitest'
import { bootFrontend, waitFor, MINIMAL_STATE } from './helpers/frontend-harness'

// Book 7 frontend restructure — boot safety net. The shipped frontend is 2,300
// lines of globals-coupled vanilla JS with no behavioural coverage; restructuring
// it blind would risk silently breaking the operator's working app. These pin the
// three boot outcomes and must stay green through every restructure step.

describe('B7 frontend boot integrity', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('boots to the SETUP gate when no password is set yet', async () => {
    bootFrontend({ 'GET /api/auth/status': { setup: false, authed: false } })
    await waitFor(() => !!document.querySelector('#login-screen'))
    expect(document.querySelector('#login-screen')).not.toBeNull()
    expect(document.body.textContent).toContain('SET THE GATE PASSWORD')
  })

  it('boots to the LOGIN gate when set up but not authenticated', async () => {
    bootFrontend({ 'GET /api/auth/status': { setup: true, authed: false } })
    await waitFor(() => !!document.querySelector('#login-screen'))
    expect(document.querySelector('#login-screen')).not.toBeNull()
    expect(document.body.textContent).toContain('IDENTIFY YOURSELF')
  })

  it('boots into the war room shell (main nav) when authenticated', async () => {
    bootFrontend({
      'GET /api/auth/status': { setup: true, authed: true, csrfToken: 'test-csrf' },
      'POST /api/tick': MINIMAL_STATE,
    })
    await waitFor(() => !!document.querySelector('#main-nav'))
    expect(document.querySelector('#login-screen'), 'stuck on the login gate').toBeNull()
    expect(document.body.textContent, 'boot fell into the failure screen').not.toContain('Failed to load')
    expect(document.querySelector('#main-nav'), 'authenticated shell/nav did not render').not.toBeNull()
  })
})
