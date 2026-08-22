import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import {
  lowestOfComponents, jiangFramingIsStruck, bothColumns, CONTRADICTION_QUESTION,
} from '../src/principles'

// Book 10.6 — concepts taught with RANGE, the Five Factors corrected against their
// common distortions, 將 scored on the lowest of five and never redirected outward, and
// the Chapter II oversimplification struck.
// Book 10.7 — Machiavelli framed with context, analogy, where the analogy breaks, cost
// and boundary; never universalised into romance, friendship or family.
// Book 10.8 — Greene only as UNREAD, defensive-recognition hypotheses, not examinable.
// Book 10.9 — the immune table always returns both columns and the cost of staying naive.
// Book 10.10 — a cross-book graph with contradiction edges that force the real question.

const baseEnv = {
  DB: env.DB, OPENAI_API_KEY: '', OPENAI_BASE_URL: 'https://model.invalid',
  OPENAI_ALLOWED_BASE_URLS: 'https://model.invalid',
}
async function passwordHash(pw: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256)
  return [...new Uint8Array(bits)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
async function login(): Promise<{ cookie: string; csrf: string }> {
  const salt = '13131313242424243535353546464646'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0, locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash('principles-pw', salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'principles-pw' }),
  }, baseEnv)
  expect(res.status).toBe(200)
  const cookie = res.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await res.json<{ csrfToken: string }>()
  return { cookie, csrf: csrfToken }
}
function get(path: string, s: { cookie: string }) {
  return app.request(path, { headers: { Cookie: s.cookie } }, baseEnv)
}
function post(path: string, s: { cookie: string; csrf: string }, body: unknown) {
  return app.request(path, {
    method: 'POST', headers: { Cookie: s.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf },
    body: JSON.stringify(body),
  }, baseEnv)
}

describe('B10.6 the Five Factors, with range and their corrections', () => {
  it('teaches each factor with a translation range, not a slogan', async () => {
    const s = await login()
    for (const slug of ['sunzi_dao', 'sunzi_tian', 'sunzi_di', 'sunzi_jiang', 'sunzi_fa']) {
      const res = await get(`/api/concepts/${slug}`, s)
      expect(res.status, slug).toBe(200)
      const c = await res.json<any>()
      // A range, not one word.
      expect(c.translation_range.split(';').length, `${slug} needs a range`).toBeGreaterThan(1)
      expect(c.original_term, `${slug} carries its original term`).toBeTruthy()
      for (const field of ['historical_meaning', 'modern_interpretation', 'misuse', 'defensive_lesson', 'reversal_condition']) {
        expect(String(c[field]).length, `${slug}.${field}`).toBeGreaterThan(20)
      }
    }
  })

  it('names the specific distortion Book 10.6 corrects for each factor', async () => {
    const s = await login()
    const dao = await (await get('/api/concepts/sunzi_dao', s)).json<any>()
    expect(dao.misuse).toMatch(/why/i)                       // not a simplistic "why"
    const tian = await (await get('/api/concepts/sunzi_tian', s)).json<any>()
    expect(tian.misuse).toMatch(/luck/i)                     // not luck
    const di = await (await get('/api/concepts/sunzi_di', s)).json<any>()
    expect(di.misuse).toMatch(/geography/i)                  // not geography alone
    const fa = await (await get('/api/concepts/sunzi_fa', s)).json<any>()
    expect(fa.defensive_lesson).toMatch(/supply|sleep|cash|isolation|calendar/i)
  })

  it('scores 將 on the lowest of the five virtues, and says which one', async () => {
    const s = await login()
    const jiang = await (await get('/api/concepts/sunzi_jiang', s)).json<any>()
    expect(jiang.components.length, 'the five virtues').toBe(5)
    expect(jiang.components.map((x: any) => x.original_term)).toEqual(['智', '信', '仁', '勇', '嚴'])
    expect(jiang.scoredOnWeakest).toBe(true)
    expect(jiang.scoreRuleNote).toContain('vices')

    // Four excellent virtues and one absent gives the absent one, not the average.
    const scored = await post('/api/concepts/sunzi_jiang/score', s, {
      scores: [{ score: 3 }, { score: 3 }, { score: 3 }, { score: 3 }, { score: 1 }],
    })
    const result = await scored.json<any>()
    expect(result.score, 'the lowest of the five is the real level').toBe(1)
    expect(result.weakest).toBe('Strictness')
    expect(result.mean).toBeGreaterThan(result.score)
    expect(result.note).toContain('would have hidden it')

    // The pure function agrees.
    expect(lowestOfComponents([
      { title: 'Wisdom', score: 3 }, { title: 'Courage', score: 0 },
    ])).toEqual({ score: 0, weakest: 'Courage', mean: 1.5 })
    expect(lowestOfComponents([]).score).toBeNull()
  })

  it('strikes any framing that redirects 將 outward', async () => {
    const s = await login()
    const struck = await post('/api/concepts/jiang/check-framing', s, {
      text: 'Build an inventory of their emotional fault lines so you can lead them.',
    })
    const body = await struck.json<any>()
    expect(body.struck).toBe(true)
    expect(body.reason).toContain('the commander is himself')

    const fine = await post('/api/concepts/jiang/check-framing', s, {
      text: 'Audit yourself on wisdom, reliability, benevolence, courage and strictness.',
    })
    expect((await fine.json<any>()).struck).toBe(false)

    // The guard catches the shapes 10.6 names, and leaves honest teaching alone.
    expect(jiangFramingIsStruck('map their insecurities and use them')).toBe(true)
    expect(jiangFramingIsStruck('exploit their fear of exclusion')).toBe(true)
    expect(jiangFramingIsStruck('the commander is scored on the lowest of the five')).toBe(false)
  })

  it('strikes the Chapter II oversimplification explicitly', async () => {
    const s = await login()
    const ch2 = await (await get('/api/concepts/sunzi_ch2_cost_of_delay', s)).json<any>()
    expect(ch2.misuse).toContain('quick imperfect action')
    expect(ch2.misuse).toMatch(/struck/i)
    expect(ch2.modern_interpretation).toContain('prepare carefully BEFORE commitment')
    expect(ch2.modern_interpretation).toContain('prolongation')
  })
})

