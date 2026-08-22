-- Book 10.6 / 10.7 / 10.8 / 10.9 / 10.10 — the concept model, the framing rules, the
-- naive-versus-master immune table, and the cross-book principle graph.
--
-- 10.9 is explicit that the immune table is "a schema requirement, not a document", so
-- every principle row carries its six columns and the application can always return
-- both columns plus the cost of staying naive.
--
-- 10.10 is explicit that the graph is "a cross-book graph, not a per-author shelf",
-- with contradiction edges, "so the interface can show where authors disagree and force
-- the real question: what conditions select this principle rather than its reversal?"
--
-- Additive: new tables and seed rows only. Nothing existing is altered or deleted.
--
-- ROLLBACK (manual): DROP TABLE IF EXISTS graph_edges; DROP TABLE IF EXISTS graph_nodes;
-- DROP TABLE IF EXISTS hypotheses; DROP TABLE IF EXISTS principle_frames;
-- DROP TABLE IF EXISTS principles; DROP TABLE IF EXISTS concept_components;
-- DROP TABLE IF EXISTS concepts; The prior application never referenced them.

-- ---------------------------------------------------------------------------
-- 10.6 CONCEPTS. "Each concept stores original term, translation range, historical
-- meaning, modern interpretation, misuse, defensive lesson, and reversal condition."
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS concepts (
  slug                 TEXT PRIMARY KEY,
  source_id            TEXT,
  anchor               TEXT,          -- the passage it is taught from
  title                TEXT NOT NULL,
  original_term        TEXT,
  translation_range    TEXT NOT NULL, -- taught with RANGE, never a slogan
  historical_meaning   TEXT NOT NULL,
  modern_interpretation TEXT NOT NULL,
  misuse               TEXT NOT NULL, -- the common distortion, named
  defensive_lesson     TEXT NOT NULL,
  reversal_condition   TEXT NOT NULL,
  -- 10.6: some concepts are scored on their weakest component, not their average.
  score_rule           TEXT,
  created_at           TEXT DEFAULT (datetime('now'))
);

-- The parts of a compound concept (the Five Factors' sub-parts, 將's five virtues).
CREATE TABLE IF NOT EXISTS concept_components (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  concept_slug TEXT NOT NULL REFERENCES concepts(slug),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  original_term TEXT,
  title        TEXT NOT NULL,
  meaning      TEXT NOT NULL,
  misuse       TEXT
);
CREATE INDEX IF NOT EXISTS idx_concept_components ON concept_components(concept_slug, sort_order);

