import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { apply, migrationPaths, migrationSql } from './setup'

// Book 17 test matrix, Migrations rows: "clean install, upgrade from current schema,
// records preserved, ownership backfilled."
//
// Three of the four were already covered, and covered well:
//
//   * UPGRADE FROM CURRENT SCHEMA is what test/setup.ts performs before every server test —
//     0001-0004, then twenty-three populated legacy tables, then 0005-0029 applied on top of
//     real rows. Every one of the server test files exercises it.
//   * RECORDS PRESERVED is the preMigrationRowCounts loop in test/migration-0005 through
//     -0008: counts taken before 0005 and re-checked after the whole chain has run.
//   * OWNERSHIP BACKFILLED is test/session-ownership.test.ts, which derives every table
//     carrying a user_id from sqlite_master, floors the derived set, and refuses any row
//     that is not the durable owner's.
//
// CLEAN INSTALL had nothing at all. Every server test begins from a database that was
// populated at 0004, so no test had ever applied these migrations to an EMPTY database —
// and the two paths are not interchangeable. A migration whose ALTER or backfill only runs
// when a legacy row exists leaves a DIFFERENT SCHEMA behind on a fresh install than on an
// upgrade, and nothing would say so: the upgrade path is the one under test, the fresh path
// is the one a new deployment or a reset local database actually takes, and the divergence
// surfaces as a missing column at runtime rather than as a failing test.
//
// So this file measures BOTH paths and requires them to converge. The assertion that earns
// its keep is not "the migrations ran" — it is "the schema a fresh install produces is the
// schema the upgrade produces".
//
// It is deliberately the only file that drops the database. Storage in this pool is isolated
// per FILE, not per test — measured, not assumed: a table dropped in one test was still gone
// in the next test of the same file, while every file re-applies the full chain in its own
// storage without colliding. That is precisely why this cannot be folded into an existing
// file, and why it is safe as its own.

type Schema = {
  tables: string[]
  columns: Record<string, string[]>
  triggers: Record<string, string>
}

/**
 * The live schema, read from sqlite_master and pragma_table_info.
 *
 * Column entries carry type, NOT NULL and default as well as the name, because a column
 * that exists on both paths with a different default is the same class of defect as one
 * that is missing outright — and a name-only comparison would call it clean.
 */
async function snapshot(): Promise<Schema> {
  const rows = (await env.DB.prepare(
    `SELECT type, name, sql FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`,
  ).all()).results as Array<{ type: string; name: string; sql: string | null }>

  const tables = rows.filter((r) => r.type === 'table').map((r) => r.name).sort()
  const columns: Record<string, string[]> = {}
  for (const table of tables) {
    const info = (await env.DB.prepare(`PRAGMA table_info(${table})`).all()).results as Array<
      { name: string; type: string; notnull: number; dflt_value: string | null }
    >
    // Sorted by name: column ORDER can differ between two honest construction paths and is
    // not something this app depends on, so ordering drift is not reported as a defect.
    columns[table] = info
      .map((c) => `${c.name} ${c.type} notnull=${c.notnull} default=${c.dflt_value ?? 'NULL'}`)
      .sort()
  }
  const triggers: Record<string, string> = {}
  for (const row of rows.filter((r) => r.type === 'trigger')) {
    triggers[row.name] = (row.sql ?? '').split(/\s+/).join(' ').trim()
  }
  return { tables, columns, triggers }
}

/** Empty the database. Repeated passes so foreign-key order does not have to be computed. */
async function dropEverything(): Promise<void> {
  for (let pass = 0; pass < 12; pass++) {
    const rows = (await env.DB.prepare(
      `SELECT type, name FROM sqlite_master
       WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`,
    ).all()).results as Array<{ type: string; name: string }>
    if (rows.length === 0) return
    let dropped = 0
    for (const { type, name } of rows) {
      try {
        await env.DB.prepare(`DROP ${type === 'view' ? 'VIEW' : 'TABLE'} IF EXISTS "${name}"`).run()
        dropped++
      } catch {
        // A dependency still points at it; a later pass takes it.
      }
    }
    if (dropped === 0) break
  }
  const left = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM sqlite_master
     WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`,
  ).first<{ n: number }>()
  if ((left?.n ?? 0) > 0) {
    throw new Error(`could not empty the database: ${left?.n} tables remain, so the clean `
      + 'install below would have been applied on top of an existing schema and proved nothing')
  }
}

let upgraded: Schema
let fresh: Schema
let tablesAfterDrop = -1
const applyFailures: string[] = []

beforeAll(async () => {
  // The upgrade path, as test/setup.ts left it.
  upgraded = await snapshot()
  // The clean path.
  await dropEverything()
  // Measured here rather than trusted from inside the helper. The emptiness guard at the end
  // of dropEverything() only runs if dropEverything() ran: an early return skips the work and
  // the guard together. Measured, not assumed — neutering that function to an immediate
  // `return` made this file report "7 migrations failed against an EMPTY database" and
  // "27 tables carry rows", which reads like a schema defect when the real problem was that
  // nothing had been dropped. A check that can only fire when the code it checks ran is not
  // a check, so the count is taken from the database itself, at the call site.
  tablesAfterDrop = (await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM sqlite_master
     WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`,
  ).first<{ n: number }>())?.n ?? -1
  for (const path of migrationPaths) {
    try {
      await apply(migrationSql(path))
    } catch (e: any) {
      applyFailures.push(`${path.split('/').pop()}: ${String(e?.message ?? e).slice(0, 240)}`)
    }
  }
  fresh = await snapshot()
})

