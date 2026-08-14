import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

type Bindings = {
  DB: D1Database
  OPENAI_API_KEY: string
  OPENAI_BASE_URL: string
  ENFORCEMENT_JOB_SECRET?: string
  ALLOWED_ORIGINS?: string
}
const app = new Hono<{ Bindings: Bindings }>()

function privatePath(path: string): boolean {
  return path.startsWith('/api/') || path.startsWith('/internal/') || path === '/calendar.ics'
}

function allowedOrigins(c: any): Set<string> {
  const configured = String(c.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin: string) => origin.trim())
    .filter(Boolean)
  return new Set([new URL(c.req.url).origin, ...configured])
}

// Private responses never enter caches. Browser requests carrying an Origin must
// match this deployment or an explicit allowlist; non-browser bridge requests do
// not send Origin and continue to authenticate with X-Agent-Token.
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (!privatePath(path)) return next()

  c.header('Cache-Control', 'no-store')
  const origin = c.req.header('origin')
  if (origin && !allowedOrigins(c).has(origin)) {
    return c.json({ error: 'ORIGIN NOT ALLOWED' }, 403)
  }

  await next()
  c.header('Cache-Control', 'no-store')
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin)
    c.header('Vary', 'Origin', { append: true })
  }
})

// ============ SERVER CLOCK (single source of truth) ============
// The commander's timezone is captured ONCE (settings.timezone). After that the
// SERVER derives date+time — the client can never time-travel the engines.
async function getSetting(DB: D1Database, key: string): Promise<string | null> {
  const r = await DB.prepare(`SELECT value FROM settings WHERE key=?`).bind(key).first<{ value: string }>()
  return r?.value ?? null
}
async function setSetting(DB: D1Database, key: string, value: string) {
  await DB.prepare(`INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .bind(key, value).run()
}
async function userNow(DB: D1Database): Promise<{ date: string; time: string; tz: string }> {
  const tz = (await getSetting(DB, 'timezone')) || 'Africa/Nairobi'
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

// Clamp any client-supplied date: valid format, never in the future.
async function safeDate(DB: D1Database, q?: string | null): Promise<string> {
  const { date: today } = await userNow(DB)
  if (!q || !/^\d{4}-\d{2}-\d{2}$/.test(q)) return today
  return q > today ? today : q
}

// ============ AUTH (session cookie, HMAC-signed; password PBKDF2) ============
const enc = new TextEncoder()
function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}
function randHex(n = 32): string {
  const a = new Uint8Array(n); crypto.getRandomValues(a)
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('')
}
async function pbkdf2(password: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256)
  return bufToHex(bits)
}
async function hmacSign(msg: string, secretHex: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secretHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return bufToHex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))
}
function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}
async function sessionValid(c: any): Promise<boolean> {
  const raw = getCookie(c, 'wr_session')
  if (!raw) return false
  const secret = await getSetting(c.env.DB, 'session_secret')
  if (!secret) return false
  const dot = raw.lastIndexOf('.')
  if (dot < 1) return false
  const exp = raw.slice(0, dot), sig = raw.slice(dot + 1)
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false
  return timingSafeEq(await hmacSign(exp, secret), sig)
}
async function issueSession(c: any) {
  let secret = await getSetting(c.env.DB, 'session_secret')
  if (!secret) { secret = randHex(32); await setSetting(c.env.DB, 'session_secret', secret) }
  const exp = String(Date.now() + 30 * 24 * 3600 * 1000) // 30 days
  const sig = await hmacSign(exp, secret)
  setCookie(c, 'wr_session', `${exp}.${sig}`, {
    httpOnly: true, sameSite: 'Strict', secure: true, path: '/', maxAge: 30 * 24 * 3600
  })
}

// -- auth endpoints (the ONLY unauthenticated API surface) --
app.get('/api/auth/status', async (c) => {
  const hasPass = !!(await getSetting(c.env.DB, 'auth_hash'))
  return c.json({ setup: hasPass, authed: hasPass ? await sessionValid(c) : false })
})
app.post('/api/auth/setup', async (c) => {
  const DB = c.env.DB
  if (await getSetting(DB, 'auth_hash')) return c.json({ error: 'Already set up. Log in.' }, 400)
  const { password } = await c.req.json()
  if (!password || password.length < 8) return c.json({ error: 'Password must be at least 8 characters. This gate protects everything.' }, 400)
  const salt = randHex(16)
  const hash = await pbkdf2(password, salt)
  await DB.batch([
    DB.prepare(`INSERT INTO settings (key,value) VALUES ('auth_salt',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(salt),
    DB.prepare(`INSERT INTO settings (key,value) VALUES ('auth_hash',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(hash),
  ])
  await issueSession(c)
  return c.json({ ok: true })
})
app.post('/api/auth/login', async (c) => {
  const DB = c.env.DB
  const hash = await getSetting(DB, 'auth_hash'), salt = await getSetting(DB, 'auth_salt')
  if (!hash || !salt) return c.json({ error: 'Not set up yet.', setup: false }, 400)
  // brute-force throttle: 5 fails → 15-minute lockout
  const failsRaw = await getSetting(DB, 'auth_fails')
  const [nFails, lastFail] = (failsRaw || '0,0').split(',').map(Number)
  if (nFails >= 5 && Date.now() - lastFail < 15 * 60 * 1000) {
    return c.json({ error: 'GATE SEALED. Too many failed attempts — wait 15 minutes. Patience is also discipline.' }, 429)
  }
  const { password } = await c.req.json()
  const attempt = await pbkdf2(password || '', salt)
  if (!timingSafeEq(attempt, hash)) {
    await setSetting(DB, 'auth_fails', `${(Date.now() - lastFail < 15 * 60 * 1000 ? nFails : 0) + 1},${Date.now()}`)
    return c.json({ error: 'Wrong password.' }, 401)
  }
  await setSetting(DB, 'auth_fails', '0,0')
  await issueSession(c)
  return c.json({ ok: true })
})
app.post('/api/auth/logout', async (c) => {
  deleteCookie(c, 'wr_session', { path: '/' })
  return c.json({ ok: true })
})

// -- global API guard --
// /api/auth/*            → open (it IS the gate)
// /api/agent/token*      → session only (GET retired; POST rotates for Termux setup)
// /api/agent/*           → X-Agent-Token ONLY (checked in each handler via agentAuthed)
// everything else /api/* → session cookie required
app.use('/api/*', async (c, next) => {
  const p = new URL(c.req.url).pathname
  if (p.startsWith('/api/auth/')) return next()
  if (p === '/api/agent/token' || p === '/api/agent/token/rotate') {
    if (!(await sessionValid(c))) return c.json({ error: 'AUTH REQUIRED' }, 401)
    return next()
  }
  if (p.startsWith('/api/agent/')) return next() // per-handler agent-token check (401 inside)
  if (!(await sessionValid(c))) return c.json({ error: 'AUTH REQUIRED' }, 401)
  return next()
})

const DOWS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function dowOf(dateStr: string): string {
  return DOWS[new Date(dateStr + 'T12:00:00Z').getUTCDay()]
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

async function blocksForDate(DB: D1Database, date: string) {
  const dow = dowOf(date)
  const { results } = await DB.prepare(
    `SELECT b.*, l.status as log_status, l.note as log_note, l.completed_at
     FROM schedule_blocks b
     LEFT JOIN block_logs l ON l.block_id = b.id AND l.log_date = ?
     WHERE (',' || b.days || ',') LIKE ?
     ORDER BY b.start_time, b.sort_order`
  ).bind(date, `%,${dow},%`).all()
  return results as any[]
}

// WEIGHTED ADHERENCE — CORE(3) / STANDARD(1) / CONTEXT(0).
// adherence = Σ(weight × credit) / Σ(weight) over non-zero-weight blocks.
// Missing a meal no longer equals missing deep work. Context blocks are
// visible but unscored and unpenalized.
function dayAdherence(blocks: any[]) {
  const scored = blocks.filter((b: any) => (b.weight ?? 1) > 0)
  if (!scored.length) return { pct: 100, done: 0, total: 0, wScore: 0, wTotal: 0, mvdHeld: false, mvdTotal: 0, mvdDone: 0 }
  let wScore = 0, wTotal = 0, done = 0
  for (const b of scored) {
    const w = b.weight ?? 1
    wTotal += w
    if (b.log_status === 'done') { wScore += w; done += 1 }
    else if (b.log_status === 'partial') { wScore += w * 0.5; done += 0.5 }
  }
  // MINIMUM VIABLE DAY: nominated CORE blocks — all hit ⇒ HELD THE LINE
  const mvd = blocks.filter((b: any) => b.is_mvd)
  const mvdDone = mvd.filter((b: any) => b.log_status === 'done' || b.log_status === 'partial').length
  const mvdHeld = mvd.length > 0 && mvdDone === mvd.length
  return {
    pct: Math.round((wScore / wTotal) * 100), done, total: scored.length,
    wScore, wTotal, mvdHeld, mvdTotal: mvd.length, mvdDone
  }
}

// Structured flag identity — no more message-LIKE matching.
async function flagExists(DB: D1Database, date: string, type: string, refType?: string, refId?: number) {
  const q = refType
    ? DB.prepare(`SELECT id FROM honesty_flags WHERE flag_date=? AND flag_type=? AND ref_type=? AND ref_id=?`).bind(date, type, refType, refId ?? 0)
    : DB.prepare(`SELECT id FROM honesty_flags WHERE flag_date=? AND flag_type=? AND ref_type IS NULL`).bind(date, type)
  return !!(await q.first())
}

// Race-safe flag+penalty: the UNIQUE identity index means INSERT OR IGNORE is the
// arbiter — the penalty is written ONLY when the flag row was actually inserted.
async function addFlag(DB: D1Database, date: string, type: string, severity: string, message: string, penalty: number, refType?: string, refId?: number) {
  const ins = await DB.prepare(
    `INSERT OR IGNORE INTO honesty_flags (flag_date, flag_type, severity, message, ref_type, ref_id) VALUES (?,?,?,?,?,?)`
  ).bind(date, type, severity, message, refType ?? null, refId ?? null).run()
  if (penalty !== 0 && (ins.meta as any).changes > 0) {
    await DB.prepare(`INSERT INTO points_ledger (log_date, points, reason, ref_type, ref_id) VALUES (?,?,?,?,?)`)
      .bind(date, penalty, message, 'flag', refId ?? null).run()
  }
  return (ins.meta as any).changes > 0
}

// ============ DAY SUMMARY (materialized — one row per day) ============
// Written whenever a past day is processed; makes streak/stats O(1) reads.
async function writeDaySummary(DB: D1Database, date: string, finalize = false) {
  const blocks = await blocksForDate(DB, date)
  const adh = dayAdherence(blocks)
  const deb = await DB.prepare(`SELECT id FROM debriefs WHERE log_date=?`).bind(date).first()
  const pts = await DB.prepare(`SELECT COALESCE(SUM(points),0) t FROM points_ledger WHERE log_date=?`).bind(date).first<any>()
  // Victory = 80%+ weighted adherence with debrief. MVD held alone keeps the
  // streak ALIVE (survival), it does not count as a victory day.
  const victory = blocks.length > 0 && adh.pct >= 80 && !!deb
  const survives = victory || adh.mvdHeld
  await DB.prepare(
    `INSERT INTO day_summary (summary_date, adherence_pct, weighted_score, weighted_total, blocks_done, blocks_total,
       mvd_held, debrief_filed, victory, points, finalized, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(summary_date) DO UPDATE SET adherence_pct=excluded.adherence_pct,
       weighted_score=excluded.weighted_score, weighted_total=excluded.weighted_total,
       blocks_done=excluded.blocks_done, blocks_total=excluded.blocks_total,
       mvd_held=excluded.mvd_held, debrief_filed=excluded.debrief_filed,
       victory=excluded.victory, points=excluded.points,
       finalized=MAX(day_summary.finalized, excluded.finalized), updated_at=datetime('now')`
  ).bind(date, adh.pct, adh.wScore, adh.wTotal, Math.round(adh.done), adh.total,
    adh.mvdHeld ? 1 : 0, deb ? 1 : 0, victory ? 1 : 0, pts?.t ?? 0, finalize ? 1 : 0).run()
  return { adh, deb: !!deb, victory, survives }
}

// ============ HONESTY ENGINE ============
// Runs against yesterday (and the day before) — ONLY from POST /api/tick, never on reads.
async function runHonestyEngine(DB: D1Database, today: string) {
  const startDate = (await getSetting(DB, 'start_date')) || today
  const y1 = addDays(today, -1)
  const y2 = addDays(today, -2)
  if (y1 < startDate) return

  // Skip if yesterday is already finalized (engine idempotence, saves ~10 queries/req)
  const done = await DB.prepare(`SELECT finalized FROM day_summary WHERE summary_date=?`).bind(y1).first<any>()
  const alreadyFinal = !!done?.finalized

  // 1. Missed debrief
  const deb = await DB.prepare(`SELECT id FROM debriefs WHERE log_date=?`).bind(y1).first()
  if (!deb) {
    await addFlag(DB, y1, 'missed_debrief', 'serious',
      `NIGHT DEBRIEF MISSED (${y1}). Law 5: Track, don't trust. An army without intelligence reports is blind. -15 pts. Write a catch-up debrief now.`, -15)
  }

  // 2. Missed non-negotiable blocks yesterday
  // (skip 'missed' — those were already punished LIVE by the same-day enforcement engine)
  const yBlocks = await blocksForDate(DB, y1)
  const adh = dayAdherence(yBlocks)
  if (!alreadyFinal) {
    for (const b of yBlocks) {
      if (b.is_non_negotiable && b.log_status !== 'done' && b.log_status !== 'partial' && b.log_status !== 'missed') {
        const skipped = b.log_status === 'skipped'
        await addFlag(DB, y1, 'missed_block', skipped ? 'warn' : 'serious',
          `[Block #${b.id}] NON-NEGOTIABLE ${skipped ? 'SKIPPED' : 'UNLOGGED'}: "${b.title}" (${y1}). ${skipped ? 'You were honest about it — logged, no ambush. -5 pts.' : 'Not even logged. Silence is the worst report. -10 pts.'}`,
          skipped ? -5 : -10, 'block', b.id)
      }
    }

    // 3. LOAD REDUCTION (never-miss-twice INVERTED — review Tier-1 #3).
    // Two straight misses = the schedule was wrong, not just the will.
    // Response: HALVE the block for 3 days + demand the WHY. No extra penalty stack.
    if (y2 >= startDate) {
      const y2Blocks = await blocksForDate(DB, y2)
      const missY2 = new Set(y2Blocks.filter((b: any) => b.is_non_negotiable && b.log_status !== 'done' && b.log_status !== 'partial').map((b: any) => b.id))
      for (const b of yBlocks) {
        if (b.is_non_negotiable && missY2.has(b.id) && b.log_status !== 'done' && b.log_status !== 'partial') {
          const created = await addFlag(DB, y1, 'load_reduction', 'serious',
            `[Block #${b.id}] TWO MISSES IN A ROW: "${b.title}" (${y2}, ${y1}). The block is now UNDER LOAD REDUCTION — half duration for 3 days. A plan that keeps breaking is a bad plan or a hidden refusal. Answer the why: wrong time? too long? wrong prerequisite? or you don't actually want it?`,
            0, 'block', b.id)
          if (created) {
            await DB.prepare(
              `INSERT OR IGNORE INTO load_reductions (block_id, start_date, end_date) VALUES (?,?,?)`
            ).bind(b.id, today, addDays(today, 2)).run()
          }
        }
      }
    }

    // 3.5 TONGUE NEGLECT — drills piling up unreviewed means the armory is rotting
    try {
      const overdue = await DB.prepare(
        `SELECT COUNT(*) n FROM response_srs s JOIN responses r ON r.id=s.response_id
         WHERE r.archived=0 AND s.due_date <= ?`
      ).bind(addDays(today, -3)).first<any>()
      if ((overdue?.n ?? 0) >= 5) {
        await addFlag(DB, y1, 'tongue_neglect', 'serious',
          `TONGUE NEGLECT: ${overdue.n} wise responses are 3+ days overdue for drilling. You recorded wisdom and let it rot — a full armory you never trained with. -10 pts. Drill them today.`, -10)
      }
    } catch (_) { /* table may not exist pre-migration */ }

    // 4. Collapse day — but a HELD LINE (MVD) is NOT a collapse. Survival counts.
    if (yBlocks.length > 0 && adh.pct < 50 && !adh.mvdHeld) {
      await addFlag(DB, y1, 'low_adherence', 'serious',
        `ADHERENCE COLLAPSE: ${adh.pct}% on ${y1} (target: 80%). No shame — but no lies either. Read your debrief, find the breach point, patch the wall. -10 pts.`, -10)
    }

    // 4.5 MVD HELD on a hard day — the line held. Small positive, streak survives.
    if (yBlocks.length > 0 && adh.mvdHeld && adh.pct < 80) {
      const already = await DB.prepare(`SELECT id FROM points_ledger WHERE log_date=? AND ref_type='mvd'`).bind(y1).first()
      if (!already) {
        await DB.prepare(`INSERT INTO points_ledger (log_date, points, reason, ref_type) VALUES (?,?,?,?)`)
          .bind(y1, 10, `HELD THE LINE: all ${adh.mvdTotal} core blocks hit on a hard day (${y1}). The streak lives. +10 pts.`, 'mvd').run()
      }
    }

    // 5. Victory: 80%+ weighted day with debrief
    if (yBlocks.length > 0 && adh.pct >= 80 && deb) {
      const already = await DB.prepare(`SELECT id FROM points_ledger WHERE log_date=? AND ref_type='streak'`).bind(y1).first()
      if (!already) {
        await DB.prepare(`INSERT INTO points_ledger (log_date, points, reason, ref_type) VALUES (?,?,?,?)`)
          .bind(y1, 30, `VICTORY DAY: ${adh.pct}% adherence + debrief filed (${y1}). +30 pts.`, 'streak').run()
      }
    }
  }

  // 6. Materialize + FINALIZE yesterday (immutable close of books)
  await writeDaySummary(DB, y1, true)
}

// O(1) STREAK from day_summary. A day extends the streak if victory=1;
// mvd_held=1 lets the streak SURVIVE (day is neutral, not a break).
async function computeStreak(DB: D1Database, today: string): Promise<number> {
  const startDate = (await getSetting(DB, 'start_date')) || today
  const { results } = await DB.prepare(
    `SELECT summary_date, victory, mvd_held FROM day_summary
     WHERE summary_date < ? AND summary_date >= ? ORDER BY summary_date DESC LIMIT 180`
  ).bind(today, startDate).all()
  const byDate = new Map((results as any[]).map(r => [r.summary_date, r]))
  let streak = 0
  let d = addDays(today, -1)
  for (let i = 0; i < 180; i++) {
    if (d < startDate) break
    const r = byDate.get(d)
    if (r?.victory) streak++
    else if (r?.mvd_held) { /* survives, contributes nothing */ }
    else break
    d = addDays(d, -1)
  }
  // today counts live if already qualifying
  const tBlocks = await blocksForDate(DB, today)
  const tDeb = await DB.prepare(`SELECT id FROM debriefs WHERE log_date=?`).bind(today).first()
  if (tDeb && dayAdherence(tBlocks).pct >= 80) streak++
  return streak
}

// DELTA SCORING — today vs your trailing 14-day median (review Tier-1 #4).
// The fixed 80% stays visible as the horizon; the fight is vs yesterday's self.
async function trailingMedian(DB: D1Database, today: string): Promise<number | null> {
  const { results } = await DB.prepare(
    `SELECT adherence_pct FROM day_summary WHERE summary_date < ? AND summary_date >= ? AND blocks_total > 0
     ORDER BY summary_date DESC LIMIT 14`
  ).bind(today, addDays(today, -14)).all()
  const v = (results as any[]).map(r => r.adherence_pct).sort((a, b) => a - b)
  if (v.length < 3) return null // not enough history to be honest about a median
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2)
}

// ============ SAME-DAY ENFORCEMENT (real-time honesty — no free passes) ============
// A block whose end_time + grace has passed with no log is AUTO-MARKED 'missed':
// instant penalty, instant flag, window closed. The day bleeds while you watch.
async function runSameDayEnforcement(DB: D1Database, date: string, time: string) {
  const start = await DB.prepare(`SELECT value FROM settings WHERE key='start_date'`).first<{ value: string }>()
  if (start?.value && date < start.value) return
  const graceRow = await DB.prepare(`SELECT value FROM settings WHERE key='grace_minutes'`).first<{ value: string }>()
  const grace = Math.max(0, Number(graceRow?.value ?? 30))
  const [nh, nm] = time.split(':').map(Number)
  const nowMin = nh * 60 + nm
  const blocks = await blocksForDate(DB, date)
  for (const b of blocks) {
    // 'pending' is NOT a real log — toggling a block back to pending after the
    // window closes must NOT let it escape the cancellation (honesty loophole).
    if (b.log_status && b.log_status !== 'pending') continue
    const [eh, em] = b.end_time.split(':').map(Number)
    const deadline = eh * 60 + em + grace
    if (nowMin <= deadline) continue                // still inside the window
    // AUTO-CANCEL: the window closed unlogged (overwrites a lingering 'pending' row)
    await DB.prepare(
      `INSERT INTO block_logs (block_id, log_date, status, note, completed_at) VALUES (?,?,?,?,datetime('now'))
       ON CONFLICT(block_id, log_date) DO UPDATE SET
         status='missed', note=excluded.note, completed_at=excluded.completed_at
       WHERE block_logs.status='pending'`
    ).bind(b.id, date, 'missed', `AUTO-CANCELED: window closed unlogged at ${time} (grace ${grace}m).`).run()
    const nn = !!b.is_non_negotiable
    const w = b.weight ?? 1
    // CONTEXT blocks (weight 0) are unscored AND unpenalized — canceled silently.
    if (w === 0) continue
    const penalty = nn ? -15 : -5
    await addFlag(DB, date, 'missed_live', nn ? 'critical' : 'warn',
      `[Block #${b.id}] ${nn ? 'NON-NEGOTIABLE ' : ''}MISSED — CANCELED: "${b.title}" (${b.start_time}–${b.end_time}) ended unlogged. The window is closed. ${penalty} pts. One appeal token per week can reopen a window — at the cost of a written, permanent reason.`,
      penalty, 'block', b.id)
  }
}

// ============ STATE (read-only heartbeat) + TICK (the engine crank) ============
// GET /api/state no longer mutates anything — engines run ONLY via POST /api/tick,
// with the SERVER's clock. A client can no longer time-travel penalties into existence.
async function buildState(DB: D1Database, date: string, time: string) {
  const blocks = await blocksForDate(DB, date)
  const current = blocks.find((b: any) => b.start_time <= time && time < b.end_time) || null
  const next = blocks.find((b: any) => b.start_time > time) || null
  const adh = dayAdherence(blocks)
  const streak = await computeStreak(DB, date)

  const pts = await DB.prepare(`SELECT COALESCE(SUM(points),0) as total FROM points_ledger`).first<{ total: number }>()
  const todayPts = await DB.prepare(`SELECT COALESCE(SUM(points),0) as total FROM points_ledger WHERE log_date=?`).bind(date).first<{ total: number }>()
  const flags = (await DB.prepare(`SELECT * FROM honesty_flags WHERE acknowledged=0 ORDER BY created_at DESC LIMIT 20`).all()).results
  const debrief = await DB.prepare(`SELECT * FROM debriefs WHERE log_date=?`).bind(date).first()
  const yDebrief = await DB.prepare(`SELECT * FROM debriefs WHERE log_date=?`).bind(addDays(date, -1)).first()
  const dueCards = await DB.prepare(`SELECT COUNT(*) as n FROM flashcards WHERE due_date <= ?`).bind(date).first<{ n: number }>()
  const dueTongue = await DB.prepare(
    `SELECT COUNT(*) as n FROM response_srs s JOIN responses r ON r.id=s.response_id WHERE r.archived=0 AND s.due_date <= ?`
  ).bind(date).first<{ n: number }>().catch(() => ({ n: 0 }))

  // active units per track
  const activeUnits = (await DB.prepare(
    `SELECT u.id, u.title, p.code, p.title as phase_title, p.track, up.status
     FROM units u JOIN phases p ON p.id=u.phase_id JOIN unit_progress up ON up.unit_id=u.id
     WHERE up.status NOT IN ('locked','complete') ORDER BY p.sort_order, u.sort_order`
  ).all()).results

  // delta scoring vs trailing 14-day median + appeal availability + active load reductions
  const median = await trailingMedian(DB, date)
  const weekKey = isoWeekKey(date)
  const appealUsed = await DB.prepare(`SELECT id FROM appeals WHERE week_key=?`).bind(weekKey).first()
  const loadReductions = (await DB.prepare(
    `SELECT lr.*, b.title FROM load_reductions lr JOIN schedule_blocks b ON b.id=lr.block_id
     WHERE lr.end_date >= ? ORDER BY lr.start_date DESC`
  ).bind(date).all().catch(() => ({ results: [] as any[] }))).results
  const openPredictions = await DB.prepare(
    `SELECT COUNT(*) n FROM predictions WHERE outcome='unresolved' AND resolve_by <= ?`
  ).bind(date).first<any>().catch(() => ({ n: 0 }))

  return {
    date, time, blocks, current, next, adherence: adh, streak,
    points: pts?.total ?? 0, todayPoints: todayPts?.total ?? 0,
    flags, debrief, debriefDoneToday: !!debrief,
    yesterdayTargets: (yDebrief as any)?.tomorrow_targets || null,
    dueCards: dueCards?.n ?? 0, dueTongue: (dueTongue as any)?.n ?? 0, activeUnits,
    median, delta: median === null ? null : adh.pct - median,
    appealAvailable: !appealUsed, loadReductions,
    duePredictions: (openPredictions as any)?.n ?? 0
  }
}

function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3) // Thursday of this week
  const y = d.getUTCFullYear()
  const jan4 = new Date(Date.UTC(y, 0, 4))
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7)
  return `${y}-W${String(week).padStart(2, '0')}`
}

