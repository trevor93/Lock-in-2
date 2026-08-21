-- Book 7 — alarms: Web Push subscriptions + notification preferences.
--
-- Web Push (driven by a Cloudflare Cron Worker) becomes the primary alarm; the
-- calendar .ics export stays the fallback and the in-page tick becomes cosmetic.
-- This migration only adds tables and indexes; it alters and deletes nothing.
--
-- PRIVACY: a subscription is an opaque browser endpoint plus two public key
-- material blobs handed out by the browser's push service. They are not secrets the
-- application chose and they identify a device, not a person; they are stored per
-- owner and deleted when the browser reports the subscription gone (410/404).
-- Payloads are never stored, and no notification body is logged.
--
-- ROLLBACK (manual): DROP TABLE IF EXISTS push_deliveries; DROP TABLE IF EXISTS
-- push_subscriptions; DROP TABLE IF EXISTS notification_preferences;
-- The prior application never referenced them, so it runs unchanged; the calendar
-- .ics fallback keeps working because it never depended on push.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id),
  endpoint      TEXT NOT NULL UNIQUE,      -- the browser push service URL
  p256dh        TEXT NOT NULL,             -- client public key (base64url)
  auth          TEXT NOT NULL,             -- client auth secret (base64url)
  device_label  TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  last_success_at TEXT,
  last_failure_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_push_subs_owner ON push_subscriptions(user_id);

-- One row per owner. Quiet hours are inclusive-start/exclusive-end local times;
-- when start == end there are no quiet hours.
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id),
  blocks_enabled     INTEGER NOT NULL DEFAULT 1,   -- block-start alarms
  debrief_enabled    INTEGER NOT NULL DEFAULT 1,   -- the night debrief nudge
  review_enabled     INTEGER NOT NULL DEFAULT 1,   -- due drills / cards
  quiet_start        TEXT NOT NULL DEFAULT '23:00',
  quiet_end          TEXT NOT NULL DEFAULT '06:00',
  lead_minutes       INTEGER NOT NULL DEFAULT 2,   -- how early a block alarm fires
  updated_at         TEXT DEFAULT (datetime('now'))
);

-- Append-only delivery ledger. UNIQUE(user_id, kind, ref, occurs_on) is what makes
-- the Cron job idempotent: a re-run inside the same minute cannot double-notify,
-- exactly like the Book 5.7 consequence guards.
CREATE TABLE IF NOT EXISTS push_deliveries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id),
  kind       TEXT NOT NULL,               -- 'block' | 'debrief' | 'review'
  ref        TEXT NOT NULL,               -- block id, or a fixed tag for daily kinds
  occurs_on  TEXT NOT NULL,               -- the owner's civil date
  sent_at    TEXT DEFAULT (datetime('now')),
  ok_count   INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_delivery_identity
  ON push_deliveries(user_id, kind, ref, occurs_on);

CREATE TRIGGER IF NOT EXISTS trg_push_delivery_no_update
BEFORE UPDATE ON push_deliveries
WHEN OLD.ok_count IS NOT NULL AND NEW.sent_at <> OLD.sent_at
BEGIN
  SELECT RAISE(ABORT, 'PUSH_DELIVERY_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS trg_push_delivery_no_delete
BEFORE DELETE ON push_deliveries
BEGIN
  SELECT RAISE(ABORT, 'PUSH_DELIVERY_APPEND_ONLY');
END;
