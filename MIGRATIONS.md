# MIGRATIONS

Every figure in this document is derived from `migrations/` by
`test/migrations-doc-completeness.test.ts` and compared against the document in both
directions: a migration on disk that this document omits fails the build, and a file or table
this document names that does not exist fails the build too. Nothing here is counted by hand.

The one assertion that makes the rest trustworthy is the parser floor. Every list below comes
from a static reading of SQL text, and a static reading is worth exactly as much as its
parser. So the replayed set of surviving tables is compared against `sqlite_master` in the
database the migrations actually built. If the parser misreads a statement, the guard fails at
the parser rather than quietly measuring this document against a set that was already wrong.

---

## 1. What this document is

`migrations/` holds thirty `.sql` files. They are the only description of the production
schema; there is no ORM, no schema-sync step and no generated DDL anywhere in the repository.
The application issues raw prepared statements against whatever these files produced.

This document exists so that an operator who is about to apply these files to a database
holding real history can answer four questions without reading 6,000 lines of SQL: what each
migration does, which migration owns the table they are looking at, which migrations cannot
be run twice, and what was destroyed rather than added.

It does not restate the runbook. `OPERATIONS.md` §5 is the procedure — one subsection per
migration, with the pre-checks, the apply command and the rollback note. This document is the
map; that one is the route.

---

## 2. The rules that make the directory safe to apply

**Filename order.** The four-digit zero-padded prefix is the order of application, and
`test/setup.ts` derives the list with `import.meta.glob` and `.sort()` rather than hard-coding
it, so a new migration joins the sequence by existing. `wrangler d1 migrations apply` applies
them in the same lexical order and records each one it has applied.

**Forward-only.** There is no `down` file anywhere in the directory, and no migration is ever
edited after it has been applied to production. A mistake in an applied migration is corrected
by a new migration with a higher number. This is a deliberate constraint, not an omission: a
`down` file that has never been executed against real data is a claim, and the reversal notes
in `OPERATIONS.md` §5 are written to be read by a person who can see the rows.

**Applied exactly once.** Most statements in the directory are defensive — all 100
`CREATE INDEX` statements say `IF NOT EXISTS`, and all but two `CREATE TABLE` statements do —
but defensiveness is not idempotence. SQLite has no `ADD COLUMN IF NOT EXISTS` and no
`RENAME TO` that tolerates a missing table, so these nine migrations **error on a second
application**:

| Migration | Why it cannot be repeated |
| --- | --- |
| `0004_reforge.sql` | `ALTER TABLE … ADD COLUMN` |
| `0005_sessions_and_ownership.sql` | `ALTER TABLE … ADD COLUMN` |
| `0009_recovery_catchup.sql` | `ALTER TABLE … ADD COLUMN` |
| `0010_alternative_explanation_gate.sql` | `ALTER TABLE … ADD COLUMN` |
| `0013_maxims_cutover.sql` | `ALTER TABLE … RENAME TO` |
| `0015_responses_cutover.sql` | `ALTER TABLE … RENAME TO` |
| `0018_ratchet.sql` | `ALTER TABLE … ADD COLUMN` |
| `0021_mastery_rubric_calibration.sql` | `ALTER TABLE … ADD COLUMN` |
| `0028_attempt_deployed.sql` | `ALTER TABLE … ADD COLUMN` |

An error part-way through one of these leaves the schema between two states. `wrangler` will
not have recorded the migration as applied, so a retry starts from the top of a file whose
first half already ran. That is the situation `OPERATIONS.md` §5 exists to walk out of, and it
is the reason the runbook's pre-checks are per-migration rather than one blanket check.

**No user data is ever deleted by a migration.** Two tables are dropped in the whole
directory, and in both cases the rows were copied into their replacement first and the
original was kept under a `_pre####_backup` name. §5 covers both.

---

## 3. The thirty migrations