// READ — no side effects, ever. Server clock, client clock ignored.
app.get('/api/state', async (c) => {
  const { date, time } = await userNow(c.env.DB)
  return c.json(await buildState(c.env.DB, date, time))
})

// CRANK — the ONLY place engines run. Server-derived date/time; future dates impossible.
app.post('/api/tick', async (c) => {
  const DB = c.env.DB
  // capture the commander's timezone once (first tick from the UI sends it)
  try {
    const body = await c.req.json().catch(() => ({}))
    if (body?.tz && !(await getSetting(DB, 'timezone_locked'))) {
      try { new Intl.DateTimeFormat('en', { timeZone: body.tz }); await setSetting(DB, 'timezone', body.tz); await setSetting(DB, 'timezone_locked', '1') } catch (_) {}
    }
  } catch (_) {}
  const { date, time } = await runEnforcement(c.env.DB)
  return c.json(await buildState(DB, date, time))
})

async function runEnforcement(DB: D1Database): Promise<{ date: string; time: string; tz: string }> {
  const now = await userNow(DB)
  await ensureUnlocks(DB)
  await ensureCards(DB)
  await runHonestyEngine(DB, now.date)
  await runSameDayEnforcement(DB, now.date, now.time)
  await writeDaySummary(DB, now.date, false)
  return now
}

