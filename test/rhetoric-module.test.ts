import { describe, expect, it } from 'vitest'
import {
  ROOT_NODE, PARTS, PART_ORDER_REASON, partIsUnlocked,
  CYCLE_DAYS, CYCLE_LENGTH, cycleDayFor,
  TIER_TARGETS, REJECTED_VERBATIM_ALLOCATION, verbatimAllocationIsRejected, MUST_NOT_ABSORB,
  LADDER, nextLadderInterval, CARD_TYPES, DAILY_REVIEW_MINUTES,
  CHAPTER_SLOTS, missingChapterSlots,
  CONVERSATIONAL_JOBS, jobsForFigure,
  TRACK_METRICS, metricIsInverted, RELISTEN_DAYS, SELF_AUDIT_MARKS,
  FIELD_DEFAULT, TRACK_FIRST_DAY, TRACK_LAST_DAY,
} from '../src/rhetoric'

// Book 11 — the rules of the Farnsworth track, as opposed to its rows.
// Each test here holds one thing the book says that the application could otherwise
// drift away from without any test going red.

describe('11.1 — the architecture and the root node', () => {
  it('states the governing principle as controlled repetition or controlled absence', () => {
    expect(ROOT_NODE).toMatch(/controlled repetition or controlled absence/)
    expect(ROOT_NODE).toMatch(/Parts I and II build patterns; Part III breaks them on purpose/)
  })

  it('teaches the three parts as acting on words, sentences, then the listener', () => {
    expect(PARTS.map((p) => [p.part, p.acts_on])).toEqual([
      [1, 'words'], [2, 'sentences'], [3, 'the listener'],
    ])
    for (const p of PARTS) expect(p.why.length).toBeGreaterThan(20)
  })

  it('refuses Part III until Parts I and II are installed', () => {
    // "a gap only registers against an established pattern"
    expect(partIsUnlocked(3, [1, 2]).unlocked).toBe(true)
    const blocked = partIsUnlocked(3, [1])
    expect(blocked.unlocked).toBe(false)
    expect(blocked.reason).toMatch(/needs Part 2/)
    expect(blocked.reason).toMatch(/a gap only registers against an established pattern/)
    expect(partIsUnlocked(2, []).unlocked).toBe(false)
    // Part I is always available: there is nothing before it.
    expect(partIsUnlocked(1, []).unlocked).toBe(true)
  })

  it('keeps the ordering reason in the codebase, not only in the prompt', () => {
    expect(PART_ORDER_REASON).toMatch(/Sound, then structure, then stance/)
  })
})

