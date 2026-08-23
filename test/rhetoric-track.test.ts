import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

// Book 11 — the Farnsworth programme as a TRACK, not a pile of cards.
// 11.1  Nineteen chapters in three parts, concealing roughly thirty to thirty-five
//       figures; Part I acts on words, Part II on sentences, Part III on the listener,
//       and the root node is that every figure is controlled repetition or controlled absence.
// 11.2  The exact day ranges, Day 53 calibration through Day 204.
// 11.7  Every figure record carries BOTH FACES — legitimate use and manipulative
//       misuse — plus the inbound detection question and the overuse tells.
// Migrations 0024 (schema), 0025 (syllabus/anchors/sources), 0026 (figure records).

describe('migration 0024 — the rhetoric track schema', () => {
  it('creates every table Book 11 and Book 12 require', async () => {
    const rows = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
    ).all<{ name: string }>()
    const names = new Set(rows.results.map((r) => r.name))
    for (const table of [
      'rhetoric_phases', 'rhetoric_chapters', 'rhetoric_milestones', 'figures',
      'figure_own_examples', 'specimens', 'commonplace_log', 'cycle_days',
      'copia_sessions', 'copia_renderings', 'deployments', 'deployment_pivots',
      'canon_maps', 'rhetoric_attempts', 'figure_detections', 'inbound_cards',
      'outbound_cards', 'response_intents', 'response_builds', 'recordings',
      'book_page_refs', 'rhetoric_cards', 'rhetoric_card_reviews',
      'book_chapter_anchors',
    ]) {
      expect(names.has(table), `missing table ${table}`).toBe(true)
    }
  })

  it('keeps the commonplace book out of the database — Book 11.8 and Law 22', async () => {
    const cols = await env.DB.prepare(`PRAGMA table_info(commonplace_log)`).all<{ name: string }>()
    const names = cols.results.map((c) => c.name)
    // The app logs THAT he copied and WHEN. It never stores the passage itself.
    expect(names).not.toContain('text')
    expect(names).toContain('copied_on')
    expect(names).toContain('page_of_book')
  })

  it('references recordings as files rather than managing media — Book 11.8', async () => {
    const cols = await env.DB.prepare(`PRAGMA table_info(recordings)`).all<{ name: string }>()
    expect(cols.results.map((c) => c.name)).toContain('file_reference')
  })
})