// Cloudflare Pages has no native scheduled handler. A separately configured Cron
// Worker calls this POST with the shared secret; no client-supplied clock is read.
app.post('/internal/jobs/enforcement', async (c) => {
  const expected = c.env.ENFORCEMENT_JOB_SECRET
  const authorization = c.req.header('authorization') || ''
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!expected || !supplied || !timingSafeEq(supplied, expected)) {
    return c.json({ error: 'INVALID INTERNAL CREDENTIAL' }, 401)
  }

  const { date, time, tz } = await runEnforcement(c.env.DB)
  return c.json({ ok: true, date, time, tz })
})

// ============ BLOCK LOGGING ============
// Date is SERVER-derived. You log the block you are living, not the day you wish.
app.post('/api/blocks/:id/log', async (c) => {
  const DB = c.env.DB
  const id = Number(c.req.param('id'))
  const { status, note } = await c.req.json()
  const { date } = await userNow(DB)
  const block = await DB.prepare(`SELECT * FROM schedule_blocks WHERE id=?`).bind(id).first<any>()
  if (!block) return c.json({ error: 'no such block' }, 404)

  const prev = await DB.prepare(`SELECT * FROM block_logs WHERE block_id=? AND log_date=?`).bind(id, date).first<any>()
  // THE WINDOW RULE: a block auto-canceled by the enforcement engine is CLOSED.
  // The only exit is the weekly appeal token (which costs a permanent written reason).
  if (prev && prev.status === 'missed') {
    return c.json({ error: 'WINDOW CLOSED. "' + block.title + '" was auto-canceled unlogged — it cannot be reopened. The penalty stands. One appeal token per week exists, if you can face writing the reason.' }, 409)
  }

  // atomic: log + points transition in one batch
  const stmts: D1PreparedStatement[] = [
    DB.prepare(
      `INSERT INTO block_logs (block_id, log_date, status, note, completed_at) VALUES (?,?,?,?,datetime('now'))
       ON CONFLICT(block_id, log_date) DO UPDATE SET status=excluded.status, note=excluded.note, completed_at=excluded.completed_at`
    ).bind(id, date, status, note || null)
  ]
  const prevEarned = prev && (prev.status === 'done' || prev.status === 'partial')
  const nowEarns = status === 'done' || status === 'partial'
  if (nowEarns && !prevEarned) {
    const p = status === 'done' ? block.points : Math.ceil(block.points / 2)
    stmts.push(DB.prepare(`INSERT INTO points_ledger (log_date, points, reason, ref_type, ref_id) VALUES (?,?,?,?,?)`)
      .bind(date, p, `${status === 'done' ? 'Completed' : 'Partial'}: ${block.title} (+${p})`, 'block', id))
  } else if (!nowEarns && prevEarned) {
    const p = prev.status === 'done' ? block.points : Math.ceil(block.points / 2)
    stmts.push(DB.prepare(`INSERT INTO points_ledger (log_date, points, reason, ref_type, ref_id) VALUES (?,?,?,?,?)`)
      .bind(date, -p, `Reverted: ${block.title} (-${p})`, 'block', id))
  }
  await DB.batch(stmts)
  await writeDaySummary(DB, date, false)
  return c.json({ ok: true, date })
})

