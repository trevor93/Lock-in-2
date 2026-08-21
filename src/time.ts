// Book 7 refactor — extracted pure date/time helpers.
// No DB, no request state: deterministic string-date arithmetic anchored at
// noon UTC so a day never slips across a boundary during ±n arithmetic. The
// civil-date derivation that needs settings.timezone stays in userNow().

const DOWS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export function dowOf(dateStr: string): string {
  return DOWS[new Date(dateStr + 'T12:00:00Z').getUTCDay()]
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Whole days from one civil date to another (positive when `to` is later).
// Noon-UTC anchored like addDays, so it never slips across a day boundary.
export function daysBetween(fromDateStr: string, toDateStr: string): number {
  const a = new Date(fromDateStr + 'T12:00:00Z').getTime()
  const b = new Date(toDateStr + 'T12:00:00Z').getTime()
  return Math.round((b - a) / 86400000)
}

export function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3) // Thursday of this week
  const y = d.getUTCFullYear()
  const jan4 = new Date(Date.UTC(y, 0, 4))
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7)
  return `${y}-W${String(week).padStart(2, '0')}`
}
