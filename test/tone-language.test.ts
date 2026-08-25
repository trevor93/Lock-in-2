import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
// ?raw imports, the pattern the other source-scanning tests use: the workers pool
// cannot read from disk at runtime.
import enforcementSrc from '../src/enforcement.ts?raw'
import daySrc from '../src/routes/day.ts?raw'
import recoverySrc from '../src/routes/recovery.ts?raw'
import missCauseSrc from '../src/routes/miss-cause.ts?raw'
import ratchetSrc from '../src/routes/ratchet.ts?raw'
import economySrc from '../src/routes/economy.ts?raw'
import tongueSrc from '../src/routes/tongue.ts?raw'
import learnSrc from '../src/routes/learn.ts?raw'
import blockStatusSrc from '../src/block-status.ts?raw'
import limitsSrc from '../src/scoring-limits.ts?raw'
import toneSrc from '../src/tone.ts?raw'
import aiSrc from '../src/ai.ts?raw'
import shellSrc from '../public/static/app/core/shell.js?raw'
import debriefSrc from '../public/static/app/features/debrief.js?raw'
import campaignSrc from '../public/static/app/features/campaign.js?raw'
import mindSrc from '../public/static/app/features/mind.js?raw'
import librarySrc from '../public/static/app/features/library.js?raw'
import councilSrc from '../public/static/app/features/council.js?raw'
import responseLabUiSrc from '../public/static/app/features/response-lab.js?raw'
import rhetoricUiSrc from '../public/static/app/features/rhetoric.js?raw'
// The gate has to be exhaustive over every shipped string, so every server route
// module and every frontend module is scanned. Listing a subset lets a new
// module ship banned language without failing anything.
import agentCredentialsRouteSrc from '../src/routes/agent-credentials.ts?raw'
import agentV1RouteSrc from '../src/routes/agent-v1.ts?raw'
import authRouteSrc from '../src/routes/auth.ts?raw'
import calendarRouteSrc from '../src/routes/calendar.ts?raw'
import cursorRouteSrc from '../src/routes/cursor.ts?raw'
import hermesRouteSrc from '../src/routes/hermes.ts?raw'
import intelLibraryRouteSrc from '../src/routes/intel-library.ts?raw'
import masteryRouteSrc from '../src/routes/mastery.ts?raw'
import principlesRouteSrc from '../src/routes/principles.ts?raw'
import pushRouteSrc from '../src/routes/push.ts?raw'
import readingRouteSrc from '../src/routes/reading.ts?raw'
import rhetoricRouteSrc from '../src/routes/rhetoric.ts?raw'
import rhetoricLabRouteSrc from '../src/routes/rhetoric-lab.ts?raw'
import fxSrc from '../public/static/app/core/fx.js?raw'
import morphSrc from '../public/static/app/core/morph.js?raw'
import storeSrc from '../public/static/app/core/store.js?raw'
import eventsSrc from '../public/static/app/core/events.js?raw'
import sanitizeSrc from '../public/static/app/core/sanitize.js?raw'
import mainSrc from '../public/static/app/main.js?raw'
import {
  SEVERITIES, TONES, DEFAULT_TONE, normaliseSeverity, normaliseTone, isRed, toned,
} from '../src/tone'

// Book 8.7 — LANGUAGE AND TONE. The theatrical lines are removed outright, red is
// reserved for genuine risk, and a tone setting exists (neutral, firm, military,
// compassionate) defaulting to firm. Military may be cold; it may never be abusive.
// This governs the interface only — Book 15 governs Hermes.

const baseEnv = {
  DB: env.DB, OPENAI_API_KEY: '', OPENAI_BASE_URL: 'https://model.invalid',
  OPENAI_ALLOWED_BASE_URLS: 'https://model.invalid',
}
async function passwordHash(pw: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256)
  return [...new Uint8Array(bits)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
async function login(): Promise<{ cookie: string; csrf: string }> {
  const salt = 'c0ffee00c0ffee00c0ffee00c0ffee00'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash('tone-test-pw', salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'tone-test-pw' }),
  }, baseEnv)
  expect(res.status).toBe(200)
  const cookie = res.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await res.json<{ csrfToken: string }>()
  return { cookie, csrf: csrfToken }
}
function post(path: string, s: { cookie: string; csrf: string }, body: unknown) {
  return app.request(path, {
    method: 'POST', headers: { Cookie: s.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf },
    body: JSON.stringify(body),
  }, baseEnv)
}