// ============ APPEALS — one token per week, permanent reason ============
app.post('/api/appeals', async (c) => {
  const DB = c.env.DB
  const { block_id, block_date, reason } = await c.req.json()
  const { date } = await userNow(DB)
  if (!reason || String(reason).trim().length < 100) {
    return c.json({ error: 'THE REASON IS THE PRICE. Write at least 100 characters explaining exactly what happened — this goes on the permanent record.' }, 400)
  }
  if (!block_id || !block_date) return c.json({ error: 'block_id and block_date required' }, 400)
  if (block_date > date) return c.json({ error: 'Cannot appeal the future.' }, 400)
  if (block_date < addDays(date, -7)) return c.json({ error: 'Too late. Appeals reach back 7 days at most — old wounds stay closed.' }, 400)
  const log = await DB.prepare(`SELECT * FROM block_logs WHERE block_id=? AND log_date=?`).bind(block_id, block_date).first<any>()
  if (!log || log.status !== 'missed') return c.json({ error: 'That block was not auto-canceled. Appeals only reopen closed windows.' }, 400)
  const week = isoWeekKey(date)
  // UNIQUE(week_key) makes this race-safe: the INSERT itself is the arbiter
  const ins = await DB.prepare(
    `INSERT OR IGNORE INTO appeals (appeal_date, block_id, block_date, reason, week_key) VALUES (?,?,?,?,?)`
  ).bind(date, block_id, block_date, String(reason).trim(), week).run()
  if ((ins.meta as any).changes === 0) {
    return c.json({ error: 'APPEAL TOKEN SPENT. One per week — the next one arrives Monday.' }, 409)
  }
  // reopen the window: missed → pending, ack the flag, refund the penalty
  const pen = await DB.prepare(
    `SELECT COALESCE(SUM(points),0) p FROM points_ledger WHERE log_date=? AND ref_type='flag' AND ref_id=? AND points<0`
  ).bind(block_date, block_id).first<any>()
  const stmts: D1PreparedStatement[] = [
    DB.prepare(`UPDATE block_logs SET status='pending', note='REOPENED BY APPEAL ('||?||')' WHERE block_id=? AND log_date=?`)
      .bind(date, block_id, block_date),
    DB.prepare(`UPDATE honesty_flags SET acknowledged=1 WHERE flag_date=? AND flag_type='missed_live' AND ref_type='block' AND ref_id=?`)
      .bind(block_date, block_id),
  ]
  if ((pen?.p ?? 0) < 0) {
    stmts.push(DB.prepare(`INSERT INTO points_ledger (log_date, points, reason, ref_type, ref_id) VALUES (?,?,?,?,?)`)
      .bind(date, -pen.p, `APPEAL GRANTED: penalty refunded for reopened window (block #${block_id}, ${block_date}). The reason is on the permanent record.`, 'appeal', block_id))
  }
  await DB.batch(stmts)
  await writeDaySummary(DB, block_date, false)
  return c.json({ ok: true, refunded: -(pen?.p ?? 0) })
})
app.get('/api/appeals', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, b.title FROM appeals a JOIN schedule_blocks b ON b.id=a.block_id ORDER BY a.created_at DESC LIMIT 50`
  ).all()
  return c.json(results)
})

// ============ LOAD REDUCTION — answer the why ============
app.post('/api/load-reductions/:id/answer', async (c) => {
  const { reason } = await c.req.json()
  const ok = ['wrong_time', 'too_long', 'wrong_prereq', 'dont_want_it']
  if (!ok.includes(reason)) return c.json({ error: 'Answer must be one of: wrong_time, too_long, wrong_prereq, dont_want_it' }, 400)
  await c.env.DB.prepare(`UPDATE load_reductions SET reason=?, answered_at=datetime('now') WHERE id=?`)
    .bind(reason, Number(c.req.param('id'))).run()
  const advice: Record<string, string> = {
    wrong_time: 'Then MOVE it. Edit the block to the hour your energy actually supports it.',
    too_long: 'Then SHRINK it permanently. A 25-minute block done daily beats a 90-minute block done never.',
    wrong_prereq: 'Then fix the pipeline. What has to exist before this block can succeed? Schedule THAT.',
    dont_want_it: 'Then that is the real finding. Either recommit for a reason you actually believe, or delete it with honor. Zombie blocks corrupt the whole ledger.'
  }
  return c.json({ ok: true, advice: advice[reason] })
})

// ============ PREDICTION LOG — the calibration instrument ============
app.post('/api/predictions', async (c) => {
  const DB = c.env.DB
  const { claim, confidence, resolve_by, domain } = await c.req.json()
  const { date } = await userNow(DB)
  if (!claim || String(claim).trim().length < 10) return c.json({ error: 'State the claim precisely — a vague prediction is unfalsifiable, which is the disease this log cures.' }, 400)
  const conf = Number(confidence)
  if (!Number.isFinite(conf) || conf < 50 || conf > 99) return c.json({ error: 'Confidence must be 50–99%. Below 50, state the opposite claim. 100 does not exist for mortals.' }, 400)
  if (!resolve_by || resolve_by <= date) return c.json({ error: 'Resolution date must be in the future.' }, 400)
  const r = await DB.prepare(
    `INSERT INTO predictions (made_date, claim, confidence, resolve_by, domain) VALUES (?,?,?,?,?)`
  ).bind(date, String(claim).trim(), conf, resolve_by, domain || null).run()
  return c.json({ ok: true, id: r.meta.last_row_id })
})
app.get('/api/predictions', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM predictions ORDER BY (outcome='unresolved') DESC, resolve_by ASC, id DESC LIMIT 200`).all()
  return c.json(results)
})
app.post('/api/predictions/:id/resolve', async (c) => {
  const DB = c.env.DB
  const { outcome, note } = await c.req.json()
  if (!['right', 'wrong', 'void'].includes(outcome)) return c.json({ error: 'Outcome: right, wrong, or void.' }, 400)
  const { date } = await userNow(DB)
  const p = await DB.prepare(`SELECT * FROM predictions WHERE id=?`).bind(Number(c.req.param('id'))).first<any>()
  if (!p) return c.json({ error: 'not found' }, 404)
  if (p.outcome !== 'unresolved') return c.json({ error: 'Already resolved. The record does not get rewritten.' }, 409)
  await DB.prepare(`UPDATE predictions SET outcome=?, resolved_date=?, resolution_note=? WHERE id=?`)
    .bind(outcome, date, note || null, p.id).run()
  return c.json({ ok: true })
})
// Calibration report: Brier score, bucketed curve, plain-language bias
app.get('/api/predictions/calibration', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT confidence, outcome FROM predictions WHERE outcome IN ('right','wrong')`
  ).all()
  const rows = results as any[]
  if (!rows.length) return c.json({ n: 0, brier: null, buckets: [], verdict: 'No resolved predictions yet. Make claims. Date them. Grade them.' })
  let brier = 0
  const buckets: Record<string, { n: number; hits: number; confSum: number }> = {}
  for (const r of rows) {
    const p = r.confidence / 100, hit = r.outcome === 'right' ? 1 : 0
    brier += (p - hit) ** 2
    const bk = r.confidence < 60 ? '50-59' : r.confidence < 70 ? '60-69' : r.confidence < 80 ? '70-79' : r.confidence < 90 ? '80-89' : '90-99'
    ;(buckets[bk] ||= { n: 0, hits: 0, confSum: 0 })
    buckets[bk].n++; buckets[bk].hits += hit; buckets[bk].confSum += r.confidence
  }
  brier = brier / rows.length
  const curve = Object.entries(buckets).sort().map(([range, b]) => ({
    range, n: b.n, avgConfidence: Math.round(b.confSum / b.n), hitRate: Math.round((b.hits / b.n) * 100)
  }))
  // plain-language bias statement
  const gaps = curve.filter(b => b.n >= 3).map(b => b.avgConfidence - b.hitRate)
  const avgGap = gaps.length ? Math.round(gaps.reduce((a, g) => a + g, 0) / gaps.length) : 0
  let verdict: string
  if (!gaps.length) verdict = `Only ${rows.length} graded predictions — grade at least 3 per bucket before trusting the curve.`
  else if (avgGap >= 15) verdict = `OVERCONFIDENT by ~${avgGap} points: when you say ${curve[curve.length - 1].avgConfidence}%, reality delivers ${curve[curve.length - 1].hitRate}%. Your certainty is louder than your accuracy — shave ${avgGap} points off every gut number before acting on it.`
  else if (avgGap >= 7) verdict = `Mildly overconfident (~${avgGap} pts). Decent, but when the stakes are high, treat your "sure" as "probably".`
  else if (avgGap <= -10) verdict = `UNDERCONFIDENT by ~${-avgGap} points: you know more than you let yourself act on. Your hesitation is costing you moves you would have won.`
  else verdict = `WELL CALIBRATED (gap ~${avgGap} pts, Brier ${brier.toFixed(3)}). Your stated confidence is close to reality — rare. Keep grading.`
  return c.json({ n: rows.length, brier: Number(brier.toFixed(4)), buckets: curve, verdict })
})

// ============ DEBRIEF ============
app.post('/api/debrief', async (c) => {
  const DB = c.env.DB
  const b = await c.req.json()
  b.date = await safeDate(DB, b.date) // clamp: no future debriefs
  const existed = await DB.prepare(`SELECT id FROM debriefs WHERE log_date=?`).bind(b.date).first()
  await DB.prepare(
    `INSERT INTO debriefs (log_date, wins, breaks, tomorrow_targets, strategy_insight, mood, energy, sleep_time, wake_time, sleep_hours)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(log_date) DO UPDATE SET wins=excluded.wins, breaks=excluded.breaks, tomorrow_targets=excluded.tomorrow_targets,
       strategy_insight=excluded.strategy_insight, mood=excluded.mood, energy=excluded.energy,
       sleep_time=excluded.sleep_time, wake_time=excluded.wake_time, sleep_hours=excluded.sleep_hours`
  ).bind(b.date, b.wins || null, b.breaks || null, b.tomorrow_targets || null, b.strategy_insight || null,
    b.mood || null, b.energy || null, b.sleep_time || null, b.wake_time || null, b.sleep_hours || null).run()
  if (!existed) {
    await DB.prepare(`INSERT INTO points_ledger (log_date, points, reason, ref_type) VALUES (?,?,?,?)`)
      .bind(b.date, 25, 'Night debrief filed. Intelligence report received. (+25)', 'debrief').run()
  }
  await writeDaySummary(DB, b.date, false)
  return c.json({ ok: true })
})

app.get('/api/debriefs', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM debriefs ORDER BY log_date DESC LIMIT 60`).all()
  return c.json(results)
})

// ============ CAMPAIGN (progress-locked) ============
async function ensureUnlocks(DB: D1Database) {
  // seed progress rows for all units
  await DB.prepare(
    `INSERT INTO unit_progress (unit_id, status)
     SELECT u.id, 'locked' FROM units u WHERE u.id NOT IN (SELECT unit_id FROM unit_progress)`
  ).run()
  // per track: walk phases in order; first incomplete unit becomes active
  const phases = (await DB.prepare(`SELECT * FROM phases ORDER BY sort_order`).all()).results as any[]
  const tracks: Record<string, any[]> = {}
  for (const p of phases) { (tracks[p.track] ||= []).push(p) }
  for (const track of Object.keys(tracks)) {
    let blocked = false
    for (const p of tracks[track]) {
      if (blocked) break
      const units = (await DB.prepare(
        `SELECT u.id, up.status FROM units u JOIN unit_progress up ON up.unit_id=u.id WHERE u.phase_id=? ORDER BY u.sort_order`
      ).bind(p.id).all()).results as any[]
      for (const u of units) {
        if (u.status === 'complete') continue
        if (u.status === 'locked') {
          await DB.prepare(`UPDATE unit_progress SET status='active' WHERE unit_id=?`).bind(u.id).run()
        }
        blocked = true
        break
      }
    }
  }
}

app.get('/api/campaign', async (c) => {
  const DB = c.env.DB
  const phases = (await DB.prepare(`SELECT * FROM phases ORDER BY sort_order`).all()).results as any[]
  const out = []
  for (const p of phases) {
    const units = (await DB.prepare(
      `SELECT u.*, up.status, up.reading_done_at, up.drill_done_at, up.drill_report, up.debrief_answer,
              up.exam_answers, up.exam_self_score, up.completed_at, up.attempts
       FROM units u JOIN unit_progress up ON up.unit_id=u.id WHERE u.phase_id=? ORDER BY u.sort_order`
    ).bind(p.id).all()).results as any[]
    const complete = units.filter(u => u.status === 'complete').length
    out.push({ ...p, units, progress: units.length ? Math.round((complete / units.length) * 100) : 0, complete, total: units.length })
  }
  return c.json(out)
})

app.post('/api/units/:id/step', async (c) => {
  const DB = c.env.DB
  const id = Number(c.req.param('id'))
  const { step, drill_report, debrief_answer, exam_answers, exam_self_score, date } = await c.req.json()
  const up = await DB.prepare(`SELECT * FROM unit_progress WHERE unit_id=?`).bind(id).first<any>()
  const unit = await DB.prepare(`SELECT * FROM units WHERE id=?`).bind(id).first<any>()
  if (!up || !unit) return c.json({ error: 'not found' }, 404)
  if (up.status === 'locked') return c.json({ error: 'UNIT LOCKED. Finish the previous unit first — this system is progress-based, no skipping.' }, 400)
  const today = date || (await userNow(c.env.DB)).date

  if (step === 'reading') {
    await DB.prepare(`UPDATE unit_progress SET status='reading_done', reading_done_at=datetime('now') WHERE unit_id=?`).bind(id).run()
    await DB.prepare(`INSERT INTO points_ledger (log_date,points,reason,ref_type,ref_id) VALUES (?,?,?,?,?)`)
      .bind(today, 20, `Reading complete: ${unit.title} (+20)`, 'unit', id).run()
  } else if (step === 'drill') {
    if (!drill_report || drill_report.trim().length < 30) {
      return c.json({ error: 'DRILL REPORT TOO THIN. A field drill without a real report is a skipped drill — write at least a few honest sentences about what you actually DID and what happened.' }, 400)
    }
    await DB.prepare(`UPDATE unit_progress SET status='drill_done', drill_done_at=datetime('now'), drill_report=? WHERE unit_id=?`).bind(drill_report, id).run()
    await DB.prepare(`INSERT INTO points_ledger (log_date,points,reason,ref_type,ref_id) VALUES (?,?,?,?,?)`)
      .bind(today, 30, `Field drill executed: ${unit.title} (+30)`, 'unit', id).run()
  } else if (step === 'complete') {
    if (unit.is_exam) {
      if (!exam_answers) return c.json({ error: 'Exam answers required.' }, 400)
      const score = Number(exam_self_score ?? 0)
      await DB.prepare(`UPDATE unit_progress SET exam_answers=?, exam_self_score=?, attempts=attempts+1 WHERE unit_id=?`)
        .bind(JSON.stringify(exam_answers), score, id).run()
      if (score < 70) {
        await addFlag(DB, today, 'exam_failed', 'serious',
          `EXAM NOT PASSED: ${unit.title} — self-score ${score}/100 (pass: 70). No shame: the weak chapters are now visible. Re-study them, retake when ready. The gate stays closed until earned. -10 pts.`, -10)
        return c.json({ ok: false, failed: true, message: `Score ${score}/100. Pass mark is 70. The honesty engine has logged this attempt. Restudy your weak chapters and retake — the next phase stays locked until you EARN it.` })
      }
      await DB.prepare(`UPDATE unit_progress SET status='complete', completed_at=datetime('now') WHERE unit_id=?`).bind(id).run()
      await DB.prepare(`INSERT INTO points_ledger (log_date,points,reason,ref_type,ref_id) VALUES (?,?,?,?,?)`)
        .bind(today, 100, `EXAM PASSED (${score}/100): ${unit.title} (+100)`, 'exam', id).run()
    } else {
      if (up.status !== 'drill_done' && up.status !== 'reading_done') {
        return c.json({ error: 'Mark the reading done first.' }, 400)
      }
      if (up.status === 'reading_done' && unit.field_drill) {
        return c.json({ error: 'FIELD DRILL NOT REPORTED. Reading without application is entertainment, not training. Execute the drill, file the report, then complete.' }, 400)
      }
      await DB.prepare(`UPDATE unit_progress SET status='complete', completed_at=datetime('now'), debrief_answer=COALESCE(?,debrief_answer) WHERE unit_id=?`)
        .bind(debrief_answer || null, id).run()
      await DB.prepare(`INSERT INTO points_ledger (log_date,points,reason,ref_type,ref_id) VALUES (?,?,?,?,?)`)
        .bind(today, 50, `UNIT CONQUERED: ${unit.title} (+50)`, 'unit', id).run()
    }
    await ensureUnlocks(DB)
  }
  return c.json({ ok: true })
})

