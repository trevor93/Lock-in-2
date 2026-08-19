import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { personalTables, preMigrationRowCounts } from './setup'

const PINNED_MODEL = 'gpt-5-mini-2025-08-07'

describe('migration 0007 populated schema preservation', () => {
  it('preserves all existing personal rows and adds model cost controls', async () => {
    const owner = await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
    ).first<{ id: number }>()
    expect(owner).toBeTruthy()

    for (const table of personalTables) {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM ${table}`,
      ).first<{ total: number }>()
      expect(row?.total, table).toBe(preMigrationRowCounts[table])
    }

    const requestColumns = (await env.DB.prepare(
      `PRAGMA table_info(model_requests)`,
    ).all()).results.map((column: any) => column.name)
    expect(requestColumns).toEqual(expect.arrayContaining([
      'user_id',
      'request_id',
      'route',
      'model',
      'input_chars',
      'reserved_tokens',
      'created_at',
    ]))

    const eventColumns = (await env.DB.prepare(
      `PRAGMA table_info(model_audit_events)`,
    ).all()).results.map((column: any) => column.name)
    expect(eventColumns).toEqual(expect.arrayContaining([
      'user_id',
      'request_id',
      'route',
      'model',
      'event_type',
      'attempt',
      'input_chars',
      'output_chars',
      'prompt_tokens',
      'completion_tokens',
      'upstream_status',
      'created_at',
    ]))
  })

  it('enforces the pinned model and hard per-user rate budget in D1', async () => {
    const owner = await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
    ).first<{ id: number }>()

    for (let index = 0; index < 10; index += 1) {
      await env.DB.prepare(
        `INSERT INTO model_requests
           (user_id, request_id, route, model, input_chars, reserved_tokens)
         VALUES (?,?,?,?,?,?)`,
      ).bind(
        owner!.id,
        `migration-rate-${index}`,
        'hermes:chat',
        PINNED_MODEL,
        100,
        1300,
      ).run()
    }

    await expect(env.DB.prepare(
      `INSERT INTO model_requests
         (user_id, request_id, route, model, input_chars, reserved_tokens)
       VALUES (?,?,?,?,?,?)`,
    ).bind(
      owner!.id,
      'migration-rate-denied',
      'hermes:chat',
      PINNED_MODEL,
      100,
      1300,
    ).run()).rejects.toThrow(/MODEL_RATE_LIMIT/)

    await expect(env.DB.prepare(
      `INSERT INTO model_requests
         (user_id, request_id, route, model, input_chars, reserved_tokens,
          created_at)
       VALUES (?,?,?,?,?,?,datetime('now','-2 minutes'))`,
    ).bind(
      owner!.id,
      'migration-unpinned-model',
      'hermes:chat',
      'gpt-5-mini',
      100,
      1300,
    ).run()).rejects.toThrow()
  })
})
