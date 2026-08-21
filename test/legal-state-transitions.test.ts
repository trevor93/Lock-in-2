import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'

const baseEnv = {
  DB: env.DB,
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: 'https://model.invalid',
}

async function passwordHash(
  password: string,
  saltHex: string,
): Promise<string> {
  const salt = new Uint8Array(
    saltHex.match(/.{2}/g)!.map((hex) => Number.parseInt(hex, 16)),
  )
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: 100000,
    },
    key,
    256,
  )
  return [...new Uint8Array(bits)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

// The server owns the calendar: routes derive the date from settings.timezone
// via userNow(), NOT from SQLite's UTC date('now'). Fixtures must use the same
// clock or they land on a different day whenever UTC and the owner's timezone
// disagree (between 21:00 and 24:00 UTC for Africa/Nairobi), which silently
// stops a same-day guard from seeing the row it is meant to guard.
async function ownerToday(): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT value FROM settings WHERE key='timezone' LIMIT 1`,
  ).first<{ value: string }>()
  const tz = row?.value || 'Africa/Nairobi'
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

async function authenticatedContext(): Promise<{
  headers: Record<string, string>
  userId: number
}> {
  const password = 'transition-test-password'
  const salt = 'aabbccddeeff00112233445566778899'
  await env.DB.prepare(
    `UPDATE users
     SET password_hash=?, password_salt=?, failed_login_count=0,
         locked_until=NULL
     WHERE role='owner'`,
  ).bind(
    await passwordHash(password, salt),
    salt,
  ).run()
  const response = await app.request(
    '/api/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    },
    baseEnv,
  )
  expect(response.status).toBe(200)
  const setCookie = response.headers.get('set-cookie')
  const body = await response.json<{ csrfToken: string }>()
  const owner = await env.DB.prepare(
    `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
  ).first<{ id: number }>()

  return {
    userId: owner!.id,
    headers: {
      Cookie: setCookie!.split(';', 1)[0],
      'Content-Type': 'application/json',
      'X-CSRF-Token': body.csrfToken,
    },
  }
}

async function issueAgentToken(userId: number): Promise<string> {
  const token = `wr_agent_v1_${'a'.repeat(50)}${userId}`
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  )
  const tokenHash = [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  await env.DB.prepare(
    `INSERT INTO agent_credentials
       (user_id, token_hash, token_prefix, device_label, scopes, expires_at)
     VALUES (?,?,?,?,?,datetime('now','+1 day'))`,
  ).bind(
    userId,
    tokenHash,
    token.slice(0, 20),
    'Transition test device',
    JSON.stringify(['blocks:write']),
  ).run()
  return token
}

async function post(
  path: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request(
    path,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
    baseEnv,
  )
}