// ============ MAXIMS + FLASHCARDS ============
app.get('/api/maxims', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM maxims ORDER BY source, id`).all()
  return c.json(results)
})
app.post('/api/maxims', async (c) => {
  const b = await c.req.json()
  const r = await c.env.DB.prepare(
    `INSERT INTO maxims (source, principle, naive_reading, master_reading, my_words, created_by_user) VALUES (?,?,?,?,?,1)`
  ).bind(b.source, b.principle, b.naive_reading || '(write it)', b.master_reading || '(write it)', b.my_words || null).run()
  await c.env.DB.prepare(`INSERT INTO flashcards (maxim_id) VALUES (?)`).bind(r.meta.last_row_id).run()
  return c.json({ ok: true, id: r.meta.last_row_id })
})
app.post('/api/maxims/:id/my-words', async (c) => {
  const { my_words } = await c.req.json()
  await c.env.DB.prepare(`UPDATE maxims SET my_words=? WHERE id=?`).bind(my_words, Number(c.req.param('id'))).run()
  return c.json({ ok: true })
})

async function ensureCards(DB: D1Database) {
  await DB.prepare(`INSERT INTO flashcards (maxim_id) SELECT id FROM maxims WHERE id NOT IN (SELECT maxim_id FROM flashcards)`).run()
}
app.get('/api/cards/due', async (c) => {
  const DB = c.env.DB
  const date = await safeDate(c.env.DB, c.req.query('date'))
  const { results } = await DB.prepare(
    `SELECT f.*, m.source, m.principle, m.naive_reading, m.master_reading, m.my_words
     FROM flashcards f JOIN maxims m ON m.id=f.maxim_id WHERE f.due_date <= ? ORDER BY f.due_date LIMIT 15`
  ).bind(date).all()
  return c.json(results)
})
app.post('/api/cards/:maximId/review', async (c) => {
  const DB = c.env.DB
  const mid = Number(c.req.param('maximId'))
  const { grade, date } = await c.req.json() // 0 fail, 1 hard, 2 good, 3 easy
  const card = await DB.prepare(`SELECT * FROM flashcards WHERE maxim_id=?`).bind(mid).first<any>()
  if (!card) return c.json({ error: 'no card' }, 404)
  let { interval_days, ease, reps, lapses } = card
  if (grade === 0) { lapses++; reps = 0; interval_days = 0; ease = Math.max(1.3, ease - 0.2) }
  else {
    reps++
    ease = Math.max(1.3, ease + (grade === 3 ? 0.1 : grade === 1 ? -0.15 : 0))
    if (reps === 1) interval_days = 1
    else if (reps === 2) interval_days = 3
    else interval_days = Math.round(interval_days * ease * (grade === 1 ? 0.8 : grade === 3 ? 1.3 : 1))
  }
  const today = date || (await userNow(c.env.DB)).date
  const due = addDays(today, Math.max(interval_days, grade === 0 ? 0 : 1))
  await DB.prepare(`UPDATE flashcards SET interval_days=?, ease=?, reps=?, lapses=?, due_date=? WHERE maxim_id=?`)
    .bind(interval_days, ease, reps, lapses, due, mid).run()
  await DB.prepare(`INSERT INTO card_reviews (maxim_id, grade) VALUES (?,?)`).bind(mid, grade).run()
  return c.json({ ok: true, next_due: due })
})

// ============ FLAGS ============
app.post('/api/flags/:id/ack', async (c) => {
  await c.env.DB.prepare(`UPDATE honesty_flags SET acknowledged=1 WHERE id=?`).bind(Number(c.req.param('id'))).run()
  return c.json({ ok: true })
})
app.get('/api/flags/history', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM honesty_flags ORDER BY created_at DESC LIMIT 100`).all()
  return c.json(results)
})

// ============ THE TONGUE — WISE-RESPONSE ARMORY + SUPREME MEMORIZATION ============
// Mastery ladder: new → learning (3+ correct) → memorized (7+ correct, interval≥7d)
//                 → ingrained (14+ correct, interval≥21d) → reflex (25+ correct, interval≥45d)
function tongueMastery(s: any): string {
  const cr = s.correct_reviews, iv = s.interval_days
  if (cr >= 25 && iv >= 45) return 'reflex'
  if (cr >= 14 && iv >= 21) return 'ingrained'
  if (cr >= 7 && iv >= 7) return 'memorized'
  if (cr >= 3) return 'learning'
  return 'new'
}

// Capture a wise response (the daily field-recording ritual)
app.post('/api/tongue', async (c) => {
  const DB = c.env.DB
  const { situation, trigger_q, response, why_works, source, category } = await c.req.json()
  if (!situation?.trim() || !trigger_q?.trim() || !response?.trim())
    return c.json({ error: 'Situation, the question, and the exact response are all required. Record it fully or it is lost.' }, 400)
  const today = (await userNow(c.env.DB)).date
  const r = await DB.prepare(
    `INSERT INTO responses (situation, trigger_q, response, why_works, source, category) VALUES (?,?,?,?,?,?)`
  ).bind(situation.trim(), trigger_q.trim(), response.trim(), (why_works || '').trim() || null, (source || '').trim() || null, category || 'wit').run()
  const rid = r.meta.last_row_id
  await DB.prepare(`INSERT INTO response_srs (response_id, due_date) VALUES (?,?)`).bind(rid, today).run()
  await DB.prepare(`INSERT INTO points_ledger (log_date, points, reason, ref_type, ref_id) VALUES (?,?,?,?,?)`)
    .bind(today, 3, `INTEL CAPTURED: recorded a wise response ("${String(trigger_q).slice(0, 50)}…"). +3 pts. Now memorize it.`, 'tongue', rid).run()
  return c.json({ ok: true, id: rid })
})

// List / filter the armory
app.get('/api/tongue', async (c) => {
  const DB = c.env.DB
  const cat = c.req.query('category')
  const q = c.req.query('q')
  let sql = `SELECT r.*, s.mastery, s.due_date, s.reps, s.lapses, s.interval_days, s.total_reviews, s.correct_reviews
             FROM responses r JOIN response_srs s ON s.response_id=r.id WHERE r.archived=0`
  const binds: any[] = []
  if (cat && cat !== 'all') { sql += ` AND r.category=?`; binds.push(cat) }
  if (q) { sql += ` AND (r.situation LIKE ? OR r.trigger_q LIKE ? OR r.response LIKE ?)`; binds.push(`%${q}%`, `%${q}%`, `%${q}%`) }
  sql += ` ORDER BY r.created_at DESC LIMIT 300`
  const { results } = await DB.prepare(sql).bind(...binds).all()
  return c.json(results)
})

app.put('/api/tongue/:id', async (c) => {
  const DB = c.env.DB
  const id = Number(c.req.param('id'))
  const { situation, trigger_q, response, why_works, source, category } = await c.req.json()
  await DB.prepare(`UPDATE responses SET situation=?, trigger_q=?, response=?, why_works=?, source=?, category=? WHERE id=?`)
    .bind(situation, trigger_q, response, why_works || null, source || null, category || 'wit', id).run()
  return c.json({ ok: true })
})
app.delete('/api/tongue/:id', async (c) => {
  await c.env.DB.prepare(`UPDATE responses SET archived=1 WHERE id=?`).bind(Number(c.req.param('id'))).run()
  return c.json({ ok: true })
})

// Due drills — each response is served with a rotating challenge mode so the
// brain is attacked from 5 angles: recall / cloze / first_letters / reverse / delivery
app.get('/api/tongue/due', async (c) => {
  const DB = c.env.DB
  const date = await safeDate(c.env.DB, c.req.query('date'))
  const { results } = await DB.prepare(
    `SELECT r.*, s.mastery, s.due_date, s.reps, s.lapses, s.interval_days, s.total_reviews, s.correct_reviews, s.last_mode
     FROM responses r JOIN response_srs s ON s.response_id=r.id
     WHERE r.archived=0 AND s.due_date <= ? ORDER BY s.due_date LIMIT 20`
  ).bind(date).all()
  const MODES = ['recall', 'cloze', 'first_letters', 'reverse', 'delivery']
  const out = (results as any[]).map((r: any) => {
    // rotate: never repeat the last mode; deeper mastery gets harder modes more often
    let pool = MODES.filter(m => m !== r.last_mode)
    if (r.mastery === 'ingrained' || r.mastery === 'reflex') pool = pool.filter(m => m !== 'recall')
    const mode = pool[Math.floor(Math.random() * pool.length)] || 'recall'
    return { ...r, drill_mode: mode }
  })
  return c.json(out)
})

// Grade a drill (0 blank | 1 shaky | 2 solid | 3 fluent) — SM-2 with mastery ladder
app.post('/api/tongue/:id/review', async (c) => {
  const DB = c.env.DB
  const id = Number(c.req.param('id'))
  const { grade, mode, date } = await c.req.json()
  const s = await DB.prepare(`SELECT * FROM response_srs WHERE response_id=?`).bind(id).first<any>()
  if (!s) return c.json({ error: 'no such response' }, 404)
  let { interval_days, ease, reps, lapses, total_reviews, correct_reviews } = s
  total_reviews++
  if (grade === 0) { lapses++; reps = 0; interval_days = 0; ease = Math.max(1.3, ease - 0.2) }
  else {
    reps++; correct_reviews++
    ease = Math.max(1.3, ease + (grade === 3 ? 0.1 : grade === 1 ? -0.15 : 0))
    if (reps === 1) interval_days = 1
    else if (reps === 2) interval_days = 3
    else interval_days = Math.round(interval_days * ease * (grade === 1 ? 0.8 : grade === 3 ? 1.3 : 1))
  }
  const today = date || (await userNow(c.env.DB)).date
  const due = addDays(today, Math.max(interval_days, grade === 0 ? 0 : 1))
  const mastery = tongueMastery({ correct_reviews, interval_days })
  const prevMastery = s.mastery
  await DB.prepare(
    `UPDATE response_srs SET interval_days=?, ease=?, reps=?, lapses=?, due_date=?, mastery=?, total_reviews=?, correct_reviews=?, last_mode=? WHERE response_id=?`
  ).bind(interval_days, ease, reps, lapses, due, mastery, total_reviews, correct_reviews, mode || 'recall', id).run()
  await DB.prepare(`INSERT INTO tongue_reviews (response_id, review_date, mode, grade) VALUES (?,?,?,?)`)
    .bind(id, today, mode || 'recall', grade).run()
  // Mastery promotion bonuses — real, earned progress
  let promoted: string | null = null
  if (mastery !== prevMastery) {
    const bonus: any = { learning: 2, memorized: 8, ingrained: 15, reflex: 30 }
    if (bonus[mastery]) {
      promoted = mastery
      const r = await DB.prepare(`SELECT trigger_q FROM responses WHERE id=?`).bind(id).first<any>()
      await DB.prepare(`INSERT INTO points_ledger (log_date, points, reason, ref_type, ref_id) VALUES (?,?,?,?,?)`)
        .bind(today, bonus[mastery], `TONGUE ${mastery.toUpperCase()}: "${String(r?.trigger_q || '').slice(0, 50)}…" climbed to ${mastery.toUpperCase()}. +${bonus[mastery]} pts.`, 'tongue', id).run()
    }
  }
  return c.json({ ok: true, next_due: due, mastery, promoted })
})

// Weekly exam — strict. 10 random armed responses (or all if fewer). Pass ≥ 80%.
app.get('/api/tongue/exam', async (c) => {
  const DB = c.env.DB
  const { results } = await DB.prepare(
    `SELECT r.id, r.situation, r.trigger_q, r.response, r.category, s.mastery
     FROM responses r JOIN response_srs s ON s.response_id=r.id
     WHERE r.archived=0 AND s.total_reviews > 0 ORDER BY RANDOM() LIMIT 10`
  ).all()
  return c.json(results)
})
app.post('/api/tongue/exam/submit', async (c) => {
  const DB = c.env.DB
  const { total, correct, date } = await c.req.json()
  const today = date || (await userNow(c.env.DB)).date
  const pct = total ? Math.round((correct / total) * 100) : 0
  const passed = pct >= 80 ? 1 : 0
  await DB.prepare(`INSERT INTO tongue_exams (exam_date, total, correct, score_pct, passed) VALUES (?,?,?,?,?)`)
    .bind(today, total, correct, pct, passed).run()
  if (passed) {
    await DB.prepare(`INSERT INTO points_ledger (log_date, points, reason, ref_type) VALUES (?,?,?,?)`)
      .bind(today, 25, `TONGUE EXAM PASSED: ${correct}/${total} (${pct}%). The armory is in your head. +25 pts.`, 'tongue').run()
  } else {
    await addFlag(DB, today, 'tongue_exam_failed', 'serious',
      `TONGUE EXAM FAILED: ${correct}/${total} (${pct}%). You recorded wisdom you cannot recall — that is decoration, not armament. −10 pts. Drill and retake.`, -10)
  }
  return c.json({ ok: true, score_pct: pct, passed: !!passed })
})

