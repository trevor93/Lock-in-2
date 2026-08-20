// Book 7 refactor — the Commander's File service (Book 16).
// Serialises live state from the database into two output modes: the model
// briefing injected after the system prompt, and the plain-text Session
// Continuity Brief (Book 14) that survives external compaction. Read-only.
import { getSetting, blocksForDate } from './repositories'
import { computeStreak } from './streak'
import { readChapterCursor } from './cursor'
import { dayAdherence } from './scoring'
import { addDays } from './time'

export async function hermesBriefing(DB: D1Database, userId: number, date: string): Promise<string> {
  const blocks = await blocksForDate(DB, userId, date)
  const adh = dayAdherence(blocks)
  const streak = await computeStreak(DB, userId, date)
  const pts = await DB.prepare(
    `SELECT COALESCE(SUM(points),0) as t FROM points_ledger WHERE user_id=?`,
  ).bind(userId).first<any>()
  const debriefs = (await DB.prepare(
    `SELECT * FROM debriefs WHERE user_id=? ORDER BY log_date DESC LIMIT 7`,
  ).bind(userId).all()).results as any[]
  const flags = (await DB.prepare(
    `SELECT * FROM honesty_flags WHERE user_id=? ORDER BY created_at DESC LIMIT 10`,
  ).bind(userId).all()).results as any[]
  const intel = (await DB.prepare(
    `SELECT * FROM intel_entries WHERE user_id=? ORDER BY id DESC LIMIT 15`,
  ).bind(userId).all()).results as any[]
  const units = (await DB.prepare(
    `SELECT u.title, p.code, up.status, up.drill_report FROM units u
     JOIN phases p ON p.id=u.phase_id JOIN unit_progress up ON up.unit_id=u.id
     WHERE up.user_id=? AND up.status NOT IN ('locked')
     ORDER BY p.sort_order, u.sort_order LIMIT 12`
  ).bind(userId).all()).results as any[]
  const lawBreaks = (await DB.prepare(
    `SELECT l.title, COUNT(*) n FROM law_checks lc JOIN laws l ON l.id=lc.law_id
     WHERE lc.user_id=? AND lc.kept=0 GROUP BY l.id ORDER BY n DESC LIMIT 3`
  ).bind(userId).all()).results as any[]

  const cursor = await readChapterCursor(DB, userId)
  return `=== COMMANDER'S FILE (auto-generated live from the War Room database) ===
DATE: ${date} | STREAK: ${streak} victory days | POINTS: ${pts?.t} | TODAY'S ADHERENCE SO FAR: ${adh.pct}% (${adh.done}/${adh.total})
CHAPTER CURSOR: Chapter ${cursor.chapter} — ${cursor.figure} (${cursor.book} / ${cursor.part}) · cycle day ${cursor.cycle_day} of 7

LAST 7 DEBRIEFS (his own words — wins / breaks / targets / insights / sleep):
${debriefs.map(d => `[${d.log_date}] WINS: ${d.wins || '—'} | BREAKS: ${d.breaks || '—'} | TARGETS: ${d.tomorrow_targets || '—'} | INSIGHT: ${d.strategy_insight || '—'} | sleep ${d.sleep_hours ?? '?'}h mood ${d.mood ?? '?'}/5`).join('\n') || '(no debriefs yet)'}

HONESTY FLAGS (his failures, logged by the system):
${flags.map(f => `[${f.flag_date}][${f.severity}] ${f.message}`).join('\n') || '(clean record)'}

MOST-BROKEN LAWS: ${lawBreaks.map(l => `"${l.title}" x${l.n}`).join(', ') || '(none logged)'}

CAMPAIGN STATE (strategy curriculum progress + his actual drill reports):
${units.map(u => `[${u.code}] ${u.title} — ${u.status}${u.drill_report ? ` | HIS DRILL REPORT: ${String(u.drill_report).slice(0, 200)}` : ''}`).join('\n') || '(not started)'}

LIFE INTEL (his logged real-world moves — smart & dumb — across loyalty, family, friends, network, money, relationships, manipulation-spotting):
${intel.map(i => `[${i.log_date}][${i.domain}][verdict:${i.verdict}] ${i.title} | SITUATION: ${(i.situation || '').slice(0, 150)} | HIS MOVE: ${(i.my_move || '').slice(0, 150)} | OUTCOME: ${(i.outcome || '').slice(0, 100)}`).join('\n') || '(no intel filed yet)'}
=== END FILE ===`
}

