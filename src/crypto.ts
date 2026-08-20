// Book 7 refactor — cryptographic primitives.
// Pure Web Crypto helpers: hex encoding, random tokens, SHA-256 (used to hash
// opaque session/agent tokens at rest), a derived CSRF token, PBKDF2 password
// hashing (100k iterations), and a constant-time string compare. No DB, no
// request state.
const enc = new TextEncoder()

export function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}
export function randHex(n = 32): string {
  const a = new Uint8Array(n); crypto.getRandomValues(a)
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('')
}
export async function sha256(value: string): Promise<string> {
  return bufToHex(await crypto.subtle.digest('SHA-256', enc.encode(value)))
}
export async function csrfToken(rawSessionToken: string): Promise<string> {
  return sha256(`csrf:${rawSessionToken}`)
}
export async function pbkdf2(password: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256)
  return bufToHex(bits)
}
export function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}
