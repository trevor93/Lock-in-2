// Book 7 refactor — the honesty / enforcement service (Books 5.3, 8).
// The single enforcement pass and its parts: structured flag identity, flag
// filing with paired point penalties, the materialised day_summary writer
// (which also reflects Minimum Viable Recovery), the previous-day honesty
// engine, and the real-time same-day window-close. PRESERVED behaviour — moved
// verbatim, verified by the enforcement/idempotency/legal-transition suites.
// runEnforcement stays in index.tsx as the orchestrator (it also calls
// ensureUnlocks/ensureCards) to avoid a circular import.
import { getSetting, blocksForDate } from './repositories'
import { dayAdherence } from './scoring'
import { addDays } from './time'
import { computeStreak, trailingMedian } from './streak'

export async function flagExists(
  DB: D1Database,
  userId: number,
  date: string,
  type: string,
  refType?: string,
  refId?: number,
) {
  const q = refType
    ? DB.prepare(
        `SELECT id FROM honesty_flags
         WHERE user_id=? AND flag_date=? AND flag_type=? AND ref_type=? AND ref_id=?`,
      ).bind(userId, date, type, refType, refId ?? 0)
    : DB.prepare(
        `SELECT id FROM honesty_flags
         WHERE user_id=? AND flag_date=? AND flag_type=? AND ref_type IS NULL`,
      ).bind(userId, date, type)
  return !!(await q.first())
}

// Race-safe flag+penalty: the UNIQUE identity index means INSERT OR IGNORE is the
// arbiter — the penalty is written ONLY when the flag row was actually inserted.
export async function addFlag(
  DB: D1Database,
  userId: number,
  date: string,
  type: string,
  severity: string,
  message: string,
  penalty: number,
  refType?: string,
  refId?: number,
) {
  if (await flagExists(DB, userId, date, type, refType, refId)) return false
  const ins = await DB.prepare(
    `INSERT OR IGNORE INTO honesty_flags
       (user_id, flag_date, flag_type, severity, message, ref_type, ref_id)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(userId, date, type, severity, message, refType ?? null, refId ?? null).run()
  if (penalty !== 0 && (ins.meta as any).changes > 0) {
    await DB.prepare(
      `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type, ref_id)
       VALUES (?,?,?,?,?,?)`,
    ).bind(userId, date, penalty, message, 'flag', refId ?? null).run()
  }
  return (ins.meta as any).changes > 0
}

// ============ DAY SUMMARY (materialized — one row per day) ============
// Written whenever a past day is processed; makes streak/stats O(1) reads.
export async function writeDaySummary(DB: D1Database, userId: number, date: string, finalize = false) {
  const blocks = await blocksForDate(DB, userId, date)
  const adh = dayAdherence(blocks)
  const deb = await DB.prepare(`SELECT id FROM debriefs WHERE user_id=? AND log_date=?`).bind(userId, date).first()
  const pts = await DB.prepare(`SELECT COALESCE(SUM(points),0) t FROM points_ledger WHERE user_id=? AND log_date=?`).bind(userId, date).first<any>()
  // Victory = 80%+ weighted adherence with debrief. MVD held alone keeps the
  // streak ALIVE (survival), it does not count as a victory day.
  const victory = blocks.length > 0 && adh.pct >= 80 && !!deb
  // Minimum Viable Recovery (Book 8.2): a single restoring action logged on a
  // breach day lets the day SURVIVE, exactly like MVD. Derived from the
  // recovery_actions record so re-materialising a day never loses it.
  const rec = await DB.prepare(
    `SELECT 1 AS r FROM recovery_actions WHERE user_id=? AND action_date=?`,
  ).bind(userId, date).first<{ r: number }>()
  const mvrHeld = !!rec
  const survives = victory || adh.mvdHeld || mvrHeld
  const existing = await DB.prepare(`SELECT summary_date FROM day_summary WHERE user_id=? AND summary_date=?`)
    .bind(userId, date).first()
  if (existing) {
    await DB.prepare(
      `UPDATE day_summary SET adherence_pct=?, weighted_score=?, weighted_total=?, blocks_done=?, blocks_total=?,
       mvd_held=?, mvr_held=?, debrief_filed=?, victory=?, points=?, finalized=MAX(finalized, ?), updated_at=datetime('now')
       WHERE user_id=? AND summary_date=?`,
    ).bind(adh.pct, adh.wScore, adh.wTotal, Math.round(adh.done), adh.total,
      adh.mvdHeld ? 1 : 0, mvrHeld ? 1 : 0, deb ? 1 : 0, victory ? 1 : 0, pts?.t ?? 0, finalize ? 1 : 0,
      userId, date).run()
  } else {
    await DB.prepare(
      `INSERT INTO day_summary (user_id, summary_date, adherence_pct, weighted_score, weighted_total, blocks_done, blocks_total,
       mvd_held, mvr_held, debrief_filed, victory, points, finalized, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
    ).bind(userId, date, adh.pct, adh.wScore, adh.wTotal, Math.round(adh.done), adh.total,
      adh.mvdHeld ? 1 : 0, mvrHeld ? 1 : 0, deb ? 1 : 0, victory ? 1 : 0, pts?.t ?? 0, finalize ? 1 : 0).run()
  }
  return { adh, deb: !!deb, victory, survives }
}