describe('B10.9 the immune table returns both columns', () => {
  it('never returns a master reading without its naive twin and the cost', async () => {
    const s = await login()
    const rows = await (await get('/api/principles', s)).json<any[]>()
    expect(rows.length, 'seeded from what he has actually read').toBeGreaterThanOrEqual(14)
    for (const row of rows) {
      for (const key of ['naive', 'master', 'costOfNaive', 'detectionTells', 'inversionTrap', 'lessObviousApplication', 'stopTest']) {
        expect(String(row[key]).length, `${row.slug}.${key}`).toBeGreaterThan(15)
      }
      // The shaping function cannot emit master alone.
      expect(row).toHaveProperty('naive')
    }
    // Spot-check the ones 10.9 names verbatim.
    const bySlug = new Map(rows.map((r) => [r.slug, r]))
    expect(bySlug.get('deception_controlled_revelation')!.master).toMatch(/habitual liar becomes a pattern/i)
    expect(bySlug.get('subdue_without_fighting')!.master).toMatch(/positioning/i)
    expect(bySlug.get('know_the_enemy_self_audit')!.master).toMatch(/yourself first/i)
    expect(bySlug.get('winning_first')!.master).toMatch(/before the engagement/i)
    expect(bySlug.get('formlessness')!.master).toMatch(/fixed.*tactics adapt/i)
    expect(bySlug.get('speed_and_long_wars')!.master).toMatch(/long wars destroy the winner/i)
    expect(bySlug.get('not_moving_while_hot')!.master).toMatch(/anger passes and sent messages do not/i)
    expect(bySlug.get('foreknowledge')!.master).toMatch(/one step ahead/i)
    expect(bySlug.get('feared_not_hated')!.master).toMatch(/money, loved ones, or dignity/i)
    expect(bySlug.get('never_rent_the_core')!.master).toMatch(/mercenar/i)
    // bothColumns() is the only shape used.
    const shaped = bothColumns({
      slug: 'x', title: 't', naive_reading: 'n', master_reading: 'm', detection_tells: 'd',
      inversion_trap: 'i', less_obvious_application: 'l', stop_test: 's', cost_of_naive: 'c',
    })
    expect(Object.keys(shaped).sort()).toEqual([
      'costOfNaive', 'detectionTells', 'inversionTrap', 'lessObviousApplication',
      'master', 'naive', 'stopTest', 'title',
    ])
  })
})

describe('B10.7 Machiavelli is framed, never universalised', () => {
  it('carries all five framing fields and refuses to universalise into intimacy', async () => {
    const s = await login()
    for (const slug of ['appearance_is_terrain', 'feared_not_hated', 'fox_and_lion',
      'effectual_truth', 'fortune_and_dikes', 'never_rent_the_core']) {
      const p = await (await get(`/api/principles/${slug}`, s)).json<any>()
      expect(p.framing, `${slug} needs its framing`).toBeTruthy()
      for (const key of ['rulerStateContext', 'civilianAnalogy', 'analogyBreaksWhere', 'longTermCost', 'legalEthicalBoundary']) {
        expect(String(p.framing[key]).length, `${slug}.${key}`).toBeGreaterThan(10)
      }
      expect(p.framing.doNotUniversalise).toBe(true)
      expect(p.framing.note).toContain('never as a permission slip')
    }
    // Where the analogy breaks is stated in the terms 10.7 forbids universalising.
    const feared = await (await get('/api/principles/feared_not_hated', s)).json<any>()
    expect(feared.framing.analogyBreaksWhere).toMatch(/intimacy|friendship|family/i)
  })
})