describe('Book 5.4 legal state transitions', () => {
  it('requires unit steps in order and keeps completion terminal', async () => {
    const { headers, userId } = await authenticatedContext()
    const phase = await env.DB.prepare(
      `INSERT INTO phases (sort_order, code, title, track)
       VALUES (999,'TRANSITION_TEST','Transition test','transition-test')`,
    ).run()
    const unit = await env.DB.prepare(
      `INSERT INTO units
         (phase_id, sort_order, title, field_drill)
       VALUES (?,?,?,?)`,
    ).bind(
      phase.meta.last_row_id,
      1,
      'Transition test unit',
      'Complete the transition test drill.',
    ).run()
    const unitId = Number(unit.meta.last_row_id)
    await env.DB.prepare(
      `INSERT INTO unit_progress (user_id, unit_id, status)
       VALUES (?,?,'active')`,
    ).bind(userId, unitId).run()

    const skippedReading = await post(
      `/api/units/${unitId}/step`,
      headers,
      {
        step: 'drill',
        drill_report: 'A detailed report that is long enough to pass validation.',
        date: '2026-08-15',
      },
    )
    expect(skippedReading.status).toBe(409)

    expect((await post(
      `/api/units/${unitId}/step`,
      headers,
      { step: 'reading', date: '2026-08-15' },
    )).status).toBe(200)

    const repeatedReading = await post(
      `/api/units/${unitId}/step`,
      headers,
      { step: 'reading', date: '2026-08-15' },
    )
    expect(repeatedReading.status).toBe(409)

    expect((await post(
      `/api/units/${unitId}/step`,
      headers,
      {
        step: 'drill',
        drill_report: 'A detailed report that is long enough to pass validation.',
        date: '2026-08-15',
      },
    )).status).toBe(200)
    expect((await post(
      `/api/units/${unitId}/step`,
      headers,
      {
        step: 'complete',
        debrief_answer: 'The transition was applied in sequence.',
        date: '2026-08-15',
      },
    )).status).toBe(200)

    const afterCompletion = await post(
      `/api/units/${unitId}/step`,
      headers,
      { step: 'reading', date: '2026-08-15' },
    )
    expect(afterCompletion.status).toBe(409)

    const points = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM points_ledger
       WHERE user_id=? AND ref_id=? AND ref_type='unit'`,
    ).bind(userId, unitId).first<{ total: number }>()
    expect(points?.total).toBe(3)
  })

  it('keeps failed exams retriable and passed exams terminal', async () => {
    const { headers, userId } = await authenticatedContext()
    const phase = await env.DB.prepare(
      `INSERT INTO phases (sort_order, code, title, track)
       VALUES (998,'EXAM_TRANSITION_TEST','Exam transition test','exam-transition-test')`,
    ).run()
    const unit = await env.DB.prepare(
      `INSERT INTO units
         (phase_id, sort_order, title, is_exam, exam_questions)
       VALUES (?,?,?,1,?)`,
    ).bind(
      phase.meta.last_row_id,
      1,
      'Transition test exam',
      JSON.stringify(['Explain the legal transition.']),
    ).run()
    const unitId = Number(unit.meta.last_row_id)
    await env.DB.prepare(
      `INSERT INTO unit_progress (user_id, unit_id, status)
       VALUES (?,?,'active')`,
    ).bind(userId, unitId).run()

    const failed = await post(
      `/api/units/${unitId}/step`,
      headers,
      {
        step: 'complete',
        exam_answers: ['An honest first attempt that needs more study.'],
        exam_self_score: 60,
        date: '2026-08-15',
      },
    )
    expect(failed.status).toBe(200)
    await expect(failed.json()).resolves.toMatchObject({
      ok: false,
      failed: true,
    })

    const afterFailure = await env.DB.prepare(
      `SELECT status, attempts FROM unit_progress
       WHERE user_id=? AND unit_id=?`,
    ).bind(userId, unitId).first<{
      status: string
      attempts: number
    }>()
    expect(afterFailure).toEqual({
      status: 'active',
      attempts: 1,
    })

    expect((await post(
      `/api/units/${unitId}/step`,
      headers,
      {
        step: 'complete',
        exam_answers: ['A complete answer after restudying the weak material.'],
        exam_self_score: 80,
        date: '2026-08-15',
      },
    )).status).toBe(200)

    const repeatedPass = await post(
      `/api/units/${unitId}/step`,
      headers,
      {
        step: 'complete',
        exam_answers: ['An attempted rewrite of a completed exam.'],
        exam_self_score: 90,
        date: '2026-08-15',
      },
    )
    expect(repeatedPass.status).toBe(409)

    const completed = await env.DB.prepare(
      `SELECT status, attempts FROM unit_progress
       WHERE user_id=? AND unit_id=?`,
    ).bind(userId, unitId).first<{
      status: string
      attempts: number
    }>()
    const rewards = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM points_ledger
       WHERE user_id=? AND ref_id=? AND ref_type='exam'`,
    ).bind(userId, unitId).first<{ total: number }>()
    expect(completed).toEqual({
      status: 'complete',
      attempts: 2,
    })
    expect(rewards?.total).toBe(1)
  })

  it('keeps auto-missed block windows terminal', async () => {
    const { headers, userId } = await authenticatedContext()
    const block = await env.DB.prepare(
      `INSERT INTO schedule_blocks
         (user_id, sort_order, start_time, end_time, title, category, days)
       VALUES (?,999,'00:00','23:59','Terminal block fixture','test',
               'mon,tue,wed,thu,fri,sat,sun')`,
    ).bind(userId).run()
    const blockId = Number(block.meta.last_row_id)
    const today = await ownerToday()
    const log = await env.DB.prepare(
      `INSERT INTO block_logs
         (user_id, block_id, log_date, status, note, completed_at)
       VALUES (?,?,?,'missed','AUTO-CANCELED: transition fixture',datetime('now'))`,
    ).bind(userId, blockId, today).run()

    const rewrite = await post(
      `/api/blocks/${blockId}/log`,
      headers,
      { status: 'done' },
    )
    expect(rewrite.status).toBe(409)

    const row = await env.DB.prepare(
      `SELECT status FROM block_logs WHERE id=? AND user_id=?`,
    ).bind(log.meta.last_row_id, userId)
      .first<{ status: string }>()
    const rewards = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM points_ledger
       WHERE user_id=? AND ref_id=? AND ref_type='block'`,
    ).bind(userId, blockId).first<{ total: number }>()
    expect(row?.status).toBe('missed')
    expect(rewards?.total).toBe(0)
  })

  it('keeps auto-missed block windows terminal through the agent route', async () => {
    const { userId } = await authenticatedContext()
    const token = await issueAgentToken(userId)
    const block = await env.DB.prepare(
      `INSERT INTO schedule_blocks
         (user_id, sort_order, start_time, end_time, title, category, days)
       VALUES (?,998,'00:00','23:59','Agent terminal block fixture','test',
               'mon,tue,wed,thu,fri,sat,sun')`,
    ).bind(userId).run()
    const blockId = Number(block.meta.last_row_id)
    await env.DB.prepare(
      `INSERT INTO block_logs
         (user_id, block_id, log_date, status, note, completed_at)
       VALUES (?,?,'2026-08-15','missed','AUTO-CANCELED: agent fixture',datetime('now'))`,
    ).bind(userId, blockId).run()

    const rewrite = await app.request(
      '/api/agent/v1/block-log',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Token': token,
        },
        body: JSON.stringify({
          block_id: blockId,
          date: '2026-08-15',
          status: 'done',
        }),
      },
      baseEnv,
    )
    expect(rewrite.status).toBe(409)

    const row = await env.DB.prepare(
      `SELECT status FROM block_logs
       WHERE user_id=? AND block_id=? AND log_date='2026-08-15'`,
    ).bind(userId, blockId).first<{ status: string }>()
    expect(row?.status).toBe('missed')
  })

  it('requires reading before done and keeps done chapters terminal', async () => {
    const { headers, userId } = await authenticatedContext()
    const path = '/api/library/art_of_war/chapter/12'

    const skippedReading = await post(
      path,
      headers,
      { status: 'done', date: '2026-08-15' },
    )
    expect(skippedReading.status).toBe(409)

    expect((await post(path, headers, { status: 'reading' })).status).toBe(200)
    expect((await post(
      path,
      headers,
      { status: 'done', date: '2026-08-15' },
    )).status).toBe(200)

    const reversal = await post(path, headers, { status: 'reading' })
    expect(reversal.status).toBe(409)

    const chapter = await env.DB.prepare(
      `SELECT status FROM book_progress
       WHERE user_id=? AND book_id='art_of_war' AND chapter_idx=12`,
    ).bind(userId).first<{ status: string }>()
    const points = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM points_ledger
       WHERE user_id=? AND ref_type='book'
         AND reason LIKE '%art_of_war ch.13%'`,
    ).bind(userId).first<{ total: number }>()
    expect(chapter?.status).toBe('done')
    expect(points?.total).toBe(1)
  })

  it('prevents a final intel verdict from being rewritten', async () => {
    const { headers, userId } = await authenticatedContext()
    const inserted = await env.DB.prepare(
      `INSERT INTO intel_entries
         (user_id, log_date, domain, title, verdict)
       VALUES (?,'2026-08-15','other','Transition verdict fixture','pending')`,
    ).bind(userId).run()
    const path = `/api/intel/${inserted.meta.last_row_id}/verdict`

    expect((await post(path, headers, { verdict: 'pending' })).status).toBe(400)
    expect((await post(
      path,
      headers,
      { verdict: 'smart', lesson: 'A final evidence-based judgment.' },
    )).status).toBe(200)
    const rewrite = await post(path, headers, { verdict: 'dumb' })
    expect(rewrite.status).toBe(409)

    const row = await env.DB.prepare(
      `SELECT verdict FROM intel_entries WHERE id=? AND user_id=?`,
    ).bind(inserted.meta.last_row_id, userId)
      .first<{ verdict: string }>()
    expect(row?.verdict).toBe('smart')
  })

  it('keeps a resolved prediction terminal', async () => {
    const { headers, userId } = await authenticatedContext()
    const inserted = await env.DB.prepare(
      `INSERT INTO predictions
         (user_id, made_date, claim, confidence, resolve_by)
       VALUES (?,'2026-08-14','Transition prediction fixture',70,'2026-08-15')`,
    ).bind(userId).run()
    const path = `/api/predictions/${inserted.meta.last_row_id}/resolve`

    expect((await post(path, headers, { outcome: 'right' })).status).toBe(200)
    expect((await post(path, headers, { outcome: 'wrong' })).status).toBe(409)

    const row = await env.DB.prepare(
      `SELECT outcome FROM predictions WHERE id=? AND user_id=?`,
    ).bind(inserted.meta.last_row_id, userId)
      .first<{ outcome: string }>()
    expect(row?.outcome).toBe('right')
  })

  it('rejects flashcard reviews before the card is due', async () => {
    const { headers, userId } = await authenticatedContext()
    // Book 7: maxims live in the unified captures table; the flashcards FK now
    // targets captures(id), so seed the maxim there and link the card to it.
    const maxim = await env.DB.prepare(
      `INSERT INTO captures
         (user_id, kind, source, principle, naive_reading, master_reading)
       VALUES (?,'maxim','Transition test','Review only when due','naive','master')`,
    ).bind(userId).run()
    const maximId = Number(maxim.meta.last_row_id)
    await env.DB.prepare(
      `INSERT INTO flashcards (user_id, maxim_id, due_date)
       VALUES (?,?,'2999-12-31')`,
    ).bind(userId, maximId).run()

    const response = await post(
      `/api/cards/${maximId}/review`,
      headers,
      { grade: 3, date: '2026-08-15' },
    )
    expect(response.status).toBe(409)
    const forgedFuture = await post(
      `/api/cards/${maximId}/review`,
      headers,
      { grade: 3, date: '2999-12-31' },
    )
    expect(forgedFuture.status).toBe(409)
    const reviews = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM card_reviews
       WHERE user_id=? AND maxim_id=?`,
    ).bind(userId, maximId).first<{ total: number }>()
    expect(reviews?.total).toBe(0)
  })

  it('rejects tongue reviews before due and after archival', async () => {
    const { headers, userId } = await authenticatedContext()
    const response = await env.DB.prepare(
      `INSERT INTO responses
         (user_id, situation, trigger_q, response, category)
       VALUES (?,'Transition test','What is legal?','Only the due transition.','wit')`,
    ).bind(userId).run()
    const responseId = Number(response.meta.last_row_id)
    await env.DB.prepare(
      `INSERT INTO response_srs (user_id, response_id, due_date)
       VALUES (?,?,'2999-12-31')`,
    ).bind(userId, responseId).run()
    const path = `/api/tongue/${responseId}/review`

    expect((await post(
      path,
      headers,
      { grade: 2, mode: 'recall', date: '2026-08-15' },
    )).status).toBe(409)
    expect((await post(
      path,
      headers,
      { grade: 2, mode: 'recall', date: '2999-12-31' },
    )).status).toBe(409)

    await env.DB.prepare(
      `UPDATE response_srs SET due_date='2000-01-01'
       WHERE response_id=? AND user_id=?`,
    ).bind(responseId, userId).run()
    await env.DB.prepare(
      `UPDATE responses SET archived=1 WHERE id=? AND user_id=?`,
    ).bind(responseId, userId).run()
    expect((await post(
      path,
      headers,
      { grade: 2, mode: 'recall', date: '2026-08-15' },
    )).status).toBe(409)

    const reviews = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM tongue_reviews
       WHERE user_id=? AND response_id=?`,
    ).bind(userId, responseId).first<{ total: number }>()
    expect(reviews?.total).toBe(0)
  })
})