// ============ HONESTY ENGINE ============
// Runs against yesterday (and the day before) — ONLY from POST /api/tick, never on reads.
export async function runHonestyEngine(DB: D1Database, userId: number, today: string) {
  const startDate = (await getSetting(DB, 'start_date', userId)) || today
  const y1 = addDays(today, -1)
  const y2 = addDays(today, -2)
  if (y1 < startDate) return

  // Skip if yesterday is already finalized (engine idempotence, saves ~10 queries/req)
  const done = await DB.prepare(
    `SELECT finalized FROM day_summary WHERE user_id=? AND summary_date=?`,
  ).bind(userId, y1).first<any>()
  const alreadyFinal = !!done?.finalized

  // 1. Missed debrief
  const deb = await DB.prepare(
    `SELECT id FROM debriefs WHERE user_id=? AND log_date=?`,
  ).bind(userId, y1).first()
  if (!deb) {
    await addFlag(DB, userId, y1, 'missed_debrief', 'serious',
      `NIGHT DEBRIEF MISSED (${y1}). Law 5: Track, don't trust. An army without intelligence reports is blind. -15 pts. Write a catch-up debrief now.`, -15)
  }

  // 2. Missed non-negotiable blocks yesterday
  // (skip 'missed' — those were already punished LIVE by the same-day enforcement engine)
  const yBlocks = await blocksForDate(DB, userId, y1)
  const adh = dayAdherence(yBlocks)
  if (!alreadyFinal) {
    for (const b of yBlocks) {
      if (b.is_non_negotiable && b.log_status !== 'done' && b.log_status !== 'partial' && b.log_status !== 'missed') {
        const skipped = b.log_status === 'skipped'
        await addFlag(DB, userId, y1, 'missed_block', skipped ? 'warn' : 'serious',
          `[Block #${b.id}] NON-NEGOTIABLE ${skipped ? 'SKIPPED' : 'UNLOGGED'}: "${b.title}" (${y1}). ${skipped ? 'You were honest about it — logged, no ambush. -5 pts.' : 'Not even logged. Silence is the worst report. -10 pts.'}`,
          skipped ? -5 : -10, 'block', b.id)
      }
    }

    // 3. LOAD REDUCTION (never-miss-twice INVERTED — review Tier-1 #3).
    // Two straight misses = the schedule was wrong, not just the will.
    // Response: HALVE the block for 3 days + demand the WHY. No extra penalty stack.
    if (y2 >= startDate) {
      const y2Blocks = await blocksForDate(DB, userId, y2)
      const missY2 = new Set(y2Blocks.filter((b: any) => b.is_non_negotiable && b.log_status !== 'done' && b.log_status !== 'partial').map((b: any) => b.id))
      for (const b of yBlocks) {
        if (b.is_non_negotiable && missY2.has(b.id) && b.log_status !== 'done' && b.log_status !== 'partial') {
          const created = await addFlag(DB, userId, y1, 'load_reduction', 'serious',
            `[Block #${b.id}] TWO MISSES IN A ROW: "${b.title}" (${y2}, ${y1}). The block is now UNDER LOAD REDUCTION — half duration for 3 days. A plan that keeps breaking is a bad plan or a hidden refusal. Answer the why: wrong time? too long? wrong prerequisite? or you don't actually want it?`,
            0, 'block', b.id)
          if (created) {
            await DB.prepare(
              `INSERT OR IGNORE INTO load_reductions (user_id, block_id, start_date, end_date)
               VALUES (?,?,?,?)`
            ).bind(userId, b.id, today, addDays(today, 2)).run()
          }
        }
      }
    }

    // 3.5 TONGUE NEGLECT — drills piling up unreviewed means the armory is rotting
    try {
      const overdue = await DB.prepare(
        `SELECT COUNT(*) n FROM response_srs s
         JOIN responses r ON r.id=s.response_id AND r.user_id=s.user_id
         WHERE s.user_id=? AND r.archived=0 AND s.due_date <= ?`
      ).bind(userId, addDays(today, -3)).first<any>()
      if ((overdue?.n ?? 0) >= 5) {
        await addFlag(DB, userId, y1, 'tongue_neglect', 'serious',
          `TONGUE NEGLECT: ${overdue.n} wise responses are 3+ days overdue for drilling. You recorded wisdom and let it rot — a full armory you never trained with. -10 pts. Drill them today.`, -10)
      }
    } catch (_) { /* table may not exist pre-migration */ }

    // 4. Collapse day — but a HELD LINE (MVD) is NOT a collapse. Survival counts.
    if (yBlocks.length > 0 && adh.pct < 50 && !adh.mvdHeld) {
      await addFlag(DB, userId, y1, 'low_adherence', 'serious',
        `ADHERENCE COLLAPSE: ${adh.pct}% on ${y1} (target: 80%). No shame — but no lies either. Read your debrief, find the breach point, patch the wall. -10 pts.`, -10)
    }

    // 4.5 MVD HELD on a hard day — the line held. Small positive, streak survives.
    if (yBlocks.length > 0 && adh.mvdHeld && adh.pct < 80) {
      // ATOMIC: the INSERT's own WHERE NOT EXISTS is the arbiter, so two
      // concurrent enforcement passes (tick + cron) cannot both award.
      await DB.prepare(
        `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type)
         SELECT ?,?,?,?,'mvd'
         WHERE NOT EXISTS (
           SELECT 1 FROM points_ledger
           WHERE user_id=? AND log_date=? AND ref_type='mvd'
         )`,
      ).bind(userId, y1, 10, `HELD THE LINE: all ${adh.mvdTotal} core blocks hit on a hard day (${y1}). The streak lives. +10 pts.`, userId, y1).run()
    }

    // 5. Victory: 80%+ weighted day with debrief
    if (yBlocks.length > 0 && adh.pct >= 80 && deb) {
      // ATOMIC: same conditional-INSERT guard as the MVD bonus above.
      await DB.prepare(
        `INSERT INTO points_ledger (user_id, log_date, points, reason, ref_type)
         SELECT ?,?,?,?,'streak'
         WHERE NOT EXISTS (
           SELECT 1 FROM points_ledger
           WHERE user_id=? AND log_date=? AND ref_type='streak'
         )`,
      ).bind(userId, y1, 30, `VICTORY DAY: ${adh.pct}% adherence + debrief filed (${y1}). +30 pts.`, userId, y1).run()
    }
  }

  // 6. Materialize + FINALIZE yesterday (immutable close of books)
  await writeDaySummary(DB, userId, y1, true)
}