export async function continuityBrief(DB: D1Database, userId: number, date: string): Promise<string> {
  const cur = await readChapterCursor(DB, userId)
  const streak = await computeStreak(DB, userId, date)
  const pts = await DB.prepare(
    `SELECT COALESCE(SUM(points),0) AS t FROM points_ledger WHERE user_id=?`,
  ).bind(userId).first<{ t: number }>()
  const startDate = (await getSetting(DB, 'start_date', userId)) || date
  const msDay = 86400000
  const programmeDay = Math.max(1,
    Math.round((new Date(date + 'T12:00:00Z').getTime() - new Date(startDate + 'T12:00:00Z').getTime()) / msDay) + 1)

  // Completed works: books whose chapters are all done.
  const doneBooks = (await DB.prepare(
    `SELECT book_id, COUNT(*) c FROM book_progress
     WHERE user_id=? AND status='done' GROUP BY book_id HAVING c >= 12`,
  ).bind(userId).all()).results as any[]
  const unitsWon = (await DB.prepare(
    `SELECT COUNT(*) AS n FROM unit_progress WHERE user_id=? AND status='complete'`,
  ).bind(userId).first<{ n: number }>())?.n ?? 0

  // Due reviews as counts by kind (never content).
  const dueCards = (await DB.prepare(
    `SELECT COUNT(*) AS n FROM flashcards WHERE user_id=? AND due_date <= ?`,
  ).bind(userId, date).first<{ n: number }>())?.n ?? 0
  const dueTongue = (await DB.prepare(
    `SELECT COUNT(*) AS n FROM response_srs s JOIN responses r ON r.id=s.response_id AND r.user_id=s.user_id
     WHERE s.user_id=? AND r.archived=0 AND s.due_date <= ?`,
  ).bind(userId, date).first<{ n: number }>().catch(() => ({ n: 0 })))?.n ?? 0

  const lastDebrief = await DB.prepare(
    `SELECT log_date, tomorrow_targets FROM debriefs WHERE user_id=? ORDER BY log_date DESC LIMIT 1`,
  ).bind(userId).first<any>()

  return [
    '=== SESSION CONTINUITY BRIEF ===',
    `Generated: ${date} (server clock) · Programme day ${programmeDay}`,
    '',
    'ACTIVE FRONT',
    `  Book: ${cur.book}`,
    `  Part: ${cur.part}`,
    `  Chapter cursor: Chapter ${cur.chapter} — ${cur.figure}`,
    `  Cycle day: ${cur.cycle_day} of 7`,
    '',
    'PROGRESS',
    `  Streak: ${streak} victory day(s) · Points: ${pts?.t ?? 0}`,
    `  Campaign units conquered: ${unitsWon}`,
    `  Completed works (all chapters): ${doneBooks.length ? doneBooks.map((b) => b.book_id).join(', ') : 'none yet'}`,
    '',
    'REVIEW CADENCE (FSRS general queue; Farnsworth ladder 1·3·7·16·35)',
    `  Due flashcards: ${dueCards} · Due tongue drills: ${dueTongue}`,
    '',
    'PHASE POSITION',
    '  Phase 0 calibration complete; Phase 1 under way (per programme).',
    '',
    'LAST DEBRIEF',
    `  ${lastDebrief ? `[${lastDebrief.log_date}] targets: ${String(lastDebrief.tomorrow_targets || '—').slice(0, 200)}` : '(none filed yet)'}`,
    '',
    'DELIVERY FORMAT',
    '  Calm and exact. One figure, used once, never announced (read the cursor).',
    '',
    'NEXT MOVE',
    `  Hold the keystone and drill ${cur.figure} for cycle day ${cur.cycle_day}. Do not advance the chapter until the standing sheets are real.`,
    '=== END BRIEF ===',
  ].join('\n')
}
