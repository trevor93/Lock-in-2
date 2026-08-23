import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import responseLabSeed from '../migrations/0027_response_lab_seed.sql?raw'
import seedFile from '../seed.sql?raw'

// Book 11.4 — the specimen tier system, and the allocation the book REJECTS.
// Book 12.7 — eleven response intents, each an ARCHITECTURE rather than a line,
//             and the movie-villain starter lines deleted from the seed data.
// Migration 0027_response_lab_seed.sql.

describe('Book 11.4 — the specimen tiers, and what must not be reintroduced', () => {
  it('seeds Tier 3 for every chapter figure', async () => {
    const missing = await env.DB.prepare(
      `SELECT c.figure_slug FROM rhetoric_chapters c
       WHERE NOT EXISTS (
         SELECT 1 FROM specimens s WHERE s.figure_slug = c.figure_slug AND s.tier = 3
       )`,
    ).all<{ figure_slug: string }>()
    expect(missing.results).toEqual([])
  })

  it('leaves Tier 1 EMPTY, because Tier 1 is his and copied by hand', async () => {
    // Book 11.3 Day 2: Tier 1 is copied BY HAND. Book 11.4: six to eight per figure.
    // Shipping Tier 1 rows would hand him the bank the book says he must build.
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM specimens WHERE tier = 1`,
    ).first<{ n: number }>()
    expect(row?.n).toBe(0)
  })

  it('does not silently reintroduce the thousand-specimen allocation', async () => {
    // Book 11.4: "Memorising a thousand specimens verbatim was considered and
    // rejected... The application must not silently reintroduce it." A seeded bank
    // anywhere near a thousand rows IS that reintroduction, whatever the tier says.
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM specimens`).first<{ n: number }>()
    expect(row?.n).toBeLessThan(200)
  })

  it('gives every seeded specimen a real attribution and marks it public domain', async () => {
    const rows = await env.DB.prepare(
      `SELECT id, text, attribution, public_domain FROM specimens`,
    ).all<{ id: number; text: string; attribution: string; public_domain: number }>()
    expect(rows.results.length).toBeGreaterThan(0)
    for (const r of rows.results) {
      expect((r.attribution ?? '').length, `specimen ${r.id} attribution`).toBeGreaterThan(5)
      // Nothing in copyright is seeded. Where no author is claimed, the attribution
      // says so plainly rather than inventing one.
      expect(r.public_domain).toBe(1)
      expect(r.text.length).toBeGreaterThan(5)
    }
  })

  it('leaves page_ref NULL, because his page numbers are never committed', async () => {
    // Book 11.8: the app REFERENCES his copy, it does not absorb it. book_page_refs
    // is populated by the operator script on his own machine.
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM specimens WHERE page_ref IS NOT NULL`,
    ).first<{ n: number }>()
    expect(row?.n).toBe(0)
  })

  it('seeds no Farnsworth page filenames into the repository', async () => {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM book_page_refs`).first<{ n: number }>()
    expect(row?.n).toBe(0)
  })
})

