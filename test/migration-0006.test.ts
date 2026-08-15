import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { personalTables, preMigrationRowCounts } from './setup'

const ALL_AGENT_SCOPES = [
  'briefing:read',
  'blocks:read',
  'blocks:write',
  'debriefs:read',
  'debriefs:write',
  'intel:read',
  'intel:write',
  'hermes:write',
  'export:read',
]

describe('migration 0006 populated schema preservation', () => {
  it('preserves all personal rows while retiring plaintext agent tokens', async () => {
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

    const retired = await env.DB.prepare(
      `SELECT value FROM settings WHERE key='agent_token'`,
    ).first<{ value: string }>()
    expect(retired?.value).toBe('')
    expect(retired?.value).not.toBe('legacy-agent-token')

    const columns = (await env.DB.prepare(
      `PRAGMA table_info(agent_credentials)`,
    ).all()).results.map((column: any) => column.name)
    expect(columns).toEqual(expect.arrayContaining([
      'user_id',
      'token_hash',
      'token_prefix',
      'device_label',
      'scopes',
      'expires_at',
      'revoked_at',
      'last_used_at',
      'last_request_method',
      'last_request_route',
      'last_request_country',
      'last_request_network',
      'rate_window_started_at',
      'rate_window_count',
    ]))
  })

  it('constrains credential lifecycle data and supports the full declared scope set', async () => {
    const owner = await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
    ).first<{ id: number }>()
    const scopes = JSON.stringify(ALL_AGENT_SCOPES)
    const inserted = await env.DB.prepare(
      `INSERT INTO agent_credentials
         (user_id, token_hash, token_prefix, device_label, scopes, expires_at)
       VALUES (?,?,?,?,?,datetime('now','+1 day'))`,
    ).bind(
      owner!.id,
      'a'.repeat(64),
      'wr_agent_v1_example',
      'Migration test device',
      scopes,
    ).run()
    expect(Number(inserted.meta.last_row_id)).toBeGreaterThan(0)

    const event = await env.DB.prepare(
      `INSERT INTO agent_credential_events
         (user_id, credential_id, event_type, request_method, request_route,
          request_country, request_network)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      owner!.id,
      inserted.meta.last_row_id,
      'used',
      'POST',
      'export:read',
      'KE',
      '203.0.113.0/24',
    ).run()
    expect(Number(event.meta.last_row_id)).toBeGreaterThan(0)
  })
})