| Migration | What it does |
| --- | --- |
| `0001_initial_schema.sql` | The original schedule, laws, units, points and rewards tables the app was first built on. |
| `0002_intel_books_alarms.sql` | Life Intel: the Council war journal, book progress, and Hermes messages. |
| `0003_tongue.sql` | The Tongue: captured wise responses, their spaced-repetition state, and exams. |
| `0004_reforge.sql` | Reforge: weighted scoring, the day summary, predictions, appeals and load reductions. |
| `0005_sessions_and_ownership.sql` | Book 5.2: durable users, revocable hashed sessions, and an owner column on every personal table. |
| `0006_agent_credentials.sql` | Book 5.5: scoped, hashed, expiring, revocable agent credentials with lifecycle events. |
| `0007_model_security.sql` | Book 5.6: per-owner model rate and cost reservations, and append-only model audit evidence. |
| `0008_audit_idempotency.sql` | Book 5.7: append-only audit events, and idempotency keys for delivery. |
| `0009_recovery_catchup.sql` | Books 8.2 and 8.6: Minimum Viable Recovery and the re-entry protocol behind `/catchup`. |
| `0010_alternative_explanation_gate.sql` | Book 13.2: the alternative-explanation gate — the brake on the pattern engine. |
| `0011_chapter_cursor.sql` | Book 16 and R9: the chapter cursor, which records the active front. |
| `0012_unify_captures.sql` | Book 7, slice 1: the unified capture, review and exam tables, backfilled 1:1. Additive only. |
| `0013_maxims_cutover.sql` | Book 7 maxims cutover: spaced repetition is repointed off `maxims`, and `flashcards` is rebuilt. |
| `0014_intel_cutover.sql` | Book 7 intel cutover: re-establishes the Law-23 brake on the unified table. Adds no table. |
| `0015_responses_cutover.sql` | Book 7 responses cutover: responses fold into captures, and `tongue_reviews` is rebuilt. |
| `0016_sm2_to_fsrs.sql` | Book 7: backfills FSRS stability and difficulty from the existing SM-2 history. |
| `0017_push_notifications.sql` | Book 7 alarms: Web Push subscriptions, delivery records and notification preferences. |
| `0018_ratchet.sql` | Book 8.1: the ratchet — the mandatory day shrinks, and the remainder becomes a deck. |
| `0019_block_statuses_and_causes.sql` | Books 8.3 and 8.4: ten honest block states, and the miss-cause diagnosis. |
| `0020_learning_sources_reading.sql` | Books 10.1 and 10.5: measured reading — dwell plus traversal — and honest source metadata. |
| `0021_mastery_rubric_calibration.sql` | Books 10.2 to 10.4 and R0: the mastery ladder with declared evidence, the rubric, calibration. |
| `0022_principles_graph.sql` | Books 10.6 to 10.10: concepts, framing rules, hypotheses, and the cross-book principle graph. |
| `0023_immune_table_seed.sql` | Book 10.9: seeds the naive-versus-master immune table from what was actually read. Adds no table. |
| `0024_rhetoric_track.sql` | Books 11 and 12: the Farnsworth programme as fixed curriculum data, and the two lab tracks. |
| `0025_rhetoric_seed.sql` | Books 11 and 12: curriculum rows only — chapters, phases, figures, cards. Adds no table. |
| `0026_figure_records.sql` | Book 11.7: twenty-two figure records, seeded as curriculum rows. Adds no table. |
| `0027_response_lab_seed.sql` | Books 11 and 12: three required seed sets, in one migration because they interlock. Adds no table. |
| `0028_attempt_deployed.sql` | Book 12.4: adds the deployed state that the outbound red-team card guards. Adds no table. |
| `0029_job_runs.sql` | Books 7 and 5.3: a run record for the enforcement tick and the alarm job. |
| `0030_decision_lab.sql` | Book 13: the six Decision Lab tables, with the commit gate and the two append-only rules as triggers. |

