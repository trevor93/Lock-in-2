// Book 7 refactor — streak and delta-scoring service.
// Reads the materialised day_summary (O(1), no N+1) to compute the current
// streak (victory extends; MVD/MVR survive-neutral) and the trailing 14-day
// adherence median for delta scoring. Depends on repositories/time/scoring.
import { getSetting, blocksForDate } from './repositories'
import { addDays } from './time'
import { dayAdherence } from './scoring'

export async function computeStreak(DB: D1Database, userId: number, today: string): Promise<number> {
  const startDate = (await getSetting(DB, 'start_date', userId)) || today
  const { results } = await DB.prepare(
    `SELECT summary_date, victory, mvd_held, mvr_held FROM day_summary
     WHERE user_id=? AND summary_date < ? AND summary_date >= ?
     ORDER BY summary_date DESC LIMIT 180`
  ).bind(userId, today, startDate).all()
  const byDate = new Map((results as any[]).map(r => [r.summary_date, r]))
  let streak = 0
  let d = addDays(today, -1)
  for (let i = 0; i < 180; i++) {
    if (d < startDate) break
    const r = byDate.get(d)
    if (r?.victory) streak++
    else if (r?.mvd_held || r?.mvr_held) { /* survives, contributes nothing */ }
    else break
    d = addDays(d, -1)
  }
  // today counts live if already qualifying
  const tBlocks = await blocksForDate(DB, userId, today)
  const tDeb = await DB.prepare(`SELECT id FROM debriefs WHERE user_id=? AND log_date=?`).bind(userId, today).first()
  if (tDeb && dayAdherence(tBlocks).pct >= 80) streak++
  return streak
}

// DELTA SCORING — today vs your trailing 14-day median (review Tier-1 #4).
// The fixed 80% stays visible as the horizon; the fight is vs yesterday's self.
export async function trailingMedian(DB: D1Database, userId: number, today: string): Promise<number | null> {
  const { results } = await DB.prepare(
    `SELECT adherence_pct FROM day_summary
     WHERE user_id=? AND summary_date < ? AND summary_date >= ? AND blocks_total > 0
     ORDER BY summary_date DESC LIMIT 14`
  ).bind(userId, today, addDays(today, -14)).all()
  const v = (results as any[]).map(r => r.adherence_pct).sort((a, b) => a - b)
  if (v.length < 3) return null // not enough history to be honest about a median
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2)
}
