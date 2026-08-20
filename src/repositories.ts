// Book 7 refactor — the repository layer (pure data access, no business logic).
// Settings key/value reads and writes, and the day's schedule blocks joined to
// their logs. Ownership is always constrained by user_id at the query.
import { dowOf } from './time'

export async function getSetting(DB: D1Database, key: string, userId?: number): Promise<string | null> {
  const query = userId === undefined
    ? DB.prepare(`SELECT value FROM settings WHERE key=? ORDER BY rowid LIMIT 1`).bind(key)
    : DB.prepare(`SELECT value FROM settings WHERE user_id=? AND key=? ORDER BY rowid LIMIT 1`).bind(userId, key)
  const row = await query.first<{ value: string }>()
  return row?.value ?? null
}
export async function setSetting(DB: D1Database, key: string, value: string, userId?: number) {
  const existing = userId === undefined
    ? await DB.prepare(`SELECT rowid AS row_id FROM settings WHERE key=? ORDER BY rowid LIMIT 1`).bind(key).first<{ row_id: number }>()
    : await DB.prepare(`SELECT rowid AS row_id FROM settings WHERE user_id=? AND key=? ORDER BY rowid LIMIT 1`).bind(userId, key).first<{ row_id: number }>()
  if (existing) {
    await DB.prepare(`UPDATE settings SET value=? WHERE rowid=?`).bind(value, existing.row_id).run()
    return
  }
  await DB.prepare(`INSERT INTO settings (user_id, key, value) VALUES (?,?,?)`)
    .bind(userId ?? null, key, value).run()
}

export async function blocksForDate(DB: D1Database, userId: number, date: string) {
  const dow = dowOf(date)
  const { results } = await DB.prepare(
    `SELECT b.*, l.status as log_status, l.note as log_note, l.completed_at
     FROM schedule_blocks b
     LEFT JOIN block_logs l ON l.block_id = b.id AND l.log_date = ? AND l.user_id = ?
     WHERE b.user_id = ? AND (',' || b.days || ',') LIKE ?
     ORDER BY b.start_time, b.sort_order`
  ).bind(date, userId, userId, `%,${dow},%`).all()
  return results as any[]
}