Seven migrations create no table of their own — `0014_intel_cutover.sql`,
`0016_sm2_to_fsrs.sql`, `0023_immune_table_seed.sql`, `0025_rhetoric_seed.sql`,
`0026_figure_records.sql`, `0027_response_lab_seed.sql` and `0028_attempt_deployed.sql`. They
add columns, install triggers, backfill history or seed curriculum rows. They are not no-ops,
and three of them are among the nine that cannot be applied twice.

---

## 4. Which migration owns each live table

The directory contains 100 `CREATE TABLE` statements and leaves **98** tables standing; the
two-table difference is the two cutovers in §5. Each row below names the migration that gave
a table its **current** name, which for `flashcards` and `tongue_reviews` is the migration
that built the replacement rather than the one that first created the name.

| Migration | Live tables | Which ones |
| --- | --- | --- |
| `0001_initial_schema.sql` | 15 | `block_logs`, `card_reviews`, `debriefs`, `honesty_flags`, `law_checks`, `laws`, `maxims`, `phases`, `points_ledger`, `reward_redemptions`, `rewards`, `schedule_blocks`, `settings`, `unit_progress`, `units` |
| `0002_intel_books_alarms.sql` | 3 | `book_progress`, `hermes_messages`, `intel_entries` |
| `0003_tongue.sql` | 3 | `response_srs`, `responses`, `tongue_exams` |
| `0004_reforge.sql` | 4 | `appeals`, `day_summary`, `load_reductions`, `predictions` |
| `0005_sessions_and_ownership.sql` | 2 | `sessions`, `users` |
| `0006_agent_credentials.sql` | 2 | `agent_credential_events`, `agent_credentials` |
| `0007_model_security.sql` | 2 | `model_audit_events`, `model_requests` |
| `0008_audit_idempotency.sql` | 2 | `audit_events`, `idempotency_keys` |
| `0009_recovery_catchup.sql` | 2 | `catchup_sessions`, `recovery_actions` |
| `0010_alternative_explanation_gate.sql` | 1 | `alternative_explanations` |
| `0011_chapter_cursor.sql` | 1 | `chapter_cursor` |
| `0012_unify_captures.sql` | 3 | `captures`, `exams`, `review_items` |
| `0013_maxims_cutover.sql` | 2 | `flashcards`, `flashcards_pre0013_backup` |
| `0015_responses_cutover.sql` | 2 | `tongue_reviews`, `tongue_reviews_pre0015_backup` |
| `0017_push_notifications.sql` | 3 | `notification_preferences`, `push_deliveries`, `push_subscriptions` |
| `0018_ratchet.sql` | 2 | `ratchet_events`, `ratchet_state` |
| `0019_block_statuses_and_causes.sql` | 1 | `block_miss_causes` |
| `0020_learning_sources_reading.sql` | 6 | `reading_events`, `reading_sessions`, `section_variants`, `source_editions`, `source_sections`, `sources` |
| `0021_mastery_rubric_calibration.sql` | 4 | `calibration_events`, `mastery`, `mastery_evidence`, `retrieval_attempts` |
| `0022_principles_graph.sql` | 7 | `concept_components`, `concepts`, `graph_edges`, `graph_nodes`, `hypotheses`, `principle_frames`, `principles` |
| `0024_rhetoric_track.sql` | 24 | `book_chapter_anchors`, `book_page_refs`, `canon_maps`, `commonplace_log`, `copia_renderings`, `copia_sessions`, `cycle_days`, `deployment_pivots`, `deployments`, `figure_detections`, `figure_own_examples`, `figures`, `inbound_cards`, `outbound_cards`, `recordings`, `response_builds`, `response_intents`, `rhetoric_attempts`, `rhetoric_card_reviews`, `rhetoric_cards`, `rhetoric_chapters`, `rhetoric_milestones`, `rhetoric_phases`, `specimens` |
| `0029_job_runs.sql` | 1 | `job_runs` |
| `0030_decision_lab.sql` | 6 | `decision_evidence`, `decision_options`, `decision_outcomes`, `decision_predictions`, `decision_reviews`, `decisions` |

