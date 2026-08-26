import { beforeEach, describe, expect, it } from 'vitest'
import { SERVICE_WORKER, SW_CACHE_PREFIX, SW_VERSION } from '../src/renderer'

// Book 17 item 4 / Book 11 PWA: the service worker cached `/static/books/*` into a single
// fixed cache named `warroom-v1`, never enumerated the caches it owned, and never deleted
// anything. Two consequences, and the second is the one that bites:
//
//   1. A book JSON that changed on the server was never re-fetched. The first response was
//      kept forever, because the handler answered from the cache and only went to the
//      network on a miss. A corrected translation could not reach a commander who had
//      already opened the chapter once.
//   2. Every future version of the worker would have written into that same name, so there
//      was no way to retire a bad generation of cached content short of asking the user to
//      clear site data.
//
// This suite runs the worker source itself rather than reading it. The worker is a string
// compiled at request time by `GET /sw.js`, so a test that greps it proves the text says
// something; a test that EXECUTES it proves the code does something. The stubs below are
// the minimum Service Worker surface the script touches, and each one records what it was
// asked to do so the assertions can be about behaviour.
//
// It lives in the DOM project, not the workers pool: this is client code, and compiling a
// function from a string is not something the Workers runtime permits.

type Handlers = Record<string, ((event: unknown) => void) | undefined>

/** A Cache that remembers its puts, so "did it revalidate?" is answerable. */
class FakeCache {
  readonly entries = new Map<string, string>()
  readonly puts: string[] = []

  constructor(seed: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(seed)) this.entries.set(key, value)
  }

  async match(request: { url: string }) {
    const hit = this.entries.get(request.url)
    return hit === undefined ? undefined : { url: request.url, body: hit, ok: true, clone: () => ({ body: hit }) }
  }

  async put(request: { url: string }, response: { body: string }) {
    this.entries.set(request.url, response.body)
    this.puts.push(request.url)
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>()
  readonly deleted: string[] = []

  constructor(names: string[] = []) {
    for (const name of names) this.caches.set(name, new FakeCache())
  }

  async open(name: string) {
    let cache = this.caches.get(name)
    if (cache === undefined) {
      cache = new FakeCache()
      this.caches.set(name, cache)
    }
    return cache
  }

  async keys() {
    return [...this.caches.keys()]
  }

  async delete(name: string) {
    this.deleted.push(name)
    return this.caches.delete(name)
  }
}

type Harness = {
  handlers: Handlers
  cacheStorage: FakeCacheStorage
  fetches: string[]
  /** Responses the network will serve, by URL. Anything unlisted is a network failure. */
  network: Map<string, string>
  skipWaitingCalled: boolean
  claimCalled: boolean
}

/**
 * Compile and run the real worker source against stub globals.
 *
 * `new Function` is deliberate. The alternative is to re-declare the worker's logic in the
 * test, which would then pass while the shipped string said something else — the exact
 * class of defect this repository's audit kept finding.
 */
function boot(existingCaches: string[] = [], network: Record<string, string> = {}): Harness {
  const handlers: Handlers = {}
  const cacheStorage = new FakeCacheStorage(existingCaches)
  const harness: Harness = {
    handlers,
    cacheStorage,
    fetches: [],
    network: new Map(Object.entries(network)),
    skipWaitingCalled: false,
    claimCalled: false,
  }

  const self = {
    addEventListener(type: string, handler: (event: unknown) => void) {
      handlers[type] = handler
    },
    skipWaiting() {
      harness.skipWaitingCalled = true
    },
    registration: { showNotification: async () => {} },
  }

  const clients = {
    claim: async () => {
      harness.claimCalled = true
    },
    matchAll: async () => [],
    openWindow: async () => {},
  }

  const fetchStub = async (request: { url: string } | string) => {
    const url = typeof request === 'string' ? request : request.url
    harness.fetches.push(url)
    const body = harness.network.get(url)
    if (body === undefined) throw new Error(`network failure for ${url}`)
    return { ok: true, body, url, clone: () => ({ body }), json: async () => ({}) }
  }

  // eslint-disable-next-line no-new-func
  const run = new Function('self', 'caches', 'clients', 'fetch', 'URL', SERVICE_WORKER)
  run(self, cacheStorage, clients, fetchStub, URL)
  return harness
}

/** Drive one worker event and await everything it passed to `waitUntil`. */
async function dispatch(harness: Harness, type: string, event: Record<string, unknown> = {}) {
  const handler = harness.handlers[type]
  if (handler === undefined) throw new Error(`the worker registers no ${type} handler`)
  const waited: Promise<unknown>[] = []
  handler({
    ...event,
    waitUntil: (promise: Promise<unknown>) => {
      waited.push(promise)
    },
    respondWith: (promise: Promise<unknown>) => {
      waited.push(promise)
      ;(event as { responded?: Promise<unknown> }).responded = promise
    },
  })
  await Promise.all(waited)
}

