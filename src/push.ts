// Book 7 — alarms: Web Push transport (VAPID).
//
// DESIGN, stated plainly. The push message carries NO PAYLOAD. A payload-carrying
// Web Push must be encrypted to the browser's keys (RFC 8291: ECDH + HKDF +
// AES128GCM); a payload-less "tickle" needs only a signed VAPID JWT (RFC 8292),
// which WebCrypto does natively. So the push wakes the service worker, and the
// worker decides what to show — no journal text ever leaves the origin inside a
// push message, and there is no hand-rolled cryptography in the delivery path.
//
// FAIL CLOSED. Without VAPID_PUBLIC_KEY, VAPID_PRIVATE_JWK and VAPID_SUBJECT the
// module reports unconfigured and sends nothing, exactly like the model boundary.
// The operator owns those secrets; the repository never holds or logs them.
//
// PLATFORM LIMIT, honestly. A push wakes the service worker even when the tab is
// closed on Android Chrome and desktop; on iOS it works only for a PWA installed
// to the home screen (iOS 16.4+) and never for a site merely open in Safari. The
// calendar .ics export stays the fallback that rings without any of this.

export type PushSubscriptionRecord = {
  id: number
  endpoint: string
  p256dh: string
  auth: string
}

export type VapidConfig = { publicKey: string; privateJwk: string; subject: string }

export function vapidConfig(env: any): VapidConfig | null {
  const publicKey = String(env.VAPID_PUBLIC_KEY || '').trim()
  const privateJwk = String(env.VAPID_PRIVATE_JWK || '').trim()
  const subject = String(env.VAPID_SUBJECT || '').trim()
  if (!publicKey || !privateJwk || !subject) return null
  if (!/^mailto:|^https:/.test(subject)) return null
  return { publicKey, privateJwk, subject }
}

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlText(text: string): string {
  return b64url(new TextEncoder().encode(text))
}

/**
 * Sign a VAPID (RFC 8292) JWT for one push-service origin. `expSeconds` is capped
 * at the spec's 24h; 12h is the default so a leaked token dies quickly.
 */
export async function vapidJwt(
  audience: string,
  config: VapidConfig,
  nowMs: number,
  expSeconds = 12 * 3600,
): Promise<string> {
  const jwk = JSON.parse(config.privateJwk)
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: jwk.d, x: jwk.x, y: jwk.y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const header = b64urlText(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const payload = b64urlText(JSON.stringify({
    aud: audience,
    exp: Math.floor(nowMs / 1000) + Math.min(expSeconds, 24 * 3600),
    sub: config.subject,
  }))
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  )
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`
}

export type PushResult = { status: number; gone: boolean }

/**
 * Deliver one payload-less push. `gone` is true when the push service says the
 * subscription no longer exists (404/410) so the caller can prune it.
 */
export async function sendPush(
  subscription: PushSubscriptionRecord,
  config: VapidConfig,
  nowMs: number,
): Promise<PushResult> {
  let audience: string
  try {
    audience = new URL(subscription.endpoint).origin
  } catch (_) {
    return { status: 400, gone: true }   // an unusable endpoint is dead weight
  }
  const jwt = await vapidJwt(audience, config, nowMs)
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${config.publicKey}`,
      TTL: '600',
      Urgency: 'high',
      'Content-Length': '0',
    },
  })
  return { status: response.status, gone: response.status === 404 || response.status === 410 }
}

/** Local "HH:MM" inside a quiet window that may wrap past midnight. */
export function inQuietHours(time: string, start: string, end: string): boolean {
  if (start === end) return false
  return start < end ? (time >= start && time < end) : (time >= start || time < end)
}
