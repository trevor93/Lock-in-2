-- Book 13 named tables: decisions, decision_evidence, decision_options,
-- decision_predictions, decision_outcomes, decision_reviews. All six appear in the
-- table list at MASTERPROMPT.md:202 and none of them existed. The Decision Lab was
-- the largest single absence in the schema: a commander could read Book 13, work
-- through the Situation object on paper, and the application had nowhere to put it.
--
-- The reason this is a migration and not a handler is Book 13.2's own sentence:
-- "Law 23 is enforced here in schema, not in advice." A rule that lives in a route
-- is a rule the next route forgets. Everything below that can be a constraint is a
-- constraint, and test/decision-lab-schema.test.ts is what proves the database
-- itself refuses -- not that some code path happens to check first.
--
-- Three design decisions worth stating, because each of them looks like an omission:
--
--   1. The commitment is guarded at the TRANSITION, not per column. A decision under
--      construction legitimately has no selected option, no premortem, and no exit
--      trigger -- that is what "under construction" means. What must be impossible is
--      COMMITTING without them. So those columns are nullable and one BEFORE UPDATE
--      trigger judges the whole intended row when status becomes 'committed'.
--
--   2. The Five Factors are nullable ON PURPOSE. Book 13.3 says each factor is
--      "scored, or marked unknown". A NOT NULL would force a number where he has
--      none, and a fabricated score is worse than an absent one.
--
--   3. The Seven Comparisons get fourteen columns, not seven. A single score column
--      silently becomes a score of himself alone, which is the comparison not being
--      made.
--
-- Every table carries user_id, so all six are swept by the ownership check in
-- test/session-ownership.test.ts. No table here holds anything an operator needs:
-- these are the commander's own reasoning, and they are personal data in full.
--
-- ROLLBACK (destroys the entire Decision Lab, including filed reviews -- take the
-- export first; a filed review is the only place the record says "I was wrong"):
--   DROP TRIGGER IF EXISTS trg_decision_predictions_no_regrade;
--   DROP TRIGGER IF EXISTS trg_decision_reviews_no_rewrite;
--   DROP TRIGGER IF EXISTS trg_decisions_commit_gate;
--   DROP TABLE IF EXISTS decision_reviews;
--   DROP TABLE IF EXISTS decision_outcomes;
--   DROP TABLE IF EXISTS decision_predictions;
--   DROP TABLE IF EXISTS decision_options;
--   DROP TABLE IF EXISTS decision_evidence;
--   DROP TABLE IF EXISTS decisions;
-- Nothing outside Book 13 references these tables, so the drop leaves the rest of
-- the application working exactly as it did before this migration.

