// Book 10.6 / 10.9 / 10.10 — the principle model.
//
// Three rules from Book 10 live here as code rather than as prose, because prose does
// not enforce anything:
//
//   10.6 將 is scored on the LOWEST of its five virtues, "because removing one turns
//        the others into vices" — an average would hide exactly the thing the text
//        warns about.
//   10.6 "Any framing that redirects 將 outward into an inventory of other people's
//        emotional fault lines is a corruption of the text and is struck."
//   10.9 When the operator recites a line, the application returns BOTH columns and
//        the cost of staying naive — never the master reading alone.

export type ConceptComponentScore = { title: string; score: number }

/**
 * 10.6: the commander's level is the lowest of the five virtues, not their mean.
 * Returns the score and which virtue is carrying it, because the weakest one is the
 * only actionable fact.
 */
export function lowestOfComponents(
  components: ConceptComponentScore[],
): { score: number | null; weakest: string | null; mean: number | null } {
  const scored = components.filter((c) => typeof c.score === 'number')
  if (!scored.length) return { score: null, weakest: null, mean: null }
  let weakest = scored[0]
  for (const c of scored) if (c.score < weakest.score) weakest = c
  const mean = scored.reduce((a, c) => a + c.score, 0) / scored.length
  return { score: weakest.score, weakest: weakest.title, mean: Number(mean.toFixed(2)) }
}

/**
 * 10.6's struck framing. A 將 lesson that turns the commander outward — into reading
 * other people's insecurities, triggers or fault lines — is a corruption of the text.
 * This is a guard, not a filter on the operator's own words: it checks curriculum and
 * model-authored framings before they are shown as teaching.
 */
const OUTWARD_FRAMINGS = [
  /their\s+(emotional\s+)?(fault\s*lines?|weak\s*points?|insecurit)/i,
  /other\s+people'?s?\s+(emotional\s+)?(fault\s*lines?|insecurit|triggers?|weaknesses)/i,
  /(map|inventory|catalogue|profile)\s+(of\s+)?(their|his|her|others?'?)\s+(insecurit|weakness|trigger|fault)/i,
  /exploit\s+(their|his|her|others?'?)\s+(insecurit|weakness|fear|trigger)/i,
]

export function jiangFramingIsStruck(text: string): boolean {
  const t = String(text || '')
  return OUTWARD_FRAMINGS.some((re) => re.test(t))
}

export const JIANG_STRUCK_REASON =
  '將 is the commander, and the commander is himself. A framing that redirects it outward ' +
  'into an inventory of other people’s emotional fault lines is a corruption of the text ' +
  'and is struck (Book 10.6). Audit yourself on the five virtues first.'

export type ImmuneRow = {
  slug: string
  title: string
  naive_reading: string
  master_reading: string
  detection_tells: string
  inversion_trap: string
  less_obvious_application: string
  stop_test: string
  cost_of_naive: string
}

/**
 * 10.9: "When the operator recites a line, the application returns both columns and the
 * cost of staying naive." Shaping it here means no caller can accidentally return the
 * master reading on its own, which is the failure mode the immune table exists to
 * prevent.
 */
export function bothColumns(row: ImmuneRow): {
  title: string
  naive: string
  master: string
  costOfNaive: string
  detectionTells: string
  inversionTrap: string
  lessObviousApplication: string
  stopTest: string
} {
  return {
    title: row.title,
    naive: row.naive_reading,
    master: row.master_reading,
    costOfNaive: row.cost_of_naive,
    detectionTells: row.detection_tells,
    inversionTrap: row.inversion_trap,
    lessObviousApplication: row.less_obvious_application,
    stopTest: row.stop_test,
  }
}

/**
 * 10.10: a contradiction is only useful if it forces the real question. Every
 * contradiction edge is rendered with it.
 */
export const CONTRADICTION_QUESTION =
  'What conditions select this principle rather than its reversal?'
