import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { personalTables, preMigrationRowCounts } from './setup'

// Migration 0008 must be additive: it adds audit_events and idempotency_keys
// and alters nothing that already held data. These tests run against the same
// migration-backed schema copy the rest of the suite uses, seeded with legacy
// rows BEFORE 0005-0008 were applied (see test/setup.ts).
describe('migration 0008 audit and idempotency', () => {
  it('creates both new tables', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master
       WHERE type='table' AND name IN ('audit_events','idempotency_keys')
       ORDER BY name`,
    ).all<{ name: string }>()
    expect((results as { name: string }[]).map((r) => r.name))
      .toEqual(['audit_events', 'idempotency_keys'])
  })

  it('preserves every pre-migration personal row', async () => {
    for (const table of personalTables) {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM ${table}`,
      ).first<{ total: number }>()
      expect(
        row?.total ?? 0,
        `${table} lost rows across migration 0008`,
      ).toBeGreaterThanOrEqual(preMigrationRowCounts[table] ?? 0)
    }
  })

  it('ships a rollback note naming the retention guarantee', async () => {
    const sql = (await import('../migrations/0008_audit_idempotency.sql?raw')).default
    expect(sql).toMatch(/Rollback:/)
    expect(sql).toMatch(/No user data is deleted/)
  })

  it('adds no column that could hold a secret', async () => {
    for (const table of ['audit_events', 'idempotency_keys']) {
      const { results } = await env.DB.prepare(
        `SELECT name FROM pragma_table_info('${table}')`,
      ).all<{ name: string }>()
      expect((results as { name: string }[]).length).toBeGreaterThan(0)
      for (const { name } of results as { name: string }[]) {
        expect(name, `${table}.${name} looks secret-bearing`)
          .not.toMatch(/token|secret|password|hash|credential|api_?key/i)
      }
    }
  })

  it('rejects an unknown actor_type at the database boundary', async () => {
    const owner = await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
    ).first<{ id: number }>()
    await expect(
      env.DB.prepare(
        `INSERT INTO audit_events
           (user_id, actor_type, request_id, action, entity_type, created_at)
         VALUES (?,'intruder','actor-type-probe','probe','probe',datetime('now'))`,
      ).bind(owner!.id).run(),
    ).rejects.toThrow(/AUDIT_ACTOR_TYPE/)
  })

  it('enforces one idempotency row per owner, scope and request', async () => {
    const owner = await env.DB.prepare(
      `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
    ).first<{ id: number }>()
    const insert = () => env.DB.prepare(
      `INSERT OR IGNORE INTO idempotency_keys (user_id, scope, request_id)
       VALUES (?,'migration:probe','migration-probe-request')`,
    ).bind(owner!.id).run()

    const first = await insert()
    const second = await insert()
    expect((first.meta as any).changes).toBe(1)
    expect((second.meta as any).changes).toBe(0)

    await env.DB.prepare(
      `DELETE FROM idempotency_keys
       WHERE user_id=? AND scope='migration:probe'`,
    ).bind(owner!.id).run()
  })
})
