// Book 7 refactor — extracted adherence/scoring math.
// Book 8.1 (the ratchet): a day is scored on its MANDATORY set alone. Deck blocks are
// visible and loggable and still earn their points, but they never move adherence and
// never generate consequence. Until a mandatory set is named the prior rule stands.
import { consequenceBlocks } from './ratchet'
import { hasLanded, isPartial, isExcusedFromScoring } from './block-status'
// Pure: it takes an array of block rows (each with weight, log_status, is_mvd)
// and returns the weighted adherence plus the Minimum Viable Day verdict. No DB,
// no request state — the single source of truth for how a day is scored.

export type Adherence = {
  pct: number
  done: number
  total: number
  wScore: number
  wTotal: number
  mvdHeld: boolean
  mvdTotal: number
  mvdDone: number
}

// Weighted adherence — CORE(3) / STANDARD(1) / CONTEXT(0). Score is
// Σ(weight × credit) / Σ(weight) over non-zero-weight blocks; a done block is
// full credit, a partial is half. Context (weight 0) blocks are visible but
// unscored. The Minimum Viable Day holds when every nominated CORE block landed.
export function dayAdherence(blocks: any[]): Adherence {
  const owed = consequenceBlocks(blocks as any[])
  const scored = owed.filter((b: any) => (b.weight ?? 1) > 0)
  if (!scored.length) return { pct: 100, done: 0, total: 0, wScore: 0, wTotal: 0, mvdHeld: false, mvdTotal: 0, mvdDone: 0 }
  let wScore = 0, wTotal = 0, done = 0
  for (const b of scored) {
      // Book 8.3/8.4: a block moved elsewhere, or displaced by a genuine higher
      // priority, is not owed on this day and carries no moral weight, so it
      // leaves the denominator rather than counting against him.
      if (isExcusedFromScoring(b.log_status)) continue
    const w = b.weight ?? 1
    wTotal += w
    if (hasLanded(b.log_status)) { wScore += w; done += 1 }
    else if (isPartial(b.log_status)) { wScore += w * 0.5; done += 0.5 }
  }
  // MINIMUM VIABLE DAY: nominated CORE blocks — all hit ⇒ HELD THE LINE
  const mvd = blocks.filter((b: any) => b.is_mvd)
  const mvdDone = mvd.filter((b: any) => hasLanded(b.log_status) || isPartial(b.log_status)).length
  const mvdHeld = mvd.length > 0 && mvdDone === mvd.length
  return {
    pct: Math.round((wScore / wTotal) * 100), done, total: scored.length,
    wScore, wTotal, mvdHeld, mvdTotal: mvd.length, mvdDone,
  }
}
