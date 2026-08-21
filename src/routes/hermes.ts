// Book 7 refactor — the COUNCIL / model-facing routes (Book 5.6). Owner-only
// Hermes chat, morning council, history, and intel analysis. The model boundary
// (budgets, fences, allowlist, structured output) lives in ../ai; these routes
// build the fenced prompt in the fixed trust order and persist the result.
import { Hono } from 'hono'
import type { Bindings, Variables } from '../env'
import { parseJson, parseValue, parseEmptyBody } from '../validation'
import { withIdempotency, requestId } from '../request-support'
import { safeDate } from '../clock'
import { randHex } from '../crypto'
import { hermesBriefing } from '../commanders-file'
import { callModel, fencedModelData, EXTERNAL_MESSAGE_PREFIX, modelAudit, modelBaseURL } from '../ai'
import { hermesBodySchema, councilBodySchema, positiveIdSchema, MODEL_USER_INPUT_CHARS } from '../schemas'

export function registerHermesRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {
// ============ HERMES — the autonomous counsel ============
// hermesBriefing extracted to ./commanders-file (Book 7).

// AI / model service extracted to ./ai (Book 5.6 / Book 7).

app.post('/api/hermes', async (c) => withIdempotency(c, 'hermes:chat', async () => {
  const DB = c.env.DB
  const { message, date } = await parseJson(c, hermesBodySchema)
  const userId = c.get('userId')
  const today = await safeDate(DB, date, userId)
  if (message.length > MODEL_USER_INPUT_CHARS) {
    return c.json({ error: 'MODEL INPUT TOO LARGE' }, 413)
  }
  if (!c.env.OPENAI_API_KEY || !modelBaseURL(c)) {
    await modelAudit(DB, {
      userId,
      requestId: `model_${randHex(16)}`,
      route: 'hermes:chat',
      eventType: 'offline',
      inputChars: message.length,
    })
    return c.json({ error: 'MODEL SERVICE OFFLINE' }, 503)
  }

  const briefing = await hermesBriefing(DB, userId, today)
  const history = ((await DB.prepare(
    `SELECT role, content FROM hermes_messages WHERE user_id=? ORDER BY id DESC LIMIT 12`,
  ).bind(userId).all()).results as any[]).reverse()
  const transcript = history.map((item: any) => ({
    role: String(item.role),
    content: String(item.content),
  }))
  const externalMessages = transcript.filter((item) =>
    item.content.startsWith(EXTERNAL_MESSAGE_PREFIX))
  const journalMessages = transcript.filter((item) =>
    !item.content.startsWith(EXTERNAL_MESSAGE_PREFIX))
  const result = await callModel(c, 'hermes:chat', [
    { role: 'user', content: `USER REQUEST:\n${message}` },
    {
      role: 'user',
      content: fencedModelData('RETRIEVED_SOURCE_CONTENT', briefing),
    },
    {
      role: 'user',
      content: fencedModelData(
        'PERSONAL_JOURNAL_CONTENT',
        journalMessages.map((item) => `[${item.role}] ${item.content}`).join('\n'),
      ),
    },
    {
      role: 'user',
      content: fencedModelData(
        'QUOTED_EXTERNAL_MESSAGES',
        externalMessages.map((item) =>
          `[${item.role}] ${item.content.slice(EXTERNAL_MESSAGE_PREFIX.length)}`)
          .join('\n'),
      ),
    },
  ])
  if (result.response) return result.response

  await DB.batch([
    DB.prepare(
      `INSERT INTO hermes_messages (user_id, role, content, context_date)
       VALUES (?, 'user', ?, ?)`,
    ).bind(userId, message, today),
    DB.prepare(
      `INSERT INTO hermes_messages (user_id, role, content, context_date)
       VALUES (?, 'assistant', ?, ?)`,
    ).bind(userId, result.answer, today),
  ])
  return c.json({ answer: result.answer })
}))

app.get('/api/hermes/history', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM hermes_messages WHERE user_id=? ORDER BY id DESC LIMIT 40`,
  ).bind(c.get('userId')).all()
  return c.json((results as any[]).reverse())
})

// Morning war council: Hermes proactively reviews the file and issues the day's orders
app.post('/api/hermes/council', async (c) => withIdempotency(c, 'hermes:council', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { date } = await parseJson(c, councilBodySchema)
  const today = await safeDate(DB, date, userId)
  if (!c.env.OPENAI_API_KEY || !modelBaseURL(c)) {
    await modelAudit(DB, {
      userId,
      requestId: `model_${randHex(16)}`,
      route: 'hermes:council',
      eventType: 'offline',
    })
    return c.json({ error: 'MODEL SERVICE OFFLINE' }, 503)
  }
  const briefing = await hermesBriefing(DB, userId, today)
  const result = await callModel(c, 'hermes:council', [
    {
      role: 'user',
      content: `USER REQUEST:\nConvene the war council for ${today}. Deliver: 1) STATE OF THE COMMANDER — the single most important pattern in recent data, with evidence. 2) THREAT ASSESSMENT — the biggest current vulnerability. 3) COMMENDATION — one real win to build on. 4) TODAY'S ORDERS — the one concrete move that matters most today. Keep it under 300 words.`,
    },
    {
      role: 'user',
      content: fencedModelData('RETRIEVED_SOURCE_CONTENT', briefing),
    },
  ])
  if (result.response) return result.response
  await DB.prepare(
    `INSERT INTO hermes_messages (user_id, role, content, context_date)
     VALUES (?, 'assistant', ?, ?)`,
  ).bind(
    userId,
    `[MORNING WAR COUNCIL ${today}]\n${result.answer}`,
    today,
  ).run()
  return c.json({ answer: result.answer })
}))

// Hermes analysis of a specific intel entry
app.post('/api/intel/:id/analyze', async (c) => withIdempotency(c, 'intel:analyze', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  await parseEmptyBody(c)
  const entry = await DB.prepare(
    `SELECT * FROM captures WHERE kind='intel' AND id=? AND user_id=?`,
  ).bind(id, userId).first<any>()
  if (!entry) return c.json({ error: 'No such entry' }, 404)
  if (!c.env.OPENAI_API_KEY || !modelBaseURL(c)) {
    await modelAudit(DB, {
      userId,
      requestId: `model_${randHex(16)}`,
      route: 'intel:analyze',
      eventType: 'offline',
    })
    return c.json({ error: 'MODEL SERVICE OFFLINE' }, 503)
  }
  const untrustedEntry = JSON.stringify({
    domain: entry.domain,
    title: entry.title,
    situation: entry.situation,
    myMove: entry.my_move,
    outcome: entry.outcome,
    people: entry.people,
  })
  if (untrustedEntry.length > MODEL_USER_INPUT_CHARS) {
    return c.json({ error: 'MODEL INPUT TOO LARGE' }, 413)
  }
  const result = await callModel(c, 'intel:analyze', [
    {
      role: 'user',
      content: `USER REQUEST:\nAnalyze the separately fenced move. Give: 1) VERDICT (smart/dumb/mixed). 2) THE PRINCIPLE — the exact applicable Sun Tzu, Machiavelli, or Stoic principle. 3) THE MASTER MOVE. 4) THE PATTERN WARNING. Max 200 words.`,
    },
    {
      role: 'user',
      content: fencedModelData('RETRIEVED_SOURCE_CONTENT', untrustedEntry),
    },
  ])
  if (result.response) return result.response
  await DB.prepare(
    `UPDATE captures SET hermes_analysis=? WHERE kind='intel' AND id=? AND user_id=?`,
  ).bind(result.answer, id, userId).run()
  return c.json({ analysis: result.answer })
}))
}