CREATE TABLE IF NOT EXISTS decisions (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                 INTEGER NOT NULL REFERENCES users(id),

  -- Book 13.1, identification.
  title                   TEXT NOT NULL,
  domain                  TEXT NOT NULL,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  deadline                TEXT,
  -- 'open' is a decision under construction; 'committed' is the transition the gate
  -- below guards; 'closed' is one that has been reviewed; 'abandoned' is one he
  -- walked away from, which is a real answer and must not be recorded as a decision
  -- that was never made.
  status                  TEXT NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open','committed','closed','abandoned')),
  importance              INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
  reversibility           TEXT NOT NULL
                            CHECK (reversibility IN ('reversible','costly_to_reverse','irreversible')),

  -- Book 13.1, situation. `observed` and `believed` are two NOT NULL columns rather
  -- than one story because "what happened as against what is merely believed" is the
  -- split the Decision Lab exists to force; one column lets the two collapse.
  description             TEXT NOT NULL,
  observed                TEXT NOT NULL,
  believed                TEXT NOT NULL,
  stakeholders_json       TEXT NOT NULL DEFAULT '[]',

  -- Book 13.1, objective.
  desired_outcome         TEXT NOT NULL,
  minimum_acceptable      TEXT NOT NULL,
  forbidden_outcome       TEXT NOT NULL,
  success_criteria        TEXT NOT NULL,

  -- Book 13.1, stakes.
  gains                   TEXT NOT NULL,
  losses                  TEXT NOT NULL,
  opportunity_cost        TEXT NOT NULL,
  others_affected         TEXT NOT NULL,

  -- Book 13.2, the brake. 0010 put this on heated captures; Book 13.2 requires it on
  -- every decision. 'None plausible' is a legal answer, counted in the 0010 ledger
  -- rather than refused here -- forcing invention would make the field a lie
  -- generator, and the paranoia tell is a rising count, not a rejection.
  alternative_explanation TEXT NOT NULL
                            CHECK (length(trim(alternative_explanation)) BETWEEN 1 AND 4000),
  -- Book 13.3, the Five Factors. NULL means "marked unknown", which Book 13.3 names
  -- as a legal state. A fabricated score is worse than an absent one.
  factor_dao              INTEGER CHECK (factor_dao IS NULL OR factor_dao BETWEEN 1 AND 5),
  factor_tian             INTEGER CHECK (factor_tian IS NULL OR factor_tian BETWEEN 1 AND 5),
  factor_di               INTEGER CHECK (factor_di IS NULL OR factor_di BETWEEN 1 AND 5),
  factor_fa               INTEGER CHECK (factor_fa IS NULL OR factor_fa BETWEEN 1 AND 5),
  -- 將 is aimed at himself. `factor_jiang` is kept for the raw score and
  -- `factor_jiang_self` names whose command is being judged, so the column cannot be
  -- read as a score of the other side -- which is the misreading Book 10.6 corrects.
  factor_jiang            INTEGER CHECK (factor_jiang IS NULL OR factor_jiang BETWEEN 1 AND 5),
  factor_jiang_self       INTEGER CHECK (factor_jiang_self IS NULL OR factor_jiang_self BETWEEN 1 AND 5),

  -- Book 13.3, the Seven Comparisons -- both sides, every time. Fourteen columns
  -- rather than seven, because a single score column silently becomes a score of
  -- himself alone, which is the comparison not being made. Nullable for the same
  -- reason the factors are.
  compare_alignment_self    INTEGER CHECK (compare_alignment_self IS NULL OR compare_alignment_self BETWEEN 1 AND 5),
  compare_alignment_other   INTEGER CHECK (compare_alignment_other IS NULL OR compare_alignment_other BETWEEN 1 AND 5),
  compare_competence_self   INTEGER CHECK (compare_competence_self IS NULL OR compare_competence_self BETWEEN 1 AND 5),
  compare_competence_other  INTEGER CHECK (compare_competence_other IS NULL OR compare_competence_other BETWEEN 1 AND 5),
  compare_timing_self       INTEGER CHECK (compare_timing_self IS NULL OR compare_timing_self BETWEEN 1 AND 5),
  compare_timing_other      INTEGER CHECK (compare_timing_other IS NULL OR compare_timing_other BETWEEN 1 AND 5),
  compare_process_self      INTEGER CHECK (compare_process_self IS NULL OR compare_process_self BETWEEN 1 AND 5),
  compare_process_other     INTEGER CHECK (compare_process_other IS NULL OR compare_process_other BETWEEN 1 AND 5),
  compare_resources_self    INTEGER CHECK (compare_resources_self IS NULL OR compare_resources_self BETWEEN 1 AND 5),
  compare_resources_other   INTEGER CHECK (compare_resources_other IS NULL OR compare_resources_other BETWEEN 1 AND 5),
  compare_preparation_self  INTEGER CHECK (compare_preparation_self IS NULL OR compare_preparation_self BETWEEN 1 AND 5),
  compare_preparation_other INTEGER CHECK (compare_preparation_other IS NULL OR compare_preparation_other BETWEEN 1 AND 5),
  compare_incentives_self   INTEGER CHECK (compare_incentives_self IS NULL OR compare_incentives_self BETWEEN 1 AND 5),
  compare_incentives_other  INTEGER CHECK (compare_incentives_other IS NULL OR compare_incentives_other BETWEEN 1 AND 5),

  -- Book 13.3's two forced sentences. Nullable at insert because a decision under
  -- construction has answered neither; required at the commit transition, because
  -- these are the two questions that change the answer.
  forced_if_nothing_changes TEXT,
  forced_cheapest_change    TEXT,

  -- Book 13.4, the commitment. Every column below is nullable here and required by
  -- trg_decisions_commit_gate: see design note 1 in the header.
  -- Deliberately NOT a foreign key. decision_options already references decisions, and
  -- a reference back would make the pair circular: deleting a decision's options would
  -- then violate the parent's own reference. The gate below proves the id is present and
  -- the route resolves it; a circular constraint would buy nothing and break deletion.
  selected_option_id        INTEGER,
  commitment_reason         TEXT,
  commitment_confidence     INTEGER
                              CHECK (commitment_confidence IS NULL
                                     OR commitment_confidence BETWEEN 0 AND 100),
  committed_date            TEXT,
  next_physical_action      TEXT,
  never_list                TEXT,
  premortem_cause           TEXT,

  -- The four triggers Book 13.4 names: what makes him act, what makes him wait, what
  -- makes him leave, and what would change the recommendation itself. The fourth is
  -- the one that keeps the decision falsifiable rather than merely scheduled.
  trigger_act                       TEXT,
  trigger_delay                     TEXT,
  trigger_exit                      TEXT,
  trigger_changes_recommendation    TEXT,

  -- Book 1's Daylight Test, six questions, recorded per decision. 1 checked, 0 not.
  -- An unchecked box is legal -- a box may honestly be false -- but Book 13.4 requires
  -- a written justification beside it, and the gate refuses the transition without one.
  daylight_truthful         INTEGER CHECK (daylight_truthful IS NULL OR daylight_truthful IN (0,1)),
  daylight_consensual       INTEGER CHECK (daylight_consensual IS NULL OR daylight_consensual IN (0,1)),
  daylight_proportionate    INTEGER CHECK (daylight_proportionate IS NULL OR daylight_proportionate IN (0,1)),
  daylight_reversible       INTEGER CHECK (daylight_reversible IS NULL OR daylight_reversible IN (0,1)),
  daylight_reputation_safe  INTEGER CHECK (daylight_reputation_safe IS NULL OR daylight_reputation_safe IN (0,1)),
  daylight_survives_daylight INTEGER CHECK (daylight_survives_daylight IS NULL OR daylight_survives_daylight IN (0,1)),
  daylight_justification    TEXT,

  -- Book 13.4's thirty-day review is scheduled at commitment, not remembered later.
  review_due_date           TEXT
);

