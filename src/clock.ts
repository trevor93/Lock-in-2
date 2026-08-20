// Book 7 refactor — the server clock service (Book 6). The server owns the
// calendar: the civil date/time derive from the stored timezone via
// Intl.DateTimeFormat, and a client-supplied date is validated and clamped
// never-future for read/history use only. Never trusts the browser clock.
import { getSetting } from './repositories'
import { parseValue } from './validation'
import { dateSchema } from './schemas'

export async function userNow(DB: D1Database, userId?: number): Promise<{ date: string; time: string; tz: string }> {
  const tz = (await getSetting(DB, 'timezone', userId)) || 'Africa/Nairobi'
  const now = new Date()
  let date: string, time: string
  try {
    date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
    time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
  } catch (_) {
    date = now.toISOString().slice(0, 10); time = now.toISOString().slice(11, 16)
  }
  if (time.startsWith('24')) time = '00' + time.slice(2)
  return { date, time, tz }
}


// Clamp any validated client-supplied date, never into the future.
export async function safeDate(DB: D1Database, q?: string | null, userId?: number): Promise<string> {
  const { date: today } = await userNow(DB, userId)
  if (!q) return today
  const validated = parseValue(dateSchema, q)
  return validated > today ? today : validated
}
