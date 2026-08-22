// Book 9 — "Sixteen intel domains collapse to six."
//
// The old list asked him to pre-classify a situation sixteen ways before he could
// write it down, which is a filing decision standing between him and the record. Six
// is enough to find things later, which is the only thing the classification is for.
//
// NOTHING IS LOST. Every legacy value keeps working: historical captures are still
// readable, still filterable, and are grouped under the domain they now belong to.
// New captures use the six. The mapping is stated here once so a read and a write can
// never disagree about where an old row belongs.

export const DOMAINS = [
  'people',        // loyalty, family, friends, neighbours, classmates
  'network',       // network, community, society
  'intimacy',      // women_relationships
  'money',         // money, hustle
  'tactics',       // manipulation_spotted, clever_move, dumb_move, workaround
  'wisdom',        // wisdom, other
] as const
export type Domain = typeof DOMAINS[number]

/** Human labels, so the interface never has to invent one. */
export const DOMAIN_LABELS: Record<Domain, string> = {
  people: 'People',
  network: 'Network & society',
  intimacy: 'Intimacy',
  money: 'Money & hustle',
  tactics: 'Tactics seen',
  wisdom: 'Wisdom',
}

/** The sixteen (plus 'other') values the application wrote before this collapse. */
export const LEGACY_DOMAINS = [
  'loyalty', 'family', 'friends', 'network', 'community', 'neighbours',
  'classmates', 'women_relationships', 'money', 'hustle', 'society',
  'manipulation_spotted', 'clever_move', 'dumb_move', 'workaround',
  'wisdom', 'other',
] as const

const COLLAPSE: Record<string, Domain> = {
  // people
  loyalty: 'people', family: 'people', friends: 'people',
  neighbours: 'people', classmates: 'people',
  // network & society
  network: 'network', community: 'network', society: 'network',
  // intimacy
  women_relationships: 'intimacy',
  // money & hustle
  money: 'money', hustle: 'money',
  // tactics seen
  manipulation_spotted: 'tactics', clever_move: 'tactics',
  dumb_move: 'tactics', workaround: 'tactics',
  // wisdom
  wisdom: 'wisdom', other: 'wisdom',
}

/** Every accepted value: the six, plus every legacy value for historical rows. */
export const ACCEPTED_DOMAINS = [...DOMAINS, ...LEGACY_DOMAINS] as const

/**
 * Which of the six a stored value belongs to. A value already collapsed maps to
 * itself; an unrecognised one lands in 'wisdom' rather than disappearing from a
 * filter, because a capture must never become unfindable.
 */
export function collapseDomain(value?: string | null): Domain {
  if (!value) return 'wisdom'
  if ((DOMAINS as readonly string[]).includes(value)) return value as Domain
  return COLLAPSE[value] ?? 'wisdom'
}
