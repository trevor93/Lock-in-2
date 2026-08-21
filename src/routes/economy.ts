// Book 7 refactor — the economy/insights routes: the 7 laws + daily checks,
// the rewards store (race-safe redemption), the in-app scoring changelog
// (Book 4), and the STATS strip (14-day adherence, medals, the alternative-
// explanation counts). Reward/law writes are idempotent.
import { Hono } from 'hono'
import type { Bindings, Variables } from '../env'
import { normaliseTone, TONES, DEFAULT_TONE } from '../tone'
import { parseJson, parseValue, parseEmptyBody } from '../validation'
import { withIdempotency, requestId, auditEvent } from '../request-support'
import { safeDate, userNow } from '../clock'
import { addDays } from '../time'
import { blocksForDate, getSetting, setSetting } from '../repositories'
import { computeStreak } from '../streak'
import { dayAdherence } from '../scoring'
import { lawCheckBodySchema, positiveIdSchema, toneBodySchema } from '../schemas'

export function registerEconomyRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {

// Book 8.7 - the interface register. neutral | firm | military | compassionate,
// defaulting to firm. Military may be cold; it may never be abusive. This governs the
// INTERFACE only: Book 15 governs Hermes, and Hermes stays cold and exact regardless.
app.get('/api/tone', async (c) => {
  const value = await getSetting(c.env.DB, 'tone', c.get('userId'))
  return c.json({ tone: normaliseTone(value), options: TONES, default: DEFAULT_TONE })
})

app.post('/api/tone', async (c) => {
  const { tone } = await parseJson(c, toneBodySchema)
  await setSetting(c.env.DB, 'tone', tone, c.get('userId'))
  return c.json({ ok: true, tone })
})
// ============ LAWS ============
app.get('/api/laws', async (c) => {
  const userId = c.get('userId')
  const date = await safeDate(c.env.DB, c.req.query('date'), userId)
  const { results } = await c.env.DB.prepare(
    `SELECT l.*, lc.kept, lc.note FROM laws l
     LEFT JOIN law_checks lc ON lc.law_id=l.id AND lc.log_date=? AND lc.user_id=?
     ORDER BY l.sort_order`
  ).bind(date, userId).all()
  return c.json(results)
})
app.post('/api/laws/:id/check', async (c) => withIdempotency(c, 'law:check', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const lawId = parseValue(positiveIdSchema, c.req.param('id'))
  const { date, kept, note } = await parseJson(c, lawCheckBodySchema)
  const existing = await DB.prepare(
    `SELECT id FROM law_checks WHERE user_id=? AND law_id=? AND log_date=?`,
  ).bind(userId, lawId, date).first<{ id: number }>()
  if (existing) {
    await DB.prepare(
      `UPDATE law_checks SET kept=?, note=? WHERE id=? AND user_id=?`,
    ).bind(kept ? 1 : 0, note || null, existing.id, userId).run()
  } else {
    await DB.prepare(
      `INSERT INTO law_checks (user_id, law_id, log_date, kept, note) VALUES (?,?,?,?,?)`,
    ).bind(userId, lawId, date, kept ? 1 : 0, note || null).run()
  }
  return c.json({ ok: true })
}))

