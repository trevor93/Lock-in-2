// Book 7 refactor — the read-only state builder (Book 5.3/6).
// Assembles the NOW/DAY heartbeat for GET /api/state from the materialised
// day_summary and today's live blocks: current/next block, weighted adherence,
// O(1) streak, delta vs the trailing median, flags, due counts, active units,
// appeal availability, and the cheap re-entry (needsCatchup) signal. No writes.
import { blocksForDate } from './repositories'
import { dayAdherence } from './scoring'
import { isMandatory, needsAnchors, ANCHOR_TARGET } from './ratchet'
import { computeStreak, trailingMedian } from './streak'
import { addDays, isoWeekKey } from './time'

export async function buildState(DB: D1Database, userId: number, date: string, time: string) {
  const blocks = await blocksForDate(DB, userId, date)
  const current = blocks.find((b: any) => b.start_time <= time && time < b.end_time) || null
  const next = blocks.find((b: any) => b.start_time > time) || null
  const adh = dayAdherence(blocks)
  const streak = await computeStreak(DB, userId, date)

  const pts = await DB.prepare(
    `SELECT COALESCE(SUM(points),0) as total FROM points_ledger WHERE user_id=?`,
  ).bind(userId).first<{ total: number }>()
  const todayPts = await DB.prepare(
    `SELECT COALESCE(SUM(points),0) as total FROM points_ledger WHERE user_id=? AND log_date=?`,
  ).bind(userId, date).first<{ total: number }>()
  const flags = (await DB.prepare(
    `SELECT * FROM honesty_flags WHERE user_id=? AND acknowledged=0 ORDER BY created_at DESC LIMIT 20`,
  ).bind(userId).all()).results
  const debrief = await DB.prepare(
    `SELECT * FROM debriefs WHERE user_id=? AND log_date=?`,
  ).bind(userId, date).first()
  const yDebrief = await DB.prepare(
    `SELECT * FROM debriefs WHERE user_id=? AND log_date=?`,
  ).bind(userId, addDays(date, -1)).first()
  const dueCards = await DB.prepare(
    `SELECT COUNT(*) as n FROM flashcards WHERE user_id=? AND due_date <= ?`,
  ).bind(userId, date).first<{ n: number }>()
  const dueTongue = await DB.prepare(
    `SELECT COUNT(*) as n FROM review_items s
     JOIN captures r ON r.id=s.item_id AND r.user_id=s.user_id AND r.kind='response'
     WHERE s.kind='response' AND s.user_id=? AND r.archived=0 AND s.due_date <= ?`
  ).bind(userId, date).first<{ n: number }>().catch(() => ({ n: 0 }))

  // active units per track
  const activeUnits = (await DB.prepare(
    `SELECT u.id, u.title, p.code, p.title as phase_title, p.track, up.status
     FROM units u JOIN phases p ON p.id=u.phase_id JOIN unit_progress up ON up.unit_id=u.id
     WHERE up.user_id=? AND up.status NOT IN ('locked','complete')
     ORDER BY p.sort_order, u.sort_order`
  ).bind(userId).all()).results

  // delta scoring vs trailing 14-day median + appeal availability + active load reductions
  const median = await trailingMedian(DB, userId, date)
  const weekKey = isoWeekKey(date)
  const appealUsed = await DB.prepare(
    `SELECT id FROM appeals WHERE user_id=? AND week_key=?`,
  ).bind(userId, weekKey).first()
  const loadReductions = (await DB.prepare(
    `SELECT lr.*, b.title FROM load_reductions lr
     JOIN schedule_blocks b ON b.id=lr.block_id AND b.user_id=lr.user_id
     WHERE lr.user_id=? AND lr.end_date >= ? ORDER BY lr.start_date DESC`
  ).bind(userId, date).all().catch(() => ({ results: [] as any[] }))).results
  const openPredictions = await DB.prepare(
    `SELECT COUNT(*) n FROM predictions
     WHERE user_id=? AND outcome='unresolved' AND resolve_by <= ?`
  ).bind(userId, date).first<any>().catch(() => ({ n: 0 }))

  // Re-entry signal (Book 8.6): auto-offer /catchup after three consecutive
  // zero days. One bounded query so it does not inflate the /api/state budget.
  const recent = await DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM block_logs WHERE user_id=? AND log_date > ? AND log_date <= ? AND status IN ('done','partial')) AS blocks,
       (SELECT COUNT(*) FROM debriefs WHERE user_id=? AND log_date > ? AND log_date <= ?) AS debriefs`,
  ).bind(userId, addDays(date, -3), addDays(date, -1), userId, addDays(date, -3), addDays(date, -1))
    .first<{ blocks: number; debriefs: number }>().catch(() => ({ blocks: 1, debriefs: 0 }))
  const needsCatchup = ((recent as any)?.blocks ?? 0) === 0 && ((recent as any)?.debriefs ?? 0) === 0

  return {
    date, time, blocks, current, next, adherence: adh, streak,
    points: pts?.total ?? 0, todayPoints: todayPts?.total ?? 0,
    flags, debrief, debriefDoneToday: !!debrief,
    yesterdayTargets: (yDebrief as any)?.tomorrow_targets || null,
    dueCards: dueCards?.n ?? 0, dueTongue: (dueTongue as any)?.n ?? 0, activeUnits,
    median, delta: median === null ? null : adh.pct - median,
    appealAvailable: !appealUsed, loadReductions,
    // Book 8.1 — the ratchet, derived from the blocks already loaded (no extra query).
    // needsAnchors tells TODAY to ask him to name his three anchors instead of
    // scoring a day he never agreed to.
    ratchet: {
      mandatoryToday: blocks.filter(isMandatory).length,
      deckToday: blocks.filter((b: any) => !isMandatory(b)).length,
      anchorTarget: ANCHOR_TARGET,
      needsAnchors: needsAnchors(blocks as any[]),
    },
    duePredictions: (openPredictions as any)?.n ?? 0,
    needsCatchup
  }
}
