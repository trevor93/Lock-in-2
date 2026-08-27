import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

// Book 13 — THE TEMPLE: DECISION LAB. Phase 9 of the Book 17 build order.
//
// Six tables were named in MASTERPROMPT.md:202 and none of them existed: `decisions`,
// `decision_evidence`, `decision_options`, `decision_predictions`, `decision_outcomes`,
// `decision_reviews`. STATUS.md recorded them as deferred to this phase.
//
// The reason this file asserts against the DATABASE rather than a route is Book 13.2's own
// sentence: "Law 23 is enforced here in schema, not in advice." A rule that lives only in a
// handler is a rule that the next handler forgets. Everything below that can be a constraint
// is a constraint, and this file is what proves it: each case writes real SQL against the
// migrated schema and requires the database itself to refuse.
//
// What is deliberately NOT here: the "None plausible" counting (that is the
// `alternative_explanations` ledger from 0010, exercised through the route), and the
// heuristics/Brier arithmetic (pure functions, exercised in their own module test). This file
// is only the part the schema can carry.

async function ownerId(): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
  ).first<{ id: number }>()
  if (!row) throw new Error('no durable owner exists, so this guard cannot address a row')
  return row.id
}

/** Every column of `decisions` that must exist, and a value that satisfies it. */
function baseDecision(userId: number): Record<string, unknown> {
  return {
    user_id: userId,
    title: 'Whether to accept the contract on the stated terms',
    domain: 'money',
    deadline: '2026-09-30',
    importance: 4,
    reversibility: 'costly_to_reverse',
    description: 'The counterparty has offered terms that expire on the thirtieth.',
    observed: 'The written offer exists and names the thirtieth.',
    believed: 'That they will not extend it. Nobody has said so.',
    stakeholders_json: '[]',
    desired_outcome: 'Signed on terms that do not mortgage next quarter.',
    minimum_acceptable: 'A dated extension, in writing.',
    forbidden_outcome: 'Signing under time pressure without reading the indemnity clause.',
    success_criteria: 'Contract signed, indemnity capped, no unpaid work before the first invoice.',
    gains: 'Six months of runway.',
    losses: 'The other engagement, which cannot run in parallel.',
    opportunity_cost: 'The engagement that would have started in October.',
    others_affected: 'One collaborator who is holding time for the other engagement.',
    alternative_explanation: 'The deadline may be a genuine internal budget date rather than pressure.',
    forced_if_nothing_changes: 'If nothing changes they win because I will run out of month before I run out of questions.',
    forced_cheapest_change: 'The cheapest legal non-dramatic change to the score is to ask for the extension in writing today.',
  }
}

