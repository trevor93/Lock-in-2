// Book 7 refactor — curriculum progression (Books 8/10).
// The progress lock: seed unit_progress rows, then per track walk phases in
// order so the first incomplete unit becomes the only active one (unit N stays
// locked until N-1 is conquered). Also seeds a flashcard per maxim. Pure data
// access.
export async function ensureUnlocks(DB: D1Database, userId: number) {
  // seed progress rows for all units
  await DB.prepare(
    `INSERT OR IGNORE INTO unit_progress (user_id, unit_id, status)
     SELECT ?, u.id, 'locked' FROM units u
     WHERE u.id NOT IN (SELECT unit_id FROM unit_progress WHERE user_id=?)`
  ).bind(userId, userId).run()
  // per track: walk phases in order; first incomplete unit becomes active
  const phases = (await DB.prepare(`SELECT * FROM phases ORDER BY sort_order`).all()).results as any[]
  const tracks: Record<string, any[]> = {}
  for (const p of phases) { (tracks[p.track] ||= []).push(p) }
  for (const track of Object.keys(tracks)) {
    let blocked = false
    for (const p of tracks[track]) {
      if (blocked) break
      const units = (await DB.prepare(
        `SELECT u.id, up.status FROM units u JOIN unit_progress up ON up.unit_id=u.id
         WHERE up.user_id=? AND u.phase_id=? ORDER BY u.sort_order`
      ).bind(userId, p.id).all()).results as any[]
      for (const u of units) {
        if (u.status === 'complete') continue
        if (u.status === 'locked') {
          await DB.prepare(
            `UPDATE unit_progress SET status='active' WHERE unit_id=? AND user_id=?`,
          ).bind(u.id, userId).run()
        }
        blocked = true
        break
      }
    }
  }
}

export async function ensureCards(DB: D1Database, userId: number) {
  await DB.prepare(
    `INSERT OR IGNORE INTO flashcards (user_id, maxim_id)
     SELECT ?, id FROM captures
     WHERE kind='maxim' AND user_id=? AND id NOT IN (SELECT maxim_id FROM flashcards WHERE user_id=?)`,
  ).bind(userId, userId, userId).run()
}
