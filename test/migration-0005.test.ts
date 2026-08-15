import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { personalTables, preMigrationRowCounts } from './setup'

describe('migration 0005 populated schema preservation', () => {
  it('preserves legacy rows and verifier while assigning every row to the owner', async () => {
    const owner = await env.DB.prepare(
      `SELECT id, password_hash, password_salt FROM users ORDER BY id LIMIT 1`,
    ).first<{ id: number; password_hash: string; password_salt: string }>()

    expect(owner).toBeTruthy()
    expect(owner!.password_hash).toBe('legacy-verifier-hash')
    expect(owner!.password_salt).toBe('legacy-verifier-salt')

    for (const table of personalTables) {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN user_id=? THEN 1 ELSE 0 END) AS owned
         FROM ${table}`,
      ).bind(owner!.id).first<{ total: number; owned: number }>()
      expect(preMigrationRowCounts[table], table).toBeGreaterThan(0)
      expect(row?.total, table).toBe(preMigrationRowCounts[table])
      expect(row?.owned, table).toBe(row?.total)
    }
  })
})