async function insertDecision(
  overrides: Record<string, unknown> = {},
): Promise<number> {
  const row = { ...baseDecision(await ownerId()), ...overrides }
  const columns = Object.keys(row)
  const result = await env.DB.prepare(
    `INSERT INTO decisions (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
  ).bind(...columns.map((c) => row[c] as never)).run()
  return Number(result.meta.last_row_id)
}

/** The six tables Book 13 names, in the order MASTERPROMPT.md:202 lists them. */
const TABLES = [
  'decisions', 'decision_evidence', 'decision_options', 'decision_predictions',
  'decision_outcomes', 'decision_reviews',
] as const

/** Book 13.2's five labels, exactly. */
const EVIDENCE_KINDS = ['FACT', 'CLAIM', 'INFERENCE', 'HYPOTHESIS', 'UNKNOWN'] as const

/** Book 1's six Daylight questions, as the column names that carry them. */
const DAYLIGHT_BOXES = [
  'daylight_truthful', 'daylight_consensual', 'daylight_proportionate',
  'daylight_reversible', 'daylight_reputation_safe', 'daylight_survives_daylight',
] as const

async function columnsOf(table: string): Promise<string[]> {
  const info = (await env.DB.prepare(`PRAGMA table_info(${table})`).all())
    .results as Array<{ name: string }>
  return info.map((column) => column.name)
}

beforeEach(async () => {
  // Ordered by dependency: the children reference the parent.
  for (const table of [...TABLES].reverse()) {
    await env.DB.prepare(`DELETE FROM ${table}`).run()
  }
})

describe('B13.1 the Situation object is a first-class record, not a note', () => {
  it('creates all six tables Book 13 names, each owned by a user', async () => {
    const live = (await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'decision%'`,
    ).all()).results as Array<{ name: string }>
    const names = live.map((row) => row.name)
    for (const table of TABLES) {
      expect(names, `${table} does not exist`).toContain(table)
      // Every one of these holds the commander's own reasoning, so every one of them is
      // swept by test/session-ownership.test.ts — which only sweeps what carries a user_id.
      expect(await columnsOf(table), `${table} carries no user_id`).toContain('user_id')
    }
  })

  it('carries identification, situation, objective, and stakes as columns', async () => {
    // Book 13.1 names four groups of fields. A note in a text blob would satisfy the prose
    // and satisfy nothing else: you cannot sort, gate, or resurface a paragraph.
    const columns = await columnsOf('decisions')
    const REQUIRED = [
      // Identification
      'title', 'domain', 'created_at', 'deadline', 'status', 'importance', 'reversibility',
      // Situation — and the split between what happened and what is merely believed
      'description', 'observed', 'believed', 'stakeholders_json',
      // Objective
      'desired_outcome', 'minimum_acceptable', 'forbidden_outcome', 'success_criteria',
      // Stakes
      'gains', 'losses', 'opportunity_cost', 'others_affected',
    ]
    for (const column of REQUIRED) {
      expect(columns, `decisions has no ${column} column`).toContain(column)
    }
  })

  it('accepts a well-formed decision and defaults it to open', async () => {
    const id = await insertDecision()
    const row = await env.DB.prepare(
      `SELECT status, created_at FROM decisions WHERE id=?`,
    ).bind(id).first<{ status: string; created_at: string }>()
    expect(row?.status, 'a new decision is not open').toBe('open')
    expect(row?.created_at, 'a new decision carries no creation date').toBeTruthy()
  })

  it('refuses an importance or reversibility outside its stated range', async () => {
    await expect(insertDecision({ importance: 6 })).rejects.toThrow()
    await expect(insertDecision({ importance: 0 })).rejects.toThrow()
    await expect(insertDecision({ reversibility: 'maybe' })).rejects.toThrow()
  })
})

