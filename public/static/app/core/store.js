// Book 7 frontend restructure — the shared store. Every mutable value that used
// to be a top-level global shared across app.js..app7.js now lives here as a
// property of the single exported object `S`, so ES modules can read and mutate
// shared state without any of it becoming a window.* global. Modules do `S.TAB = x`
// / `if (S.STATE)` instead of the old bare `TAB` / `STATE`.
export const S = {
  // navigation + session. Book 9 collapses nine tabs to five; SUB remembers
  // which face of a tab is showing, so nothing that used to be a tab is lost.
  TAB: 'today',
  SUB: {
    today: 'now',        // now | schedule
    learn: 'campaign',   // campaign | books
    practice: 'cards',   // cards | maxims | response  (Book 12.7: the Tongue is the Response Lab)
    review: 'debrief',   // debrief | stats
    more: 'council',     // council | intel | settings
  },
  STATE: null,
  CSRF_TOKEN: null,
  TZ_SENT: false,
  // freshness watcher
  LAST_VERSION: null,
  VERSION_IN_FLIGHT: false,
  BOUNDARY_TIMER: null,
  // laws
  LAWS_CACHE: null,
  // lazily-loaded per-tab caches
  CAMPAIGN: null,
  MAXIMS: null,
  DUE: null,
  STATS: null,
  DEBRIEFS: null,
  REWARDS: null,
  PREDICTIONS: null,
  CALIBRATION: null,
  LIBRARY: null,
  INTEL: null,
  HERMES_HIST: null,
  // mind / cards view state
  OPEN_UNIT: null,
  CARD_IDX: 0,
  CARD_FLIP: false,
  MIND_MODE: 'cards',
  // library reader
  BOOK: null,
  BOOK_ID: null,
  CHAP_IDX: 0,
  // council / bridge
  COUNCIL_MODE: 'hermes',
  INTEL_OPEN: false,
  BRIDGE_CREDENTIAL: null,
  BRIDGE_CREDENTIALS: [],
  // Response Lab working state. Book 12.7 renames the Tongue to the Response Lab and
  // rebuilds it around architectures; RL.intents holds the eleven the server serves,
  // so the interface never paraphrases the book's own logic.
  RL: {
    view: 'today', list: null, due: null, stats: null, drill: null, drillIdx: 0,
    drillReveal: false, drillSession: { done: 0, fluent: 0 }, exam: null,
    examIdx: 0, examReveal: false, examCorrect: 0, filter: 'all', search: '',
    // 12.7 build state: the eleven intents from the server, the intent being built,
    // and the four layers. A build with a missing layer is refused by the route.
    intents: null, intentSlug: null, build: null, builds: null,
  },
  // Book 11 — the Farnsworth programme's track state. TRACK is /api/rhetoric/track;
  // CHAPTER is one chapter in the thirteen-slot format; METRICS carries each metric's
  // own direction so no renderer can lose an inverted one.
  RH: {
    view: 'track', track: null, today: null, chapter: null, chapterId: null, metrics: null,
  },
}