-- ---------------------------------------------------------------------------
-- 10.9 THE IMMUNE TABLE. Six columns per principle, plus the cost of staying naive,
-- so reciting a line always returns both readings.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS principles (
  slug                     TEXT PRIMARY KEY,
  title                    TEXT NOT NULL,
  source_id                TEXT,
  anchor                   TEXT,      -- the passage, at paragraph level
  naive_reading            TEXT NOT NULL,
  master_reading           TEXT NOT NULL,
  detection_tells          TEXT NOT NULL,
  inversion_trap           TEXT NOT NULL,
  less_obvious_application TEXT NOT NULL,
  stop_test                TEXT NOT NULL,
  cost_of_naive            TEXT NOT NULL,
  created_at               TEXT DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 10.7 MACHIAVELLI FRAMING. "For every principle: the ruler-and-state context, the
-- civilian analogy, where the analogy breaks, the long-term cost, and the legal and
-- ethical boundary." Held separately so the framing can be REQUIRED for that source.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS principle_frames (
  principle_slug         TEXT PRIMARY KEY REFERENCES principles(slug),
  ruler_state_context    TEXT NOT NULL,
  civilian_analogy       TEXT NOT NULL,
  analogy_breaks_where   TEXT NOT NULL,
  long_term_cost         TEXT NOT NULL,
  legal_ethical_boundary TEXT NOT NULL,
  -- 10.7: "Do not universalise the political into romance, friendship, or family."
  do_not_universalise    INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- 10.8 GREENE AS HYPOTHESES. Flagged UNREAD, usable only as a defensive recognition
-- aid, and not examinable until Book 1 changes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hypotheses (
  slug                 TEXT PRIMARY KEY,
  source_id            TEXT,
  claim                TEXT NOT NULL,
  mechanism            TEXT NOT NULL,
  assumptions          TEXT NOT NULL,
  possible_application TEXT NOT NULL,
  reversal             TEXT NOT NULL,
  failure_condition    TEXT NOT NULL,
  defensive_signs      TEXT NOT NULL,
  proportional_defence TEXT NOT NULL,
  evidence_quality     TEXT NOT NULL,
  long_term_consequence TEXT NOT NULL,
  read_status          TEXT NOT NULL DEFAULT 'UNREAD'
    CHECK (read_status IN ('UNREAD','READ')),
  -- Hermes may not examine on it, and no syllabus phase may be built around it.
  examinable           INTEGER NOT NULL DEFAULT 0 CHECK (examinable = 0),
  defensive_only       INTEGER NOT NULL DEFAULT 1 CHECK (defensive_only = 1),
  created_at           TEXT DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 10.10 THE PRINCIPLE GRAPH. Nodes are cross-book ideas, not authors. Ethos, logos and
-- pathos each carry a strong-use and a corrupt-use column.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS graph_nodes (
  slug        TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  strong_use  TEXT,
  corrupt_use TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Edges connect anything to anything, including the contradiction edges that make
-- disagreement visible.
CREATE TABLE IF NOT EXISTS graph_edges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  from_type  TEXT NOT NULL,   -- 'node' | 'principle' | 'concept' | 'hypothesis' | 'section' | 'figure' | 'drill' | 'decision' | 'outcome'
  from_id    TEXT NOT NULL,
  to_type    TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  kind       TEXT NOT NULL
    CHECK (kind IN ('anchors','supports','related','reversal','contradicts','applies_in','detects')),
  note       TEXT,            -- for a contradiction: what selects one over the other
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON graph_edges(from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_to ON graph_edges(to_type, to_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_kind ON graph_edges(kind);

-- ===========================================================================
-- SEEDS. Every row below is transcribed from Book 10 itself, which states this
-- content explicitly; nothing here is invented.
-- ===========================================================================

-- 10.10 the named nodes.
INSERT OR IGNORE INTO graph_nodes (slug, title) VALUES
  ('preparation','Preparation'), ('legitimacy','Legitimacy'), ('alignment','Alignment'),
  ('timing','Timing'), ('terrain','Terrain'), ('logistics','Logistics'),
  ('discipline','Discipline'), ('information','Information'), ('uncertainty','Uncertainty'),
  ('deception','Deception'), ('privacy','Privacy'), ('reputation','Reputation'),
  ('incentives','Incentives'), ('alliances','Alliances'), ('dependence','Dependence'),
  ('options','Options'), ('alternatives','Alternatives'), ('commitment','Commitment'),
  ('withdrawal','Withdrawal'), ('escalation','Escalation'), ('adaptation','Adaptation'),
  ('emotional_regulation','Emotional regulation'), ('rhetoric','Rhetoric'),
  ('persuasion','Persuasion'), ('evidence','Evidence'), ('trust','Trust'),
  ('boundaries','Boundaries'), ('leadership','Leadership'), ('institutions','Institutions'),
  ('fortune','Fortune'), ('reversibility','Reversibility');

-- 10.10 ethos / logos / pathos, each with strong and corrupt use.
INSERT OR IGNORE INTO graph_nodes (slug, title, strong_use, corrupt_use) VALUES
  ('ethos','Ethos',
   'Credibility earned by a record that can be checked: you have done the thing, and your word has been banked before.',
   'Borrowed or manufactured authority — credentials implied, association implied, confidence substituted for a record.'),
  ('logos','Logos',
   'Reasoning that exposes its own premises and can be checked, including where it would fail.',
   'The shape of an argument without its substance: selective evidence, unstated premises, numbers that cannot be traced.'),
  ('pathos','Pathos',
   'Naming a real stake so a true thing lands with the weight it actually has.',
   'Manufactured urgency, fear or flattery used to move someone past their own judgement.');

-- 10.6 the Five Factors, taught with range and corrected against the distortions.
INSERT OR IGNORE INTO concepts
  (slug, source_id, anchor, title, original_term, translation_range, historical_meaning,
   modern_interpretation, misuse, defensive_lesson, reversal_condition, score_rule)
VALUES
  ('sunzi_dao','art_of_war','art_of_war:1:3','The Way (Dào)','道',
   'the Way; alignment; cohesion; legitimacy; shared purpose — never simply "why"',
   'Whether ruler and people share a purpose such that the people will follow him into danger; cohesion that makes cooperation voluntary.',
   'Whether the purpose is genuinely shared by everyone whose cooperation you need, and whether that cooperation is voluntary rather than extracted.',
   'Flattened into a motivational "find your why". A private motive is not 道; 道 is about shared purpose and legitimacy across the people involved.',
   'When cooperation has to be compelled, 道 is absent — and no amount of method (法) repairs it.',
   'A shared purpose imposed rather than held becomes a slogan; it inverts into resentment the moment cost arrives.',
   NULL),
  ('sunzi_tian','art_of_war','art_of_war:1:4','Heaven (Tiān)','天',
   'Heaven; timing; season; external conditions; cycle; momentum — not luck',
   'Night and day, cold and heat, the seasons: the conditions no commander controls but every commander must read.',
   'Timing and external conditions — deadlines, seasons, market or institutional cycles, momentum already in motion.',
   'Reduced to luck or fate, which excuses bad timing instead of reading it.',
   'Conditions you did not choose still decide outcomes; a correct plan at the wrong time loses.',
   'Waiting for perfect conditions becomes paralysis; 天 selects the moment, it does not excuse inaction forever.',
   NULL),
  ('sunzi_di','art_of_war','art_of_war:1:5','Ground (Dì)','地',
   'Ground; terrain; structural environment; constraints; channels; choke points; access; bottlenecks — not physical geography alone',
   'Distance, danger, open and constricted ground: the structure within which movement is possible or not.',
   'The structural environment of a situation: which channels exist, who controls access, where the bottlenecks and choke points are.',
   'Read as physical geography only, which misses the structural terrain of institutions, access and dependence.',
   'Map the constraints before choosing a move; ground you have not surveyed will choose for you.',
   'Terrain read once becomes a fixed belief; ground changes, and a stale map is worse than none.',
   NULL),
  ('sunzi_jiang','art_of_war','art_of_war:1:6','The Commander (Jiàng)','將',
   'the commander; generalship; the five virtues of command — and the commander is HIMSELF',
   'The general: wisdom, sincerity, benevolence, courage and strictness, judged as a whole because a missing virtue corrupts the rest.',
   'His own conduct as commander of himself: what he knows, whether his word can be banked, how he treats people, whether he acts under fear, and whether he holds a standard.',
   'Redirected OUTWARD into an inventory of other people''s emotional fault lines. Book 10.6 strikes that framing: 將 is the commander, and the commander is himself.',
   'Audit yourself on the five before auditing anyone else; the lowest of the five is your real level.',
   'Any one virtue removed turns the others into vices — courage without wisdom is recklessness, strictness without benevolence is cruelty.',
   'lowest_of_components'),
  ('sunzi_fa','art_of_war','art_of_war:1:7','Method (Fǎ)','法',
   'method; law; organisation; discipline; logistics; system',
   'Organisation, the chain of command, control of supply: the machinery that makes an army an army rather than a crowd.',
   'Systems, routines and logistics — sleep, cash, calendar, environment. Talent without 法 is a firework.',
   'Treated as bureaucracy or as beneath talent, when it is what makes talent repeatable.',
   'Attacks come against supply — sleep, cash, isolation, calendar — not against arguments. Defend the supply line first.',
   'Method hardened into ritual stops serving the aim; 法 exists for the objective, not the reverse.',
   NULL);

INSERT OR IGNORE INTO concept_components (concept_slug, sort_order, original_term, title, meaning, misuse) VALUES
  ('sunzi_jiang',1,'智','Wisdom','Seeing the situation as it is, including your own part in it.','Cleverness mistaken for wisdom.'),
  ('sunzi_jiang',2,'信','A word that can be banked','What you say is what happens, reliably enough that others can plan on it.','Charm substituted for reliability.'),
  ('sunzi_jiang',3,'仁','Benevolence','Genuine regard for the people whose cooperation you depend on.','Sentimentality that avoids necessary decisions.'),
  ('sunzi_jiang',4,'勇','Courage','Acting when action is correct and costly.','Recklessness dressed as courage.'),
  ('sunzi_jiang',5,'嚴','Strictness','Holding a standard, consistently, including for yourself.','Harshness aimed outward only.');

-- 10.6 the Chapter II correction, recorded as a concept so the distortion is visibly struck.
INSERT OR IGNORE INTO concepts
  (slug, source_id, anchor, title, original_term, translation_range, historical_meaning,
   modern_interpretation, misuse, defensive_lesson, reversal_condition, score_rule)
VALUES
  ('sunzi_ch2_cost_of_delay','art_of_war','art_of_war:2:1','Chapter II — the cost of prolongation','作戰',
   'waging war; the conduct of a campaign once begun; the economics of a contest in progress',
   'A campaign in the field consumes the state: prolonged operations exhaust treasury, men and the goodwill of the people.',
   'Once a costly contest has begun, delay compounds its cost. Therefore prepare carefully BEFORE commitment, and avoid unnecessary prolongation.',
   'Flattened in the seed data into "a quick imperfect action always beats a perfect slow one". That is not the chapter and it is struck: the chapter is about the economics of a contest ALREADY BEGUN, and it argues for careful preparation before commitment.',
   'Before committing, ask what prolongation would cost; after committing, treat delay itself as a cost that compounds.',
   'Read as a licence for haste, it destroys the preparation the chapter demands. Speed applies after commitment, not instead of preparation.',
   NULL);