// O(1) STREAK from day_summary. A day extends the streak if victory=1;
// mvd_held=1 lets the streak SURVIVE (day is neutral, not a break).
// computeStreak/trailingMedian extracted to ./streak (Book 7).

// ============ SAME-DAY ENFORCEMENT (real-time honesty — no free passes) ============
// A block whose end_time + grace has passed with no log is AUTO-MARKED 'missed':
// instant penalty, instant flag, window closed. The day bleeds while you watch.
export async function runSameDayEnforcement(DB: D1Database, userId: number, date: string, time: string) {
  const start = await getSetting(DB, 'start_date', userId)
  if (start && date < start) return
  const grace = Math.max(0, Number((await getSetting(DB, 'grace_minutes', userId)) ?? 30))
  const [nh, nm] = time.split(':').map(Number)
  const nowMin = nh * 60 + nm
  const blocks = await blocksForDate(DB, userId, date)
  for (const b of blocks) {
    // 'pending' is NOT a real log — toggling a block back to pending after the
    // window closes must NOT let it escape the cancellation (honesty loophole).
    if (b.log_status && b.log_status !== 'pending') continue
    const [eh, em] = b.end_time.split(':').map(Number)
    const deadline = eh * 60 + em + grace
    if (nowMin <= deadline) continue                // still inside the window
    // AUTO-CANCEL: the window closed unlogged (overwrites a lingering 'pending' row)
    await DB.prepare(
      `INSERT INTO block_logs (user_id, block_id, log_date, status, note, completed_at)
       VALUES (?,?,?,?,?,datetime('now'))
       ON CONFLICT(block_id, log_date) DO UPDATE SET
         status='missed', note=excluded.note, completed_at=excluded.completed_at
       WHERE block_logs.user_id=excluded.user_id AND block_logs.status='pending'`
    ).bind(userId, b.id, date, 'missed', `AUTO-CANCELED: window closed unlogged at ${time} (grace ${grace}m).`).run()
    const nn = !!b.is_non_negotiable
    const w = b.weight ?? 1
    // CONTEXT blocks (weight 0) are unscored AND unpenalized — canceled silently.
    if (w === 0) continue
    const penalty = nn ? -15 : -5
    await addFlag(DB, userId, date, 'missed_live', nn ? 'critical' : 'warn',
      `[Block #${b.id}] ${nn ? 'NON-NEGOTIABLE ' : ''}MISSED — CANCELED: "${b.title}" (${b.start_time}–${b.end_time}) ended unlogged. The window is closed. ${penalty} pts. One appeal token per week can reopen a window — at the cost of a written, permanent reason.`,
      penalty, 'block', b.id)
  }
}
