import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import readingRoutesSrc from '../src/routes/reading.ts?raw'
import learnRoutesSrc from '../src/routes/learn.ts?raw'
import {
  readingVerdict, requiredSeconds, dwellIncrement,
  MAX_PLAUSIBLE_WPM, MIN_DWELL_SECONDS, MIN_SCROLL_PCT, IDLE_GAP_SECONDS,
} from '../src/reading'

// Book 10.1 — "reading_done is dwell time plus traversal, never a button. A chapter is
// opened, scrolled at a plausible reading speed, and anchored, with section-level
// positions recorded."
// Book 10.5/10.6 — sources carry full provenance, partial works are labelled, editions
// that disagree are stored so the disagreement can be shown, and sections are anchored
// at paragraph level.

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
async function login(): Promise<{ cookie: string; csrf: string; userId: number }> {
  const salt = 'ab12cd34ef56ab12cd34ef56ab12cd34'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash('reading-test-pw', salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'reading-test-pw' }),
  }, baseEnv)
  expect(res.status).toBe(200)
  const cookie = res.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await res.json<{ csrfToken: string }>()
  const owner = await env.DB.prepare(`SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`).first<{ id: number }>()
  return { cookie, csrf: csrfToken, userId: owner!.id }
}
function post(path: string, s: { cookie: string; csrf: string }, body: unknown) {
  return app.request(path, {
    method: 'POST', headers: { Cookie: s.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf },
    body: JSON.stringify(body),
  }, baseEnv)
}