describe('migration 0025 — the syllabus is the book, in order', () => {
  it('seeds all nineteen chapters with Book 11.2 day ranges', async () => {
    const rows = await env.DB.prepare(
      `SELECT id, part, title, figure_slug, day_from, day_to FROM rhetoric_chapters ORDER BY id`,
    ).all<{ id: number; part: number; title: string; figure_slug: string; day_from: number; day_to: number }>()
    expect(rows.results).toHaveLength(19)
    // The exact spine of Book 11.2, at both ends and at both seams.
    expect(rows.results[0]).toMatchObject({ id: 1, part: 1, figure_slug: 'epizeuxis', day_from: 54, day_to: 60 })
    expect(rows.results[5]).toMatchObject({ id: 6, part: 1, figure_slug: 'polyptoton', day_from: 89, day_to: 95 })
    expect(rows.results[6]).toMatchObject({ id: 7, part: 2, figure_slug: 'isocolon', day_from: 98, day_to: 104 })
    expect(rows.results[11]).toMatchObject({ id: 12, part: 2, figure_slug: 'ellipsis', day_from: 133, day_to: 139 })
    expect(rows.results[12]).toMatchObject({ id: 13, part: 3, figure_slug: 'praeteritio', day_from: 142, day_to: 148 })
    expect(rows.results[18]).toMatchObject({ id: 19, part: 3, figure_slug: 'prolepsis', day_from: 184, day_to: 190 })
  })

  it('gives every chapter a seven-day cycle', async () => {
    const rows = await env.DB.prepare(
      `SELECT id, day_to - day_from AS span FROM rhetoric_chapters`,
    ).all<{ id: number; span: number }>()
    for (const r of rows.results) expect(r.span, `chapter ${r.id}`).toBe(6)
  })

  it('makes the days between chapters into rows, so no day reads as empty', async () => {
    const rows = await env.DB.prepare(
      `SELECT slug, day_from, day_to FROM rhetoric_milestones ORDER BY day_from`,
    ).all<{ slug: string; day_from: number; day_to: number }>()
    expect(rows.results.map((r) => [r.slug, r.day_from, r.day_to])).toEqual([
      ['consolidation_a', 96, 97],
      ['consolidation_b', 140, 141],
      ['consolidation_c', 191, 192],
      ['phase_4_consolidation', 193, 197],
      ['phase_5_transfer', 198, 204],
    ])
  })

  it('covers Day 54 through Day 204 with no gap and no overlap', async () => {
    const rows = await env.DB.prepare(
      `SELECT day_from, day_to FROM rhetoric_chapters
       UNION ALL SELECT day_from, day_to FROM rhetoric_milestones
       ORDER BY day_from`,
    ).all<{ day_from: number; day_to: number }>()
    let cursor = 53 // Day 53 is P0 calibration and belongs to no chapter.
    for (const r of rows.results) {
      expect(r.day_from, `gap or overlap before day ${r.day_from}`).toBe(cursor + 1)
      cursor = r.day_to
    }
    expect(cursor).toBe(204)
  })

  it('records only page anchors that were actually read, and fabricates none', async () => {
    const total = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM book_chapter_anchors`,
    ).first<{ n: number }>()
    // Eight confirmed anchors. The other seventeen chapter openings are absent on
    // purpose: inventing them would have been one INSERT away and is what the Laws forbid.
    expect(total?.n).toBe(8)
    const openings = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM book_chapter_anchors WHERE is_opening=1`,
    ).first<{ n: number }>()
    expect(openings?.n).toBe(2)
  })

  it('marks the Farnsworth books as in copyright and creates no edition rows', async () => {
    const rows = await env.DB.prepare(
      `SELECT id, notes FROM sources WHERE id IN ('classical_english_rhetoric','classical_english_argument')`,
    ).all<{ id: string; notes: string }>()
    expect(rows.results).toHaveLength(2)
    for (const r of rows.results) expect(r.notes).toMatch(/IN COPYRIGHT/)
    // source_editions.translation_status has no honest value for an in-copyright book.
    const editions = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM source_editions
       WHERE source_id IN ('classical_english_rhetoric','classical_english_argument')`,
    ).first<{ n: number }>()
    expect(editions?.n).toBe(0)
  })
})

describe('migration 0026 — figure records, both faces in the same row', () => {
  it('seeds twenty-two figures across the three parts', async () => {
    const rows = await env.DB.prepare(
      `SELECT part, COUNT(*) AS n FROM figures GROUP BY part ORDER BY part`,
    ).all<{ part: number; n: number }>()
    expect(rows.results).toEqual([
      { part: 1, n: 9 },  // six chapter figures plus the three Chapter 1 conceals
      { part: 2, n: 6 },
      { part: 3, n: 7 },
    ])
  })

  it('names at least thirty devices once sub_variants are counted — Book 11.1', async () => {
    const rows = await env.DB.prepare(`SELECT slug, sub_variants FROM figures`).all<{ slug: string; sub_variants: string }>()
    const extra = new Set<string>()
    for (const r of rows.results) {
      for (const piece of (r.sub_variants ?? '').split(';')) {
        const name = piece.trim().split(/[\s(]/)[0].toLowerCase()
        if (name) extra.add(name)
      }
    }
    const named = new Set([...rows.results.map((r) => r.slug), ...extra])
    // Book 11.1: nineteen chapters concealing roughly thirty to thirty-five figures.
    expect(named.size).toBeGreaterThanOrEqual(30)
  })

  it('carries every chapter figure, matching the syllabus slugs exactly', async () => {
    const missing = await env.DB.prepare(
      `SELECT c.id, c.figure_slug FROM rhetoric_chapters c
       LEFT JOIN figures f ON f.slug = c.figure_slug
       WHERE f.slug IS NULL`,
    ).all<{ id: number; figure_slug: string }>()
    expect(missing.results).toEqual([])
  })

  it('gives every figure both faces, a detection question and its overuse tells', async () => {
    const rows = await env.DB.prepare(
      `SELECT slug, legitimate_use, manipulative_misuse, detection_question, overuse_tells,
              conversational_job, mechanism, hidden_layer
       FROM figures`,
    ).all<Record<string, string>>()
    expect(rows.results).toHaveLength(22)
    for (const r of rows.results) {
      for (const field of [
        'legitimate_use', 'manipulative_misuse', 'detection_question',
        'overuse_tells', 'conversational_job', 'mechanism', 'hidden_layer',
      ]) {
        expect((r[field] ?? '').length, `${r.slug}.${field}`).toBeGreaterThan(20)
      }
      // Book 11.7: the misuse boundary lives in the SAME record, never a separate table.
      expect(r.legitimate_use).not.toBe(r.manipulative_misuse)
    }
  })

  it('points related and stackable figures at figures that exist', async () => {
    const rows = await env.DB.prepare(
      `SELECT slug, related_figures, stackable_with FROM figures`,
    ).all<{ slug: string; related_figures: string; stackable_with: string }>()
    const known = new Set(rows.results.map((r) => r.slug))
    // sub_variants may name devices without records; related/stackable may not.
    const orphans: string[] = []
    for (const r of rows.results) {
      for (const list of [r.related_figures, r.stackable_with]) {
        for (const ref of (list ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
          if (!known.has(ref) && !EXPECTED_SUB_VARIANT_REFS.has(ref)) orphans.push(`${r.slug} -> ${ref}`)
        }
      }
    }
    expect(orphans).toEqual([])
  })

  it('assigns each chapter figure to its own chapter', async () => {
    const wrong = await env.DB.prepare(
      `SELECT f.slug, f.chapter_id, c.id AS expected FROM figures f
       JOIN rhetoric_chapters c ON c.figure_slug = f.slug
       WHERE f.chapter_id IS NOT c.id`,
    ).all<{ slug: string }>()
    expect(wrong.results).toEqual([])
  })

  it('files the three concealed Chapter 1 devices under Chapter 1', async () => {
    const rows = await env.DB.prepare(
      `SELECT slug FROM figures WHERE chapter_id = 1 ORDER BY slug`,
    ).all<{ slug: string }>()
    expect(rows.results.map((r) => r.slug)).toEqual([
      'conduplicatio', 'diacope', 'epimone', 'epizeuxis',
    ])
  })
})

// Devices named in related_figures/stackable_with that are deliberately sub-variants
// rather than chapter figures: they live inside another record's hidden layer.
const EXPECTED_SUB_VARIANT_REFS = new Set([
  'antanaclasis', 'antimetabole', 'epanalepsis', 'gradatio', 'homoioteleuton',
  'hyperbaton', 'meiosis', 'epiplexis', 'anacoenosis', 'zeugma', 'brachylogia',
  'tricolon',
])
