// Book 7 refactor — alarms: Web Push subscription, preferences, and the internal
// Cron entry point that actually delivers block/debrief/review alarms.
//
// Owner-session routes register and drop this browser's subscription and read/write
// notification preferences. The internal job is called by the operator's Cron Worker
// with the shared secret (Cloudflare Pages has no native scheduled handler), exactly
// like /internal/jobs/enforcement. Delivery is idempotent: one row per
// (owner, kind, ref, day) in the append-only push_deliveries ledger, so a re-run in
// the same minute cannot double-notify.
import { Hono } from 'hono'
import type { Bindings, Variables } from '../env'
import { parseJson, parseEmptyBody } from '../validation'
import { timingSafeEq } from '../crypto'
import { userNow } from '../clock'
import { addDays, dowOf } from '../time'
import {
  pushSubscriptionBodySchema, pushUnsubscribeBodySchema, notificationPreferencesBodySchema,
} from '../schemas'
import { vapidConfig, sendPush, inQuietHours, type PushSubscriptionRecord } from '../push'
import { openJobRun, closeJobRun } from '../request-support'

const DEFAULT_PREFS = {
  blocks_enabled: 1, debrief_enabled: 1, review_enabled: 1,
  quiet_start: '23:00', quiet_end: '06:00', lead_minutes: 2,
}

async function preferencesFor(DB: D1Database, userId: number): Promise<any> {
  const row = await DB.prepare(
    `SELECT blocks_enabled, debrief_enabled, review_enabled, quiet_start, quiet_end, lead_minutes
     FROM notification_preferences WHERE user_id=?`,
  ).bind(userId).first<any>()
  return row || { ...DEFAULT_PREFS }
}