Two consequences of this table are worth stating in words, because an operator reading down
the list will otherwise infer the opposite. First, the tables the original app was built on
are still standing: `maxims`, `responses`, `response_srs` and `intel_entries` were unified
into `captures`, not replaced by it, and the old tables and their rows are still there.
Nothing in Book 7 deleted the commander's history. Second, a single migration —
`0024_rhetoric_track.sql` — accounts for a quarter of the schema, which is why it is the one
with the longest pre-check list in the runbook.

---

## 5. The two cutovers, and the two tables that really were dropped

The phrase `DROP TABLE` occurs 37 times across eleven files in `migrations/`. **Two** of them are
statements SQLite executes. The other 35 sit inside a `-- ROLLBACK …:` comment at the foot of
a migration — the reversal a human would type, written down next to the thing that needs
reversing, and never parsed. Counting `DROP TABLE` occurrences to judge how destructive this
directory is therefore overstates it by an order of magnitude, which is why the guard on this
document strips comments before it counts anything, and asserts the split.

Both real drops are the last step of the same four-step pattern, used where a table's foreign
keys had to change and SQLite cannot alter a constraint in place:

1. Copy the table to `<name>_pre####_backup`, rows and all, and leave it there permanently.
2. Build `<name>_v2` with the new columns and the new references.
3. Insert every row from the original into `_v2`.
4. Drop the original and rename `_v2` into its place.

**`0013_maxims_cutover.sql`** does this to `flashcards`, whose rows referenced `maxims(id)` and
had to reference `captures(id)` after `0012` unified the stores. The drop is at
`0013_maxims_cutover.sql:46`. `flashcards_v2` is renamed to `flashcards`, and
`flashcards_pre0013_backup` still holds the pre-cutover rows.

**`0015_responses_cutover.sql`** does the same to `tongue_reviews`, whose rows referenced
`responses(id)` and had to reference `captures(id)`. The drop is at
`0015_responses_cutover.sql:65`. `tongue_reviews_v2` is renamed to `tongue_reviews`, and
`tongue_reviews_pre0015_backup` still holds the pre-cutover rows.

The two backup tables are counted in the 98 and are not scheduled for removal. They are the
only evidence that the cutovers preserved what they claimed to preserve, and no migration in
this repository will drop them.

---

## 6. Triggers and indexes

The directory installs 30 `CREATE TRIGGER` statements and 107 `CREATE INDEX` statements. 10
are `UNIQUE`. Every index says `IF NOT EXISTS` and every index name begins with `idx_`, which
is what makes a re-run of an index-only migration harmless.

Those 107 statements create **103** distinct indexes, and an operator who counts indexes in
the database will find 103, not 107. Four names are written twice:

| Index | Created by |
| --- | --- |
| `idx_cards_due` | `0001_initial_schema.sql`, then again by `0013_maxims_cutover.sql` |
| `idx_flashcards_user_due` | `0005_sessions_and_ownership.sql`, then again by `0013_maxims_cutover.sql` |
| `idx_treviews_date` | `0003_tongue.sql`, then again by `0015_responses_cutover.sql` |
| `idx_tongue_reviews_user_date` | `0005_sessions_and_ownership.sql`, then again by `0015_responses_cutover.sql` |

All four sit on `flashcards` or `tongue_reviews`. Dropping a table in SQLite drops its
indexes with it, so each cutover in §5 had to recreate the indexes belonging to the table it
had just rebuilt. Nothing was lost: every one of the 103 is present in the database the
directory builds, and `test/migrations-doc-completeness.test.ts` compares the parsed index
names against `sqlite_master` in both directions, so an index this document cannot account
for fails the build.

**Where the trigger guarantees are stated.** `SECURITY.md` §12 is the derived, guarded list of
which tables refuse `UPDATE` and `DELETE`, which refuse them only under a stated `WHEN`
condition, and which are append-only by application discipline rather than by schema. That
list is compared against `migrations/` in both directions by its own guard. It is not repeated
here — a second copy would be a second thing to drift, and §12 was corrected once already
because it was the one list in that document written as prose instead of derived.

