// Book 7 refactor — extracted adherence/scoring math.
// Book 8.1 (the ratchet): a day is scored on its MANDATORY set alone. Deck blocks are
// visible and loggable and still earn their points, but they never move adherence and
// never generate consequence. Until a mandatory set is named the prior rule stands.
import { consequenceBlocks } from './ratchet'
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
    wScore, wTotal, mvdHeld, mvdTotal: mvd.length, mvdDone,
  }
}