describe('B10.1 the verdict is the application’s, not the client’s', () => {
  it('there is no endpoint that lets a client declare a chapter read', () => {
    // The only writes are open / progress / close. None of them accepts a "read" claim.
    expect(readingRoutesSrc).not.toMatch(/plausible:\s*(true|b\.|body)/)
    expect(readingRoutesSrc).not.toMatch(/reading_done\s*=\s*1/)
    // The verdict is always computed by the shared function.
    const computed = (readingRoutesSrc.match(/readingVerdict\(/g) || []).length
    expect(computed, 'every reading answer must come from readingVerdict()').toBeGreaterThanOrEqual(3)
  })

  it('requires the dwell a chapter of that length actually needs', () => {
    // 3000 words cannot pass in under 3000/450*60 = 400s.
    expect(requiredSeconds(3000)).toBe(400)
    // A very short chapter still needs the floor.
    expect(requiredSeconds(10)).toBe(MIN_DWELL_SECONDS)
  })

  it('refuses a traversal that stopped short of the end', () => {
    const v = readingVerdict({ dwell_seconds: 9999, max_scroll_pct: MIN_SCROLL_PCT - 1, word_count: 500 })
    expect(v.plausible).toBe(false)
    expect(v.reason).toContain('not read to the end')
  })

  it('refuses a scroll-through that was too fast to be reading', () => {
    const v = readingVerdict({ dwell_seconds: 30, max_scroll_pct: 100, word_count: 4000 })
    expect(v.plausible).toBe(false)
    expect(v.reason).toMatch(/fastest these 4000 words could honestly be read/)
  })

  it('accepts an honest read, and is not fooled by an open tab', () => {
    const v = readingVerdict({ dwell_seconds: 600, max_scroll_pct: 100, word_count: 1500 })
    expect(v.plausible).toBe(true)
    expect(v.wpm).toBe(150)
    // A gap longer than the idle window contributes nothing to dwell.
    expect(dwellIncrement(5000)).toBe(5)
    expect(dwellIncrement((IDLE_GAP_SECONDS + 60) * 1000), 'an abandoned tab is not reading').toBe(0)
  })

  it('never treats slow reading as suspicious', () => {
    const v = readingVerdict({ dwell_seconds: 7200, max_scroll_pct: 100, word_count: 800 })
    expect(v.plausible, 'a long think is honest').toBe(true)
    expect(v.wpm).toBeLessThan(MAX_PLAUSIBLE_WPM)
  })
})

describe('B10.1 the measured reading flow', () => {
  it('records dwell and traversal server-side and reaches a verdict', async () => {
    const s = await login()
    const opened = await post('/api/reading/open', s, {
      book_id: 'art_of_war', chapter_idx: 1, word_count: 900,
    })
    expect(opened.status).toBe(200)
    const { session_id, requiredSeconds: needed } = await opened.json<any>()
    expect(needed).toBe(requiredSeconds(900))

    // Six honest heartbeats: 30s each, walking down the chapter with anchors.
    for (let i = 1; i <= 6; i++) {
      const res = await post('/api/reading/progress', s, {
        session_id, scroll_pct: Math.min(100, i * 18), elapsed_ms: 30000,
        anchor: `art_of_war:1:${i}`,
      })
      expect(res.status).toBe(200)
    }
    const closed = await post('/api/reading/close', s, { session_id })
    const verdict = await closed.json<any>()
    expect(verdict.dwellSeconds, 'dwell is accumulated server-side').toBe(180)
    expect(verdict.scrollPct).toBe(100)
    expect(verdict.plausible).toBe(true)

    // Section-level positions were recorded.
    const events = await env.DB.prepare(
      `SELECT COUNT(DISTINCT anchor) AS n FROM reading_events WHERE session_id=?`,
    ).bind(session_id).first<{ n: number }>()
    expect(events?.n, 'the traversal is anchored section by section').toBe(6)

    // And the chapter now reports as read.
    const status = await (await app.request('/api/reading/art_of_war/1', { headers: { Cookie: s.cookie } }, baseEnv)).json<any>()
    expect(status.read).toBe(true)
  })

  it('a client that claims a fast read gets no credit', async () => {
    const s = await login()
    const { session_id } = await (await post('/api/reading/open', s, {
      book_id: 'the_prince', chapter_idx: 3, word_count: 5000,
    })).json<any>()
    // One heartbeat, straight to the bottom.
    await post('/api/reading/progress', s, { session_id, scroll_pct: 100, elapsed_ms: 4000 })
    const verdict = await (await post('/api/reading/close', s, { session_id })).json<any>()
    expect(verdict.plausible).toBe(false)
    const row = await env.DB.prepare(
      `SELECT plausible FROM reading_sessions WHERE id=?`,
    ).bind(session_id).first<{ plausible: number }>()
    expect(row?.plausible).toBe(0)
  })

  it('keeps the traversal record append-only', async () => {
    const s = await login()
    const { session_id } = await (await post('/api/reading/open', s, {
      book_id: 'meditations', chapter_idx: 2, word_count: 300,
    })).json<any>()
    await post('/api/reading/progress', s, { session_id, scroll_pct: 50, elapsed_ms: 10000, anchor: 'meditations:2:1' })
    let refused = false
    try {
      await env.DB.prepare(`DELETE FROM reading_events WHERE session_id=?`).bind(session_id).run()
    } catch (e: any) { refused = /READING_EVENTS_APPEND_ONLY/.test(String(e?.message || e)) }
    expect(refused, 'a traversal record could be deleted').toBe(true)
  })
})

describe('B10.1 the curriculum gate replaces the button', () => {
  it('refuses reading_done until a measured session passed', async () => {
    const s = await login()
    // An active unit with no reading session at all.
    const phase = await env.DB.prepare(
      `INSERT INTO phases (sort_order, code, title) VALUES (900,'B10','Book 10 gate')`,
    ).run()
    const unit = await env.DB.prepare(
      `INSERT INTO units (phase_id, sort_order, title, reading) VALUES (?,1,'Measured reading unit','Art of War I')`,
    ).bind(Number(phase.meta.last_row_id)).run()
    const unitId = Number(unit.meta.last_row_id)
    await env.DB.prepare(
      `INSERT INTO unit_progress (user_id, unit_id, status) VALUES (?,?,'active')`,
    ).bind(s.userId, unitId).run()

    const refused = await post(`/api/units/${unitId}/step`, s, { step: 'reading' })
    expect(refused.status).toBe(409)
    const body = await refused.json<any>()
    expect(body.needsReading).toBe(true)
    expect(body.error).toContain('measured, not clicked')

    // A too-fast session still does not open the gate.
    const { session_id } = await (await post('/api/reading/open', s, {
      book_id: 'art_of_war', chapter_idx: 1, word_count: 4000, unit_id: unitId,
    })).json<any>()
    await post('/api/reading/progress', s, { session_id, scroll_pct: 100, elapsed_ms: 5000 })
    await post('/api/reading/close', s, { session_id })
    const stillRefused = await post(`/api/units/${unitId}/step`, s, { step: 'reading' })
    expect(stillRefused.status, 'scrolling is not reading').toBe(409)

    // An honest session opens it.
    const second = await (await post('/api/reading/open', s, {
      book_id: 'art_of_war', chapter_idx: 1, word_count: 600, unit_id: unitId,
    })).json<any>()
    for (let i = 1; i <= 4; i++) {
      await post('/api/reading/progress', s, {
        session_id: second.session_id, scroll_pct: i * 25, elapsed_ms: 30000, anchor: `art_of_war:1:${i}`,
      })
    }
    await post('/api/reading/close', s, { session_id: second.session_id })
    const granted = await post(`/api/units/${unitId}/step`, s, { step: 'reading' })
    expect(granted.status, 'a measured read opens the gate').toBe(200)
  })

  it('the gate lives in the server, not in the client', () => {
    expect(learnRoutesSrc).toContain('reading_sessions')
    expect(learnRoutesSrc).toContain('plausible=1')
    expect(learnRoutesSrc).toContain('measured, not clicked')
  })
})

describe('B10.5 source metadata is honest', () => {
  it('refuses to call a translation official unless the status says so', async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO sources (id, title, author, original_language, first_published)
       VALUES ('art_of_war','The Art of War','Sun Tzu','Classical Chinese','c. 5th century BC')`,
    ).run()
    let refused = false
    try {
      await env.DB.prepare(
        `INSERT INTO source_editions (id, source_id, translation_status, completeness)
         VALUES ('art_of_war:bogus','art_of_war','definitive','complete')`,
      ).run()
    } catch (e: any) { refused = /CHECK|constraint/i.test(String(e?.message || e)) }
    expect(refused, 'only the four declared statuses are storable').toBe(true)
  })

  it('records full provenance, labels a partial work, and stores an edition disagreement', async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO source_editions
         (id, source_id, translator, edition, publication_year, source_url,
          translation_status, portion_included, completeness, editorial_notes, checksum)
       VALUES ('art_of_war:giles_1910','art_of_war','Lionel Giles','1910 first edition','1910',
               'https://www.gutenberg.org/ebooks/132','public_domain',
               'Chapters I-XIII (complete)','complete','Giles numbering retained.','sha256:test')`,
    ).run()
    await env.DB.prepare(
      `INSERT OR IGNORE INTO source_editions
         (id, source_id, translator, publication_year, translation_status, portion_included, completeness)
       VALUES ('on_war:excerpt','art_of_war','Unknown','n/a','public_domain','Book I only','partial')`,
    ).run()

    const giles = await env.DB.prepare(
      `SELECT translation_status, completeness, portion_included, checksum
       FROM source_editions WHERE id='art_of_war:giles_1910'`,
    ).first<any>()
    expect(giles.translation_status, 'a public-domain translation is called exactly that').toBe('public_domain')
    expect(giles.completeness).toBe('complete')
    expect(giles.checksum).toBeTruthy()

    const partial = await env.DB.prepare(
      `SELECT completeness, portion_included FROM source_editions WHERE id='on_war:excerpt'`,
    ).first<any>()
    expect(partial.completeness, 'a partial work is labelled explicitly').toBe('partial')

    // A paragraph-level anchor, and a rival rendering stored rather than resolved.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO source_sections
         (anchor, edition_id, chapter_idx, chapter_title, paragraph_idx, text, word_count, original_term)
       VALUES ('art_of_war:1:1','art_of_war:giles_1910',1,'Laying Plans',1,
               'Sun Tzu said: The art of war is of vital importance to the State.',12,'始計')`,
    ).run()
    await env.DB.prepare(
      `INSERT INTO section_variants (anchor, edition_id, text, note)
       VALUES ('art_of_war:1:1','art_of_war:giles_1910',
               'Sun Tzu said: warfare is the greatest affair of state.',
               'Editions differ on whether 兵 is rendered as war or as the army; both are shown.')`,
    ).run()
    const variant = await env.DB.prepare(
      `SELECT note FROM section_variants WHERE anchor='art_of_war:1:1' LIMIT 1`,
    ).first<{ note: string }>()
    expect(variant?.note, 'disagreement is displayed, not silently resolved').toContain('both are shown')

    const section = await env.DB.prepare(
      `SELECT original_term, chapter_idx, paragraph_idx FROM source_sections WHERE anchor='art_of_war:1:1'`,
    ).first<any>()
    expect(section.original_term, 'the original term travels with the passage').toBe('始計')
    expect(section.paragraph_idx, 'citations are paragraph-level').toBe(1)
  })
})