// Tongue stats — the real-progress dashboard
app.get('/api/tongue/stats', async (c) => {
  const DB = c.env.DB
  const date = await safeDate(c.env.DB, c.req.query('date'))
  const byMastery = (await DB.prepare(
    `SELECT s.mastery, COUNT(*) n FROM response_srs s JOIN responses r ON r.id=s.response_id WHERE r.archived=0 GROUP BY s.mastery`
  ).all()).results
  const totals = await DB.prepare(
    `SELECT COUNT(*) total FROM responses WHERE archived=0`).first<any>()
  const due = await DB.prepare(
    `SELECT COUNT(*) n FROM response_srs s JOIN responses r ON r.id=s.response_id WHERE r.archived=0 AND s.due_date<=?`).bind(date).first<any>()
  const reviews7 = await DB.prepare(
    `SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN grade>=2 THEN 1 ELSE 0 END),0) solid FROM tongue_reviews WHERE review_date >= ?`
  ).bind(addDays(date, -7)).first<any>()
  const exams = (await DB.prepare(`SELECT * FROM tongue_exams ORDER BY created_at DESC LIMIT 8`).all()).results
  const captured7 = await DB.prepare(
    `SELECT COUNT(*) n FROM responses WHERE archived=0 AND created_at >= datetime(?, '-7 days')`).bind(date + ' 00:00:00').first<any>()
  const byCat = (await DB.prepare(
    `SELECT category, COUNT(*) n FROM responses WHERE archived=0 GROUP BY category ORDER BY n DESC`).all()).results
  const lastExam = (exams as any[])[0] || null
  const weekExamDone = lastExam && (lastExam as any).exam_date >= addDays(date, -6)
  return c.json({
    total: totals?.total ?? 0, due: due?.n ?? 0, byMastery, byCat,
    reviews7: reviews7?.n ?? 0, solid7: reviews7?.solid ?? 0,
    captured7: captured7?.n ?? 0, exams, weekExamDone: !!weekExamDone
  })
})

// ============ LAWS ============
app.get('/api/laws', async (c) => {
  const date = await safeDate(c.env.DB, c.req.query('date'))
  const { results } = await c.env.DB.prepare(
    `SELECT l.*, lc.kept, lc.note FROM laws l LEFT JOIN law_checks lc ON lc.law_id=l.id AND lc.log_date=? ORDER BY l.sort_order`
  ).bind(date).all()
  return c.json(results)
})
app.post('/api/laws/:id/check', async (c) => {
  const { date, kept, note } = await c.req.json()
  await c.env.DB.prepare(
    `INSERT INTO law_checks (law_id, log_date, kept, note) VALUES (?,?,?,?)
     ON CONFLICT(law_id, log_date) DO UPDATE SET kept=excluded.kept, note=excluded.note`
  ).bind(Number(c.req.param('id')), date, kept ? 1 : 0, note || null).run()
  return c.json({ ok: true })
})

// ============ REWARDS ============
app.get('/api/rewards', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM rewards ORDER BY cost`).all()
  return c.json(results)
})
app.post('/api/rewards/:id/redeem', async (c) => {
  const DB = c.env.DB
  const id = Number(c.req.param('id'))
  const { date } = await userNow(DB) // server clock
  const reward = await DB.prepare(`SELECT * FROM rewards WHERE id=?`).bind(id).first<any>()
  if (!reward) return c.json({ error: 'no reward' }, 404)
  // RACE-SAFE: the debit INSERT itself re-checks the balance atomically —
  // two simultaneous redeems cannot both pass, because each INSERT only fires
  // if the CURRENT ledger sum still covers the cost.
  const debit = await DB.prepare(
    `INSERT INTO points_ledger (log_date, points, reason, ref_type, ref_id)
     SELECT ?, ?, ?, 'reward', ?
     WHERE (SELECT COALESCE(SUM(points),0) FROM points_ledger) >= ?`
  ).bind(date, -reward.cost, `REWARD REDEEMED: ${reward.title} (-${reward.cost})`, id, reward.cost).run()
  if ((debit.meta as any).changes === 0) {
    const pts = await DB.prepare(`SELECT COALESCE(SUM(points),0) as total FROM points_ledger`).first<{ total: number }>()
    return c.json({ error: `NOT EARNED YET. You have ${pts?.total ?? 0} pts, this costs ${reward.cost}. Rewards are taken, not given. Back to work.` }, 400)
  }
  await DB.batch([
    DB.prepare(`UPDATE rewards SET redeemed_count=redeemed_count+1 WHERE id=?`).bind(id),
    DB.prepare(`INSERT INTO reward_redemptions (reward_id) VALUES (?)`).bind(id),
  ])
  return c.json({ ok: true })
})

// ============ STATS ============
app.get('/api/stats', async (c) => {
  const DB = c.env.DB
  const date = await safeDate(c.env.DB, c.req.query('date'))
  // 14-day strip straight from day_summary (2 queries, not 28+)
  const from14 = addDays(date, -13)
  const sumRows = (await DB.prepare(
    `SELECT * FROM day_summary WHERE summary_date BETWEEN ? AND ?`
  ).bind(from14, date).all()).results as any[]
  const debRows = (await DB.prepare(
    `SELECT log_date, sleep_hours, mood, energy FROM debriefs WHERE log_date BETWEEN ? AND ?`
  ).bind(from14, date).all()).results as any[]
  const sumBy = new Map(sumRows.map(r => [r.summary_date, r]))
  const debBy = new Map(debRows.map(r => [r.log_date, r]))
  const days = [] as any[]
  for (let i = 13; i >= 0; i--) {
    const d = addDays(date, -i)
    const s = sumBy.get(d), deb = debBy.get(d)
    // today (or an unmaterialized day) falls back to live computation once
    let pct = s?.adherence_pct ?? null, done = s?.blocks_done ?? 0, total = s?.blocks_total ?? 0, mvd = !!s?.mvd_held
    if (pct === null && d === date) {
      const adh = dayAdherence(await blocksForDate(DB, d))
      pct = adh.pct; done = Math.round(adh.done); total = adh.total; mvd = adh.mvdHeld
    }
    days.push({ date: d, pct: pct ?? 0, done, total, mvdHeld: mvd, sleep: deb?.sleep_hours ?? null, mood: deb?.mood ?? null, energy: deb?.energy ?? null, debrief: !!deb })
  }
  // category breakdown last 7 days
  const from = addDays(date, -6)
  const { results: catRows } = await DB.prepare(
    `SELECT b.category, COUNT(*) as total,
            SUM(CASE WHEN l.status='done' THEN 1 WHEN l.status='partial' THEN 0.5 ELSE 0 END) as done
     FROM block_logs l JOIN schedule_blocks b ON b.id=l.block_id
     WHERE l.log_date BETWEEN ? AND ? GROUP BY b.category`
  ).bind(from, date).all()
  const ledger = (await DB.prepare(`SELECT * FROM points_ledger ORDER BY created_at DESC LIMIT 40`).all()).results
  const unitStats = await DB.prepare(
    `SELECT COUNT(*) as total, SUM(CASE WHEN status='complete' THEN 1 ELSE 0 END) as complete FROM unit_progress`
  ).first<any>()
  const cardStats = await DB.prepare(
    `SELECT COUNT(*) as reviews, AVG(grade) as avg_grade FROM card_reviews`
  ).first<any>()
  const flagCounts = (await DB.prepare(
    `SELECT flag_type, COUNT(*) as n FROM honesty_flags GROUP BY flag_type`
  ).all()).results
  const streak = await computeStreak(DB, date)
  const pts = await DB.prepare(`SELECT COALESCE(SUM(points),0) as total FROM points_ledger`).first<{ total: number }>()

  // ── MEDALS (war decorations, computed live — earned, never given) ──
  const debriefCount = (await DB.prepare(`SELECT COUNT(*) as n FROM debriefs`).first<any>())?.n ?? 0
  const chaptersDone = (await DB.prepare(`SELECT COUNT(*) as n FROM book_progress WHERE status='done'`).first<any>())?.n ?? 0
  const booksDone = (await DB.prepare(
    `SELECT COUNT(*) as n FROM (SELECT book_id, COUNT(*) c FROM book_progress WHERE status='done' GROUP BY book_id HAVING c >= 12)`
  ).first<any>())?.n ?? 0
  const intelCount = (await DB.prepare(`SELECT COUNT(*) as n FROM intel_entries`).first<any>())?.n ?? 0
  const examsPassed = (await DB.prepare(`SELECT COUNT(*) as n FROM unit_progress up JOIN units u ON u.id=up.unit_id WHERE u.is_exam=1 AND up.status='complete'`).first<any>())?.n ?? 0
  const earlyWakes = (await DB.prepare(
    `SELECT COUNT(*) as n FROM debriefs WHERE wake_time IS NOT NULL AND wake_time <= '06:00'`
  ).first<any>())?.n ?? 0
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

  return c.json({ days, categories: catRows, ledger, unitStats, cardStats, flagCounts, streak, points: pts?.total ?? 0, medals })
})

// ============ LIFE INTEL (The Council) ============
app.get('/api/intel', async (c) => {
  const domain = c.req.query('domain')
  const q = domain
    ? c.env.DB.prepare(`SELECT * FROM intel_entries WHERE domain=? ORDER BY log_date DESC, id DESC LIMIT 100`).bind(domain)
    : c.env.DB.prepare(`SELECT * FROM intel_entries ORDER BY log_date DESC, id DESC LIMIT 100`)
  return c.json((await q.all()).results)
})

app.post('/api/intel', async (c) => {
  const b = await c.req.json()
  if (!b.title || !b.domain) return c.json({ error: 'Domain and title required.' }, 400)
  const r = await c.env.DB.prepare(
    `INSERT INTO intel_entries (log_date, domain, title, situation, my_move, outcome, verdict, principle_used, lesson, people)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(b.log_date || (await userNow(c.env.DB)).date, b.domain, b.title, b.situation || null,
    b.my_move || null, b.outcome || null, b.verdict || 'pending', b.principle_used || null,
    b.lesson || null, b.people || null).run()
  await c.env.DB.prepare(`INSERT INTO points_ledger (log_date, points, reason, ref_type, ref_id) VALUES (?,?,?,?,?)`)
    .bind(b.log_date || (await userNow(c.env.DB)).date, 15, `Intel filed: [${b.domain}] ${b.title} (+15)`, 'intel', r.meta.last_row_id).run()
  return c.json({ ok: true, id: r.meta.last_row_id })
})

app.post('/api/intel/:id/verdict', async (c) => {
  const { verdict, lesson } = await c.req.json()
  await c.env.DB.prepare(`UPDATE intel_entries SET verdict=?, lesson=COALESCE(?,lesson) WHERE id=?`)
    .bind(verdict, lesson || null, Number(c.req.param('id'))).run()
  return c.json({ ok: true })
})

