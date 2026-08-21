import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Shared happy-dom harness for the Book 7 frontend. It boots the REAL shipped
// client — now the Vite-built ES-module bundle (public/static/bundle.js, generated
// from public/static/app/: core/ + features/) — against a route-addressed axios
// stand-in that also RECORDS calls, so tests can drive real user actions and assert
// the resulting endpoint traffic. These are characterisation tests: they pinned the
// behaviour of the old nine-globals frontend and must stay green for the bundle.

export const SRC = readFileSync(resolve(__dirname, '../../public/static/bundle.js'), 'utf8')

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

// Each boot evaluates a FRESH copy of the bundle, which registers its own
// document/window listeners and timers. happy-dom keeps one document per test
// file, so without cleanup a previous boot's listeners would also answer the next
// test's clicks (two rival app instances writing into the same #app). Track what
// each boot installs and tear it down before the next one.
let installedListeners: Array<[EventTarget, string, any]> = []
let installedTimers: any[] = []
let installedFrames: any[] = []

function resetPreviousBoot(): void {
  for (const [target, type, fn] of installedListeners) {
    try { target.removeEventListener(type, fn) } catch { /* ignore */ }
  }
  installedListeners = []
  for (const id of installedTimers) {
    try { clearInterval(id); clearTimeout(id) } catch { /* ignore */ }
  }
  installedTimers = []
  for (const id of installedFrames) {
    try { (globalThis as any).cancelAnimationFrame?.(id) } catch { /* ignore */ }
  }
  installedFrames = []
}

function captureDuring(run: () => void): void {
  const dAdd = document.addEventListener.bind(document)
  const wAdd = globalThis.addEventListener?.bind(globalThis)
  const origInterval = globalThis.setInterval
  const origTimeout = globalThis.setTimeout
  const origRaf = (globalThis as any).requestAnimationFrame
  ;(document as any).addEventListener = (t: string, fn: any, o?: any) => {
    installedListeners.push([document, t, fn]); return dAdd(t, fn, o)
  }
  if (wAdd) {
    ;(globalThis as any).addEventListener = (t: string, fn: any, o?: any) => {
      installedListeners.push([globalThis, t, fn]); return wAdd(t, fn, o)
    }
  }
  ;(globalThis as any).setInterval = (...a: any[]) => {
    const id = (origInterval as any)(...a); installedTimers.push(id); return id
  }
  ;(globalThis as any).setTimeout = (...a: any[]) => {
    const id = (origTimeout as any)(...a); installedTimers.push(id); return id
  }
  if (origRaf) {
    ;(globalThis as any).requestAnimationFrame = (cb: any) => {
      const id = origRaf(cb); installedFrames.push(id); return id
    }
  }
  try { run() } finally {
    ;(document as any).addEventListener = dAdd
    if (wAdd) (globalThis as any).addEventListener = wAdd
    ;(globalThis as any).setInterval = origInterval
    ;(globalThis as any).setTimeout = origTimeout
    if (origRaf) (globalThis as any).requestAnimationFrame = origRaf
  }
}


// happy-dom has no canvas raster backend: getContext('2d') returns null, so the FX
// confetti/ring animation frames would throw inside a rAF callback (an unhandled
// rejection that can fail an unrelated test). Hand out an inert 2D context so the
// visual effects are no-ops under test while the code under test runs unchanged.
function installCanvasStub(): void {
  const ctx: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'canvas') return null
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop() {} })
      }
      return () => {}
    },
    set() { return true },
  })
  const proto = (globalThis as any).HTMLCanvasElement?.prototype
  if (proto) proto.getContext = () => ctx
}

// Boots the frontend. `routes` maps "METHOD /path" (no query) to the response body;
// unmapped routes answer 200 {} so freshness probes and lazy loaders never throw.
export function bootFrontend(routes: Record<string, unknown>): { calls: RecordedCall[] } {
  resetPreviousBoot()
  installAudioStub()
  installCanvasStub()
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
  captureDuring(() => { new Function('axios', SRC)(axios) })
  return { calls }
}

// Let the init IIFE and any awaited loads settle.
export const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0))
}

// Wait until a condition holds. A fixed tick count is load-sensitive (these files
// run in parallel workers), so anything asserted after a user action polls for the
// state it expects instead of guessing how many ticks the chain needs.
export async function waitFor(condition: () => boolean, ticks = 80): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    if (condition()) return
    await new Promise((r) => setTimeout(r, 0))
  }
}

// Find a recorded call by method + exact path (query string ignored).
export function findCall(calls: RecordedCall[], method: string, path: string): RecordedCall | undefined {
  return calls.find((c) => c.method === method.toUpperCase() && c.url.split('?')[0] === path)
}
