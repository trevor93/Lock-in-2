import { describe, expect, it } from 'vitest'
import {
  CANON_SLOTS, CANON_PURPOSES, FIGURE_FIRST_REASON, canonMapComplete, TRIANGLE,
  EXERCISE_TYPES, DELIVERY_REGISTERS, THREE_VERSIONS,
  INBOUND_QUESTIONS, OUTBOUND_QUESTIONS, DAYLIGHT_TEST, outboundGate,
  PIVOT_RULES, DELIVERY_NOTATION, NEVER_LIST_SCOPE,
  DETECTION_IS_A_PROPOSAL, SOURCE_IS_THE_ROOM, antiObviousVerdict,
  RESPONSE_INTENTS, RESPONSE_LAYERS, NEVER_THE_LINE_ALONE,
  ASSESSMENT_CRITERIA, missingResponseLayers, criterionIsInverted,
} from '../src/rhetoric-lab'

// Book 12 — the Lab's rules, each of which is a gate rather than a topic.

describe('12.1 — the canon map runs before any figure is named', () => {
  it('has the six slots the book names', () => {
    expect(CANON_SLOTS.map((s) => s.slug)).toEqual([
      'purpose', 'audience', 'occasion', 'proof', 'arrangement', 'delivery',
    ])
  })

  it('lists the ten purposes', () => {
    expect([...CANON_PURPOSES]).toEqual([
      'inform', 'clarify', 'persuade', 'repair', 'decline', 'negotiate',
      'de-escalate', 'inspire', 'pause', 'challenge',
    ])
  })

  it('refuses a figure until all six slots are filled', () => {
    const full = {
      purpose: 'decline', audience: 'my manager', occasion: 'now, briefly',
      proof: 'the timeline', arrangement: 'reason then decline', delivery: 'flat, slow',
    }
    expect(canonMapComplete(full)).toEqual({ complete: true, missing: [], reason: null })

    const partial = { ...full, proof: '', arrangement: '   ' }
    const verdict = canonMapComplete(partial)
    expect(verdict.complete).toBe(false)
    expect(verdict.missing).toEqual(['proof', 'arrangement'])
    // The refusal explains itself: "Figure-first composition is how a student produces
    // ornamented nonsense."
    expect(verdict.reason).toBe(FIGURE_FIRST_REASON)
    expect(verdict.reason).toMatch(/ornamented nonsense/)
  })

  it('counts a missing slot as missing even when the key is absent entirely', () => {
    const verdict = canonMapComplete({ purpose: 'inform' })
    expect(verdict.missing).toEqual(['audience', 'occasion', 'proof', 'arrangement', 'delivery'])
  })

  it('teaches the triangle with both faces', () => {
    expect(TRIANGLE.map((t) => t.slug)).toEqual(['ethos', 'logos', 'pathos'])
    for (const leg of TRIANGLE) {
      expect(leg.honest.length, `${leg.slug} honest`).toBeGreaterThan(20)
      expect(leg.corrupted.length, `${leg.slug} corrupted`).toBeGreaterThan(15)
    }
    expect(TRIANGLE[1].corrupted).toMatch(/[Cc]herry-picking/)
    expect(TRIANGLE[2].corrupted).toMatch(/bypass judgment/)
  })
})