// ============ BOOK PROGRESS (real books library) ============
const BOOKS_META = [
  { id: 'art_of_war', title: 'The Art of War', author: 'Sun Tzu', phase: 'P1', chapters: 13 },
  { id: 'the_prince', title: 'The Prince', author: 'Machiavelli', phase: 'P2', chapters: 26 },
  { id: 'discourses', title: 'Discourses on Livy', author: 'Machiavelli', phase: 'P2B', chapters: 141 },
  { id: 'on_war', title: 'On War (Book I)', author: 'Clausewitz', phase: 'P3', chapters: 12 },
  { id: 'meditations', title: 'Meditations', author: 'Marcus Aurelius', phase: 'PHIL', chapters: 12 },
  { id: 'enchiridion', title: 'The Enchiridion', author: 'Epictetus', phase: 'PHIL', chapters: 6 },
  { id: 'apology', title: 'Apology', author: 'Plato', phase: 'PHIL', chapters: 4 },
  { id: 'crito', title: 'Crito', author: 'Plato', phase: 'PHIL', chapters: 3 },
  { id: 'republic', title: 'The Republic (I–IV)', author: 'Plato', phase: 'PHIL', chapters: 4 },
  { id: 'zarathustra', title: 'Thus Spake Zarathustra (Pt.1)', author: 'Nietzsche', phase: 'PHIL', chapters: 25 },
  { id: 'beyond_good_evil', title: 'Beyond Good and Evil', author: 'Nietzsche', phase: 'PHIL', chapters: 10 },
]

app.get('/api/library', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT book_id, chapter_idx, status, last_para FROM book_progress`).all()
  const prog: Record<string, any[]> = {}
  for (const r of results as any[]) (prog[r.book_id] ||= []).push(r)
  return c.json(BOOKS_META.map(b => {
    const rows = prog[b.id] || []
    const done = rows.filter(r => r.status === 'done').length
    const reading = rows.find(r => r.status === 'reading')
    return { ...b, chaptersDone: done, currentChapter: reading?.chapter_idx ?? null, lastPara: reading?.last_para ?? 0 }
  }))
})

app.post('/api/library/:bookId/chapter/:idx', async (c) => {
  const bookId = c.req.param('bookId')
  const idx = Number(c.req.param('idx'))
  const { status, last_para, notes, date } = await c.req.json()
  const prev = await c.env.DB.prepare(`SELECT status FROM book_progress WHERE book_id=? AND chapter_idx=?`).bind(bookId, idx).first<any>()
  await c.env.DB.prepare(
    `INSERT INTO book_progress (book_id, chapter_idx, status, last_para, notes, completed_at)
     VALUES (?,?,?,?,?, CASE WHEN ?='done' THEN datetime('now') ELSE NULL END)
     ON CONFLICT(book_id, chapter_idx) DO UPDATE SET status=excluded.status,
       last_para=excluded.last_para, notes=COALESCE(excluded.notes, notes),
       completed_at=CASE WHEN excluded.status='done' THEN datetime('now') ELSE completed_at END`
  ).bind(bookId, idx, status || 'reading', last_para ?? 0, notes || null, status || 'reading').run()
  if (status === 'done' && prev?.status !== 'done') {
    await c.env.DB.prepare(`INSERT INTO points_ledger (log_date, points, reason, ref_type) VALUES (?,?,?,?)`)
      .bind(date || (await userNow(c.env.DB)).date, 20, `Real chapter finished: ${bookId} ch.${idx + 1} (+20)`, 'book').run()
  }
  return c.json({ ok: true })
})

// ============ CALENDAR EXPORT (.ics — device-native alarms) ============
app.use('/calendar.ics', async (c, next) => {
  if (!(await sessionValid(c))) return c.json({ error: 'AUTH REQUIRED' }, 401)
  return next()
})

app.get('/calendar.ics', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM schedule_blocks ORDER BY start_time`).all()
  const dayMap: Record<string, string> = { mon: 'MO', tue: 'TU', wed: 'WE', thu: 'TH', fri: 'FR', sat: 'SA', sun: 'SU' }
  let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WarRoom//LockIn//EN\r\nX-WR-CALNAME:War Room Schedule\r\n'
  for (const b of results as any[]) {
    const days = b.days.split(',').map((d: string) => dayMap[d.trim()]).filter(Boolean).join(',')
    const [sh, sm] = b.start_time.split(':'); const [eh, em] = b.end_time.split(':')
    ics += 'BEGIN:VEVENT\r\n'
    ics += `UID:warroom-block-${b.id}@lockin\r\n`
    ics += `DTSTART;TZID=Africa/Nairobi:20260101T${sh}${sm}00\r\n`
    ics += `DTEND;TZID=Africa/Nairobi:20260101T${eh}${em}00\r\n`
    ics += `RRULE:FREQ=WEEKLY;BYDAY=${days}\r\n`
    ics += `SUMMARY:${b.is_non_negotiable ? '🔒 ' : ''}${b.title.replace(/[,;]/g, ' ')}\r\n`
    ics += `DESCRIPTION:${(b.description || '').replace(/[,;\n]/g, ' ')}\r\n`
    ics += 'BEGIN:VALARM\r\nTRIGGER:-PT2M\r\nACTION:DISPLAY\r\nDESCRIPTION:War Room block starting\r\nEND:VALARM\r\n'
    ics += 'END:VEVENT\r\n'
  }
  ics += 'END:VCALENDAR\r\n'
  return new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="warroom.ics"' } })
})

// ============ HERMES — the autonomous counsel ============
async function hermesBriefing(DB: D1Database, date: string): Promise<string> {
  const y1 = addDays(date, -1)
  const blocks = await blocksForDate(DB, date)
  const adh = dayAdherence(blocks)
  const streak = await computeStreak(DB, date)
  const pts = await DB.prepare(`SELECT COALESCE(SUM(points),0) as t FROM points_ledger`).first<any>()
  const debriefs = (await DB.prepare(`SELECT * FROM debriefs ORDER BY log_date DESC LIMIT 7`).all()).results as any[]
  const flags = (await DB.prepare(`SELECT * FROM honesty_flags ORDER BY created_at DESC LIMIT 10`).all()).results as any[]
  const intel = (await DB.prepare(`SELECT * FROM intel_entries ORDER BY id DESC LIMIT 15`).all()).results as any[]
  const units = (await DB.prepare(
    `SELECT u.title, p.code, up.status, up.drill_report FROM units u
     JOIN phases p ON p.id=u.phase_id JOIN unit_progress up ON up.unit_id=u.id
     WHERE up.status NOT IN ('locked') ORDER BY p.sort_order, u.sort_order LIMIT 12`
  ).all()).results as any[]
  const lawBreaks = (await DB.prepare(
    `SELECT l.title, COUNT(*) n FROM law_checks lc JOIN laws l ON l.id=lc.law_id WHERE lc.kept=0 GROUP BY l.id ORDER BY n DESC LIMIT 3`
  ).all()).results as any[]

  return `=== COMMANDER'S FILE (auto-generated live from the War Room database) ===
DATE: ${date} | STREAK: ${streak} victory days | POINTS: ${pts?.t} | TODAY'S ADHERENCE SO FAR: ${adh.pct}% (${adh.done}/${adh.total})

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

const HERMES_SYSTEM = `You are HERMES — the Commander's private autonomous counsel inside his War Room discipline system. You have his COMPLETE file: every debrief, every honesty flag, every drill report, every real-world move he logs (family, friends, money, relationships, network, manipulation attempts, hustles).

Your doctrine:
1. MASTER READINGS ONLY. You are fluent in Sun Tzu, Machiavelli (The Prince AND the Discourses), the Stoics, Plato, Nietzsche, Greene, Musashi, Clausewitz. You teach strategic clarity — never paranoia, never manipulation. When he drifts toward the naive reading (scheming, paranoia, treating friends like enemies), correct him immediately and explain why detected manipulators lose long-term (never-be-hated constraint, reputation networks).
2. RUTHLESS HONESTY, ZERO SHAME. Call out his dumb moves by name using HIS OWN logged words as evidence. Praise real wins specifically. Never flatter — Machiavelli Ch.23: flatterers are a plague, and you are the truth-teller he authorized.
3. HE IS A SLOW, DEEP PROCESSOR. Never push speed. Push depth, sequence, and consistency. One principle applied beats ten memorized.
4. CITE THE CANON. When advising on his real situations (loyalty, women, money, classmates, neighbours, hustles), name the exact chapter/principle: e.g. "Sun Tzu Ch.3 — win without fighting", "The Prince Ch.17 — feared vs loved, but NEVER hated", "Epictetus — dichotomy of control".
5. PATTERN DETECTION. Cross-reference his file: if his debriefs show the same break 3x, if a person keeps appearing in bad-outcome intel, if his sleep collapses before his worst days — SAY IT. You see patterns he can't.
6. FORMAT: tight, soldier-to-commander. Short paragraphs. Bold the key move. End with ONE concrete order for today when relevant.
7. Ethics line: you advise defense, positioning, boundaries, leverage through competence — never fraud, revenge, or harming others. That is the master reading and you enforce it.`

app.post('/api/hermes', async (c) => {
  const DB = c.env.DB
  const { message, date } = await c.req.json()
  if (!message?.trim()) return c.json({ error: 'Say something, Commander.' }, 400)
  const today = date || (await userNow(c.env.DB)).date

  const briefing = await hermesBriefing(DB, today)
  const history = ((await DB.prepare(`SELECT role, content FROM hermes_messages ORDER BY id DESC LIMIT 12`).all()).results as any[]).reverse()

  await DB.prepare(`INSERT INTO hermes_messages (role, content, context_date) VALUES ('user', ?, ?)`).bind(message, today).run()

  const apiKey = c.env.OPENAI_API_KEY
  const baseURL = c.env.OPENAI_BASE_URL
  if (!apiKey) return c.json({ error: 'Hermes is offline: no LLM key configured. Inject your API key in the project settings.' }, 500)

  const resp = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-5-mini',
      messages: [
        { role: 'system', content: HERMES_SYSTEM },
        { role: 'system', content: briefing },
        ...history.map((h: any) => ({ role: h.role, content: h.content })),
        { role: 'user', content: message }
      ]
    })
  })
  if (!resp.ok) {
    const t = await resp.text()
    return c.json({ error: `Hermes uplink failed (${resp.status}): ${t.slice(0, 200)}` }, 500)
  }
  const data: any = await resp.json()
  const answer = data.choices?.[0]?.message?.content || '(no response)'
  await DB.prepare(`INSERT INTO hermes_messages (role, content, context_date) VALUES ('assistant', ?, ?)`).bind(answer, today).run()
  return c.json({ answer })
})

app.get('/api/hermes/history', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM hermes_messages ORDER BY id DESC LIMIT 40`).all()
  return c.json((results as any[]).reverse())
})

// Morning war council: Hermes proactively reviews the file and issues the day's orders
app.post('/api/hermes/council', async (c) => {
  const DB = c.env.DB
  const { date } = await c.req.json()
  const today = date || (await userNow(c.env.DB)).date
  const briefing = await hermesBriefing(DB, today)
  const apiKey = c.env.OPENAI_API_KEY
  if (!apiKey) return c.json({ error: 'Hermes offline: no LLM key.' }, 500)
  const resp = await fetch(`${c.env.OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-5-mini',
      messages: [
        { role: 'system', content: HERMES_SYSTEM },
        { role: 'system', content: briefing },
        { role: 'user', content: `Convene the war council for ${today}. Review my complete file above and deliver: 1) STATE OF THE COMMANDER — the single most important pattern you see in my recent data (good or bad, with evidence from my own logs). 2) THREAT ASSESSMENT — my biggest current vulnerability. 3) COMMENDATION — one real win to build on. 4) TODAY'S ORDERS — the one concrete move that matters most today. Keep it under 300 words, soldier-to-commander.` }
      ]
    })
  })
  if (!resp.ok) return c.json({ error: `Council failed (${resp.status})` }, 500)
  const data: any = await resp.json()
  const answer = data.choices?.[0]?.message?.content || '(silence)'
  await DB.prepare(`INSERT INTO hermes_messages (role, content, context_date) VALUES ('assistant', ?, ?)`).bind(`[MORNING WAR COUNCIL ${today}]\n${answer}`, today).run()
  return c.json({ answer })
})

