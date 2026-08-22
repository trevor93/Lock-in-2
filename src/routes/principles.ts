// Book 10.6 - 10.10 — the curriculum routes: concepts taught with range, the immune
// table that always returns both columns, Greene as defensive-only hypotheses, and the
// cross-book graph with its contradiction edges.
import { Hono } from 'hono'
import type { Bindings, Variables } from '../env'
import { parseValue } from '../validation'
import { slugParamSchema } from '../schemas'
import {
  bothColumns, lowestOfComponents, jiangFramingIsStruck, JIANG_STRUCK_REASON,
  CONTRADICTION_QUESTION, type ImmuneRow,
} from '../principles'

export function registerPrincipleRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {

// 10.9 — the immune table. Both columns, always, plus the cost of staying naive.
app.get('/api/principles', async (c) => {
  const rows = (await c.env.DB.prepare(
    `SELECT slug, title, source_id, anchor, naive_reading, master_reading, detection_tells,
            inversion_trap, less_obvious_application, stop_test, cost_of_naive
     FROM principles ORDER BY source_id, slug`,
  ).all()).results as unknown as Array<ImmuneRow & { source_id: string; anchor: string }>
  return c.json(rows.map((r) => ({
    slug: r.slug, source_id: r.source_id, anchor: r.anchor, ...bothColumns(r),
  })))
})

// One principle, with its Machiavelli framing when the source requires it (10.7) and
// its graph edges (10.10).
app.get('/api/principles/:slug', async (c) => {
  const DB = c.env.DB
  const slug = parseValue(slugParamSchema, c.req.param('slug'))
  const row = await DB.prepare(
    `SELECT slug, title, source_id, anchor, naive_reading, master_reading, detection_tells,
            inversion_trap, less_obvious_application, stop_test, cost_of_naive
     FROM principles WHERE slug=?`,
  ).bind(slug).first<any>()
  if (!row) return c.json({ error: 'no such principle' }, 404)

  const frame = await DB.prepare(
    `SELECT ruler_state_context, civilian_analogy, analogy_breaks_where, long_term_cost,
            legal_ethical_boundary, do_not_universalise
     FROM principle_frames WHERE principle_slug=?`,
  ).bind(slug).first<any>()

  const edges = (await DB.prepare(
    `SELECT to_type, to_id, kind, note FROM graph_edges
     WHERE from_type='principle' AND from_id=?
     UNION ALL
     SELECT from_type AS to_type, from_id AS to_id, kind, note FROM graph_edges
     WHERE to_type='principle' AND to_id=?`,
  ).bind(slug, slug).all()).results as any[]

  const contradictions = edges.filter((e) => e.kind === 'contradicts').map((e) => ({
    with: e.to_id, note: e.note, question: CONTRADICTION_QUESTION,
  }))
  return c.json({
    slug: row.slug, source_id: row.source_id, anchor: row.anchor,
    ...bothColumns(row),
    framing: frame ? {
      rulerStateContext: frame.ruler_state_context,
      civilianAnalogy: frame.civilian_analogy,
      analogyBreaksWhere: frame.analogy_breaks_where,
      longTermCost: frame.long_term_cost,
      legalEthicalBoundary: frame.legal_ethical_boundary,
      doNotUniversalise: !!frame.do_not_universalise,
      note: 'Taught as cold anthropology in Renaissance context, never as a permission slip (Book 10.7).',
    } : null,
    edges: edges.filter((e) => e.kind !== 'contradicts'),
    contradictions,
  })
})

// 10.6 — a concept, taught with its translation RANGE, its named misuse, and its parts.
// A compound concept scored on its weakest part says so, and says which part.
app.get('/api/concepts/:slug', async (c) => {
  const DB = c.env.DB
  const slug = parseValue(slugParamSchema, c.req.param('slug'))
  const concept = await DB.prepare(
    `SELECT slug, source_id, anchor, title, original_term, translation_range,
            historical_meaning, modern_interpretation, misuse, defensive_lesson,
            reversal_condition, score_rule
     FROM concepts WHERE slug=?`,
  ).bind(slug).first<any>()
  if (!concept) return c.json({ error: 'no such concept' }, 404)
  const components = (await DB.prepare(
    `SELECT original_term, title, meaning, misuse FROM concept_components
     WHERE concept_slug=? ORDER BY sort_order`,
  ).bind(slug).all()).results as any[]
  return c.json({
    ...concept,
    components,
    scoredOnWeakest: concept.score_rule === 'lowest_of_components',
    scoreRuleNote: concept.score_rule === 'lowest_of_components'
      ? 'Scored on the lowest of its parts: removing one turns the others into vices (Book 10.6).'
      : null,
  })
})

// 10.6 — score a compound concept from his own honest self-assessment of each part.
// This is a mirror, not a grade: it names the weakest virtue, which is the only
// actionable fact. (Mastery levels are still evidence-gated per Book 10.2.)
app.post('/api/concepts/:slug/score', async (c) => {
  const DB = c.env.DB
  const slug = parseValue(slugParamSchema, c.req.param('slug'))
  const body = await c.req.json().catch(() => null) as any
  const scores = Array.isArray(body?.scores) ? body.scores : null
  if (!scores) return c.json({ error: 'scores[] required, one per component' }, 400)
  const concept = await DB.prepare(
    `SELECT slug, score_rule FROM concepts WHERE slug=?`,
  ).bind(slug).first<any>()
  if (!concept) return c.json({ error: 'no such concept' }, 404)
  const components = (await DB.prepare(
    `SELECT title FROM concept_components WHERE concept_slug=? ORDER BY sort_order`,
  ).bind(slug).all()).results as Array<{ title: string }>
  const paired = components.map((comp, i) => ({
    title: comp.title,
    score: Number(scores[i]?.score ?? scores[i] ?? 0),
  }))
  const result = lowestOfComponents(paired)
  return c.json({
    slug,
    ...result,
    rule: concept.score_rule === 'lowest_of_components' ? 'lowest_of_components' : 'mean',
    note: concept.score_rule === 'lowest_of_components'
      ? `Your level here is ${result.score} — the lowest of the five, carried by ${result.weakest}. The mean (${result.mean}) would have hidden it.`
      : null,
  })
})

// 10.6 — the framing guard. Curriculum or model-authored teaching that redirects 將
// outward is struck rather than displayed.
app.post('/api/concepts/jiang/check-framing', async (c) => {
  const body = await c.req.json().catch(() => null) as any
  const text = String(body?.text ?? '')
  if (!text.trim()) return c.json({ error: 'text required' }, 400)
  const struck = jiangFramingIsStruck(text)
  return c.json({ struck, reason: struck ? JIANG_STRUCK_REASON : null })
})

// 10.8 — Greene, as hypotheses only: UNREAD, defensive recognition, not examinable.
app.get('/api/hypotheses', async (c) => {
  const rows = (await c.env.DB.prepare(
    `SELECT slug, source_id, claim, mechanism, assumptions, possible_application, reversal,
            failure_condition, defensive_signs, proportional_defence, evidence_quality,
            long_term_consequence, read_status, examinable, defensive_only
     FROM hypotheses ORDER BY slug`,
  ).all()).results as any[]
  return c.json({
    hypotheses: rows.map((r) => ({ ...r, examinable: !!r.examinable, defensive_only: !!r.defensive_only })),
    note: 'Presented only as a catalogue of hypotheses, historically illustrated, flagged UNREAD, '
      + 'and usable exclusively as a defensive recognition aid. Not scientific law, not universal '
      + 'commandment, not proof of human nature. Hermes may not examine on it (Book 10.8).',
  })
})

// 10.10 — the graph. Nodes are cross-book ideas; contradiction edges carry the question.
app.get('/api/graph', async (c) => {
  const DB = c.env.DB
  const nodes = (await DB.prepare(
    `SELECT slug, title, description, strong_use, corrupt_use FROM graph_nodes ORDER BY slug`,
  ).all()).results as any[]
  const edges = (await DB.prepare(
    `SELECT from_type, from_id, to_type, to_id, kind, note FROM graph_edges ORDER BY id`,
  ).all()).results as any[]
  return c.json({
    nodes,
    edges,
    contradictions: edges.filter((e) => e.kind === 'contradicts').map((e) => ({
      from: e.from_id, to: e.to_id, note: e.note, question: CONTRADICTION_QUESTION,
    })),
    note: 'A cross-book graph, not a per-author shelf. Contradiction edges exist so disagreement '
      + 'is visible and the real question can be forced (Book 10.10).',
  })
})
}
