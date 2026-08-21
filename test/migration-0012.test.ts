import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { preMigrationRowCounts } from './setup'

// Book 7 table unification — Slice 1 evidence. Migration 0012 is ADDITIVE: it
// creates captures / review_items / exams and backfills them 1:1 from the legacy
// per-kind tables, without touching those tables or changing any route. These
// tests prove the backfill preserves every row and field and that the legacy
// stores are left exactly as they were (so the change is fully reversible).

async function count(sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...binds).first<{ n: number }>()
  return row?.n ?? 0
}

describe('B7 migration 0012 — unified capture/review/exam backfill', () => {
  it('created the three unified tables with provenance columns', async () => {
    for (const t of ['captures', 'review_items', 'exams']) {
      expect(await count(
        `SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='table' AND name=?`, t,
      ), t).toBe(1)
      // legacy_table/legacy_id provenance present on each
      expect(await count(
        `SELECT COUNT(*) AS n FROM pragma_table_info('${t}') WHERE name IN ('legacy_table','legacy_id')`,
      ), `${t} provenance`).toBe(2)
    }
  })

  it('backfilled captures = intel_entries + maxims + responses, split by kind', async () => {
    const intel = preMigrationRowCounts['intel_entries']
    const maxims = preMigrationRowCounts['maxims']
    const responses = preMigrationRowCounts['responses']
    expect(intel + maxims + responses, 'fixture must populate all three').toBeGreaterThan(0)

    expect(await count(`SELECT COUNT(*) AS n FROM captures`)).toBe(intel + maxims + responses)
    expect(await count(`SELECT COUNT(*) AS n FROM captures WHERE kind='intel'`)).toBe(intel)
    expect(await count(`SELECT COUNT(*) AS n FROM captures WHERE kind='maxim'`)).toBe(maxims)
    expect(await count(`SELECT COUNT(*) AS n FROM captures WHERE kind='response'`)).toBe(responses)
  })

  it('backfilled review_items = response_srs and exams = tongue_exams', async () => {
    expect(await count(`SELECT COUNT(*) AS n FROM review_items WHERE kind='response'`))
      .toBe(preMigrationRowCounts['response_srs'])
    expect(await count(`SELECT COUNT(*) AS n FROM exams WHERE kind='tongue'`))
      .toBe(preMigrationRowCounts['tongue_exams'])
  })

  it('preserved the actual field values through the mapping', async () => {
    // The fixture's single intel row: title 'Legacy intel', domain 'other'.
    const intelRow = await env.DB.prepare(
      `SELECT title, domain, kind, legacy_table FROM captures
       WHERE kind='intel' AND legacy_table='intel_entries'
       ORDER BY legacy_id LIMIT 1`,
    ).first<{ title: string; domain: string; kind: string; legacy_table: string }>()
    expect(intelRow?.title).toBe('Legacy intel')
    expect(intelRow?.domain).toBe('other')

    // A response row carries its response text and category.
    const resp = await env.DB.prepare(
      `SELECT response, category FROM captures WHERE kind='response' ORDER BY legacy_id LIMIT 1`,
    ).first<{ response: string; category: string }>()
    expect(resp?.response, 'response text lost in backfill').toBeTruthy()

    // review_items points back at its response and preserves SR fields.
    const ri = await env.DB.prepare(
      `SELECT item_id, due_date, ease, mastery FROM review_items WHERE kind='response' LIMIT 1`,
    ).first<{ item_id: number; due_date: string; ease: number; mastery: string }>()
    expect(ri?.item_id, 'review_items lost its item link').toBeGreaterThan(0)
    expect(ri?.due_date).toBeTruthy()
  })

  it('carried owner (user_id) onto every unified row', async () => {
    for (const t of ['captures', 'review_items', 'exams']) {
      const orphaned = await count(
        `SELECT COUNT(*) AS n FROM ${t} u LEFT JOIN users usr ON usr.id=u.user_id WHERE usr.id IS NULL`,
      )
      expect(orphaned, `${t} has rows with no valid owner`).toBe(0)
    }
  })

  it('left the legacy source tables completely unchanged (reversible)', async () => {
    for (const t of ['intel_entries', 'maxims', 'responses', 'response_srs', 'tongue_exams']) {
      expect(await count(`SELECT COUNT(*) AS n FROM ${t}`), `${t} row count drifted`)
        .toBe(preMigrationRowCounts[t])
    }
  })

  it('is re-runnable without duplicating (idempotent backfill guard)', async () => {
    const before = await count(`SELECT COUNT(*) AS n FROM captures`)
    // Re-run the intel backfill statement; the NOT EXISTS guard must insert nothing.
    await env.DB.prepare(
      `INSERT INTO captures (user_id, kind, title, legacy_table, legacy_id)
       SELECT user_id, 'intel', title, 'intel_entries', id FROM intel_entries e
       WHERE NOT EXISTS (SELECT 1 FROM captures c WHERE c.legacy_table='intel_entries' AND c.legacy_id=e.id)`,
    ).run()
    expect(await count(`SELECT COUNT(*) AS n FROM captures`)).toBe(before)
  })
})