// ============ REWARDS ============
app.get('/api/rewards', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM rewards ORDER BY cost`).all()
  return c.json(results)
})
app.post('/api/rewards/:id/redeem', async (c) => withIdempotency(c, 'reward:redeem', async () => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const id = parseValue(positiveIdSchema, c.req.param('id'))
  await parseEmptyBody(c)
  const { date } = await userNow(DB, userId) // server clock
  const reward = await DB.prepare(`SELECT * FROM rewards WHERE id=?`).bind(id).first<any>()
  if (!reward) return c.json({ error: 'no reward' }, 404)
  // RACE-SAFE: the debit INSERT itself re-checks this owner's balance atomically.
  const debit = await DB.prepare(
    `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type, ref_id)
     SELECT ?, ?, ?, ?, 'reward', ?
     WHERE (SELECT COALESCE(SUM(points),0) FROM points_ledger WHERE user_id=?) >= ?`
  ).bind(userId, date, -reward.cost, `REWARD REDEEMED: ${reward.title} (-${reward.cost})`, id, userId, reward.cost).run()
  if ((debit.meta as any).changes === 0) {
    const pts = await DB.prepare(
      `SELECT COALESCE(SUM(points),0) as total FROM points_ledger WHERE user_id=?`,
    ).bind(userId).first<{ total: number }>()
    return c.json({ error: `NOT EARNED YET. You have ${pts?.total ?? 0} pts, this costs ${reward.cost}. Rewards are taken, not given. Back to work.` }, 400)
  }
  await DB.batch([
    DB.prepare(`UPDATE rewards SET redeemed_count=redeemed_count+1 WHERE id=?`).bind(id),
    DB.prepare(
      `INSERT INTO reward_redemptions (user_id, reward_id) VALUES (?,?)`,
    ).bind(userId, id),
  ])
  const rid = requestId(c)
  if (rid) {
    await auditEvent(DB, {
      userId, actorType: 'user', requestId: rid,
      action: 'reward.redeem', entityType: 'reward', entityId: id,
      after: { cost: reward.cost, log_date: date },
    })
  }
  return c.json({ ok: true })
}))

// ============ STATS ============
// ============ SCORING CHANGELOG (Book 4) ============
// "Every behavioural change to scoring ships with a one-line entry in a
// changelog visible inside the application — the operator must be able to see
// when the rules of his own game changed." Static, honest, newest first.
const SCORING_CHANGELOG: Array<{ date: string; change: string }> = [
  { date: '2026-08-20', change: 'Minimum Viable Recovery: on a declared breach day, one logged restoring action makes the day survive the streak — survival, never a victory.' },
  { date: '2026-08-20', change: 'Alternative-explanation brake: a capture logged with non-calm heat now requires a written alternative explanation; a rising "none plausible" count is surfaced as the paranoia tell.' },
  { date: '2026-08-20', change: 'Duplicate delivery of the same request (retries, double-taps) can no longer create a second consequence; enforcement run twice awards once.' },
  { date: '2026-08-12', change: 'Reforge wave 1: weighted adherence (CORE 3 / STANDARD 1 / CONTEXT 0), the Minimum Viable Day HELD-THE-LINE bonus, load reduction on repeated misses, delta scoring against your trailing 14-day median, and the weekly appeal token.' },
]

app.get('/api/changelog', async (c) => {
  return c.json(SCORING_CHANGELOG)
})

app.get('/api/stats', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const date = await safeDate(DB, c.req.query('date'), userId)
  // 14-day strip straight from day_summary (2 queries, not 28+)
  const from14 = addDays(date, -13)
  const sumRows = (await DB.prepare(
    `SELECT * FROM day_summary WHERE user_id=? AND summary_date BETWEEN ? AND ?`
  ).bind(userId, from14, date).all()).results as any[]
  const debRows = (await DB.prepare(
    `SELECT log_date, sleep_hours, mood, energy FROM debriefs
     WHERE user_id=? AND log_date BETWEEN ? AND ?`
  ).bind(userId, from14, date).all()).results as any[]
  const sumBy = new Map(sumRows.map(r => [r.summary_date, r]))
  const debBy = new Map(debRows.map(r => [r.log_date, r]))
  const days = [] as any[]
  for (let i = 13; i >= 0; i--) {
    const d = addDays(date, -i)
    const s = sumBy.get(d), deb = debBy.get(d)
    // today (or an unmaterialized day) falls back to live computation once
    let pct = s?.adherence_pct ?? null, done = s?.blocks_done ?? 0, total = s?.blocks_total ?? 0, mvd = !!s?.mvd_held
    if (pct === null && d === date) {
      const adh = dayAdherence(await blocksForDate(DB, userId, d))
      pct = adh.pct; done = Math.round(adh.done); total = adh.total; mvd = adh.mvdHeld
    }
    days.push({ date: d, pct: pct ?? 0, done, total, mvdHeld: mvd, sleep: deb?.sleep_hours ?? null, mood: deb?.mood ?? null, energy: deb?.energy ?? null, debrief: !!deb })
  }
  // category breakdown last 7 days
  const from = addDays(date, -6)
  const { results: catRows } = await DB.prepare(
    `SELECT b.category, COUNT(*) as total,
            SUM(CASE WHEN l.status='done' THEN 1 WHEN l.status='partial' THEN 0.5 ELSE 0 END) as done
     FROM block_logs l JOIN schedule_blocks b ON b.id=l.block_id AND b.user_id=l.user_id
     WHERE l.user_id=? AND l.log_date BETWEEN ? AND ? GROUP BY b.category`
  ).bind(userId, from, date).all()
  const ledger = (await DB.prepare(
    `SELECT * FROM points_ledger WHERE user_id=? ORDER BY created_at DESC LIMIT 40`,
  ).bind(userId).all()).results
  const unitStats = await DB.prepare(
    `SELECT COUNT(*) as total, SUM(CASE WHEN status='complete' THEN 1 ELSE 0 END) as complete
     FROM unit_progress WHERE user_id=?`,
  ).bind(userId).first<any>()
  const cardStats = await DB.prepare(
    `SELECT COUNT(*) as reviews, AVG(grade) as avg_grade FROM card_reviews WHERE user_id=?`,
  ).bind(userId).first<any>()
  const flagCounts = (await DB.prepare(
    `SELECT flag_type, COUNT(*) as n FROM honesty_flags WHERE user_id=? GROUP BY flag_type`,
  ).bind(userId).all()).results
  const streak = await computeStreak(DB, userId, date)
  const pts = await DB.prepare(
    `SELECT COALESCE(SUM(points),0) as total FROM points_ledger WHERE user_id=?`,
  ).bind(userId).first<{ total: number }>()

  // ── MEDALS (war decorations, computed live — earned, never given) ──
  const debriefCount = (await DB.prepare(
    `SELECT COUNT(*) as n FROM debriefs WHERE user_id=?`,
  ).bind(userId).first<any>())?.n ?? 0
  const chaptersDone = (await DB.prepare(
    `SELECT COUNT(*) as n FROM book_progress WHERE user_id=? AND status='done'`,
  ).bind(userId).first<any>())?.n ?? 0
  const booksDone = (await DB.prepare(
    `SELECT COUNT(*) as n FROM (
       SELECT book_id, COUNT(*) c FROM book_progress
       WHERE user_id=? AND status='done' GROUP BY book_id HAVING c >= 12
     )`,
  ).bind(userId).first<any>())?.n ?? 0
  const intelCount = (await DB.prepare(
    `SELECT COUNT(*) as n FROM captures WHERE kind='intel' AND user_id=?`,
  ).bind(userId).first<any>())?.n ?? 0
  const examsPassed = (await DB.prepare(
    `SELECT COUNT(*) as n FROM unit_progress up JOIN units u ON u.id=up.unit_id
     WHERE up.user_id=? AND u.is_exam=1 AND up.status='complete'`,
  ).bind(userId).first<any>())?.n ?? 0
  const earlyWakes = (await DB.prepare(
    `SELECT COUNT(*) as n FROM debriefs
     WHERE user_id=? AND wake_time IS NOT NULL AND wake_time <= '06:00'`,
  ).bind(userId).first<any>())?.n ?? 0
  const victoryDays = days.filter(d => d.pct >= 80 && d.debrief).length
  const reviews = cardStats?.reviews ?? 0
  const unitsWon = unitStats?.complete ?? 0
  const totalFlags = (flagCounts as any[]).reduce((a: number, f: any) => a + f.n, 0)
  const medals = [
    { id: 'first_blood',   icon: 'fa-droplet',        title: 'FIRST BLOOD',        desc: 'Complete your first block',            earned: (pts?.total ?? 0) !== 0 || debriefCount > 0 || unitsWon > 0 },
    { id: 'scribe',        icon: 'fa-feather-pointed', title: 'THE SCRIBE',        desc: 'File 7 night debriefs',                earned: debriefCount >= 7,  prog: Math.min(debriefCount, 7),  goal: 7 },
    { id: 'chronicler',    icon: 'fa-scroll',          title: 'CHRONICLER',        desc: 'File 30 night debriefs',               earned: debriefCount >= 30, prog: Math.min(debriefCount, 30), goal: 30 },
    { id: 'week_of_iron',  icon: 'fa-fire',            title: 'WEEK OF IRON',      desc: '7-day victory streak',                 earned: streak >= 7,  prog: Math.min(streak, 7),  goal: 7 },
    { id: 'month_of_steel',icon: 'fa-fire-flame-curved',title:'MONTH OF STEEL',    desc: '30-day victory streak',                earned: streak >= 30, prog: Math.min(streak, 30), goal: 30 },
    { id: 'dawn_raider',   icon: 'fa-sun',             title: 'DAWN RAIDER',       desc: 'Wake by 06:00 ten times',              earned: earlyWakes >= 10, prog: Math.min(earlyWakes, 10), goal: 10 },
    { id: 'first_conquest',icon: 'fa-flag',            title: 'FIRST CONQUEST',    desc: 'Conquer your first campaign unit',     earned: unitsWon >= 1 },
    { id: 'strategist',    icon: 'fa-chess-knight',    title: 'STRATEGIST',        desc: 'Conquer 10 campaign units',            earned: unitsWon >= 10, prog: Math.min(unitsWon, 10), goal: 10 },
    { id: 'gatekeeper',    icon: 'fa-shield-halved',   title: 'GATEKEEPER',        desc: 'Pass an integration exam',             earned: examsPassed >= 1 },
    { id: 'bookworm',      icon: 'fa-book-open',       title: 'DEEP READER',       desc: 'Conquer 25 real chapters',             earned: chaptersDone >= 25, prog: Math.min(chaptersDone, 25), goal: 25 },
    { id: 'librarian',     icon: 'fa-crown',           title: 'MASTER OF TEXTS',   desc: 'Finish a complete book',               earned: booksDone >= 1 },
    { id: 'drillmaster',   icon: 'fa-layer-group',     title: 'DRILLMASTER',       desc: '100 flashcard reviews',                earned: reviews >= 100, prog: Math.min(reviews, 100), goal: 100 },
    { id: 'spymaster',     icon: 'fa-user-secret',     title: 'SPYMASTER',         desc: 'File 15 life-intel entries',           earned: intelCount >= 15, prog: Math.min(intelCount, 15), goal: 15 },
    { id: 'clean_record',  icon: 'fa-scale-balanced',  title: 'CLEAN RECORD',      desc: '14 days, zero honesty flags, 5+ victory days', earned: totalFlags === 0 && victoryDays >= 5 },
    { id: 'sovereign',     icon: 'fa-dragon',          title: 'SOVEREIGN',         desc: 'Reach 10,000 points',                  earned: (pts?.total ?? 0) >= 10000, prog: Math.min(Math.max(pts?.total ?? 0, 0), 10000), goal: 10000 },
  ]

  // Book 13.2 — the brake counts. A rising nonePlausible is the paranoia tell,
  // surfaced here so the operator can actually see it.
  const altCounts = await DB.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(none_plausible),0) AS none_plausible
     FROM alternative_explanations WHERE user_id=?`,
  ).bind(userId).first<{ total: number; none_plausible: number }>()

  return c.json({
    days, categories: catRows, ledger, unitStats, cardStats, flagCounts,
    streak, points: pts?.total ?? 0, medals,
    alternativeExplanations: {
      total: altCounts?.total ?? 0,
      nonePlausible: altCounts?.none_plausible ?? 0,
    },
  })
})
}
