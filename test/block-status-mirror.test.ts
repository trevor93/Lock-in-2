import { describe, expect, it } from 'vitest'
import serverSrc from '../src/block-status.ts?raw'
import clientSrc from '../public/static/app/core/block-status.js?raw'
import {
  LANDED_STATUSES, PARTIAL_STATUSES, BLOCK_STATUSES,
  hasLanded, isPartial, isHonestlyCanceled, isExcusedFromScoring,
} from '../src/block-status'

// Book 8.3 has ONE taxonomy, and it now exists in two languages: src/block-status.ts
// decides what a status pays, public/static/app/core/block-status.js decides what the
// interface writes and how it draws what came back. Two copies of a list is exactly
// the failure this audit keeps finding — the SQL literals that kept saying
// 'done','partial' after the predicates had moved on, and before them the hand-listed
// migrations that produced the job_runs blocker.
//
// So the mirror is not trusted. This reads both files and asserts each set matches,
// which means adding a status on one side and forgetting the other fails here instead
// of shipping an interface that cannot write a state the API accepts.

/** Pull a quoted string array out of a source file by its declaration name. */
function setFrom(src: string, decl: RegExp): string[] {
  const m = src.match(decl)
  if (!m) throw new Error(`declaration not found: ${decl}`)
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()
}

const server = {
  landed: setFrom(serverSrc, /const LANDED = new Set\(\[([^\]]*)\]\)/),
  partial: setFrom(serverSrc, /const PARTIAL_STATUSES: readonly string\[\] = \[([^\]]*)\]/),
  canceled: setFrom(serverSrc, /const HONESTLY_CANCELED = new Set\(\[([^\]]*)\]\)/),
  excluded: setFrom(serverSrc, /const EXCLUDED = new Set\(\[([^\]]*)\]\)/),
}
const client = {
  landed: setFrom(clientSrc, /export const LANDED = \[([^\]]*)\]/),
  partial: setFrom(clientSrc, /export const PARTIAL = \[([^\]]*)\]/),
  canceled: setFrom(clientSrc, /export const HONESTLY_CANCELED = \[([^\]]*)\]/),
  excluded: setFrom(clientSrc, /export const EXCLUDED = \[([^\]]*)\]/),
}

describe('B8.3 the client taxonomy mirrors the server taxonomy', () => {
  it('reads a non-empty set from each side, so a broken match fails loudly', () => {
    // Without this floor a regex that stopped matching would report two empty sets
    // as equal, and the guard would pass while guarding nothing.
    for (const [name, set] of Object.entries(server)) {
      expect(set.length, `server ${name} came back empty`).toBeGreaterThan(0)
    }
    for (const [name, set] of Object.entries(client)) {
      expect(set.length, `client ${name} came back empty`).toBeGreaterThan(0)
    }
  })

  it('agrees on which statuses mean the work landed', () => {
    expect(client.landed).toEqual(server.landed)
    // and the exported list the SQL call sites derive from is the same set again
    expect([...LANDED_STATUSES].sort()).toEqual(server.landed)
  })

  it('agrees on partial, honest cancellation, and the excused statuses', () => {
    expect(client.partial).toEqual(server.partial)
    expect([...PARTIAL_STATUSES].sort()).toEqual(server.partial)
    expect(client.canceled).toEqual(server.canceled)
    expect(client.excluded).toEqual(server.excluded)
  })

  it('the predicates agree with the sets they are built from', () => {
    for (const st of server.landed) expect(hasLanded(st), st).toBe(true)
    for (const st of server.partial) expect(isPartial(st), st).toBe(true)
    for (const st of server.canceled) expect(isHonestlyCanceled(st), st).toBe(true)
    for (const st of server.excluded) expect(isExcusedFromScoring(st), st).toBe(true)
  })

  it('every status either side names is a status the API accepts', () => {
    // A button that writes a spelling blockStatusSchema rejects is a 400 the
    // commander can reach by tapping, so the client's own values are checked too.
    const accepted = new Set<string>(BLOCK_STATUSES as readonly string[])
    for (const set of Object.values(client)) {
      for (const st of set) expect(accepted.has(st), `${st} is not in BLOCK_STATUSES`).toBe(true)
    }
  })

  it('the three shipped buttons write doctrinal spellings, not the legacy synonyms', () => {
    const values = [...clientSrc.matchAll(/\{ value: '([a-z_]+)'/g)].map((m) => m[1])
    expect(values, 'STATUS_BUTTONS did not parse').toHaveLength(3)
    expect(values).toEqual(['completed', 'partial', 'intentionally_canceled'])
    for (const v of values) expect((BLOCK_STATUSES as readonly string[]).includes(v), v).toBe(true)
  })
})