describe('B17 migrations: a clean install and an upgrade reach the same schema', () => {
  it('measured both paths, so a broken measurement fails loudly instead of passing', () => {
    expect(migrationPaths.length, 'the migration glob came back empty').toBeGreaterThanOrEqual(29)
    expect(upgraded.tables.length, 'the upgrade-path snapshot came back empty').toBeGreaterThanOrEqual(60)
    expect(fresh.tables.length, 'the clean-install snapshot came back empty').toBeGreaterThanOrEqual(60)
    expect(
      Object.keys(upgraded.triggers).length,
      'no triggers found on the upgrade path, so the trigger comparison below is inert',
    ).toBeGreaterThan(0)
    expect(
      tablesAfterDrop,
      'the database still held tables when the clean install began, so every comparison in '
      + 'this file measured migrations applied ON TOP OF an existing schema and the words '
      + '"clean install" in the failures below are false',
    ).toBe(0)
  })

  it('every migration applies to an empty database, in filename order', () => {
    // The operator handoff tells a human to apply these in filename order to a database
    // that may be fresh. If one of them only works when a legacy row is already there, this
    // is where it says so, and it names the file rather than failing somewhere downstream.
    expect(applyFailures, 'these migrations failed against an EMPTY database').toEqual([])
  })

  it('produces the same set of tables either way', () => {
    const missing = upgraded.tables.filter((t) => !fresh.tables.includes(t))
    const extra = fresh.tables.filter((t) => !upgraded.tables.includes(t))
    expect(
      missing,
      'a fresh install does not create these tables, though an upgrade does — a new '
      + 'deployment would hit "no such table" at runtime',
    ).toEqual([])
    expect(
      extra,
      'a fresh install creates these tables and an upgrade does not, so existing '
      + 'installations are missing them',
    ).toEqual([])
  })

  it('produces the same columns in every shared table', () => {
    const drift: string[] = []
    for (const table of upgraded.tables) {
      if (!fresh.tables.includes(table)) continue
      const before = upgraded.columns[table] ?? []
      const after = fresh.columns[table] ?? []
      if (before.join(' | ') === after.join(' | ')) continue
      const missing = before.filter((c) => !after.includes(c))
      const extra = after.filter((c) => !before.includes(c))
      drift.push(
        `${table}: fresh install lacks [${missing.join('; ') || 'nothing'}]`
        + `${extra.length ? ` and adds [${extra.join('; ')}]` : ''}`,
      )
    }
    expect(
      drift,
      'the two paths disagree about these columns. A column present after an upgrade but '
      + 'not after a clean install (or with a different default) means the schema depends '
      + 'on data that happened to be there',
    ).toEqual([])
  })

  it('installs the same triggers, with the same bodies', () => {
    // The append-only journal is enforced by triggers, not by application code. A fresh
    // install missing one would accept deletions from the journal silently, which is the
    // single guarantee this app is least able to lose.
    const missing = Object.keys(upgraded.triggers).filter((t) => !(t in fresh.triggers))
    expect(
      missing,
      'a fresh install does not create these triggers, so the guarantees they enforce — '
      + 'append-only journals among them — would not exist on a new deployment',
    ).toEqual([])
    const changed = Object.keys(upgraded.triggers)
      .filter((t) => t in fresh.triggers && fresh.triggers[t] !== upgraded.triggers[t])
    expect(changed, 'these triggers have different bodies on the two paths').toEqual([])
  })

  it('leaves no row belonging to any user', async () => {
    // A clean install has no users yet. Any row carrying a user_id at this point was
    // written by a migration against a user that does not exist — which on a real fresh
    // deployment would silently attach seeded data to whoever registers first.
    const owned = fresh.tables.filter(
      (t) => (fresh.columns[t] ?? []).some((c) => c.startsWith('user_id ')),
    )
    expect(owned.length, 'no table carries a user_id, so this check is inert').toBeGreaterThanOrEqual(60)
    const populated: string[] = []
    for (const table of owned) {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM ${table} WHERE user_id IS NOT NULL`,
      ).first<{ n: number }>()
      if ((row?.n ?? 0) > 0) populated.push(`${table}: ${row?.n}`)
    }
    expect(
      populated,
      'a clean install seeded these rows against a user that does not exist yet',
    ).toEqual([])
  })
})