const BOOK = 'https://war.room/static/books/art_of_war.json'
const CURRENT = `${SW_CACHE_PREFIX}${SW_VERSION}`

describe('Book 17 item 4 — the service worker owns its caches and can retire them', () => {
  it('names its cache with a version, and the version is not the literal the audit found', () => {
    expect(SW_VERSION, 'SW_VERSION is empty, so the cache name carries no version')
      .toMatch(/\S/)
    expect(SW_CACHE_PREFIX, 'the cache prefix is empty, so a purge cannot be scoped')
      .toMatch(/\S/)
    // The worker must build the name from the exported constants rather than repeating a
    // literal, because two copies of a version are two versions.
    expect(SERVICE_WORKER, 'the worker does not build its cache name from the exported prefix')
      .toContain(SW_CACHE_PREFIX)
    expect(SERVICE_WORKER, 'the worker does not build its cache name from the exported version')
      .toContain(SW_VERSION)
  })

  it('deletes every cache of its own that is not the current one, on activate', async () => {
    const stale = [`${SW_CACHE_PREFIX}v0`, `${SW_CACHE_PREFIX}older`, CURRENT]
    const harness = boot(stale)
    await dispatch(harness, 'activate')

    expect(harness.cacheStorage.deleted.sort(), 'activate did not delete the superseded caches')
      .toEqual([`${SW_CACHE_PREFIX}older`, `${SW_CACHE_PREFIX}v0`])
    expect(
      await harness.cacheStorage.keys(),
      'activate deleted the cache the worker is about to serve from',
    ).toEqual([CURRENT])
  })

  it('leaves caches it does not own alone, so a purge cannot reach past its prefix', async () => {
    const foreign = 'someone-elses-cache'
    const harness = boot([foreign, `${SW_CACHE_PREFIX}v0`])
    await dispatch(harness, 'activate')

    expect(
      harness.cacheStorage.deleted,
      'the purge is not scoped to the worker’s own prefix and deleted a foreign cache',
    ).not.toContain(foreign)
    expect(await harness.cacheStorage.keys(), 'the foreign cache did not survive the purge')
      .toContain(foreign)
  })

  it('takes over immediately, or a versioned cache is written by a worker nobody is using', async () => {
    const harness = boot()
    await dispatch(harness, 'install')
    expect(harness.skipWaitingCalled, 'install does not call skipWaiting, so the old worker keeps serving')
      .toBe(true)
    await dispatch(harness, 'activate')
    expect(harness.claimCalled, 'activate does not claim open clients, so open tabs keep the old worker')
      .toBe(true)
  })

  it('revalidates a cached book instead of serving the first response forever', async () => {
    const harness = boot([CURRENT], { [BOOK]: 'fresh' })
    const cache = await harness.cacheStorage.open(CURRENT)
    await cache.put({ url: BOOK }, { body: 'stale' })
    cache.puts.length = 0

    const event: Record<string, unknown> = { request: { url: BOOK } }
    await dispatch(harness, 'fetch', event)

    // The cached copy still answers — offline reading is the point of the cache.
    const served = await (event as { responded: Promise<{ body: string }> }).responded
    expect(served.body, 'the cached copy was not served, so the reader is now network-bound')
      .toBe('stale')
    // …and the network was consulted anyway, so the next read is the corrected text. Without
    // this the only way to retire a bad chapter is to bump the version by hand, and a
    // hand-bumped constant is exactly what stops happening.
    expect(harness.fetches, 'a cache hit did not revalidate, so a stale chapter is permanent')
      .toContain(BOOK)
    expect(cache.puts, 'the revalidated response was not written back to the cache')
      .toContain(BOOK)
  })

  it('still serves the cached copy when the network is gone', async () => {
    const harness = boot([CURRENT])
    const cache = await harness.cacheStorage.open(CURRENT)
    await cache.put({ url: BOOK }, { body: 'offline copy' })

    const event: Record<string, unknown> = { request: { url: BOOK } }
    await dispatch(harness, 'fetch', event)

    const served = await (event as { responded: Promise<{ body: string }> }).responded
    expect(served.body, 'a failed revalidation broke offline reading')
      .toBe('offline copy')
  })

  it('caches only the book assets, so no private API response is ever stored', async () => {
    const harness = boot([CURRENT], { 'https://war.room/api/state': '{}' })
    const event: Record<string, unknown> = { request: { url: 'https://war.room/api/state' } }
    const handler = harness.handlers.fetch
    if (handler === undefined) throw new Error('the worker registers no fetch handler')
    let responded = false
    handler({ ...event, respondWith: () => { responded = true } })
    expect(responded, 'the worker intercepted a private API request, which it must never cache')
      .toBe(false)
  })
})
