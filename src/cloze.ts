// Book 10.2 — the cheap half of adversarial grading, done without a model call.
//
// "Generate cloze deletions from the source JSON for cheap immediate testing, add
// free-recall diffing, and have the model attack the answer rather than accept it."
//
// Cloze and diffing are deterministic, run locally, cost nothing and cannot flatter
// the learner. The model attack is the expensive half and lives behind the model
// boundary (src/ai.ts); this file is what makes the cheap half honest.

/** Words too common to be worth deleting or diffing on. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these',
  'those', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to', 'of', 'in', 'on',
  'at', 'by', 'for', 'with', 'from', 'as', 'it', 'its', 'he', 'his', 'him', 'they',
  'them', 'their', 'you', 'your', 'we', 'our', 'not', 'no', 'nor', 'so', 'such', 'may',
  'can', 'will', 'shall', 'would', 'could', 'should', 'do', 'does', 'did', 'have',
  'has', 'had', 'there', 'here', 'when', 'where', 'which', 'who', 'whom', 'what',
  'how', 'why', 'all', 'any', 'both', 'each', 'more', 'most', 'other', 'some', 'up',
  'out', 'off', 'over', 'under', 'again', 'once', 'also', 'into', 'about', 'said',
])

/** Normalised content words of a text, in order, without stopwords. */
export function contentWords(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    // keep letters (including accented and CJK) and digits; split on everything else
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
}

export type Cloze = {
  /** The passage with the deletions replaced by ____ . */
  prompt: string
  /** The deleted words, in the order they appear. */
  answers: string[]
}

/**
 * Deterministic cloze deletions from a passage. Deterministic matters: the same
 * passage must produce the same test every time, so a learner cannot reroll until the
 * deletions are easy. `every` selects which content words to delete.
 */
export function makeCloze(text: string, every = 7): Cloze {
  const answers: string[] = []
  let contentIndex = 0
  const prompt = String(text || '').replace(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu, (word) => {
    const bare = word.toLowerCase()
    if (bare.length <= 2 || STOPWORDS.has(bare)) return word
    contentIndex++
    if (contentIndex % every === 0) {
      answers.push(word)
      return '____'
    }
    return word
  })
  return { prompt, answers }
}

/** How many of the expected answers the learner produced, ignoring order and case. */
export function scoreCloze(answers: string[], given: string[]): { hits: number; total: number; ratio: number } {
  const wanted = answers.map((a) => a.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
  const pool = given.map((g) => String(g || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
  let hits = 0
  for (const w of wanted) {
    const at = pool.indexOf(w)
    if (at !== -1) { hits++; pool.splice(at, 1) }
  }
  const total = wanted.length
  return { hits, total, ratio: total ? hits / total : 0 }
}

export type RecallDiff = {
  /** Fraction of the passage's key terms the answer recovered. */
  hitRatio: number
  recovered: string[]
  missed: string[]
  /** Terms the answer added that are not in the passage — not wrong, but not recall. */
  invented: string[]
}

/**
 * Free-recall diffing: what the answer recovered from the passage, what it missed, and
 * what it invented. This is the honest half of grading a no-notes answer — it cannot
 * be argued with, and it names the gap rather than scoring the person.
 */
export function diffRecall(passage: string, answer: string, keyTermLimit = 25): RecallDiff {
  const passageTerms = contentWords(passage)
  // Frequency-ranked key terms keep the diff about the passage's substance.
  const counts = new Map<string, number>()
  for (const w of passageTerms) counts.set(w, (counts.get(w) ?? 0) + 1)
  const key = [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, keyTermLimit)
    .map(([w]) => w)

  const answerTerms = new Set(contentWords(answer))
  const recovered = key.filter((w) => answerTerms.has(w))
  const missed = key.filter((w) => !answerTerms.has(w))
  const passageSet = new Set(passageTerms)
  const invented = [...answerTerms].filter((w) => !passageSet.has(w))
  return {
    hitRatio: key.length ? recovered.length / key.length : 0,
    recovered, missed, invented,
  }
}
