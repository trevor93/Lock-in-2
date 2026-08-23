import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../src/index'
import { EXERCISE_TYPES, RESPONSE_INTENTS } from '../src/rhetoric-lab'

// Book 12 — the Lab ROUTES. Four gates, each tested against real rows rather than
// against the module that describes it:
//
//   12.1 no figure until the six-slot canon map is complete
//   12.4 no 'deployed' until the red-team card is answered and clear
//   12.6 no saved line without why_not_obvious, and none that reads like a reel;
//        detection PROPOSES and his correction is the training signal
//   12.7 no response without all four layers

const baseEnv = {
  DB: env.DB, OPENAI_API_KEY: '', OPENAI_BASE_URL: 'https://model.invalid',
  OPENAI_ALLOWED_BASE_URLS: 'https://model.invalid',
}

async function passwordHash(pw: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)))
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256,
  )
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

type Session = { cookie: string; csrf: string; userId: number }

async function login(): Promise<Session> {
  const salt = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, failed_login_count=0,
       locked_until=NULL WHERE role='owner'`,
  ).bind(await passwordHash('lab-routes-pw', salt), salt).run()
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'lab-routes-pw' }),
  }, baseEnv)
  expect(res.status).toBe(200)
  const cookie = res.headers.get('set-cookie')!.split(';', 1)[0]
  const { csrfToken } = await res.json<{ csrfToken: string }>()
  const owner = await env.DB.prepare(
    `SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1`,
  ).first<{ id: number }>()
  return { cookie, csrf: csrfToken, userId: owner!.id }
}

function post(path: string, s: Session, body: unknown = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { Cookie: s.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf },
    body: JSON.stringify(body),
  }, baseEnv)
}
function get(path: string, s: Session) {
  return app.request(path, { headers: { Cookie: s.cookie } }, baseEnv)
}

const COMPLETE_MAP = {
  purpose: 'decline',
  audience: 'My manager, who values the date more than the reason for it.',
  occasion: 'Now, briefly, before the plan is announced to the wider team.',
  proof: 'The two dependencies that have not shipped, and last quarter’s slip.',
  arrangement: 'The constraint first, then the decline, then the date I can hold.',
  delivery: 'Flat, unhurried, and stop after the date.',
}

async function makeMap(s: Session): Promise<number> {
  const res = await post('/api/lab/canon-map', s, COMPLETE_MAP)
  expect(res.status).toBe(200)
  return (await res.json<any>()).id
}

let session: Session

beforeEach(async () => {
  session = await login()
  for (const table of ['outbound_cards', 'inbound_cards', 'figure_detections',
    'response_builds', 'rhetoric_attempts', 'canon_maps']) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(session.userId).run()
  }
})

describe('12.1 — the canon map runs before any figure is named', () => {
  it('stores a complete map and only then reports figures unlocked', async () => {
    const res = await post('/api/lab/canon-map', session, COMPLETE_MAP)
    expect(res.status).toBe(200)
    const body = await res.json<any>()
    expect(body.figuresUnlocked).toBe(true)
    expect(body.reason).toMatch(/ornamented nonsense/)
    expect(body.triangle).toHaveLength(3)
  })

  it('refuses a partial map', async () => {
    const res = await post('/api/lab/canon-map', session, { ...COMPLETE_MAP, proof: '' })
    expect(res.status).toBe(400)
  })

  it('refuses an attempt that names a figure with no canon map at all', async () => {
    const res = await post('/api/lab/attempt', session, {
      exercise_type: 'construct_original',
      figure_slug: 'anaphora',
      answer: 'I asked for the timeline. I asked for the owner. I asked for the date.',
      why_not_obvious: 'The obvious move was to accept the vague answer and chase it later.',
      occurred_on: '2026-08-23',
    })
    expect(res.status).toBe(409)
    const body = await res.json<any>()
    expect(body.error).toBe('CANON MAP REQUIRED BEFORE A FIGURE IS NAMED')
    expect(body.reason).toMatch(/Figures are chosen after the map, never before/)
    expect(body.slots).toEqual([
      'purpose', 'audience', 'occasion', 'proof', 'arrangement', 'delivery',
    ])
  })

  it('accepts the same attempt once the map exists', async () => {
    const mapId = await makeMap(session)
    const res = await post('/api/lab/attempt', session, {
      exercise_type: 'construct_original',
      figure_slug: 'anaphora',
      canon_map_id: mapId,
      answer: 'I asked for the timeline. I asked for the owner. I asked for the date.',
      why_not_obvious: 'The obvious move was to accept the vague answer and chase it later.',
      source_room: 'Standup, 14 Aug, with the delivery lead',
      occurred_on: '2026-08-23',
    })
    expect(res.status).toBe(200)
    const body = await res.json<any>()
    // Nothing is deployable on arrival: 12.4 stands between the draft and 'deployed'.
    expect(body.deployable).toBe(false)
    expect(body.beforeDeploying).toHaveLength(4)
  })

  it('refuses an attempt pointing at a canon map that is not his', async () => {
    const res = await post('/api/lab/attempt', session, {
      exercise_type: 'construct_original', figure_slug: 'anaphora', canon_map_id: 999999,
      answer: 'Something.',
      why_not_obvious: 'A reason long enough to satisfy the twenty-character floor.',
      occurred_on: '2026-08-23',
    })
    expect(res.status).toBe(409)
  })
})

describe('12.2 / 12.6 — the thirteenth exercise, and the two rules on any saved line', () => {
  it('refuses exercise thirteen without the written diagnosis', async () => {
    const res = await post('/api/lab/attempt', session, {
      exercise_type: 'three_versions_and_diagnosis',
      answer: 'The three versions are below.',
      why_not_obvious: 'The obvious version was the excessive one, which is the point.',
      version_plain: 'I cannot make Friday.',
      version_controlled: 'Friday is not a date I can hold, and here is the one I can.',
      version_excessive: 'Friday is a fantasy, Friday is a fiction, Friday is a lie we tell.',
      occurred_on: '2026-08-23',
    })
    expect(res.status).toBe(409)
    const body = await res.json<any>()
    expect(body.error).toBe('EXERCISE THIRTEEN INCOMPLETE')
    expect(body.missing).toEqual(['excess_diagnosis'])
    // The exercise teaches the rule rather than policing it.
    expect(body.reason).toMatch(/SKILL instead of enforcing it as a validator/)
  })

  it('accepts exercise thirteen when the diagnosis is written', async () => {
    const res = await post('/api/lab/attempt', session, {
      exercise_type: 'three_versions_and_diagnosis',
      answer: 'The three versions are below.',
      why_not_obvious: 'The obvious version was the excessive one, which is the point.',
      version_plain: 'I cannot make Friday.',
      version_controlled: 'Friday is not a date I can hold, and here is the one I can.',
      version_excessive: 'Friday is a fantasy, Friday is a fiction, Friday is a lie we tell.',
      excess_diagnosis: 'The third version makes the date the enemy instead of the constraint, '
        + 'so it wins the sentence and loses the negotiation.',
      occurred_on: '2026-08-23',
    })
    expect(res.status).toBe(200)
    expect((await res.json<any>()).exercise.n).toBe(13)
  })

  it('is the only exercise carrying a teaching note', async () => {
    const body = await (await get('/api/lab/rules', session)).json<any>()
    expect(body.exercises).toHaveLength(13)
    expect(body.exercises.filter((e: any) => e.teaches !== null)).toHaveLength(1)
    expect(body.exercises.map((e: any) => e.slug))
      .toEqual(EXERCISE_TYPES.map((e) => e.slug))
  })

  it('refuses an unknown exercise type rather than storing it', async () => {
    const res = await post('/api/lab/attempt', session, {
      exercise_type: 'freestyle',
      answer: 'Something.',
      why_not_obvious: 'A reason long enough to satisfy the twenty-character floor.',
      occurred_on: '2026-08-23',
    })
    expect(res.status).toBe(400)
    expect((await res.json<any>()).error).toBe('UNKNOWN EXERCISE TYPE')
  })

  it('refuses a saved line with no why_not_obvious, and one that is too short', async () => {
    const empty = await post('/api/lab/attempt', session, {
      exercise_type: 'construct_original',
      answer: 'I need the timeline before I can commit.',
      occurred_on: '2026-08-23',
    })
    expect(empty.status).toBe(409)
    expect((await empty.json<any>()).reasons[0]).toMatch(/why_not_obvious is empty/)

    const short = await post('/api/lab/attempt', session, {
      exercise_type: 'construct_original',
      answer: 'I need the timeline before I can commit.',
      why_not_obvious: 'it is good',
      occurred_on: '2026-08-23',
    })
    expect(short.status).toBe(409)
    expect((await short.json<any>()).reasons[0]).toMatch(/too short/)
  })

  it('rejects a line that reads like a reel', async () => {
    const res = await post('/api/lab/attempt', session, {
      exercise_type: 'construct_original',
      answer: 'Never explain yourself. Let that sink in.',
      why_not_obvious: 'Because most people over-explain the moment they are challenged.',
      occurred_on: '2026-08-23',
    })
    expect(res.status).toBe(409)
    const body = await res.json<any>()
    expect(body.reasons).toContain('If it reads like a reel, it is rejected.')
    // And the refusal reminds him what the source field is actually for.
    expect(body.source).toMatch(/the room, not the book/)
  })

  it('stores nothing when a line is refused', async () => {
    const before = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM rhetoric_attempts WHERE user_id=?`,
    ).bind(session.userId).first<{ n: number }>()
    await post('/api/lab/attempt', session, {
      exercise_type: 'construct_original',
      answer: 'Stay dangerous.',
      why_not_obvious: 'A reason long enough to pass the twenty-character floor easily.',
      occurred_on: '2026-08-23',
    })
    const after = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM rhetoric_attempts WHERE user_id=?`,
    ).bind(session.userId).first<{ n: number }>()
    expect(after!.n).toBe(before!.n)
  })
})

describe('12.3 — the inbound card names what the figure was carrying', () => {
  it('requires all nine answers and reports the verdict the last two imply', async () => {
    const res = await post('/api/lab/inbound', session, {
      text: 'Everyone agrees this is the only responsible path forward.',
      emphasis: '"everyone" and "only"',
      expectation_created: 'That disagreeing puts me outside the group.',
      what_is_repeated: 'The appeal to consensus, twice in one sentence.',
      what_is_omitted: 'Who "everyone" is, and what the other paths were.',
      emotion_activated: 'The fear of being the lone objector.',
      action_wanted: 'Agreement without asking for the alternatives.',
      independently_supported: false,
      survives_plain_statement: false,
    })
    expect(res.status).toBe(200)
    const body = await res.json<any>()
    expect(body.questions).toHaveLength(9)
    expect(body.verdict).toMatch(/carrying the claim rather than decorating it/)
  })

  it('refuses a card that skips a question', async () => {
    const res = await post('/api/lab/inbound', session, {
      text: 'Everyone agrees.',
      emphasis: 'everyone',
      expectation_created: 'That disagreement is deviance.',
      what_is_repeated: 'The consensus claim.',
      what_is_omitted: 'Who.',
      emotion_activated: 'Fear.',
      action_wanted: 'Agreement.',
      independently_supported: false,
      // survives_plain_statement omitted — the ninth question is the one that matters most.
    })
    expect(res.status).toBe(400)
  })
})

describe('12.4 — the red-team card is mandatory before a draft is deployed', () => {
  async function makeAttempt(): Promise<number> {
    const res = await post('/api/lab/attempt', session, {
      exercise_type: 'construct_original',
      answer: 'Friday is not a date I can hold. The 12th is.',
      why_not_obvious: 'The obvious move was to agree and renegotiate after the announcement.',
      occurred_on: '2026-08-23',
    })
    expect(res.status).toBe(200)
    return (await res.json<any>()).id
  }

  it('refuses the deploy transition when no card has been answered', async () => {
    const id = await makeAttempt()
    const res = await post(`/api/lab/attempt/${id}/deploy`, session, {})
    expect(res.status).toBe(409)
    const body = await res.json<any>()
    expect(body.error).toBe('RED-TEAM CARD REQUIRED')
    expect(body.reason).toMatch(/mandatory before any draft is marked/)
    expect(body.questions).toHaveLength(4)
  })

  it('refuses the transition while a defect stands, and allows it once clear', async () => {
    const id = await makeAttempt()
    const pressuring = await post('/api/lab/outbound', session, {
      attempt_id: id, draft: 'Friday is not a date I can hold. The 12th is.',
      overstates_certainty: false, hides_downside: false,
      pressures_rather_than_persuades: true, defensible_if_quoted: true,
    })
    expect(pressuring.status).toBe(200)
    const card = await pressuring.json<any>()
    expect(card.deployable).toBe(false)
    expect(card.failed).toEqual(['pressures'])
    expect(card.blocks).toMatch(/cannot be marked deployed/)

    const blocked = await post(`/api/lab/attempt/${id}/deploy`, session, {})
    expect(blocked.status).toBe(409)
    expect((await blocked.json<any>()).error).toBe('RED-TEAM CARD NOT CLEAR')

    const clean = await post('/api/lab/outbound', session, {
      attempt_id: id, draft: 'Friday is not a date I can hold. The 12th is.',
      overstates_certainty: false, hides_downside: false,
      pressures_rather_than_persuades: false, defensible_if_quoted: true,
    })
    expect((await clean.json<any>()).deployable).toBe(true)

    const deployed = await post(`/api/lab/attempt/${id}/deploy`, session, {})
    expect(deployed.status).toBe(200)
    const body = await deployed.json<any>()
    expect(body.deployed).toBe(true)
    // The pivot table arrives with the deployment, because the branches exist so the
    // decision is not made at the moment of pressure.
    expect(body.pivots).toHaveLength(4)

    const row = await env.DB.prepare(
      `SELECT deployed, deployed_on FROM rhetoric_attempts WHERE id=?`,
    ).bind(id).first<any>()
    expect(row.deployed).toBe(1)
    expect(row.deployed_on).toBeTruthy()
  })

  it('fails the Daylight Test on a NO, where the other three fail on a YES', async () => {
    const id = await makeAttempt()
    const res = await post('/api/lab/outbound', session, {
      attempt_id: id, draft: 'A draft I would not want quoted.',
      overstates_certainty: false, hides_downside: false,
      pressures_rather_than_persuades: false, defensible_if_quoted: false,
    })
    const body = await res.json<any>()
    expect(body.deployable).toBe(false)
    expect(body.failed).toEqual(['defensible_if_quoted'])
    expect(body.daylightTest).toMatch(/every scripted exchange/)
  })

  it('refuses a card that leaves a question unanswered', async () => {
    const res = await post('/api/lab/outbound', session, {
      draft: 'A draft.', overstates_certainty: false, hides_downside: false,
      pressures_rather_than_persuades: false,
    })
    expect(res.status).toBe(400)
  })
})

describe('12.6 — detection proposes, and his correction is the training signal', () => {
  it('proposes a tag, stores it as unscored, and never writes it as fact', async () => {
    const res = await post('/api/lab/detect', session, {
      text: 'I asked for the timeline. I asked for the owner. I asked for the date.',
    })
    expect(res.status).toBe(200)
    const body = await res.json<any>()
    expect(body.status).toBe('PROPOSED')
    expect(body.proposed).toContain('anaphora')
    expect(body.detection).toMatch(/proposes tags/)

    const row = await env.DB.prepare(
      `SELECT proposed, corrected, was_correct FROM figure_detections WHERE id=?`,
    ).bind(body.id).first<any>()
    // Unscored, not wrong: nobody has said yet whether the proposal was right.
    expect(row.was_correct).toBeNull()
    expect(row.corrected).toBeNull()
  })

  it('scores the proposal only against HIS correction', async () => {
    const made = await post('/api/lab/detect', session, {
      text: 'I asked for the timeline. I asked for the owner. I asked for the date.',
    })
    const id = (await made.json<any>()).id

    const corrected = await post(`/api/lab/detect/${id}/correct`, session, {
      corrected: ['anaphora', 'isocolon'],
    })
    expect(corrected.status).toBe(200)
    const body = await corrected.json<any>()
    expect(body.wasCorrect).toBe(false)
    expect(body.corrected).toEqual(['anaphora', 'isocolon'])

    const row = await env.DB.prepare(
      `SELECT corrected, was_correct FROM figure_detections WHERE id=?`,
    ).bind(id).first<any>()
    expect(row.was_correct).toBe(0)
    expect(JSON.parse(row.corrected)).toEqual(['anaphora', 'isocolon'])
  })

  it('records a correct proposal as correct when his correction matches it', async () => {
    const made = await post('/api/lab/detect', session, {
      text: 'The plan was ambitious. The budget was ambitious. The timeline was ambitious.',
    })
    const body = await made.json<any>()
    const res = await post(`/api/lab/detect/${body.id}/correct`, session, {
      corrected: body.proposed,
    })
    expect((await res.json<any>()).wasCorrect).toBe(true)
  })

  it('refuses a correction naming a figure that has no record', async () => {
    const made = await post('/api/lab/detect', session, { text: 'A plain sentence.' })
    const id = (await made.json<any>()).id
    const res = await post(`/api/lab/detect/${id}/correct`, session, {
      corrected: ['not_a_figure'],
    })
    expect(res.status).toBe(404)
  })

  it('reports uncorrected rows as awaiting his correction, never as zero', async () => {
    await post('/api/lab/detect', session, { text: 'A plain sentence with nothing in it.' })
    const body = await (await get('/api/lab/detections', session)).json<any>()
    const pending = body.detections.filter((d: any) => d.was_correct === null)
    expect(pending.length).toBeGreaterThan(0)
    expect(pending[0].status).toBe('AWAITING HIS CORRECTION')
  })

  it('only ever proposes slugs that have a real figure record behind them', async () => {
    const made = await post('/api/lab/detect', session, {
      text: 'Was the delay avoidable? It was. We chose the date before we chose the scope.',
    })
    const proposed: string[] = (await made.json<any>()).proposed
    for (const slug of proposed) {
      const figure = await env.DB.prepare(`SELECT slug FROM figures WHERE slug=?`)
        .bind(slug).first()
      expect(figure, `${slug} must be a real record`).toBeTruthy()
    }
  })
})

describe('12.7 the Response Lab: eleven intents, four layers, six criteria', () => {
  it('serves the eleven intents with their architectures and their logic', async () => {
    const res = await get('/api/lab/response/intents', session)
    expect(res.status).toBe(200)
    const body = await res.json<any>()
    expect(body.intents).toHaveLength(11)
    expect(body.intents.map((i: any) => i.slug)).toEqual([...RESPONSE_INTENTS])
    // The architecture is the curriculum; the logic is what makes it adaptable rather
    // than recitable. 12.7: never give the line alone.
    for (const intent of body.intents) {
      expect(intent.architecture).toMatch(/->/)
      expect(intent.logic.length, intent.slug).toBeGreaterThan(200)
    }
    expect(body.neverTheLineAlone).toMatch(/give the logic of the line so it can be adapted/)
  })

  it('names the exact stage sequence Book 12.7 gives each intent', async () => {
    // The stage names ARE the curriculum. A renamed stage is a different drill, so they
    // are pinned rather than paraphrased.
    const body = await (await get('/api/lab/response/intents', session)).json<any>()
    const architecture = new Map<string, string>(
      body.intents.map((i: any) => [i.slug, i.architecture]),
    )
    expect(architecture.get('boundary')).toBe('observation -> standard -> consequence -> exit')
    expect(architecture.get('pressure')).toBe('acknowledge -> pause -> verify -> decide')
    expect(architecture.get('loaded_question'))
      .toBe('reject the false premise -> state the corrected question -> answer')
    expect(architecture.get('pause'))
      .toBe('delay the commitment -> do not disappear -> do not bluff')
  })

  it('refuses a build missing a layer', async () => {
    const res = await post('/api/lab/response', session, {
      intent_slug: 'boundary',
      situation: 'He raised his voice in the review again.',
      layer_intent: 'Name the standard without making it a fight.',
      layer_truth: 'It happened twice and I let the first one pass.',
      layer_structure: 'Observation, then the standard, then what happens next.',
      layer_delivery: '',
      occurred_on: '2026-08-23',
    })
    expect(res.status).toBe(400)
  })

  it('stores a four-layer build and marks escalation risk as the inverted criterion', async () => {
    const res = await post('/api/lab/response', session, {
      intent_slug: 'boundary',
      situation: 'He raised his voice in the review again.',
      layer_intent: 'Name the standard without making it a fight.',
      layer_truth: 'It happened twice and I let the first one pass, which taught him it was free.',
      layer_structure: 'Observation, then the standard, then the consequence, then the exit.',
      layer_delivery: 'Level, slower than his, and stop after the exit line.',
      a_appropriateness: 3, a_clarity: 3, a_proportionality: 2,
      a_naturalness: 2, a_objective_achieved: 3, a_escalation_risk: 1,
      occurred_on: '2026-08-23',
    })
    expect(res.status).toBe(200)
    const body = await res.json<any>()
    expect(body.intent.architecture).toBe('observation -> standard -> consequence -> exit')
    expect(body.assessment).toHaveLength(6)
    const risk = body.assessment.find((a: any) => a.slug === 'escalation_risk')
    expect(risk.inverted).toBe(true)
    expect(risk.better).toBe('lower')
    expect(risk.score).toBe(1)
    expect(body.assessment.filter((a: any) => a.inverted)).toHaveLength(1)
    expect(body.escalationRiskNote).toMatch(/No view may render it as progress/)
  })

  it('refuses an intent that is not one of the eleven', async () => {
    const res = await post('/api/lab/response', session, {
      intent_slug: 'intimidate',
      situation: 'A room.',
      layer_intent: 'a', layer_truth: 'b', layer_structure: 'c', layer_delivery: 'd',
      occurred_on: '2026-08-23',
    })
    expect(res.status).toBe(400)
  })

  it('returns every stored build with the architecture of its intent attached', async () => {
    await post('/api/lab/response', session, {
      intent_slug: 'repair',
      situation: 'I missed the handover and he found out from someone else.',
      layer_intent: 'Repair it without performing the apology.',
      layer_truth: 'I forgot, and the reason does not change what it cost him.',
      layer_structure: 'The impact, then the intent, then the next step.',
      layer_delivery: 'Short. No qualifiers. Stop after the next step.',
      occurred_on: '2026-08-23',
    })
    const body = await (await get('/api/lab/responses', session)).json<any>()
    expect(body.builds.length).toBeGreaterThan(0)
    expect(body.builds[0].architecture)
      .toBe('name the impact -> clarify the intent -> propose the next step')
    expect(body.layers.map((l: any) => l.slug))
      .toEqual(['intent', 'truth', 'structure', 'delivery'])
  })
})