export function registerPushRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {

// The VAPID public key is public by design (the browser needs it to subscribe); it
// is still served only to an authenticated owner, and 503 when unconfigured so the
// client can fall back to the calendar export instead of failing silently.
app.get('/api/push/key', (c) => {
  const config = vapidConfig(c.env)
  if (!config) return c.json({ error: 'PUSH SERVICE OFFLINE' }, 503)
  return c.json({ publicKey: config.publicKey })
})

// What the service worker shows when a payload-less push wakes it. READ-ONLY
// (Book 5.3): it derives the line from state the engines already wrote and writes
// nothing. Titles are short and non-shaming, per Book 4.
app.get('/api/next-alarm', async (c) => {
  const DB = c.env.DB
  const userId = c.get('userId')
  const { date, time } = await userNow(DB, userId)
  const next = await DB.prepare(
    `SELECT b.title, b.start_time FROM schedule_blocks b
     WHERE b.user_id=? AND b.days LIKE '%' || ? || '%' AND b.start_time >= ?
       AND NOT EXISTS (
         SELECT 1 FROM block_logs l
         WHERE l.block_id=b.id AND l.user_id=b.user_id AND l.log_date=?
       )
     ORDER BY b.start_time LIMIT 1`,
  ).bind(userId, dowOf(date), time, date).first<{ title: string; start_time: string }>()
  if (next) {
    return c.json({ title: `${next.start_time} · ${next.title}`, body: 'Your block is starting. Open the war room.' })
  }
  const debriefDone = await DB.prepare(
    `SELECT 1 AS x FROM debriefs WHERE user_id=? AND log_date=?`,
  ).bind(userId, date).first<{ x: number }>()
  if (!debriefDone && time >= '20:00') {
    return c.json({ title: 'THE NIGHT DEBRIEF', body: 'Close the day honestly — it takes two minutes.' })
  }
  const due = await DB.prepare(
    `SELECT COUNT(*) AS n FROM review_items WHERE user_id=? AND kind='response' AND due_date <= ?`,
  ).bind(userId, date).first<{ n: number }>()
  if ((due?.n ?? 0) > 0) {
    return c.json({ title: 'DRILLS ARE DUE', body: `${due!.n} line(s) waiting. A few minutes keeps them.` })
  }
  return c.json({ title: 'WAR ROOM', body: 'Open the war room.' })
})

app.post('/api/push/subscribe', async (c) => {
  const userId = c.get('userId')
  const b = await parseJson(c, pushSubscriptionBodySchema)
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
     VALUES (?,?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth,
       device_label=excluded.device_label, failure_count=0`,
  ).bind(userId, b.endpoint, b.p256dh, b.auth, b.device_label || null).run()
  return c.json({ ok: true })
})

app.post('/api/push/unsubscribe', async (c) => {
  const b = await parseJson(c, pushUnsubscribeBodySchema)
  await c.env.DB.prepare(
    `DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?`,
  ).bind(b.endpoint, c.get('userId')).run()
  return c.json({ ok: true })
})

app.get('/api/notification-preferences', async (c) => {
  const prefs = await preferencesFor(c.env.DB, c.get('userId'))
  const devices = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id=?`,
  ).bind(c.get('userId')).first<{ n: number }>()
  return c.json({
    ...prefs,
    devices: devices?.n ?? 0,
    pushConfigured: !!vapidConfig(c.env),
  })
})

app.post('/api/notification-preferences', async (c) => {
  const userId = c.get('userId')
  const b = await parseJson(c, notificationPreferencesBodySchema)
  const current = await preferencesFor(c.env.DB, userId)
  const merged: any = { ...current, ...b }
  await c.env.DB.prepare(
    `INSERT INTO notification_preferences
       (user_id, blocks_enabled, debrief_enabled, review_enabled, quiet_start, quiet_end, lead_minutes, updated_at)
     VALUES (?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       blocks_enabled=excluded.blocks_enabled, debrief_enabled=excluded.debrief_enabled,
       review_enabled=excluded.review_enabled, quiet_start=excluded.quiet_start,
       quiet_end=excluded.quiet_end, lead_minutes=excluded.lead_minutes,
       updated_at=datetime('now')`,
  ).bind(userId,
    merged.blocks_enabled ? 1 : 0, merged.debrief_enabled ? 1 : 0, merged.review_enabled ? 1 : 0,
    merged.quiet_start, merged.quiet_end, merged.lead_minutes).run()
  return c.json({ ok: true })
})

// ---- the Cron entry point -------------------------------------------------
// Called every minute by the operator's Cron Worker. Server-derived clock only; no
// client can influence what fires or when.
app.post('/internal/jobs/alarms', async (c) => {
  const expected = c.env.ENFORCEMENT_JOB_SECRET
  const authorization = c.req.header('authorization') || ''
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!expected || !supplied || !timingSafeEq(supplied, expected)) {
    return c.json({ error: 'INVALID INTERNAL CREDENTIAL' }, 401)
  }
  await parseEmptyBody(c)

  // Book 7 job_runs: the record is opened BEFORE the config check, so an operator
  // reading the table can tell "the Cron never called" from "the Cron called and the
  // push service was not configured". Those need different fixes.
  const runId = await openJobRun(c.env.DB, 'alarms', 'cron')

  const config = vapidConfig(c.env)
  if (!config) {
    await closeJobRun(c.env.DB, runId, { status: 'error', errorClass: 'PushServiceOffline' })
    return c.json({ error: 'PUSH SERVICE OFFLINE' }, 503)
  }

  const DB = c.env.DB
  const owners = (await DB.prepare(
    `SELECT id FROM users WHERE role='owner' ORDER BY id`,
  ).all()).results as Array<{ id: number }>

  const summary: Array<{ user_id: number; sent: number; skipped: number }> = []
  for (const owner of owners) {
    const { date, time } = await userNow(DB, owner.id)
    const prefs = await preferencesFor(DB, owner.id)
    let sent = 0
    let skipped = 0
    if (inQuietHours(time, prefs.quiet_start, prefs.quiet_end)) {
      summary.push({ user_id: owner.id, sent: 0, skipped: 1 })
      continue
    }

    const due: Array<{ kind: string; ref: string }> = []
    if (prefs.blocks_enabled) {
      // A block whose start falls inside the lead window and is not yet logged today.
      const lead = Number(prefs.lead_minutes) || 0
      const blocks = (await DB.prepare(
        `SELECT b.id, b.start_time FROM schedule_blocks b
         WHERE b.user_id=? AND b.days LIKE '%' || ? || '%'
           AND NOT EXISTS (
             SELECT 1 FROM block_logs l
             WHERE l.block_id=b.id AND l.user_id=b.user_id AND l.log_date=?
           )`,
      ).bind(owner.id, dowOf(date), date).all()).results as Array<{ id: number; start_time: string }>
      const [nowH, nowM] = time.split(':').map(Number)
      for (const block of blocks) {
        const [h, m] = block.start_time.split(':').map(Number)
        const minutesUntil = (h * 60 + m) - (nowH * 60 + nowM)
        if (minutesUntil >= 0 && minutesUntil <= lead) {
          due.push({ kind: 'block', ref: String(block.id) })
        }
      }
    }
    if (prefs.debrief_enabled && time >= '20:00') {
      const done = await DB.prepare(
        `SELECT 1 AS x FROM debriefs WHERE user_id=? AND log_date=?`,
      ).bind(owner.id, date).first<{ x: number }>()
      if (!done) due.push({ kind: 'debrief', ref: 'night' })
    }
    if (prefs.review_enabled && time >= '18:00') {
      const overdue = await DB.prepare(
        `SELECT COUNT(*) AS n FROM review_items
         WHERE user_id=? AND kind='response' AND due_date <= ?`,
      ).bind(owner.id, addDays(date, -1)).first<{ n: number }>()
      if ((overdue?.n ?? 0) > 0) due.push({ kind: 'review', ref: 'overdue' })
    }

    const subs = (await DB.prepare(
      `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=?`,
    ).bind(owner.id).all()).results as unknown as PushSubscriptionRecord[]

    for (const item of due) {
      // The idempotency arbiter: only the first insert for this (kind, ref, day) sends.
      const claim = await DB.prepare(
        `INSERT OR IGNORE INTO push_deliveries (user_id, kind, ref, occurs_on)
         VALUES (?,?,?,?)`,
      ).bind(owner.id, item.kind, item.ref, date).run()
      if (Number((claim.meta as any).changes) !== 1) { skipped++; continue }
      for (const sub of subs) {
        // A push service that is unreachable (DNS, TLS, timeout) must not abort the
        // whole run: record the failure and carry on to the next device.
        let result
        try {
          result = await sendPush(sub, config, Date.now())
        } catch (_) {
          result = { status: 0, gone: false }
        }
        if (result.gone) {
          await DB.prepare(`DELETE FROM push_subscriptions WHERE id=?`).bind(sub.id).run()
        } else if (result.status >= 200 && result.status < 300) {
          sent++
          await DB.prepare(
            `UPDATE push_subscriptions SET last_success_at=datetime('now'), failure_count=0 WHERE id=?`,
          ).bind(sub.id).run()
        } else {
          await DB.prepare(
            `UPDATE push_subscriptions SET last_failure_at=datetime('now'), failure_count=failure_count+1 WHERE id=?`,
          ).bind(sub.id).run()
        }
      }
    }
    summary.push({ user_id: owner.id, sent, skipped })
  }
  await closeJobRun(DB, runId, {
    status: 'ok',
    ownersWalked: owners.length,
    counts: {
      owners: owners.length,
      sent: summary.reduce((total, row) => total + row.sent, 0),
      skipped: summary.reduce((total, row) => total + row.skipped, 0),
    },
  })
  return c.json({ ok: true, summary })
})
}