describe('Book 12.7 — eleven intents, each an architecture', () => {
  it('seeds exactly the eleven intents Book 12.7 names', async () => {
    const rows = await env.DB.prepare(
      `SELECT slug, title FROM response_intents ORDER BY sort_order`,
    ).all<{ slug: string; title: string }>()
    expect(rows.results.map((r) => r.slug)).toEqual([
      'boundary', 'pressure', 'provocation', 'loaded_question', 'negotiation',
      'disagreement', 'clarify', 'repair', 'de_escalate', 'inspire', 'pause',
    ])
  })

  it('gives each intent an ordered architecture, not a line', async () => {
    const rows = await env.DB.prepare(
      `SELECT slug, architecture, when_to_use, logic FROM response_intents`,
    ).all<{ slug: string; architecture: string; when_to_use: string; logic: string }>()
    for (const r of rows.results) {
      // "the ordered moves" — an architecture has stages, so it has arrows.
      expect(r.architecture, `${r.slug} architecture`).toMatch(/->/)
      expect(r.architecture.split('->').length, `${r.slug} stages`).toBeGreaterThanOrEqual(3)
      // "give the logic of the line so it can be adapted" — the logic explains WHY
      // each move is there, which is what makes it adaptable instead of copyable.
      expect(r.logic.length, `${r.slug} logic`).toBeGreaterThan(200)
      expect(r.when_to_use.length, `${r.slug} when_to_use`).toBeGreaterThan(20)
    }
  })

  it('ships no example lines, because a line would be copied instead of built', async () => {
    const cols = await env.DB.prepare(`PRAGMA table_info(response_intents)`).all<{ name: string }>()
    const names = cols.results.map((c) => c.name)
    for (const forbidden of ['example', 'example_line', 'line', 'script']) {
      expect(names, `response_intents must not carry ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('numbers the intents contiguously from one', async () => {
    const rows = await env.DB.prepare(
      `SELECT sort_order FROM response_intents ORDER BY sort_order`,
    ).all<{ sort_order: number }>()
    expect(rows.results.map((r) => r.sort_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })
})

describe('Book 12.7 — the movie-villain starter lines are deleted', () => {
  const STARTERS = [
    {
      situation: 'Anyone pressing you to reveal your plans or opinion before you are ready',
      response: "I'll let the result answer that.",
    },
    {
      situation: 'Someone tries to provoke you publicly with an insult dressed as a joke',
      response: "You'd know if it did.",
    },
    {
      situation: 'Being asked to commit on the spot to something you have not examined',
      response: 'Let me give you an answer worth counting on — tomorrow.',
    },
  ]

  it('removes them from seed.sql, so a fresh install never gets them', () => {
    for (const s of STARTERS) {
      expect(seedFile, `seed.sql still seeds: ${s.response}`).not.toContain(s.response)
      expect(seedFile).not.toContain(s.situation)
    }
    // The armory table is no longer seeded at all.
    expect(seedFile).not.toMatch(/INSERT[^\n]*INTO responses/)
    expect(seedFile).not.toMatch(/INSERT[^\n]*INTO response_srs/)
  })

  it('archives rather than destroys them where they already exist', async () => {
    // "Never delete user data" governs: his review history on these rows is real.
    // archived=1 is the application's own delete path (src/routes/tongue.ts), and
    // every read path filters archived=0, so the app sees them as gone.
    const inserted: number[] = []
    for (const s of STARTERS) {
      const res = await env.DB.prepare(
        `INSERT INTO captures (kind, situation, response, archived, legacy_table)
         VALUES ('response', ?, ?, 0, 'test_0027') RETURNING id`,
      ).bind(s.situation, s.response).first<{ id: number }>()
      inserted.push(res!.id)
    }
    // A row he has edited into his own must survive the same sweep.
    const his = await env.DB.prepare(
      `INSERT INTO captures (kind, situation, response, archived, legacy_table)
       VALUES ('response', ?, ?, 0, 'test_0027') RETURNING id`,
    ).bind(STARTERS[0].situation, 'My own rewrite of this one.').first<{ id: number }>()

    // Re-run the migration's OWN archival statements against those rows, so the test
    // exercises the shipped SQL rather than a restatement of it.
    // Strip '--' comments BEFORE splitting on ';', exactly as test/setup.ts does:
    // a semicolon inside a comment would otherwise cut a statement in half.
    const archivalStatements = responseLabSeed
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((stmt) => stmt.trim())
      .filter((stmt) => /^UPDATE captures SET archived = 1/i.test(stmt))
    expect(archivalStatements.length, 'migration 0027 must archive the starter lines').toBe(3)
    for (const stmt of archivalStatements) await env.DB.prepare(stmt).run()

    const rows = await env.DB.prepare(
      `SELECT id, archived FROM captures WHERE legacy_table='test_0027' ORDER BY id`,
    ).all<{ id: number; archived: number }>()
    const byId = new Map(rows.results.map((r) => [r.id, r.archived]))
    for (const id of inserted) expect(byId.get(id), `capture ${id} should be archived`).toBe(1)
    expect(byId.get(his!.id), 'his own rewrite must survive').toBe(0)

    // Nothing was destroyed: every row is still present.
    expect(rows.results).toHaveLength(4)

    await env.DB.prepare(`DELETE FROM captures WHERE legacy_table='test_0027'`).run()
  })
})