// Hermes analysis of a specific intel entry
app.post('/api/intel/:id/analyze', async (c) => {
  const DB = c.env.DB
  const id = Number(c.req.param('id'))
  const entry = await DB.prepare(`SELECT * FROM intel_entries WHERE id=?`).bind(id).first<any>()
  if (!entry) return c.json({ error: 'No such entry' }, 404)
  const apiKey = c.env.OPENAI_API_KEY
  if (!apiKey) return c.json({ error: 'Hermes offline: no LLM key.' }, 500)
  const resp = await fetch(`${c.env.OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-5-mini',
      messages: [
        { role: 'system', content: HERMES_SYSTEM },
        { role: 'user', content: `Analyze this move I made. Domain: ${entry.domain}. Title: ${entry.title}. SITUATION: ${entry.situation || '—'}. MY MOVE: ${entry.my_move || '—'}. OUTCOME: ${entry.outcome || '—'}. People involved: ${entry.people || '—'}.\n\nGive me: 1) VERDICT (smart/dumb/mixed — brutal). 2) THE PRINCIPLE — which exact Sun Tzu/Machiavelli/Stoic principle applies, by name. 3) THE MASTER MOVE — what the ideal play was. 4) THE PATTERN WARNING — what to watch for next time. Max 200 words.` }
      ]
    })
  })
  if (!resp.ok) return c.json({ error: `Analysis failed (${resp.status})` }, 500)
  const data: any = await resp.json()
  const answer = data.choices?.[0]?.message?.content || '(no analysis)'
  await DB.prepare(`UPDATE intel_entries SET hermes_analysis=? WHERE id=?`).bind(answer, id).run()
  return c.json({ analysis: answer })
})

// ============ HERMES BRIDGE — external agent API (Termux/Telegram/CLI) ============
// Your local Hermes agent authenticates with X-Agent-Token and gets full read/write
// access to the war room: briefings, journaling, check-offs, intel filing.

function genToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let t = 'hermes_'
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  for (const b of buf) t += chars[b % chars.length]
  return t
}

async function getAgentToken(DB: D1Database): Promise<string | null> {
  const row = await DB.prepare(`SELECT value FROM settings WHERE key='agent_token'`).first<{ value: string }>()
  return row?.value ?? null
}

async function agentAuthed(c: any): Promise<boolean> {
  // HEADER ONLY — tokens in query strings leak into logs and referrers.
  const token = c.req.header('x-agent-token')
  if (!token) return false
  const stored = await getAgentToken(c.env.DB)
  return stored !== null && timingSafeEq(token, stored)
}

// Raw agent credentials are issued only by the explicit rotation POST below.
// This retired GET remains non-mutating so old clients fail without leaking a token.
app.get('/api/agent/token', async (c) => {
  return c.json({ error: 'Agent tokens are issued only by POST /api/agent/token/rotate.' }, 405, { Allow: 'POST' })
})
app.post('/api/agent/token/rotate', async (c) => {
  const t = genToken()
  await c.env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('agent_token', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(t).run()
  return c.json({ token: t })
})

// Full situational briefing for the agent (text + structured JSON)
app.get('/api/agent/briefing', async (c) => {
  if (!(await agentAuthed(c))) return c.json({ error: 'Invalid agent token' }, 401)
  const DB = c.env.DB
  const { date, time } = await userNow(DB) // server clock; reads never run engines
  const briefing = await hermesBriefing(DB, date)
  const blocks = await blocksForDate(DB, date)
  const current = blocks.find((b: any) => b.start_time <= time && time < b.end_time) || null
  const next = blocks.find((b: any) => b.start_time > time) || null
  const flags = (await DB.prepare(`SELECT * FROM honesty_flags WHERE acknowledged=0`).all()).results
  return c.json({ date, briefing, current, next, adherence: dayAdherence(blocks), flags, blocks })
})

// What needs attention RIGHT NOW (for the agent's watch loop → Telegram/termux-notification)
app.get('/api/agent/pending', async (c) => {
  if (!(await agentAuthed(c))) return c.json({ error: 'Invalid agent token' }, 401)
  const DB = c.env.DB
  const { date, time } = await userNow(DB) // server clock; reads never run engines
  const blocks = await blocksForDate(DB, date)
  const overdue = blocks.filter((b: any) => b.end_time <= time && !b.log_status)
  const current = blocks.find((b: any) => b.start_time <= time && time < b.end_time) || null
  const flags = (await DB.prepare(`SELECT * FROM honesty_flags WHERE acknowledged=0 ORDER BY created_at DESC`).all()).results
  const debriefToday = await DB.prepare(`SELECT id FROM debriefs WHERE log_date=?`).bind(date).first()
  const dueCards = await DB.prepare(`SELECT COUNT(*) n FROM flashcards WHERE due_date<=?`).bind(date).first<any>()
  return c.json({
    date, time,
    current_block: current ? { id: current.id, title: current.title, start: current.start_time, end: current.end_time, status: current.log_status } : null,
    overdue_unlogged: overdue.map((b: any) => ({ id: b.id, title: b.title, end: b.end_time, non_negotiable: !!b.is_non_negotiable })),
    unacknowledged_flags: flags,
    debrief_filed_today: !!debriefToday,
    flashcards_due: dueCards?.n ?? 0
  })
})

// Agent auto-journals anything it observes: intel, debrief updates, block check-offs
app.post('/api/agent/intel', async (c) => {
  if (!(await agentAuthed(c))) return c.json({ error: 'Invalid agent token' }, 401)
  const b = await c.req.json()
  if (!b.title || !b.domain) return c.json({ error: 'domain and title required' }, 400)
  const r = await c.env.DB.prepare(
    `INSERT INTO intel_entries (log_date, domain, title, situation, my_move, outcome, verdict, principle_used, lesson, people, hermes_analysis)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(b.log_date || (await userNow(c.env.DB)).date, b.domain, '[HERMES] ' + b.title, b.situation || null,
    b.my_move || null, b.outcome || null, b.verdict || 'pending', b.principle_used || null,
    b.lesson || null, b.people || null, b.analysis || null).run()
  return c.json({ ok: true, id: r.meta.last_row_id })
})

app.post('/api/agent/debrief', async (c) => {
  if (!(await agentAuthed(c))) return c.json({ error: 'Invalid agent token' }, 401)
  const b = await c.req.json()
  const date = b.date || (await userNow(c.env.DB)).date
  const prev = await c.env.DB.prepare(`SELECT * FROM debriefs WHERE log_date=?`).bind(date).first<any>()
  const merge = (a: string | null | undefined, x: string | null | undefined) =>
    x ? (a ? a + '\n[HERMES] ' + x : '[HERMES] ' + x) : (a ?? null)
  await c.env.DB.prepare(
    `INSERT INTO debriefs (log_date, wins, breaks, tomorrow_targets, strategy_insight, mood, energy, sleep_time, wake_time, sleep_hours)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(log_date) DO UPDATE SET wins=excluded.wins, breaks=excluded.breaks,
       tomorrow_targets=excluded.tomorrow_targets, strategy_insight=excluded.strategy_insight,
       mood=COALESCE(excluded.mood, mood), energy=COALESCE(excluded.energy, energy),
       sleep_time=COALESCE(excluded.sleep_time, sleep_time), wake_time=COALESCE(excluded.wake_time, wake_time),
       sleep_hours=COALESCE(excluded.sleep_hours, sleep_hours)`
  ).bind(date, merge(prev?.wins, b.wins), merge(prev?.breaks, b.breaks),
    merge(prev?.tomorrow_targets, b.tomorrow_targets), merge(prev?.strategy_insight, b.strategy_insight),
    b.mood ?? prev?.mood ?? null, b.energy ?? prev?.energy ?? null,
    b.sleep_time ?? prev?.sleep_time ?? null, b.wake_time ?? prev?.wake_time ?? null,
    b.sleep_hours ?? prev?.sleep_hours ?? null).run()
  return c.json({ ok: true })
})

app.post('/api/agent/block-log', async (c) => {
  if (!(await agentAuthed(c))) return c.json({ error: 'Invalid agent token' }, 401)
  const { block_id, date, status, note } = await c.req.json()
  await c.env.DB.prepare(
    `INSERT INTO block_logs (block_id, log_date, status, note, completed_at) VALUES (?,?,?,?,datetime('now'))
     ON CONFLICT(block_id, log_date) DO UPDATE SET status=excluded.status, note=excluded.note, completed_at=excluded.completed_at`
  ).bind(block_id, date || (await userNow(c.env.DB)).date, status, note ? '[HERMES] ' + note : null).run()
  return c.json({ ok: true })
})

// Agent posts its counsel into the app's Council log (visible in the COUNCIL tab)
app.post('/api/agent/message', async (c) => {
  if (!(await agentAuthed(c))) return c.json({ error: 'Invalid agent token' }, 401)
  const { content, role } = await c.req.json()
  if (!content) return c.json({ error: 'content required' }, 400)
  await c.env.DB.prepare(`INSERT INTO hermes_messages (role, content, context_date) VALUES (?,?,?)`)
    .bind(role === 'user' ? 'user' : 'assistant', '[LOCAL-HERMES] ' + content, (await userNow(c.env.DB)).date).run()
  return c.json({ ok: true })
})

// Everything endpoint: full DB export for the agent's memory sync
app.get('/api/agent/export', async (c) => {
  if (!(await agentAuthed(c))) return c.json({ error: 'Invalid agent token' }, 401)
  const DB = c.env.DB
  const out: Record<string, any> = {}
  for (const t of ['debriefs', 'intel_entries', 'honesty_flags', 'points_ledger', 'unit_progress', 'book_progress', 'law_checks', 'maxims'])
    out[t] = (await DB.prepare(`SELECT * FROM ${t}`).all()).results
  return c.json(out)
})

// ============ PWA MANIFEST + SERVICE WORKER ============
app.get('/manifest.json', (c) => c.json({
  name: 'War Room — Lock In', short_name: 'War Room', start_url: '/', display: 'standalone',
  background_color: '#0a0e14', theme_color: '#0a0e14',
  icons: [{ src: '/static/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
}))

app.get('/sw.js', (c) => {
  const sw = `
const CACHE='warroom-v1';
self.addEventListener('install',e=>{self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(clients.claim())});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.pathname.startsWith('/static/books/')){
    e.respondWith(caches.open(CACHE).then(async c=>{
      const hit=await c.match(e.request); if(hit) return hit;
      const r=await fetch(e.request); if(r.ok) c.put(e.request,r.clone()); return r;
    }));
  }
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window'}).then(cs=>{
    for(const c of cs){ if('focus' in c) return c.focus(); }
    return clients.openWindow('/');
  }));
});`
  return new Response(sw, { headers: { 'Content-Type': 'application/javascript' } })
})

// ============ SHELL ============
app.get('/', (c) => c.html(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="theme-color" content="#0a0e14">
<title>WAR ROOM — Lock In</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⚔️</text></svg>">
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/static/icon.svg">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Inter:wght@400;500;600;700&family=Cinzel:wght@500;600;700&display=swap" rel="stylesheet">
<link href="/static/style.css" rel="stylesheet">
<script>tailwind.config={theme:{extend:{fontFamily:{disp:['Rajdhani','sans-serif'],body:['Inter','sans-serif']},colors:{ink:'#0a0e14',panel:'#111826',line:'#1e2a3d',gold:'#d4af37',blood:'#dc2626',jade:'#22c55e'}}}}</script>
</head>
<body class="text-gray-200 font-body">
<div class="splash" id="splash">
  <div class="splash-sword">⚔</div>
  <div class="font-engraved gold-text text-2xl font-bold">WAR ROOM</div>
  <div class="splash-line"></div>
  <div class="text-[10px] tracking-[.35em] text-gray-500 font-semibold">DISCIPLINE · STRATEGY · HONESTY</div>
</div>
<canvas id="fx-canvas"></canvas>
<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<script src="/static/fx.js"></script>
<script src="/static/app.js"></script>
<script src="/static/app2.js"></script>
<script src="/static/app3.js"></script>
<script src="/static/app4.js"></script>
<script src="/static/app5.js"></script>
<script src="/static/app6.js"></script>
<script src="/static/app7.js"></script>
<script>if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js');}</script>
</body>
</html>`))

export default app