// Every shipped string the commander can read: the server messages and the client.
const SOURCES = [
  enforcementSrc, daySrc, recoverySrc, missCauseSrc, ratchetSrc, economySrc,
  tongueSrc, learnSrc, blockStatusSrc, limitsSrc, toneSrc,
  shellSrc, debriefSrc, campaignSrc, mindSrc, librarySrc, councilSrc, responseLabUiSrc,
  rhetoricUiSrc,
  agentCredentialsRouteSrc, agentV1RouteSrc, authRouteSrc, calendarRouteSrc, cursorRouteSrc, hermesRouteSrc, intelLibraryRouteSrc, masteryRouteSrc, principlesRouteSrc, pushRouteSrc, readingRouteSrc, rhetoricRouteSrc, rhetoricLabRouteSrc,
  fxSrc, morphSrc, storeSrc, eventsSrc, sanitizeSrc, mainSrc,
].join(String.fromCharCode(10))

describe('B8.7 the removed language is gone', () => {
  it('contains none of the five phrases Book 8.7 strikes out', () => {
    const banned = [
      'the day bleeds while you watch',
      'the beginning of the end',
      'silence is the worst report',
      'kill it today',
      'you woke up without orders',
    ]
    const found = banned.filter((phrase) => SOURCES.toLowerCase().includes(phrase))
    expect(found, 'Book 8.7 removes these from the interface').toEqual([])
  })

  it('uses the calm replacements Book 8.7 names', () => {
    expect(SOURCES).toContain('This block passed without a status')
    expect(SOURCES).toContain('Choose what actually happened')
    expect(SOURCES).toContain('Three similar misses suggest a scheduling problem')
    expect(SOURCES).toContain('Record the cause before rescheduling')
  })
})

describe('B8.7 the severity hierarchy', () => {
  it('names exactly the five levels, in order', () => {
    expect([...SEVERITIES]).toEqual(['neutral', 'information', 'attention', 'warning', 'critical'])
  })

  it('reserves red for genuine risk, never for ordinary incompletion', () => {
    expect(isRed('critical')).toBe(true)
    // The engine's legacy words map onto the ladder without drifting into red.
    expect(normaliseSeverity('serious')).toBe('warning')
    expect(normaliseSeverity('warn')).toBe('attention')
    expect(normaliseSeverity('info')).toBe('information')
    expect(isRed('serious'), 'ordinary incompletion is not red').toBe(false)
    expect(isRed('attention')).toBe(false)
    expect(normaliseSeverity(undefined)).toBe('neutral')
    expect(normaliseSeverity('nonsense')).toBe('neutral')
  })

  it('the unreported-block prompt is an attention, not a warning or worse', async () => {
    // Book 8.3/8.7 together: a passed window is a prompt, amber at most.
    expect(enforcementSrc).toContain("'unreported_block', 'attention'")
  })
})

describe('B8.7 the tone setting', () => {
  it('offers the four registers and defaults to firm', () => {
    expect([...TONES]).toEqual(['neutral', 'firm', 'military', 'compassionate'])
    expect(DEFAULT_TONE).toBe('firm')
    expect(normaliseTone(undefined)).toBe('firm')
    expect(normaliseTone('shouty'), 'an unknown register falls back to firm').toBe('firm')
    expect(normaliseTone('compassionate')).toBe('compassionate')
  })

  it('says the same thing in every register, and is never abusive in military', () => {
    for (const key of ['unreported_block', 'no_targets', 'repeated_miss', 'cause_required']) {
      for (const tone of TONES) {
        const line = toned(key, tone)
        expect(line.length, `${key}/${tone}`).toBeGreaterThan(5)
        // Military may be cold. It may never be contemptuous.
        expect(line, `${key}/${tone}`).not.toMatch(/pathetic|worthless|lazy|coward|disgrace|useless|weak/i)
      }
    }
    // The registers really do differ.
    expect(toned('unreported_block', 'military')).not.toBe(toned('unreported_block', 'compassionate'))
  })

  it('persists the chosen register and reports it in state', async () => {
    const s = await login()
    const initial = await (await app.request('/api/tone', { headers: { Cookie: s.cookie } }, baseEnv)).json<any>()
    expect(initial.tone).toBe(DEFAULT_TONE)
    expect(initial.options).toEqual([...TONES])

    expect((await post('/api/tone', s, { tone: 'compassionate' })).status).toBe(200)
    const after = await (await app.request('/api/tone', { headers: { Cookie: s.cookie } }, baseEnv)).json<any>()
    expect(after.tone).toBe('compassionate')

    const state = await (await app.request('/api/state', { headers: { Cookie: s.cookie } }, baseEnv)).json<any>()
    expect(state.tone, 'the client is told which register to render').toBe('compassionate')

    // An invented register is refused rather than silently stored.
    expect((await post('/api/tone', s, { tone: 'shouty' })).status).toBe(400)
    // Reset so the rest of the suite sees the default.
    await post('/api/tone', s, { tone: DEFAULT_TONE })
  })

  it('leaves the Hermes register alone (Book 15 governs it, not this setting)', () => {
    expect(aiSrc).not.toContain("from './tone'")
    expect(aiSrc).not.toMatch(/normaliseTone|TONE_STRINGS/)
  })
})