describe('12.2 — thirteen exercise types, the last one teaching rather than policing', () => {
  it('has thirteen types, numbered contiguously', () => {
    expect(EXERCISE_TYPES).toHaveLength(13)
    expect(EXERCISE_TYPES.map((e) => e.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
  })

  it('makes the thirteenth the one that teaches the anti-obvious rule as a skill', () => {
    const thirteenth = EXERCISE_TYPES[12]
    expect(thirteenth.slug).toBe('three_versions_and_diagnosis')
    expect(thirteenth.title).toMatch(/deliberately excessive/)
    expect(thirteenth.title).toMatch(/written diagnosis/)
    expect(thirteenth.teaches).toMatch(/SKILL instead of enforcing it as a validator/)
    // It is the only exercise carrying a teaching note, because it is the only one whose
    // purpose is not the exercise itself.
    expect(EXERCISE_TYPES.filter((e) => e.teaches !== null)).toHaveLength(1)
  })

  it('names the four delivery registers and the three versions', () => {
    expect([...DELIVERY_REGISTERS]).toEqual(['neutral', 'warm', 'firm', 'concise'])
    expect([...THREE_VERSIONS]).toEqual(['plain', 'controlled', 'excessive'])
  })
})

describe('12.3 / 12.4 — the two cards', () => {
  it('asks all nine inbound questions', () => {
    expect(INBOUND_QUESTIONS).toHaveLength(9)
    expect(INBOUND_QUESTIONS.map((q) => q.slug)).toEqual([
      'figure_used', 'emphasis', 'expectation', 'repetition', 'omission',
      'emotion', 'wanted_action', 'independent_support', 'survives_plainly',
    ])
    // The last two are the ones that do the defensive work.
    expect(INBOUND_QUESTIONS[8].question).toMatch(/survive being stated plainly/)
  })

  it('asks all four outbound questions and carries the Daylight Test', () => {
    expect(OUTBOUND_QUESTIONS).toHaveLength(4)
    expect(OUTBOUND_QUESTIONS.map((q) => q.slug)).toEqual([
      'overstates_certainty', 'hides_downside', 'pressures', 'defensible_if_quoted',
    ])
    expect(DAYLIGHT_TEST).toMatch(/every scripted exchange/)
  })

  it('blocks deployment until the red-team card is answered', () => {
    // 12.4: "mandatory before any draft is marked deployed"
    const unanswered = outboundGate({ overstates_certainty: false })
    expect(unanswered.deployable).toBe(false)
    expect(unanswered.unanswered).toEqual(['hides_downside', 'pressures', 'defensible_if_quoted'])
  })

  it('blocks deployment on any defect, and on failing the Daylight Test', () => {
    const clean = {
      overstates_certainty: false, hides_downside: false,
      pressures: false, defensible_if_quoted: true,
    }
    expect(outboundGate(clean).deployable).toBe(true)

    expect(outboundGate({ ...clean, pressures: true }).failed).toEqual(['pressures'])
    expect(outboundGate({ ...clean, hides_downside: true }).deployable).toBe(false)
    // The fourth question inverts: a NO is the failure there, not a yes.
    const daylight = outboundGate({ ...clean, defensible_if_quoted: false })
    expect(daylight.deployable).toBe(false)
    expect(daylight.failed).toEqual(['defensible_if_quoted'])
  })
})

describe('12.5 — the pivot table, the notation, and the never-list', () => {
  it('carries all four pivots, three of which say do less', () => {
    expect(PIVOT_RULES).toHaveLength(4)
    const byTrigger = new Map(PIVOT_RULES.map((p) => [p.trigger, p]))
    expect(byTrigger.get('they concede')!.execute).toBe('stop talking')
    expect(byTrigger.get('they escalate')!.execute)
      .toBe('slow the pace and ask one precise question')
    expect(byTrigger.get('they deflect')!.execute)
      .toBe('restate the request once and let the silence sit')
    for (const p of PIVOT_RULES) expect(p.why.length, p.trigger).toBeGreaterThan(30)
  })

  it('records the four pieces of delivery notation', () => {
    expect(DELIVERY_NOTATION.map((d) => d.slug)).toEqual([
      'pause_points', 'stressed_word', 'pace', 'where_to_stop',
    ])
  })

  it('bounds the never-list to his own leakage', () => {
    // The never-list is not permission to withhold material facts from someone
    // entitled to them, and the boundary is stored beside the definition.
    expect(NEVER_LIST_SCOPE.is).toMatch(/regardless of provocation/)
    expect(NEVER_LIST_SCOPE.is_not).toMatch(/not an instruction to conceal material facts/)
  })
})

describe('12.6 — detection proposes, and the anti-obvious rule', () => {
  it('keeps detection a proposal, with his correction as the training signal', () => {
    expect(DETECTION_IS_A_PROPOSAL).toMatch(/proposes tags/)
    expect(DETECTION_IS_A_PROPOSAL).toMatch(/training signal/)
    expect(DETECTION_IS_A_PROPOSAL).toMatch(/never written as fact/)
  })

  it('records the room, not the book', () => {
    expect(SOURCE_IS_THE_ROOM).toMatch(/the room, not the book/)
    expect(SOURCE_IS_THE_ROOM).toMatch(/not which/)
  })

  it('requires why_not_obvious on every saved line', () => {
    const rejected = antiObviousVerdict({
      text: 'I need the timeline before I can commit.',
      why_not_obvious: '',
    })
    expect(rejected.accepted).toBe(false)
    expect(rejected.reasons[0]).toMatch(/why_not_obvious is empty/)

    const tooShort = antiObviousVerdict({
      text: 'I need the timeline before I can commit.',
      why_not_obvious: 'it is good',
    })
    expect(tooShort.accepted).toBe(false)
    expect(tooShort.reasons[0]).toMatch(/too short/)
  })

  it('rejects a line that reads like a reel', () => {
    const reel = antiObviousVerdict({
      text: 'Never explain yourself. Let that sink in.',
      why_not_obvious: 'Because most people over-explain when they are challenged.',
    })
    expect(reel.accepted).toBe(false)
    expect(reel.reasons).toContain('If it reads like a reel, it is rejected.')
  })

  it('accepts a plain line from the room with a real answer', () => {
    const ok = antiObviousVerdict({
      text: 'I need the timeline before I can commit.',
      why_not_obvious: 'The obvious move was to agree and renegotiate later, which would have '
        + 'cost the trust that made the ask possible.',
      source: 'Standup, 14 Aug, with the delivery lead',
    })
    expect(ok).toEqual({ accepted: true, reasons: [] })
  })
})

describe('12.7 — the Response Lab', () => {
  it('has the eleven intents', () => {
    expect(RESPONSE_INTENTS).toHaveLength(11)
    expect([...RESPONSE_INTENTS]).toEqual([
      'boundary', 'pressure', 'provocation', 'loaded_question', 'negotiation',
      'disagreement', 'clarify', 'repair', 'de_escalate', 'inspire', 'pause',
    ])
  })

  it('builds every response in four layers, never the line alone', () => {
    expect(RESPONSE_LAYERS.map((l) => l.slug)).toEqual(['intent', 'truth', 'structure', 'delivery'])
    expect(NEVER_THE_LINE_ALONE).toMatch(/give the logic of the line so it can be adapted/)
  })

  it('refuses an incomplete build', () => {
    const complete = {
      layer_intent: 'decline without damaging it',
      layer_truth: 'I cannot deliver by Friday and saying otherwise would be a lie',
      layer_structure: 'reason, then the decline, then the alternative date',
      layer_delivery: 'flat, unhurried, stop after the date',
    }
    expect(missingResponseLayers(complete)).toEqual([])
    expect(missingResponseLayers({ ...complete, layer_truth: '' })).toEqual(['truth'])
    expect(missingResponseLayers({})).toEqual(['intent', 'truth', 'structure', 'delivery'])
  })

  it('assesses on six criteria, with escalation risk inverted', () => {
    expect(ASSESSMENT_CRITERIA).toHaveLength(6)
    expect(ASSESSMENT_CRITERIA.map((c) => c.slug)).toEqual([
      'appropriateness', 'clarity', 'proportionality', 'naturalness',
      'objective_achieved', 'escalation_risk',
    ])
    // A high escalation risk is a worse result, so no view may render it as progress.
    expect(criterionIsInverted('escalation_risk')).toBe(true)
    expect(criterionIsInverted('clarity')).toBe(false)
    expect(ASSESSMENT_CRITERIA.filter((c) => c.better === 'lower')).toHaveLength(1)
  })
})
