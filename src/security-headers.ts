// Book 7 refactor — extracted security-headers module.
// Self-contained: no DB, no request state beyond the Hono context's header sink.
// The Content-Security-Policy is the single source of truth for the app's
// allowed origins; every private response also carries the hardening headers.

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
].join('; ')

export function setSecurityHeaders(c: any): void {
  c.header('Content-Security-Policy', CONTENT_SECURITY_POLICY)
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
}