CREATE INDEX IF NOT EXISTS idx_decisions_user_status
  ON decisions(user_id, status, created_at DESC);
-- The Continuity Brief at MASTERPROMPT.md:740 lists open_situations[], and the
-- Temple's review queue asks "which committed decision is due". Both read this.
CREATE INDEX IF NOT EXISTS idx_decisions_review_due
  ON decisions(user_id, status, review_due_date);

-- Book 13.2, evidence typing. The five labels are the whole point: an unlabelled
-- claim reads exactly like a fact, and Law 23 is about not confusing the two.
CREATE TABLE IF NOT EXISTS decision_evidence (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                 INTEGER NOT NULL REFERENCES users(id),
  decision_id             INTEGER NOT NULL REFERENCES decisions(id),
  kind                    TEXT NOT NULL
                            CHECK (kind IN ('FACT','CLAIM','INFERENCE','HYPOTHESIS','UNKNOWN')),
  statement               TEXT NOT NULL CHECK (length(trim(statement)) > 0),
  -- Where it came from, how much the source is worth, when it was observed. An
  -- undated observation cannot be aged, and a sourceless one cannot be re-checked.
  source                  TEXT NOT NULL,
  reliability             TEXT NOT NULL CHECK (reliability IN ('high','medium','low','unknown')),
  observed_date           TEXT,
  confidence              INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  -- The flag that separates "I checked this myself" from "someone told me". A FACT
  -- that is not independently verified is still a CLAIM wearing a better label, and
  -- this column is what lets the Lab say so.
  independently_verified  INTEGER NOT NULL DEFAULT 0
                            CHECK (independently_verified IN (0,1)),
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_decision_evidence_decision
  ON decision_evidence(decision_id, kind);

-- Book 13.3, options. Every field is NOT NULL: each one is a question the option is
-- supposed to have answered, and a nullable column here means an option that looks
-- complete on screen and answered nothing.
CREATE TABLE IF NOT EXISTS decision_options (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                 INTEGER NOT NULL REFERENCES users(id),
  decision_id             INTEGER NOT NULL REFERENCES decisions(id),
  -- The six shapes an option can take. 'seek_review' and 'delay' are options in their
  -- own right, which is what stops the list collapsing into engage-or-decline.
  kind                    TEXT NOT NULL
                            CHECK (kind IN ('engage','modify','delay','decline','seek_review','exit')),
  summary                 TEXT NOT NULL,
  expected_benefit        TEXT NOT NULL,
  cost                    TEXT NOT NULL,
  downside                TEXT NOT NULL,
  reversibility           TEXT NOT NULL
                            CHECK (reversibility IN ('reversible','costly_to_reverse','irreversible')),
  dependencies            TEXT NOT NULL,
  second_order_effects    TEXT NOT NULL,
  -- What the option teaches even if it fails. An option that gains no information is
  -- a bet; one that does is a probe, and the distinction changes which to take first.
  information_gained      TEXT NOT NULL,
  probability             INTEGER NOT NULL CHECK (probability BETWEEN 0 AND 100),
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_decision_options_decision
  ON decision_options(decision_id, kind);

-- Book 13.5. The decision Brier sits beside Book 10.3's knowledge Brier and reads
-- from here. `resolve_by` is NOT NULL because a prediction with no resolution date is
-- not falsifiable, and an unfalsifiable prediction is an opinion with a number on it.
CREATE TABLE IF NOT EXISTS decision_predictions (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                 INTEGER NOT NULL REFERENCES users(id),
  decision_id             INTEGER NOT NULL REFERENCES decisions(id),
  statement               TEXT NOT NULL CHECK (length(trim(statement)) > 0),
  confidence              INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  resolve_by              TEXT NOT NULL,
  -- The same four-word vocabulary as `predictions` in 0004. 'void' exists because a
  -- question that stopped being askable is not a wrong answer.
  outcome                 TEXT NOT NULL DEFAULT 'unresolved'
                            CHECK (outcome IN ('right','wrong','unresolved','void')),
  resolved_date           TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_decision_predictions_open
  ON decision_predictions(user_id, outcome, resolve_by);

-- Book 13.4, the outcome. `measurable_result` is NOT NULL because "it went fine" is
-- the sentence this table exists to refuse: an outcome that measures nothing cannot
-- be compared against the success criteria the decision wrote down in advance.
CREATE TABLE IF NOT EXISTS decision_outcomes (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                 INTEGER NOT NULL REFERENCES users(id),
  decision_id             INTEGER NOT NULL REFERENCES decisions(id),
  what_happened           TEXT NOT NULL,
  measurable_result       TEXT NOT NULL,
  unintended_consequences TEXT,
  stakeholder_response    TEXT,
  recorded_date           TEXT NOT NULL,
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_decision_outcomes_decision
  ON decision_outcomes(decision_id);

-- Book 13.4, the thirty-day review. Every column NOT NULL, because the review is the
-- only place the record says "I was wrong about this", and a review that skipped the
-- lesson is a review that happened without being one.
CREATE TABLE IF NOT EXISTS decision_reviews (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                 INTEGER NOT NULL REFERENCES users(id),
  decision_id             INTEGER NOT NULL REFERENCES decisions(id),
  review_date             TEXT NOT NULL,
  prediction_accuracy     INTEGER NOT NULL CHECK (prediction_accuracy BETWEEN 0 AND 100),
  failed_assumption       TEXT NOT NULL,
  missing_information     TEXT NOT NULL,
  -- The separation Book 13.4 insists on. Without it, a decision that worked is
  -- recorded as a decision that was right, which is how a lucky habit becomes a rule.
  judgment_vs_luck        TEXT NOT NULL,
  lesson                  TEXT NOT NULL,
  updated_principle       TEXT NOT NULL,
  -- The Daylight boxes that were left unchecked at commitment, resurfaced here as a
  -- JSON array. The route derives this list from the decision's own columns rather
  -- than asking; the guard asserts the two agree, so it cannot drift into whatever
  -- the reviewer remembers having waved through.
  unchecked_daylight_resurfaced TEXT NOT NULL DEFAULT '[]',
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_decision_reviews_decision
  ON decision_reviews(decision_id, review_date);

-- The commit gate. This is design note 1 in the header made executable: everything
-- Book 13.4 requires of a commitment is judged at the moment status becomes
-- 'committed', on the whole intended row, in one statement.
--
-- It fires only on the transition INTO 'committed' from something else, so a later
-- edit of a committed decision is not re-judged by this trigger (the append-only
-- record is the review, not the decision), and a decision under construction is left
-- alone entirely.
--
-- Each RAISE names the missing thing rather than saying "invalid", because the route
-- surfaces the message and "commitment is incomplete" tells the commander nothing
-- about which question he skipped.
CREATE TRIGGER IF NOT EXISTS trg_decisions_commit_gate
BEFORE UPDATE ON decisions
WHEN NEW.status = 'committed' AND OLD.status <> 'committed'
BEGIN
  -- Book 13.3: "at least three options where possible". Enforced, because two options
  -- is almost always a decision that has already been made and is looking for
  -- permission to have been made.
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM decision_options WHERE decision_id = NEW.id
  ) < 3 THEN RAISE(ABORT, 'DECISION_NEEDS_THREE_OPTIONS') END;

  SELECT CASE WHEN NEW.selected_option_id IS NULL
    THEN RAISE(ABORT, 'DECISION_NEEDS_SELECTED_OPTION') END;
  SELECT CASE WHEN NEW.commitment_reason IS NULL
                OR length(trim(NEW.commitment_reason)) = 0
    THEN RAISE(ABORT, 'DECISION_NEEDS_REASON') END;
  SELECT CASE WHEN NEW.commitment_confidence IS NULL
    THEN RAISE(ABORT, 'DECISION_NEEDS_CONFIDENCE') END;
  SELECT CASE WHEN NEW.committed_date IS NULL
    THEN RAISE(ABORT, 'DECISION_NEEDS_COMMITTED_DATE') END;
  -- The next physical action is the difference between a commitment and an intention.
  SELECT CASE WHEN NEW.next_physical_action IS NULL
                OR length(trim(NEW.next_physical_action)) = 0
    THEN RAISE(ABORT, 'DECISION_NEEDS_NEXT_PHYSICAL_ACTION') END;
  -- Pre-mortem: assume it failed, name the most likely cause. Before, not after.
  SELECT CASE WHEN NEW.premortem_cause IS NULL
                OR length(trim(NEW.premortem_cause)) = 0
    THEN RAISE(ABORT, 'DECISION_NEEDS_PREMORTEM') END;

  -- The four triggers. All four, because the fourth -- what new fact changes the
  -- recommendation -- is the one that keeps the commitment open to evidence.
  SELECT CASE WHEN NEW.trigger_act IS NULL OR length(trim(NEW.trigger_act)) = 0
    THEN RAISE(ABORT, 'DECISION_NEEDS_TRIGGER_ACT') END;
  SELECT CASE WHEN NEW.trigger_delay IS NULL OR length(trim(NEW.trigger_delay)) = 0
    THEN RAISE(ABORT, 'DECISION_NEEDS_TRIGGER_DELAY') END;
  SELECT CASE WHEN NEW.trigger_exit IS NULL OR length(trim(NEW.trigger_exit)) = 0
    THEN RAISE(ABORT, 'DECISION_NEEDS_TRIGGER_EXIT') END;
  SELECT CASE WHEN NEW.trigger_changes_recommendation IS NULL
                OR length(trim(NEW.trigger_changes_recommendation)) = 0
    THEN RAISE(ABORT, 'DECISION_NEEDS_TRIGGER_CHANGES_RECOMMENDATION') END;

  -- Book 13.3's two forced sentences.
  SELECT CASE WHEN NEW.forced_if_nothing_changes IS NULL
                OR length(trim(NEW.forced_if_nothing_changes)) = 0
    THEN RAISE(ABORT, 'DECISION_NEEDS_FORCED_IF_NOTHING_CHANGES') END;
  SELECT CASE WHEN NEW.forced_cheapest_change IS NULL
                OR length(trim(NEW.forced_cheapest_change)) = 0
    THEN RAISE(ABORT, 'DECISION_NEEDS_FORCED_CHEAPEST_CHANGE') END;

  -- All six Daylight boxes must have been answered one way or the other. A NULL box
  -- is a question that was never put, which is not the same as a 'no'.
  SELECT CASE WHEN NEW.daylight_truthful IS NULL
                OR NEW.daylight_consensual IS NULL
                OR NEW.daylight_proportionate IS NULL
                OR NEW.daylight_reversible IS NULL
                OR NEW.daylight_reputation_safe IS NULL
                OR NEW.daylight_survives_daylight IS NULL
    THEN RAISE(ABORT, 'DECISION_NEEDS_ALL_DAYLIGHT_BOXES') END;

  -- "...with written justification for any unchecked box." An unchecked box is legal:
  -- a box may honestly be false. What is not legal is waving it through in silence.
  SELECT CASE WHEN (
      NEW.daylight_truthful = 0 OR NEW.daylight_consensual = 0
      OR NEW.daylight_proportionate = 0 OR NEW.daylight_reversible = 0
      OR NEW.daylight_reputation_safe = 0 OR NEW.daylight_survives_daylight = 0
    ) AND (NEW.daylight_justification IS NULL
           OR length(trim(NEW.daylight_justification)) = 0)
    THEN RAISE(ABORT, 'DECISION_NEEDS_DAYLIGHT_JUSTIFICATION') END;

  -- The thirty-day review is scheduled now, at the moment of commitment. Scheduling
  -- it later means scheduling it never.
  SELECT CASE WHEN NEW.review_due_date IS NULL
    THEN RAISE(ABORT, 'DECISION_NEEDS_REVIEW_DATE') END;
END;

-- The review is evidence, not an opinion about the past. If it can be edited after
-- filing, the record of having been wrong quietly becomes a record of having been
-- nearly right, which is the failure mode the whole Book exists to prevent.
CREATE TRIGGER IF NOT EXISTS trg_decision_reviews_no_rewrite
BEFORE UPDATE ON decision_reviews
BEGIN
  SELECT RAISE(ABORT, 'decision_reviews is append-only: a filed review cannot be rewritten');
END;

-- There is deliberately NO no-delete trigger here, unlike the 0010 ledger. A commander
-- who deletes a decision must be able to take its review with it -- that is his data,
-- and Book 16's export-and-delete right is not negotiable. SQLite cannot tell a cascade
-- from an edit inside a trigger, so a delete guard would either block the deletion or be
-- trivially bypassed. What makes the review evidence is that it cannot be REWRITTEN
-- while it stands, which is the trigger above.

-- A resolved prediction is not regraded. This mirrors the 409 the knowledge
-- prediction route already returns -- "the record does not get rewritten" -- and puts
-- it where a future route cannot forget it. Only the resolution itself is writable,
-- and only once.
CREATE TRIGGER IF NOT EXISTS trg_decision_predictions_no_regrade
BEFORE UPDATE ON decision_predictions
WHEN OLD.outcome <> 'unresolved'
BEGIN
  SELECT RAISE(ABORT, 'a resolved prediction cannot be regraded');
END;