describe('11.3 — the seven-day cycle', () => {
  it('has exactly seven days, in the book’s order', () => {
    expect(CYCLE_DAYS).toHaveLength(CYCLE_LENGTH)
    expect(CYCLE_DAYS.map((d) => d.slug)).toEqual([
      'install', 'tier_and_copy', 'mouth', 'skeleton', 'copia', 'live_fire', 'consolidation',
    ])
    expect(CYCLE_DAYS.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('makes Day 1 produce nothing', () => {
    expect(CYCLE_DAYS[0].constraint).toMatch(/produces NOTHING/)
  })

  it('keeps Day 2 by hand', () => {
    // 11.3: "Handwriting, not typing — it slows him to the speed of the pattern."
    expect(CYCLE_DAYS[1].constraint).toMatch(/BY HAND/)
    expect(CYCLE_DAYS[1].constraint).toMatch(/never the text/)
  })

  it('keeps Day 3 aloud and Day 5 counting bad renderings', () => {
    expect(CYCLE_DAYS[2].constraint).toMatch(/[Aa]loud/)
    expect(CYCLE_DAYS[4].constraint).toMatch(/[Bb]ad renderings INCLUDED/)
  })

  it('requires the Day 6 failure rather than tolerating it', () => {
    expect(CYCLE_DAYS[5].job).toMatch(/one where it fails/)
    expect(CYCLE_DAYS[5].constraint).toMatch(/required, not tolerated/)
  })

  it('maps a track day onto its cycle day', () => {
    // Chapter 2 runs Days 61-67.
    expect(cycleDayFor(61, 61)?.slug).toBe('install')
    expect(cycleDayFor(64, 61)?.slug).toBe('skeleton')
    expect(cycleDayFor(67, 61)?.slug).toBe('consolidation')
    expect(cycleDayFor(68, 61)).toBeNull()
    expect(cycleDayFor(60, 61)).toBeNull()
  })
})

describe('11.4 — the tiers, and the allocation the book rejects', () => {
  it('carries the three tiers with their targets and their purposes', () => {
    expect(TIER_TARGETS.map((t) => [t.tier, t.total])).toEqual([[1, 150], [2, 400], [3, 500]])
    expect(TIER_TARGETS[0].per_figure).toBe('6-8')
    expect(TIER_TARGETS[0].treatment).toMatch(/verbatim/)
    expect(TIER_TARGETS[1].purpose).toMatch(/generative engine/)
  })

  it('flags the thousand-specimen allocation the book rejected', () => {
    // 11.4: "Memorising a thousand specimens verbatim was considered and rejected as a
    // wrong allocation of effort. The application must not silently reintroduce it."
    expect(REJECTED_VERBATIM_ALLOCATION).toBe(1000)
    expect(verbatimAllocationIsRejected(1000)).toBe(true)
    expect(verbatimAllocationIsRejected(1200)).toBe(true)
    expect(verbatimAllocationIsRejected(150)).toBe(false)
  })

  it('keeps Tier 1 far below the rejected allocation', () => {
    const tier1 = TIER_TARGETS.find((t) => t.tier === 1)!
    expect(verbatimAllocationIsRejected(tier1.total)).toBe(false)
    // Only Tier 1 is held verbatim. Tiers 2 and 3 are structure and ear, not memory.
    expect(tier1.total).toBeLessThan(REJECTED_VERBATIM_ALLOCATION / 2)
  })

  it('records what the application must not absorb, including Law 22', () => {
    const bySlug = new Map(MUST_NOT_ABSORB.map((r) => [r.slug, r.rule]))
    expect(bySlug.get('commonplace_book')).toMatch(/stays handwritten/)
    expect(bySlug.get('recordings')).toMatch(/files the app references/)
    // The deployment log is the one thing 11.8 permits in the app.
    expect(bySlug.get('deployment_log')).toMatch(/MAY live in the application/)
    expect(bySlug.get('law_22')).toMatch(/make the paper obsolete without making the skill better/)
  })
})

describe('11.5 — the ladder is fixed, and is deliberately not FSRS', () => {
  it('is exactly 1, 3, 7, 16, 35', () => {
    expect([...LADDER]).toEqual([1, 3, 7, 16, 35])
  })

  it('walks the rungs and then stays on the last one', () => {
    expect(nextLadderInterval(null)).toBe(1)
    expect(nextLadderInterval(1)).toBe(3)
    expect(nextLadderInterval(3)).toBe(7)
    expect(nextLadderInterval(7)).toBe(16)
    expect(nextLadderInterval(16)).toBe(35)
    // 11.5 names five intervals and no sixth. Extrapolating one would be the
    // application inventing curriculum.
    expect(nextLadderInterval(35)).toBe(35)
    expect(nextLadderInterval(90)).toBe(35)
  })

  it('carries the three card types and the ten-minute daily floor', () => {
    expect(CARD_TYPES.map((c) => c.slug)).toEqual([
      'name_to_definition', 'skeleton_to_example', 'situation_to_figure',
    ])
    expect(CARD_TYPES[1].answer).toMatch(/on the spot/)
    expect(DAILY_REVIEW_MINUTES).toBe(10)
  })
})

describe('11.6 — the thirteen chapter slots', () => {
  it('has thirteen slots in the book’s order', () => {
    expect(CHAPTER_SLOTS).toHaveLength(13)
    expect(CHAPTER_SLOTS.map((s) => s.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    expect(CHAPTER_SLOTS[0].slug).toBe('orientation')
    expect(CHAPTER_SLOTS[3].slug).toBe('hidden_layer')
    expect(CHAPTER_SLOTS[12].slug).toBe('next_figure_preview')
  })

  it('names a chapter incomplete while any slot is unpopulated', () => {
    expect(missingChapterSlots(CHAPTER_SLOTS.map((s) => s.slug))).toEqual([])
    const allButOne = CHAPTER_SLOTS.map((s) => s.slug).filter((s) => s !== 'hidden_layer')
    expect(missingChapterSlots(allButOne)).toEqual(['hidden_layer'])
    expect(missingChapterSlots([])).toHaveLength(13)
  })

  it('asks slot 2 for why it works, not what it is', () => {
    expect(CHAPTER_SLOTS[1].requirement).toMatch(/why it lands/)
  })
})

describe('11.7 — the conversational-job index, both faces per entry', () => {
  it('covers all thirteen jobs the book names', () => {
    expect(CONVERSATIONAL_JOBS).toHaveLength(13)
  })

  it('gives every job its misuse boundary in the same record', () => {
    for (const j of CONVERSATIONAL_JOBS) {
      expect(j.figures.length, `${j.job} figures`).toBeGreaterThan(0)
      expect(j.misuse_boundary.length, `${j.job} misuse boundary`).toBeGreaterThan(40)
    }
  })

  it('maps the pairs the book pairs', () => {
    const byJob = new Map(CONVERSATIONAL_JOBS.map((j) => [j.job, [...j.figures]]))
    expect(byJob.get('making a point unforgettable')).toEqual(['anaphora', 'epistrophe'])
    expect(byJob.get('binding a theme')).toEqual(['symploce', 'polyptoton'])
    expect(byJob.get('suspense')).toEqual(['anadiplosis', 'anastrophe'])
    expect(byJob.get('cadence')).toEqual(['isocolon', 'polysyndeton'])
    expect(byJob.get('energy and compression')).toEqual(['asyndeton', 'ellipsis'])
  })

  it('answers the reverse question: what is this figure for', () => {
    expect(jobsForFigure('praeteritio').map((j) => j.job)).toEqual([
      'raising what you decline to raise',
    ])
    expect(jobsForFigure('chiasmus')[0].misuse_boundary).toMatch(/not symmetrical/)
    expect(jobsForFigure('epizeuxis')).toEqual([])
  })
})

describe('11.9 — measurement, including the metric that inverts', () => {
  it('treats being noticed as the failure condition', () => {
    // The single most important inversion in Book 11: a rising "noticed" ratio is a
    // worsening result, and no view may render it as progress.
    expect(metricIsInverted('noticed_ratio')).toBe(true)
    const noticed = TRACK_METRICS.find((m) => m.slug === 'noticed_ratio')!
    expect(noticed.better).toBe('lower')
    expect(noticed.note).toMatch(/BEING NOTICED IS THE FAILURE CONDITION/)
  })

  it('leaves every other metric reading higher-is-better', () => {
    const inverted = TRACK_METRICS.filter((m) => m.better === 'lower').map((m) => m.slug)
    expect(inverted).toEqual(['noticed_ratio'])
    expect(TRACK_METRICS).toHaveLength(6)
  })

  it('schedules the re-listens at Day 143 and Day 204 and only then', () => {
    expect([...RELISTEN_DAYS]).toEqual([143, 204])
  })

  it('carries the U/R/N self-audit marks that weight the early cycles', () => {
    expect(SELF_AUDIT_MARKS.map((m) => m.mark)).toEqual(['U', 'R', 'N'])
    expect(SELF_AUDIT_MARKS[1].meaning).toMatch(/recognised in others but not producible/)
  })
})

describe('11.10 — the field default', () => {
  it('is one figure, once, never announced', () => {
    expect(FIELD_DEFAULT.figures_per_exchange).toBe(1)
    expect(FIELD_DEFAULT.announce).toBe(false)
    expect(FIELD_DEFAULT.rule).toMatch(/sourced from the chapter cursor/)
    expect(FIELD_DEFAULT.failure).toMatch(/remembering his style/)
    expect(FIELD_DEFAULT.success).toMatch(/conclusion was their own/)
  })
})

describe('11.2 — the track boundaries', () => {
  it('runs Day 53 through Day 204', () => {
    expect(TRACK_FIRST_DAY).toBe(53)
    expect(TRACK_LAST_DAY).toBe(204)
  })
})