---

## 7. How the migrations are tested

`test/setup.ts` is the harness, and it applies the real directory rather than a fixture. It
globs `migrations/*.sql`, sorts by filename, applies `0001` through `0004`, seeds twenty-three
populated legacy tables so that every later migration meets rows rather than empty tables,
records the row counts, then applies `0005` onward. It throws if the glob returns fewer than
thirty files, so a build in which the migrations did not load fails loudly instead of
running a suite against an empty database.

- `test/migration-clean-install.test.ts` proves a clean install and an upgrade reach the same
  schema. It snapshots tables, columns, types, nullability, defaults and trigger bodies from
  the upgraded database, drops everything, re-applies the whole directory to an empty
  database, and compares. It also asserts that no seeded row carries a `user_id`, so an
  ownership backfill cannot be credited to the seed.
- `test/migration-runbook-coverage.test.ts` proves every migration from `0005` onward has a
  runbook subsection with a reversal note, and that the runbook's stated range matches disk.
- `test/migrations-doc-completeness.test.ts` proves this document.
- `test/session-ownership.test.ts` and the per-migration tests, such as
  `test/migration-0005.test.ts` and `test/migration-0012.test.ts`, prove the behaviour each
  migration was written to enable.

The whole set runs under `npm run verify`, which is the only gate: build, both test projects,
`tsc --noEmit`, whitespace check, and a check that the committed bundle matches source.

---

## 8. Rollback

Reversal notes live in `OPERATIONS.md` §5 — one subsection per migration, each with the
pre-checks to run first, the apply command, and the manual reversal written out. They are not
duplicated here, and a copy should not be added: `test/migration-runbook-coverage.test.ts`
guards §5 and nothing would guard a copy in this file. `test/migrations-doc-completeness.test.ts`
asserts that this document keeps zero reversal notes of its own.

`0001` through `0004` have no reversal note, and that is adjudicated rather than outstanding.
They are the **inherited baseline** — the schema the application was already running on before
this work began, already applied to the production database, holding the commander's real
history. There is no state to reverse them to. Writing a note that dropped those tables would
destroy the data every later migration was built to preserve. `OPERATIONS.md` §5 states this
in its preamble, and its guard requires the exemption to be stated rather than silent.

---

## 9. Applying these to production

Applying these migrations to the production D1 database is an **operator action**. This
repository does not perform it, cannot perform it, and does not claim to have performed it.
Nothing in `package.json`, in CI, or in any test applies a migration or executes SQL against a
remote database: no script, no workflow step and no test contains `d1 migrations apply`,
`d1 execute` or `--remote`, and `test/migrations-doc-completeness.test.ts` sweeps all three
and fails if one appears. Two scripts do reach Cloudflare — `npm run deploy` and `npm run
preview` — and both require operator credentials this repository does not hold. Every test in
the
suite runs against a local SQLite database built from these files.

The operator's sequence is in `OPERATIONS.md` §5 and begins with a backup of production D1 —
also operator-owned. The commands are `npx wrangler d1 migrations list webapp-production
--remote` to see what is outstanding and `npx wrangler d1 migrations apply webapp-production
--remote` to apply it, run per migration with that migration's pre-checks in front of it.

---

## 10. What this document does not claim

- It does not claim the migrations have been applied to production. See §9.
- It does not claim any migration is reversible by running a file. There are no `down`
  migrations; reversal is a manual procedure a person carries out with the rows in view.
- It does not claim the directory is idempotent. Nine migrations error on a second
  application, and they are named in §2.
- It does not confuse statements with objects. It states 100 `CREATE INDEX` statements and 96
  distinct indexes, and names the four repeats. See §6.
- It does not state which tables are tamper-proof. `SECURITY.md` §12 does, with the conditions
  attached, and it is the only place that statement is derived and guarded.
- It does not describe the application's behaviour, only its schema. `ARCHITECTURE.md` covers
  the request path, and `PRIVACY.md` covers what each field is for and why it exists.