describe('B13.2 evidence typing and the brake, in schema', () => {
  it('refuses a decision with no alternative explanation', async () => {
    // The brake. 0010 put it on heated captures; Book 13.2 requires it on EVERY decision.
    // Not a nullable column with a handler that checks it — the database refuses the row.
    await expect(insertDecision({ alternative_explanation: null })).rejects.toThrow()
    await expect(insertDecision({ alternative_explanation: '   ' })).rejects.toThrow()
  })

  it('accepts "None plausible" as a legal alternative explanation', async () => {
    // Legal, because forcing invention would make the field a lie generator. It is counted
    // elsewhere (the 0010 ledger) — the paranoia tell is a rising count, not a refusal.
    const id = await insertDecision({ alternative_explanation: 'None plausible' })
    expect(id).toBeGreaterThan(0)
  })

  it('labels every evidence item with one of Book 13.2 five kinds and nothing else', async () => {
    const decisionId = await insertDecision()
    const userId = await ownerId()
    for (const kind of EVIDENCE_KINDS) {
      const inserted = await env.DB.prepare(
        `INSERT INTO decision_evidence
           (user_id, decision_id, kind, statement, source, reliability, observed_date,
            confidence, independently_verified)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).bind(userId, decisionId, kind, `A ${kind} item`, 'Direct observation', 'high',
        '2026-08-27', 80, kind === 'FACT' ? 1 : 0).run()
      expect(Number(inserted.meta.last_row_id), `${kind} was refused`).toBeGreaterThan(0)
    }
    await expect(
      env.DB.prepare(
        `INSERT INTO decision_evidence
           (user_id, decision_id, kind, statement, source, reliability, observed_date,
            confidence, independently_verified)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).bind(userId, decisionId, 'PROBABLY', 'An unlabelled item', 'Hearsay', 'low',
        '2026-08-27', 30, 0).run(),
      'an evidence label outside the five was accepted',
    ).rejects.toThrow()
  })

  it('carries source, reliability, date, confidence, and the verification flag', async () => {
    const columns = await columnsOf('decision_evidence')
    for (const column of [
      'source', 'reliability', 'observed_date', 'confidence', 'independently_verified',
    ]) {
      expect(columns, `decision_evidence has no ${column} column`).toContain(column)
    }
  })

  it('refuses a confidence outside 0-100 on evidence', async () => {
    const decisionId = await insertDecision()
    const userId = await ownerId()
    const write = (confidence: number) => env.DB.prepare(
      `INSERT INTO decision_evidence
         (user_id, decision_id, kind, statement, source, reliability, observed_date,
          confidence, independently_verified)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).bind(userId, decisionId, 'CLAIM', 'A bounded claim', 'A person', 'medium',
      '2026-08-27', confidence, 0).run()
    await expect(write(101)).rejects.toThrow()
    await expect(write(-1)).rejects.toThrow()
  })

  it('forces the observed/believed split rather than one undifferentiated story', async () => {
    // "What happened as against what is merely believed" is the sentence. A single
    // description column would let the two collapse into each other, which is the exact
    // confusion the Decision Lab exists to prevent.
    await expect(insertDecision({ observed: null })).rejects.toThrow()
    await expect(insertDecision({ believed: null })).rejects.toThrow()
  })
})

/** One option row, complete per Book 13.3. */
async function insertOption(
  decisionId: number,
  overrides: Record<string, unknown> = {},
): Promise<number> {
  const row: Record<string, unknown> = {
    user_id: await ownerId(),
    decision_id: decisionId,
    kind: 'engage',
    summary: 'Sign on the stated terms.',
    expected_benefit: 'Runway starts immediately.',
    cost: 'Six months of availability.',
    downside: 'The indemnity clause is uncapped.',
    reversibility: 'costly_to_reverse',
    dependencies: 'Their legal signing off this week.',
    second_order_effects: 'The collaborator loses the October slot they held.',
    information_gained: 'Whether their deadline was real.',
    probability: 55,
    ...overrides,
  }
  const columns = Object.keys(row)
  const result = await env.DB.prepare(
    `INSERT INTO decision_options (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
  ).bind(...columns.map((c) => row[c] as never)).run()
  return Number(result.meta.last_row_id)
}

describe('B13.3 options carry the whole calculation, or they are not options', () => {
  it('names the six option kinds Book 13.3 lists, and refuses anything else', async () => {
    const decisionId = await insertDecision()
    for (const kind of ['engage', 'modify', 'delay', 'decline', 'seek_review', 'exit']) {
      expect(await insertOption(decisionId, { kind }), `${kind} was refused`).toBeGreaterThan(0)
    }
    await expect(insertOption(decisionId, { kind: 'wing_it' })).rejects.toThrow()
  })

  it('requires every one of the eight fields an option must carry', async () => {
    const decisionId = await insertDecision()
    // Each of these is a question the option is supposed to have answered. A nullable
    // column here means an option that looks complete on screen and answered nothing.
    for (const column of [
      'expected_benefit', 'cost', 'downside', 'reversibility', 'dependencies',
      'second_order_effects', 'information_gained', 'probability',
    ]) {
      await expect(
        insertOption(decisionId, { [column]: null }),
        `decision_options accepted a row with no ${column}`,
      ).rejects.toThrow()
    }
  })

  it('bounds the probability estimate', async () => {
    const decisionId = await insertDecision()
    await expect(insertOption(decisionId, { probability: 101 })).rejects.toThrow()
    await expect(insertOption(decisionId, { probability: -1 })).rejects.toThrow()
  })

  it('carries the Five Factors with 將 aimed at himself, and the Seven Comparisons on both sides', async () => {
    const columns = await columnsOf('decisions')
    // The Five Factors, nullable ON PURPOSE: Book 13.3 says "scored, OR MARKED UNKNOWN".
    // A NOT NULL here would force a number where he has none, and a fabricated score is
    // worse than an absent one.
    for (const factor of ['dao', 'tian', 'di', 'jiang', 'fa']) {
      expect(columns, `decisions has no factor_${factor} column`).toContain(`factor_${factor}`)
    }
    // 將 aimed at himself is the correction Book 10.6 already enforces for the concept.
    // Here it is a column name that cannot be read any other way.
    expect(columns, 'the 將 factor is not marked as self-assessed').toContain('factor_jiang_self')
    // The Seven Comparisons, both sides. Fourteen columns rather than seven, because a
    // single "score" column silently becomes a score of himself alone, which is the
    // comparison not being made.
    for (const comparison of [
      'alignment', 'competence', 'timing', 'process', 'resources', 'preparation', 'incentives',
    ]) {
      expect(columns, `decisions has no compare_${comparison}_self`)
        .toContain(`compare_${comparison}_self`)
      expect(columns, `decisions has no compare_${comparison}_other`)
        .toContain(`compare_${comparison}_other`)
    }
  })

  it('requires both forced sentences before the decision can be committed', async () => {
    // Book 13.3's two sentences are not optional prose; they are the two questions that
    // change the answer. They are checked at the COMMIT transition rather than at insert,
    // because a decision under construction legitimately has neither yet.
    //
    // EACH sentence is proven separately. Nulling both at once and asserting one rejection
    // proves only that at least one of the two is required -- a gate that had lost the check
    // on `forced_cheapest_change` would still refuse the row on the other one and this test
    // would report clean. That survivor was found by mutation and is why the loop exists.
    for (const missing of ['forced_if_nothing_changes', 'forced_cheapest_change']) {
      const id = await insertDecision({ [missing]: null })
      await threeOptions(id)
      await expect(
        commit(id),
        `a decision was committed with no ${missing}`,
      ).rejects.toThrow()
    }
    // And with both answered it commits, so the pair is a requirement rather than a wall.
    const complete = await insertDecision()
    await threeOptions(complete)
    await commit(complete)
    const row = await env.DB.prepare(`SELECT status FROM decisions WHERE id=?`)
      .bind(complete).first<{ status: string }>()
    expect(row?.status).toBe('committed')
  })
})

/**
 * The commit transition: `open` -> `committed`.
 *
 * Everything Book 13.4 requires of a commitment is written in one UPDATE, so the trigger
 * that guards the transition sees the whole intended row rather than a half-built one. A
 * per-column NOT NULL could not express this: a decision under construction legitimately
 * has no selected option, and the point is that it cannot be COMMITTED without one.
 */
async function commit(
  decisionId: number,
  overrides: Record<string, unknown> = {},
): Promise<D1Result> {
  const selected = await env.DB.prepare(
    `SELECT id FROM decision_options WHERE decision_id=? ORDER BY id LIMIT 1`,
  ).bind(decisionId).first<{ id: number }>()
  const row: Record<string, unknown> = {
    status: 'committed',
    selected_option_id: selected?.id ?? null,
    commitment_reason: 'It is the only option that buys the information the others assume.',
    commitment_confidence: 65,
    committed_date: '2026-08-27',
    next_physical_action: 'Send the written extension request before nine tomorrow.',
    never_list: 'Never sign the same day I first read a clause.',
    premortem_cause: 'It failed because I read the indemnity clause after signing, not before.',
    trigger_act: 'Their written extension arrives.',
    trigger_delay: 'No written answer by Friday.',
    trigger_exit: 'They refuse to cap the indemnity.',
    trigger_changes_recommendation: 'Evidence that the budget date is external and immovable.',
    daylight_truthful: 1,
    daylight_consensual: 1,
    daylight_proportionate: 1,
    daylight_reversible: 1,
    daylight_reputation_safe: 1,
    daylight_survives_daylight: 1,
    daylight_justification: null,
    review_due_date: '2026-09-26',
    ...overrides,
  }
  const columns = Object.keys(row)
  return env.DB.prepare(
    `UPDATE decisions SET ${columns.map((c) => `${c}=?`).join(',')} WHERE id=?`,
  ).bind(...columns.map((c) => row[c] as never), decisionId).run()
}

/** Three complete options, which is Book 13.3's floor. */
async function threeOptions(decisionId: number): Promise<void> {
  for (const kind of ['engage', 'delay', 'exit']) await insertOption(decisionId, { kind })
}

describe('B13.4 the commitment cannot be made until it is a commitment', () => {
  it('commits a decision that answered everything', async () => {
    const id = await insertDecision()
    await threeOptions(id)
    await commit(id)
    const row = await env.DB.prepare(
      `SELECT status, review_due_date FROM decisions WHERE id=?`,
    ).bind(id).first<{ status: string; review_due_date: string }>()
    expect(row?.status).toBe('committed')
    expect(row?.review_due_date, 'the thirty-day review was not scheduled').toBeTruthy()
  })

  it('refuses to commit with fewer than three options', async () => {
    // "At least three options where possible" — enforced, because two options is almost
    // always a decision that has already been made and is looking for permission.
    const id = await insertDecision()
    await insertOption(id, { kind: 'engage' })
    await insertOption(id, { kind: 'delay' })
    await expect(commit(id), 'a decision committed on two options').rejects.toThrow()
    await insertOption(id, { kind: 'exit' })
    await commit(id)
    const row = await env.DB.prepare(`SELECT status FROM decisions WHERE id=?`)
      .bind(id).first<{ status: string }>()
    expect(row?.status).toBe('committed')
  })

  it('refuses to commit without a selected option, a reason, or a next physical action', async () => {
    for (const missing of [
      'selected_option_id', 'commitment_reason', 'next_physical_action', 'premortem_cause',
    ]) {
      const id = await insertDecision()
      await threeOptions(id)
      await expect(
        commit(id, { [missing]: null }),
        `a decision committed with no ${missing}`,
      ).rejects.toThrow()
    }
  })

  it('refuses to commit without all four triggers', async () => {
    for (const missing of [
      'trigger_act', 'trigger_delay', 'trigger_exit', 'trigger_changes_recommendation',
    ]) {
      const id = await insertDecision()
      await threeOptions(id)
      await expect(
        commit(id, { [missing]: null }),
        `a decision committed with no ${missing}`,
      ).rejects.toThrow()
    }
  })

  it('carries all six Daylight boxes and refuses an unchecked one with no written justification', async () => {
    const columns = await columnsOf('decisions')
    for (const box of DAYLIGHT_BOXES) {
      expect(columns, `decisions has no ${box} column`).toContain(box)
    }
    // Book 1's Daylight Test is six questions; Book 13.4 requires "written justification for
    // any unchecked box". An unchecked box with no sentence beside it is the tactic being
    // waved through, so the transition is refused — and a checked-everything commitment is
    // not the only legal shape, because a box may honestly be false.
    for (const box of DAYLIGHT_BOXES) {
      const refused = await insertDecision()
      await threeOptions(refused)
      await expect(
        commit(refused, { [box]: 0, daylight_justification: null }),
        `${box} was left unchecked with no written justification`,
      ).rejects.toThrow()

      const allowed = await insertDecision()
      await threeOptions(allowed)
      await commit(allowed, {
        [box]: 0,
        daylight_justification: `${box} is false here, and the reason is written down.`,
      })
      const row = await env.DB.prepare(`SELECT status FROM decisions WHERE id=?`)
        .bind(allowed).first<{ status: string }>()
      expect(row?.status, `${box} could not be unchecked even with a justification`)
        .toBe('committed')
    }
  })

  it('refuses to commit without scheduling the thirty-day review', async () => {
    const id = await insertDecision()
    await threeOptions(id)
    await expect(
      commit(id, { review_due_date: null }),
      'a decision committed with no review date, so the review is optional',
    ).rejects.toThrow()
  })

  it('bounds the commitment confidence', async () => {
    const id = await insertDecision()
    await threeOptions(id)
    await expect(commit(id, { commitment_confidence: 101 })).rejects.toThrow()
    await expect(commit(id, { commitment_confidence: null })).rejects.toThrow()
  })
})

describe('B13.4 outcome and the mandatory thirty-day review', () => {
  async function committed(): Promise<number> {
    const id = await insertDecision()
    await threeOptions(id)
    await commit(id)
    return id
  }

  it('records what happened, what it measured, and who reacted', async () => {
    const id = await committed()
    const userId = await ownerId()
    const result = await env.DB.prepare(
      `INSERT INTO decision_outcomes
         (user_id, decision_id, what_happened, measurable_result,
          unintended_consequences, stakeholder_response, recorded_date)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(userId, id, 'They extended in writing.', 'Signed on the 12th with the cap.',
      'The collaborator moved their slot without being asked.',
      'Their legal team answered within a day.', '2026-09-12').run()
    expect(Number(result.meta.last_row_id)).toBeGreaterThan(0)
  })

  it('refuses an outcome that measures nothing', async () => {
    const id = await committed()
    const userId = await ownerId()
    await expect(
      env.DB.prepare(
        `INSERT INTO decision_outcomes
           (user_id, decision_id, what_happened, measurable_result, recorded_date)
         VALUES (?,?,?,?,?)`,
      ).bind(userId, id, 'It went fine.', null, '2026-09-12').run(),
      'an outcome with no measurable result was accepted',
    ).rejects.toThrow()
  })

  it('requires the review to separate judgment from luck and to name the lesson', async () => {
    const id = await committed()
    const userId = await ownerId()
    const base: Record<string, unknown> = {
      user_id: userId,
      decision_id: id,
      review_date: '2026-09-26',
      prediction_accuracy: 70,
      failed_assumption: 'That the deadline was pressure rather than a budget date.',
      missing_information: 'Their fiscal calendar.',
      judgment_vs_luck: 'Judgment on asking; luck that their quarter ended when it did.',
      lesson: 'Ask what the date is FOR before treating it as pressure.',
      updated_principle: 'A deadline is evidence about the other side, not only about me.',
      unchecked_daylight_resurfaced: '[]',
    }
    const write = (overrides: Record<string, unknown> = {}) => {
      const row = { ...base, ...overrides }
      const columns = Object.keys(row)
      return env.DB.prepare(
        `INSERT INTO decision_reviews (${columns.join(',')})
         VALUES (${columns.map(() => '?').join(',')})`,
      ).bind(...columns.map((c) => row[c] as never)).run()
    }
    for (const missing of [
      'failed_assumption', 'missing_information', 'judgment_vs_luck', 'lesson',
      'updated_principle', 'unchecked_daylight_resurfaced',
    ]) {
      await expect(write({ [missing]: null }), `a review was accepted with no ${missing}`)
        .rejects.toThrow()
    }
    expect(Number((await write()).meta.last_row_id)).toBeGreaterThan(0)
  })

  it('resurfaces the boxes that were left unchecked, rather than the operator remembering to', async () => {
    // Book 13.4: "the unchecked Daylight boxes are resurfaced here". The review row carries
    // the list, and the list is derivable from the decision itself — so this asserts the two
    // agree rather than trusting whoever wrote the review.
    const id = await insertDecision()
    await threeOptions(id)
    await commit(id, {
      daylight_reversible: 0,
      daylight_justification: 'Not reversible, and the reason is that the signature is the act.',
    })
    const decision = await env.DB.prepare(
      `SELECT ${DAYLIGHT_BOXES.join(',')} FROM decisions WHERE id=?`,
    ).bind(id).first<Record<string, number>>()
    const unchecked = DAYLIGHT_BOXES.filter((box) => (decision?.[box] ?? 1) === 0)
    expect(unchecked, 'the unchecked box was not stored as unchecked')
      .toEqual(['daylight_reversible'])

    const userId = await ownerId()
    await env.DB.prepare(
      `INSERT INTO decision_reviews
         (user_id, decision_id, review_date, prediction_accuracy, failed_assumption,
          missing_information, judgment_vs_luck, lesson, updated_principle,
          unchecked_daylight_resurfaced)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(userId, id, '2026-09-26', 60, 'That signing was reversible.', 'The cancellation terms.',
      'Judgment on the cap; luck on the timing.', 'Reversibility is a fact, not a feeling.',
      'Check the exit before the entrance.', JSON.stringify(unchecked)).run()

    const review = await env.DB.prepare(
      `SELECT unchecked_daylight_resurfaced FROM decision_reviews WHERE decision_id=?`,
    ).bind(id).first<{ unchecked_daylight_resurfaced: string }>()
    expect(JSON.parse(review!.unchecked_daylight_resurfaced)).toEqual(unchecked)
  })

  it('keeps a filed review from being rewritten', async () => {
    // The review is the only place the record says "I was wrong about this". If it can be
    // edited later it stops being evidence and becomes an opinion about the past.
    const id = await committed()
    const userId = await ownerId()
    await env.DB.prepare(
      `INSERT INTO decision_reviews
         (user_id, decision_id, review_date, prediction_accuracy, failed_assumption,
          missing_information, judgment_vs_luck, lesson, updated_principle,
          unchecked_daylight_resurfaced)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(userId, id, '2026-09-26', 70, 'An assumption.', 'Some information.',
      'Some judgment.', 'A lesson.', 'A principle.', '[]').run()
    await expect(
      env.DB.prepare(`UPDATE decision_reviews SET lesson='A nicer lesson.' WHERE decision_id=?`)
        .bind(id).run(),
      'a filed review was rewritten',
    ).rejects.toThrow()
  })
})

describe('B13.5 the prediction log — every commitment is falsifiable', () => {
  it('logs a decision prediction with a confidence and a resolution date', async () => {
    const id = await insertDecision()
    await threeOptions(id)
    await commit(id)
    const userId = await ownerId()
    const result = await env.DB.prepare(
      `INSERT INTO decision_predictions
         (user_id, decision_id, statement, confidence, resolve_by)
       VALUES (?,?,?,?,?)`,
    ).bind(userId, id, 'They will extend in writing before Friday.', 60, '2026-09-04').run()
    expect(Number(result.meta.last_row_id)).toBeGreaterThan(0)
    const row = await env.DB.prepare(
      `SELECT outcome FROM decision_predictions WHERE decision_id=?`,
    ).bind(id).first<{ outcome: string }>()
    expect(row?.outcome, 'a new prediction is not unresolved').toBe('unresolved')
  })

  it('refuses a prediction with no resolution date, which is what makes it falsifiable', async () => {
    const id = await insertDecision()
    const userId = await ownerId()
    await expect(
      env.DB.prepare(
        `INSERT INTO decision_predictions (user_id, decision_id, statement, confidence, resolve_by)
         VALUES (?,?,?,?,?)`,
      ).bind(userId, id, 'It will probably work out.', 60, null).run(),
      'a prediction with no resolution date was accepted',
    ).rejects.toThrow()
  })

  it('bounds the confidence and the outcome vocabulary', async () => {
    const id = await insertDecision()
    const userId = await ownerId()
    const write = (confidence: number, outcome = 'unresolved') => env.DB.prepare(
      `INSERT INTO decision_predictions
         (user_id, decision_id, statement, confidence, resolve_by, outcome)
       VALUES (?,?,?,?,?,?)`,
    ).bind(userId, id, 'A bounded statement.', confidence, '2026-09-04', outcome).run()
    await expect(write(101)).rejects.toThrow()
    await expect(write(-1)).rejects.toThrow()
    await expect(write(60, 'sort_of')).rejects.toThrow()
  })

  it('refuses to rewrite a resolved prediction', async () => {
    const id = await insertDecision()
    const userId = await ownerId()
    await env.DB.prepare(
      `INSERT INTO decision_predictions
         (user_id, decision_id, statement, confidence, resolve_by)
       VALUES (?,?,?,?,?)`,
    ).bind(userId, id, 'A resolvable statement.', 60, '2026-09-04').run()
    await env.DB.prepare(
      `UPDATE decision_predictions SET outcome='right', resolved_date='2026-09-03'
       WHERE decision_id=?`,
    ).bind(id).run()
    await expect(
      env.DB.prepare(`UPDATE decision_predictions SET outcome='wrong' WHERE decision_id=?`)
        .bind(id).run(),
      'a resolved prediction was regraded',
    ).rejects.toThrow()
  })
})
