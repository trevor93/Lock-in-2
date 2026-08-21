import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Shared happy-dom harness for the Book 7 frontend restructure net. It boots the
// REAL shipped frontend (fx.js + app.js..app7.js, concatenated as the browser
// loads them) against a route-addressed axios stand-in that also RECORDS calls,
// so tests can drive real user actions and assert the resulting endpoint traffic.
// These are characterisation tests: they must stay green through the core/
// components/features split, the onclick -> event-delegation conversion, and the
// switch to a Vite bundle.

const FILES = ['fx.js', 'app.js', 'app2.js', 'app3.js', 'app4.js', 'app5.js', 'app6.js', 'app7.js']
export const SRC = FILES
  .map((f) => readFileSync(resolve(__dirname, '../../public/static/', f), 'utf8'))
  .join('\n;\n')

// Mirrors the shape src/state.ts buildState() returns, trimmed to a fresh day.
export const MINIMAL_STATE = {
  date: '2026-08-21', time: '09:00', blocks: [], current: null, next: null,
  adherence: { pct: 0 }, streak: 0, points: 0, todayPoints: 0, flags: [],
  debrief: null, debriefDoneToday: false, yesterdayTargets: null,
  dueCards: 0, dueTongue: 0, activeUnits: [], median: null, delta: null,
  appealAvailable: true, loadReductions: [], duePredictions: 0, needsCatchup: false,
}

export type RecordedCall = { method: string; url: string; data: unknown }

// happy-dom has no Web Audio. The shipped Alarm engine (app5.js) lazily does
// `new AudioContext()` inside a document click-unlock handler, so any click would
// throw without this. A Proxy-backed node satisfies the bell-synthesis calls
// (createOscillator/Gain/StereoPanner, AudioParams, connect/start/stop) as no-ops.
function installAudioStub(): void {
  const param = () => ({
    value: 0,
    setValueAtTime() {}, exponentialRampToValueAtTime() {},
    linearRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {},
  })
  const node = (): any => new Proxy({}, {
    get(_t, prop) {
      if (prop === 'connect' || prop === 'disconnect' || prop === 'start' || prop === 'stop') return () => {}
      if (['frequency', 'detune', 'gain', 'pan', 'Q', 'threshold', 'knee', 'ratio', 'attack', 'release'].includes(prop as string)) return param()
      if (typeof prop === 'string' && prop.startsWith('create')) return node
      return () => node()
    },
  })
  class FakeAudioContext {
    state = 'running'; currentTime = 0; destination = node()
    resume() { return Promise.resolve() }
    createOscillator() { return node() }
    createGain() { return node() }
    createStereoPanner() { return node() }
    createBiquadFilter() { return node() }
    createDynamicsCompressor() { return node() }
    createConvolver() { return node() }
    createBuffer() { return node() }
  }
  ;(globalThis as any).AudioContext = FakeAudioContext
  ;(globalThis as any).webkitAudioContext = FakeAudioContext
}

// Boots the frontend. `routes` maps "METHOD /path" (no query) to the response body;
// unmapped routes answer 200 {} so freshness probes and lazy loaders never throw.
export function bootFrontend(routes: Record<string, unknown>): { calls: RecordedCall[] } {
  installAudioStub()
  const calls: RecordedCall[] = []
  const answer = (method: string, url: string, data?: unknown) => {
    calls.push({ method: method.toUpperCase(), url: String(url), data })
    const path = String(url).split('?')[0]
    const key = `${method.toUpperCase()} ${path}`
    const body = key in routes ? routes[key] : {}
    return Promise.resolve({ data: body, status: 200, config: { method, url } })
  }
  const axios: any = (config: any) => answer(config.method || 'get', config.url, config.data)
  axios.get = (url: string) => answer('get', url)
  axios.post = (url: string, data?: unknown) => answer('post', url, data)
  axios.put = (url: string, data?: unknown) => answer('put', url, data)
  axios.delete = (url: string) => answer('delete', url)
  axios.interceptors = { request: { use() {} }, response: { use() {} } }

  document.body.innerHTML =
    '<div id="splash"></div><canvas id="fx-canvas"></canvas><div id="app"></div>'
  // The real fx.js rides along; its canvas/rAF work is inside effect methods that
  // only fire on user actions, so FX.rank()/FX.flameClass() return true values.
  // eslint-disable-next-line no-new-func
  new Function('axios', SRC)(axios)
  return { calls }
}

// Let the init IIFE and any awaited loads settle.
export const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0))
}

// Find a recorded call by method + exact path (query string ignored).
export function findCall(calls: RecordedCall[], method: string, path: string): RecordedCall | undefined {
  return calls.find((c) => c.method === method.toUpperCase() && c.url.split('?')[0] === path)
}
