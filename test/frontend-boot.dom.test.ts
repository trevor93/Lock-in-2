import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Book 7 frontend restructure — safety net. The shipped frontend is 2,300 lines
// of globals-coupled vanilla JS across seven files with no behavioural coverage;
// restructuring it blind would risk silently breaking the operator's working app.
// This is a CHARACTERISATION test: it boots the REAL concatenated frontend inside
// happy-dom against a mocked axios/FX and pins the three boot outcomes (setup gate,
// login gate, authenticated shell). It must stay green through every step of the
// core/components/features split, the de-globalisation, and the Vite bundling.

const FILES = ['fx.js', 'app.js', 'app2.js', 'app3.js', 'app4.js', 'app5.js', 'app6.js', 'app7.js']
const SRC = FILES
  .map((f) => readFileSync(resolve(__dirname, '../public/static/', f), 'utf8'))
  .join('\n;\n')

// Matches the shape src/state.ts buildState() returns, trimmed to what a fresh
// day needs so viewNow() renders without a live server.
const MINIMAL_STATE = {
  date: '2026-08-21', time: '09:00', blocks: [], current: null, next: null,
  adherence: { pct: 0 }, streak: 0, points: 0, todayPoints: 0, flags: [],
  debrief: null, debriefDoneToday: false, yesterdayTargets: null,
  dueCards: 0, dueTongue: 0, activeUnits: [], median: null, delta: null,
  appealAvailable: true, loadReductions: [], duePredictions: 0, needsCatchup: false,
}

// A route-addressed axios stand-in. Unmapped routes answer 200 with {} so the
// freshness watcher and lazy loaders never throw during a boot.
function makeAxios(routes: Record<string, unknown>) {
  const answer = (method: string, url: string) => {
    const path = String(url).split('?')[0]
    const key = `${method.toUpperCase()} ${path}`
    const data = key in routes ? routes[key] : {}
    return Promise.resolve({ data, status: 200, config: { method, url } })
  }
  const axios: any = (config: any) => answer(config.method || 'get', config.url)
  axios.get = (url: string) => answer('get', url)
  axios.post = (url: string) => answer('post', url)
  axios.put = (url: string) => answer('put', url)
  axios.delete = (url: string) => answer('delete', url)
  axios.interceptors = { request: { use() {} }, response: { use() {} } }
  return axios
}

// The real fx.js is evaluated alongside the app (its canvas/rAF work lives inside
// effect methods that only fire on user actions, never during a boot render), so
// FX.rank()/FX.flameClass() return their true values.

function boot(routes: Record<string, unknown>) {
  document.body.innerHTML =
    '<div id="splash"></div><canvas id="fx-canvas"></canvas><div id="app"></div>'
  // eslint-disable-next-line no-new-func
  new Function('axios', SRC)(makeAxios(routes))
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0))
}

describe('B7 frontend boot integrity', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('boots to the SETUP gate when no password is set yet', async () => {
    boot({ 'GET /api/auth/status': { setup: false, authed: false } })
    await flush()
    expect(document.querySelector('#login-screen')).not.toBeNull()
    expect(document.body.textContent).toContain('SET THE GATE PASSWORD')
  })

  it('boots to the LOGIN gate when set up but not authenticated', async () => {
    boot({ 'GET /api/auth/status': { setup: true, authed: false } })
    await flush()
    expect(document.querySelector('#login-screen')).not.toBeNull()
    expect(document.body.textContent).toContain('IDENTIFY YOURSELF')
  })

  it('boots into the war room shell (main nav) when authenticated', async () => {
    boot({
      'GET /api/auth/status': { setup: true, authed: true, csrfToken: 'test-csrf' },
      'POST /api/tick': MINIMAL_STATE,
    })
    await flush()
    expect(document.querySelector('#login-screen'), 'stuck on the login gate').toBeNull()
    expect(document.body.textContent, 'boot fell into the failure screen').not.toContain('Failed to load')
    expect(document.querySelector('#main-nav'), 'authenticated shell/nav did not render').not.toBeNull()
  })
})