describe('B10.8 Greene is a catalogue of hypotheses, not a syllabus', () => {
  it('is UNREAD, defensive-only, and not examinable — enforced by the schema', async () => {
    const s = await login()
    const body = await (await get('/api/hypotheses', s)).json<any>()
    expect(body.hypotheses.length).toBeGreaterThan(0)
    for (const h of body.hypotheses) {
      expect(h.read_status).toBe('UNREAD')
      expect(h.examinable).toBe(false)
      expect(h.defensive_only).toBe(true)
      for (const key of ['claim', 'mechanism', 'assumptions', 'possible_application', 'reversal',
        'failure_condition', 'defensive_signs', 'proportional_defence', 'evidence_quality',
        'long_term_consequence']) {
        expect(String(h[key]).length, `${h.slug}.${key}`).toBeGreaterThan(10)
      }
      expect(h.evidence_quality).toMatch(/anecdotal|not a scientific/i)
    }
    expect(body.note).toContain('Not scientific law')
    expect(body.note).toContain('may not examine')

    // The schema itself refuses to make one examinable.
    let refused = false
    try {
      await env.DB.prepare(
        `INSERT INTO hypotheses
           (slug, claim, mechanism, assumptions, possible_application, reversal,
            failure_condition, defensive_signs, proportional_defence, evidence_quality,
            long_term_consequence, examinable)
         VALUES ('probe','c','m','a','p','r','f','d','pd','eq','lt',1)`,
      ).run()
    } catch (e: any) { refused = /CHECK|constraint/i.test(String(e?.message || e)) }
    expect(refused, 'a hypothesis cannot be made examinable').toBe(true)
  })
})

describe('B10.10 the cross-book graph', () => {
  it('holds the named nodes, with strong and corrupt use for ethos/logos/pathos', async () => {
    const s = await login()
    const graph = await (await get('/api/graph', s)).json<any>()
    const slugs = new Set(graph.nodes.map((n: any) => n.slug))
    for (const node of ['preparation', 'legitimacy', 'alignment', 'timing', 'terrain', 'logistics',
      'discipline', 'information', 'uncertainty', 'deception', 'privacy', 'reputation',
      'incentives', 'alliances', 'dependence', 'options', 'alternatives', 'commitment',
      'withdrawal', 'escalation', 'adaptation', 'emotional_regulation', 'rhetoric',
      'persuasion', 'evidence', 'trust', 'boundaries', 'leadership', 'institutions',
      'fortune', 'reversibility', 'ethos', 'logos', 'pathos']) {
      expect(slugs.has(node), `graph node ${node}`).toBe(true)
    }
    for (const appeal of ['ethos', 'logos', 'pathos']) {
      const n = graph.nodes.find((x: any) => x.slug === appeal)
      expect(String(n.strong_use).length, `${appeal}.strong_use`).toBeGreaterThan(20)
      expect(String(n.corrupt_use).length, `${appeal}.corrupt_use`).toBeGreaterThan(20)
    }
  })

  it('is a cross-book graph: principles from different sources meet at the same node', async () => {
    const s = await login()
    const graph = await (await get('/api/graph', s)).json<any>()
    const info = graph.edges.filter((e: any) => e.to_id === 'information' && e.kind === 'supports')
    expect(info.length, 'more than one source reaches Information').toBeGreaterThan(1)
    // And a section anchor is the shared identifier.
    expect(graph.edges.some((e: any) => e.kind === 'anchors' && e.to_type === 'section')).toBe(true)
  })

  it('shows where authors disagree and forces the real question', async () => {
    const s = await login()
    const graph = await (await get('/api/graph', s)).json<any>()
    expect(graph.contradictions.length, 'contradiction edges exist').toBeGreaterThanOrEqual(3)
    for (const contradiction of graph.contradictions) {
      expect(contradiction.question).toBe(CONTRADICTION_QUESTION)
      expect(String(contradiction.note).length, 'a contradiction states what selects one over the other')
        .toBeGreaterThan(40)
      expect(contradiction.note).toMatch(/what selects/i)
    }
    // The per-principle view carries them too.
    const speed = await (await get('/api/principles/speed_and_long_wars', s)).json<any>()
    expect(speed.contradictions.length).toBeGreaterThan(0)
    expect(speed.contradictions[0].question).toBe(CONTRADICTION_QUESTION)
  })
})
