# Curriculum Guide

What this application teaches, what it only stores, and what it does not have.

Books 9, 10 and 11 of the governing specification describe a curriculum. This repository is a
partial implementation of that description. This guide is written to make the difference visible
per clause, because the two are not the same and a reader who assumes they are will plan around
lessons that do not exist.

Every count, list and threshold below is derived from source by
`test/curriculum-doc-completeness.test.ts`, which fails if this document and the code disagree.
That includes the absences: each gap recorded here is derived from the same search that found it,
so implementing the missing thing breaks the test and forces this document to stop calling it
missing. An absence recorded by hand is the one claim that goes stale silently and in the
flattering direction.

Contents: §2 the surfaces. §3 the two lesson formats. §4–§7 the learning engine. §8–§9 the
corpus and its provenance. §10–§12 the canon. §13–§18 the Farnsworth programme. §19–§20 what is
built and what cannot be reached. §21 what this document does not claim.

## 2. The surfaces the curriculum is delivered through

Nine tabs collapse to five. The shipped shell registers exactly five: TODAY, LEARN, PRACTICE,
REVIEW, MORE. Each merges several older faces, and those faces survive as sub-views rather than
as tabs. Thirteen sub-views ship:

| Tab | Sub-views |
| --- | --- |
| TODAY | NOW, SCHEDULE |
| LEARN | CAMPAIGN, BOOKS, RHETORIC |
| PRACTICE | CARDS, MAXIMS, RESPONSE LAB |
| REVIEW | DEBRIEF, STATS |
| MORE | COUNCIL, INTEL, SETTINGS |

Curriculum lives in LEARN and PRACTICE. Reading, the campaign and the rhetoric track are taught
under LEARN; recall, maxims and the response drills are practised under PRACTICE. REVIEW holds
the debrief and the statistics, including calibration. INTEL and COUNCIL are not lessons.

Intel domains: sixteen collapse to six. The six are people, network, intimacy, money, tactics and
wisdom. The collapse map in code carries 17 legacy values rather than sixteen, because `other` is
one of the values that must land somewhere; the specification counts the sixteen real domains and
the code counts every string it has to accept. Where the two differ, this document follows the
code.

## 3. Two lesson formats, one of which is not implemented

The specification names two delivery formats, and they have different fates in this repository.

The **thirteen-slot rhetoric format is present**, as a schema rather than as prose: thirteen named
slots in `src/rhetoric.ts`, listed in §14 below, each with the requirement it must satisfy.

The **eleven-slot non-rhetoric format does not exist**. Book 9 specifies that non-rhetoric lessons
render through eleven slots — exact source, historical context, plain-language principle, causal
mechanism, naive misuse, defensible application, reversal and failure condition, defensive
recognition, practical drill, review question, and citation. No source file declares those slots
and no renderer consumes them. There is no `LESSON_SLOTS` constant, and the slot names Book 9 uses
appear nowhere in `src/`.

This gap is easy to misread in the flattering direction, because a reader who opens the rhetoric
track sees a fully-slotted lesson and concludes the format shipped. It did not. Rhetoric chapters
have a format; everything else — Sun Tzu, Machiavelli, Aurelius, Epictetus, Plato, Nietzsche,
Clausewitz — renders as a chapter of text with the mastery ladder attached to it, and the eleven
analytical slots that were supposed to surround that text are absent.

What exists instead, for non-rhetoric material: the measured reading record (§4), the six-level
mastery ladder with its nine-dimension rubric (§5), the calibration record (§6), the spaced return
(§7), and — for the material that has been seeded — the immune table and the principle graph
(§10, §11). Those carry the analytical load the eleven slots were meant to carry, but they are not
the same thing and they are not per-lesson.

## 4. Reading is measured, not clicked

A chapter counts as read when the application computes that it was, from what the reader did.
There is no "mark as read" button, and the client cannot assert the verdict: `src/reading.ts`
computes it server-side from the session record.

Three conditions must all hold:

- **Dwell.** At least 45 seconds, and for a long chapter more: the floor rises to however many
  seconds the words would take at the maximum plausible speed.
- **Traversal.** At least 90 percent of the chapter reached. Opening a chapter is not reading it.
- **Plausible speed.** Not faster than 450 words per minute. Above that, the traversal cannot have
  been reading.

The asymmetry is deliberate and worth stating plainly, because a reader who assumes symmetry will
think a paused tab costs him the unit: **unusually slow reading passes.** Only *too fast* fails. A
paused tab, a re-read and a long think are all honest, and the application treats them as honest.
The verdict names which condition failed rather than returning a bare refusal.

## 5. The mastery ladder and the rubric

Six levels, in order: `encountered`, `recalled`, `explained`, `applied`, `transferred`,
`integrated`. Each declares the evidence it requires, and the evidence is checked rather than
claimed — `encountered` needs a reading record, `recalled` needs a retrieval attempt with the
source closed, `explained` needs an explanation of 50 to 150 words in the operator's own language,
`transferred` needs a populated reference to a real decision, capture or deployment.

Grading uses a nine-dimension rubric, each dimension scored 0 to 3: `recall`, `explanation`,
`mechanism`, `application`, `reversal`, `defence`, `evidence`, `transfer`, `retention`. Zero is
absent; one is partial or vague; two is accurate and applicable; three is accurate, nuanced,
transferable, and aware of its own limits.

`integrated` requires a rubric mean of at least 2.5 with no dimension at zero. Both conditions,
not either: a mean of 2.6 carrying one zero is not integrated, because a zero means a dimension is
absent and an absent dimension cannot be averaged away.

**Self-scoring is never a gate.** This is enforced rather than promised: `admitEvidence` in
`src/mastery.ts` is the function that decides whether a piece of evidence counts, and it does not
read `self_score` at all. The operator's own confidence is recorded — §6 needs it — and it has no
influence on whether he advances.

Grading is adversarial where it can be. Cloze deletions are generated from source text for cheap
immediate testing, deterministically, so a learner cannot reroll until the deletions are easy.

## 6. Calibration on learning

Every review item, rhetoric attempt and exam records confidence before and after, and computes the
gap. That produces a second Brier score — knowledge calibration — reported beside the decision
Brier that the debrief already carries. Overconfidence is reported as a named pattern rather than
as a number alone.

It **never costs points.** Calibration is diagnostic by design: nothing in the mastery path
subtracts for a bad Brier, and nothing gates on a good one. This matters more than it looks,
because a calibration measure that carries a penalty teaches the operator to under-report
confidence, which destroys the only signal it was built to collect.

High confidence is never treated as evidence of mastery. Familiarity produces fluency illusions,
and only retrieval and application refute them.

## 7. Spaced return, and the scheduler that is currently split

**R0 comes first.** R0 is same-session, no-notes retrieval, and no lesson closes without it. This
is enforced: `src/routes/learn.ts` refuses to close a non-exam unit unless a same-session retrieval
attempt with the source closed exists for it, and the refusal names what is missing rather than
returning a bare "no".

Beyond R0 the specification asks for two schedulers: FSRS for the general queue, and the fixed
Farnsworth ladder of 1, 3, 7, 16 and 35 days for the rhetoric track.

**What ships is split, and the split is worth recording rather than smoothing over.** The response
queue is FSRS: `src/routes/tongue.ts` calls `fsrsReview`. The maxim queue is not — `src/routes/learn.ts`
still runs SM-2 over `flashcards.interval_days` and `flashcards.ease`. So one half of the general
queue is scheduled by the algorithm the specification names and the other half by its predecessor.

There is a second-order consequence, and it is the reason this is recorded here rather than filed
as a to-do: the Commander's File emits the phrase `FSRS general queue` from
`src/commanders-file.ts`. For the response queue that is true. For the maxim queue it is ahead of
the code. The emitted claim is therefore stronger than the implementation for one of the two
queues, and a reader comparing the two will find the discrepancy — which is why it is written down
here instead of being discovered.

The rhetoric ladder is separate by design and is described in §16.
## 8. The book corpus, and the denominator that is checked

Eleven works ship as JSON under `public/static/books/`, one file per work, each carrying `id`,
`title`, `author`, `translator`, `note` and a `chapters` array of `{title, paras}`:

| File | Work | Author | Chapters |
| --- | --- | --- | --- |
| `apology.json` | Apology (The Trial of Socrates) | Plato | 4 |
| `art_of_war.json` | The Art of War | Sun Tzu | 13 |
| `beyond_good_evil.json` | Beyond Good and Evil | Friedrich Nietzsche | 10 |
| `crito.json` | Crito | Plato | 3 |
| `discourses.json` | Discourses on the First Decade of Titus Livius | Machiavelli | 141 |
| `enchiridion.json` | The Enchiridion | Epictetus | 6 |
| `meditations.json` | Meditations | Marcus Aurelius | 12 |
| `on_war.json` | On War (Book I selections) | Carl von Clausewitz | 12 |
| `republic.json` | The Republic (Books I-IV) | Plato | 4 |
| `the_prince.json` | The Prince | Machiavelli | 26 |
| `zarathustra.json` | Thus Spake Zarathustra (Prologue & Part I) | Friedrich Nietzsche | 25 |

Four of the eleven titles say in the title itself that they are partial — `on_war.json` is Book I
selections, `republic.json` is Books I–IV, `zarathustra.json` is the Prologue and Part I, and
`apology.json` is the trial rather than the collected dialogues. A partial work labelled as
complete would be the same defect as a wrong chapter count, one step earlier.

**The counts above are a denominator, and the denominator is the thing that used to be wrong.**
`src/books.ts` carries the post-mortem: completion was once decided by `HAVING c >= 12`, a single
literal standing in for all eleven works. It was correct for exactly two of them. Twelve chapters
of Discourses awarded a completed book with a hundred and twenty-nine chapters unread, and the five
works shorter than twelve could never be reported finished no matter how completely they were read.
Congratulating the operator for a book he has not read and refusing to acknowledge five he has are
the same defect.

What prevents its return is not the comment. `BOOK_CHAPTER_COUNTS` in `src/books.ts` records the
eleven counts, and `test/book-completion.test.ts` derives them from the shipped JSON and fails in
both directions if the map and the shelf disagree. The Worker cannot read
`public/static/books/*.json` at runtime, which is why the map exists at all; adding a twelfth work
breaks the build until its chapter count is written down. As of this document the declared counts
and the shipped arrays agree for all eleven works, with zero mismatches, and a `book_id` with no
recorded count is never reported complete — an unknown denominator produces silence rather than a
guess.

`book_progress` carries `UNIQUE(book_id, chapter_idx)`, so a book's done-count cannot exceed its
chapter count by duplicate rows, and reaching the total is genuine rather than coincidental.

## 9. Provenance: the tables Book 10.5 asks for, and the two that are empty

Book 10.5 requires that every source record its full provenance, that partial works and
public-domain translations be labelled as exactly that, and that where editions disagree on wording
the disagreement be stored rather than silently resolved. `migrations/0020_learning_sources_reading.sql`
creates the four tables that would hold it: `sources`, `source_editions`, `source_sections` and
`section_variants`.

**Two rows exist, and three of the four tables are written by nothing.** `sources` is seeded with
exactly 2 rows, and they are not the eleven shipped works — they are the two Farnsworth
bibliographic records from `migrations/0025_rhetoric_seed.sql`, present so the copyright position of
the paper programme is recorded in the database rather than assumed. Nothing writes
`source_editions`, `source_sections` or `section_variants`: no migration inserts into them, and no
route does either. So the eleven works on the shelf have no provenance row, no edition record and no
paragraph-level anchor, and Book 10.5 is unmet rather than partially met.

The consequence a reader acts on is in `src/routes/mastery.ts`, which SELECTs `text` and
`chapter_idx`/`paragraph_idx` `FROM source_sections` to generate cloze deletions. **Cloze generation
reads a table that has no rows.** The deterministic, adversarial, cheap half of retrieval testing
described in §5 therefore cannot run against any shipped chapter — not because the generator is
broken, but because the corpus was never ingested into the schema the generator reads. The reading
record in §4 works from the JSON directly and is unaffected.

There is also no Unicode-corruption sweep. Book 10.5 orders one; `src/` contains no mojibake or
`virtù`-class check of any kind, so **no automated sweep exists.** The shipped text happens to be
clean — a byte-level search of all eleven files for the usual double-encoding signatures finds
nothing — but that is a fact about the current files, not a guarantee about the next ones. A fact
and a check are different things, and this document has one of them.

## 10. Sun Tzu: the five factors, the struck framing, and the immune table

Book 10.6 is the one part of the canon that is modelled as data rather than as chapters of prose,
and it is the part where the specification is least willing to be paraphrased.

**Six concepts are seeded**, each with an original term, a translation *range* rather than a single
gloss, a historical meaning, a modern interpretation, the misuse it is usually flattened into, a
defensive lesson and a reversal condition: `sunzi_dao` (道, the Way), `sunzi_tian` (天, Heaven),
`sunzi_di` (地, Ground), `sunzi_jiang` (將, the Commander), `sunzi_fa` (法, Method), and
`sunzi_ch2_cost_of_delay` (作戰, the Chapter II correction). The last is not a factor; it is a
distortion recorded as a concept so the strike is visible. The seed data had flattened Chapter II
into "a quick imperfect action always beats a perfect slow one", and the chapter is about the
economics of a contest *already begun*, which argues for preparation before commitment rather than
for haste.

**將 is scored on the lowest of its five components, not their mean.** All 5 are seeded rows —
智 Wisdom, 信 A word that can be banked, 仁 Benevolence, 勇 Courage, 嚴 Strictness — and the rule is
`lowestOfComponents` in `src/principles.ts`, which returns the weakest virtue by name because the
weakest one is the only actionable fact. An average would hide precisely what the text warns about:
removing one virtue turns the others into vices, so courage without wisdom is recklessness and
strictness without benevolence is cruelty.

**The outward framing is struck.** Book 10.6: any framing that redirects 將 outward into an inventory
of other people's emotional fault lines is a corruption of the text. This is enforced rather than
promised — `jiangFramingIsStruck` in `src/principles.ts` pattern-checks curriculum and
model-authored framings before they are shown as teaching, and refusing returns the reason: *將 is
the commander, and the commander is himself.* It is a guard on teaching, not a filter on the
operator's own words; he may write what he likes in his own capture.

**The immune table.** 14 principle rows are seeded, each carrying seven columns rather than a
summary: `naive_reading`, `master_reading`, `detection_tells`, `inversion_trap`,
`less_obvious_application`, `stop_test` and `cost_of_naive`. The shape is enforced in
`src/principles.ts` so that no caller can return the master reading alone — returning it without the
naive reading and the cost of staying naive is the exact failure the table exists to prevent, and it
is the failure a shortcut would produce. Six of the fourteen also carry a `principle_frames` row: the
ruler-state context, the civilian analogy, and — the column that matters — where the analogy breaks.
A private person has no subjects, and managing perception inside the circle is the betrayal rather
than the tactic.

## 11. The principle graph

Book 10.10 asks for a cross-book graph rather than a shelf. 34 nodes are seeded as themes —
preparation, legitimacy, timing, terrain, logistics, information, reputation, dependence and the
rest, with ethos, logos and pathos carrying a strong use and a corrupt use side by side — and 30
edges connect principles, concepts, hypotheses and passages to them.

The schema permits seven edge kinds, by CHECK rather than by convention: `anchors`, `supports`,
`related`, `reversal`, `contradicts`, `applies_in` and `detects`.

**4 contradiction edges are seeded, and each one carries the note that says what selects between
them.** That note is the point of the section: an edge saying two principles disagree is trivia, and
an edge saying *what decides which applies* is a lesson. Speed against preparation is selected by
whether the contest has already begun. Controlled revelation against appearance-as-terrain is
selected by which audience — to the wide audience disclosure is a choice, inside the circle the word
must be unbreakable. Subduing without fighting against speed is selected by whether a position
exists that makes the contest unnecessary; if it does not, delay must not be dressed as strategy.
The fourth runs from the single Greene hypothesis to `appearance_is_terrain`, and its note resolves
itself: the principle wins, always, because the hypothesis is unread and defensive-only.

Two edges are `anchors` edges into `section` targets — `art_of_war:1:3` and `art_of_war:2:1` — which
are the paragraph-level anchors Book 10.6 asks for. Those anchors point into `source_sections`, and
per §9 that table has no rows, so the anchor is a well-formed reference to text the database does
not hold.

## 12. Greene, and the two strikes on the canon

**Greene enters as a hypothesis and nothing else.** 1 hypothesis row is seeded —
`greene_never_outshine_master` — with `read_status` UNREAD, and it carries a claim, a mechanism, its
assumptions, a possible application marked as recognition only, a reversal, a failure condition,
defensive signs, a proportional defence, an evidence-quality note that says plainly *anecdotal and
historical illustration only, not a scientific finding*, and its long-term consequence.

The guarantee behind that is in the schema, not in the prose: `hypotheses.examinable` is
`INTEGER NOT NULL DEFAULT 0 CHECK (examinable = 0)` and `defensive_only` is
`CHECK (defensive_only = 1)`. A row that tried to become examinable would be rejected by the
database. This is the difference between a document saying Greene cannot be tested on and the
application being unable to test on him.

**The Discourses strike is recorded, not resolved.** R1 removed *Discourses on Livy* from the active
curriculum, leaving the Farnsworth programme as the sole active front until Day 204. The work is
still shipped and still readable — 141 chapters, per §8 — and that is intentional: reading is not
forbidden, it is simply not the active track. But `BOOKS_META` in `src/routes/intel-library.ts`
still assigns `discourses` the phase code `P2B`, which is an active-curriculum phase code. The book
is struck from the active curriculum and labelled as part of it in the same repository.

This is written here rather than corrected because the correction is a curriculum decision with a
visible consequence in the library view, and this document's job is to make the discrepancy findable
rather than to make it disappear. `test/curriculum-doc-completeness.test.ts` derives the phase code
from that line, so the day it is corrected this paragraph fails and must be rewritten.

## 13. The Farnsworth programme: the syllabus as seeded data

Book 11 is the one part of the curriculum that ships as a complete, fixed syllabus rather than as a
capability. It runs from **Day 53 to Day 204** and, per R1, it is the sole active front for that whole
span.

What is seeded, all of it in `migrations/0025_rhetoric_seed.sql` unless noted:

| Thing | Rows |
| --- | --- |
| Phases | 6 |
| Chapters | 19 |
| Milestones (the cycles that are not chapters) | 5 |
| Figure records (`migrations/0026_figure_records.sql`) | 22 |
| Specimens (`migrations/0027_response_lab_seed.sql`) | 40 |
| Confirmed page anchors | 8 |

The six phases are P0 Calibration (Day 53, one day), P1 Repetition — the ear (54–97), P2 Structure —
the mind (98–141), P3 Drama — the listener (142–192), P4 The Consolidation (193–197) and P5 Transfer
to Speech (198–204). Each carries its architecture as prose in the row, because the ordering is an
argument and not a convenience: sound comes first because it needs no permission from the mind;
structure works by violating an order the listener has already predicted, so it needs a pattern to
violate; the dramatic devices are silences and gaps, and a gap only registers against an established
pattern. P4 and P5 patch two gaps in the book itself — it teaches figures one at a time and never
teaches combination, and it teaches written prose through orators without covering negotiation,
hostile exchange, timing or room-reading.

The nineteen chapters map one figure each, in fixed seven-day windows: `epizeuxis` 54–60,
`anaphora` 61–67, `epistrophe` 68–74, `symploce` 75–81, `anadiplosis` 82–88, `polyptoton` 89–95,
`isocolon` 98–104, `chiasmus` 105–111, `anastrophe` 112–118, `polysyndeton` 119–125, `asyndeton`
126–132, `ellipsis` 133–139, `praeteritio` 142–148, `aposiopesis` 149–155, `metanoia` 156–162,
`litotes` 163–169, `erotema` 170–176, `hypophora` 177–183, `prolepsis` 184–190.

**Twenty-two figure records against nineteen chapters.** The extra three — `epimone`,
`conduplicatio` and `diacope` — have no chapter of their own. They are the hidden layer of Chapter 1,
which is titled with an "etc." that conceals the other simple-repetition devices; the record exists so
the concealed device can be named, and Book 11.6's fourth slot exists to make that layer explicit.
A reader looking for a `diacope` week will not find one, and that is correct.

The five milestones fill the days between chapters — Consolidation A at 96–97, B at 140–141, C at
191–192, then the Phase 4 consolidation at 193–197 and the Phase 5 transfer at 198–204 — so that a
day between chapters cannot read as an empty day.

**The page anchors are the honesty exhibit of this migration.** The operator captured both Farnsworth
books page by page as screenshots, and the capture sequence was reconstructed from timestamps and
then checked by reading pages. Only anchors whose page was actually read are recorded: 8 of them, of
which two are marked as a chapter opening and the rest confirm a span rather than a first page. The
other seventeen chapter openings are **absent rather than estimated**, and the application reports
the span between two anchors as unconfirmed. Fabricating them would have been one `INSERT` away.

## 14. The seven-day cycle and the thirteen-slot chapter

Each chapter runs a fixed seven-day cycle, seeded as data in `src/rhetoric.ts` with a job and a
constraint per day: `install`, `tier_and_copy`, `mouth`, `skeleton`, `copia`, `live_fire`,
`consolidation`.

The constraints are the content, not decoration. Day 1 produces **nothing** — a Day 1 that asks for
output is wrong. Day 2 is by hand, because handwriting slows him to the speed of the pattern, and the
application logs that it happened and when, never the text. Day 3 is aloud, because these are
auditory technologies and silent reading teaches recognition only. Day 4 refills the stripped
structure with his own life, because refilling it with the book's content makes it a copying
exercise. Day 5 counts bad renderings, because volume is the trainer. Day 6 **requires** a failure,
not merely tolerates one: the failure teaches the boundary, and the boundary is what separates a
stylist from a man who sounds like he swallowed a thesaurus.

A chapter is delivered through thirteen slots, and `missingChapterSlots` in `src/rhetoric.ts` means a
chapter cannot ship with one quietly missing: `orientation`, `mechanism`, `notation_and_variants`,
`hidden_layer`, `tiered_specimen_bank`, `skeleton_set`, `failure_modes`, `copia_drill`,
`live_fire_script`, `conversational_conversion`, `sayings`, `one_line_summary`,
`next_figure_preview`.

This is the thirteen-slot format §3 refers to, and it is the only lesson format this repository
implements. Alongside it, the conversational-job index pairs each job with the figures that do it and
— in the same record — the misuse boundary, because the same device that pre-empts an honest
objection can bury a real one and the operator must be able to see both faces at once.

Review is **10 minutes daily**, non-negotiable, described in source as the difference between
finishing the book and owning it.

## 15. Three tiers, and the allocation the book rejects

Specimens are sorted into three tiers, each with a per-figure target and a programme total:

| Tier | Name | Per figure | Total | Treatment |
| --- | --- | --- | --- | --- |
| 1 | Own | 6-8 | 150 | Held verbatim and permanently — the arsenal that comes out under pressure. |
| 2 | Skeleton | about 20 | 400 | Structure memorised, content replaced — the generative engine. |
| 3 | Ear | the remainder | 500 | Read aloud once, marked, revisited only in review. |

**Memorising 1000 specimens verbatim was considered and rejected** as a wrong allocation of effort,
and Book 11.4 adds that the application must not silently reintroduce it. That is not left to
goodwill: `REJECTED_VERBATIM_ALLOCATION` records the rejected number and
`verbatimAllocationIsRejected` tests a proposed verbatim bank against it. Only Tier 1 is held
verbatim, so only Tier 1 counts.

**Tier 1 is seeded empty, deliberately.** Of the 40 seeded specimens, none is Tier 1. Tier 1 is his:
six to eight per figure, chosen by him, copied by hand on Day 2. Seeding it would hand him someone
else's arsenal, and would be the rejected allocation reintroduced quietly, one migration at a time.
The seeded 40 are Tier 2 and Tier 3 material — structure to strip, and text to soak the ear in.

## 16. The ladder is fixed, and it is not FSRS

Rhetoric cards climb five rungs and stop: **1, 3, 7, 16 and 35 days.**

This is a deliberate divergence from the rest of the application, which schedules with FSRS (§7).
FSRS would compute its own intervals from stability and difficulty and silently override the book,
which is why the rhetoric cards have their own tables instead of joining `review_items` — the
divergence is structural, not a setting. `src/routes/rhetoric.ts` does not call the FSRS scheduler at
all.

**There is no sixth rung.** `nextLadderInterval` stays on the last one once 35 days is reached,
because Book 11.5 names five intervals and no sixth, and extrapolating one would be the application
inventing curriculum. A reader who assumes the ladder keeps doubling will expect a schedule the code
never produces.

Three card types are generated: `name_to_definition`, `skeleton_to_example` and
`situation_to_figure`. The middle one is answered with a fresh example generated on the spot, which
is why it cannot be graded by string match.

## 17. What the application must not absorb, and the metric that inverts

Book 11.8 draws a boundary around the application itself, and `MUST_NOT_ABSORB` in `src/rhetoric.ts`
holds it as four named rules: `commonplace_book`, `deployment_log`, `recordings`, `law_22`.

The commonplace book stays handwritten; the application logs that Tier 1 was copied and when, and
never becomes a substitute surface for it. Recordings are files the app references, not media it
manages. And Law 22 is the test the other three are instances of: **if a feature would make the paper
obsolete without making the skill better, it is a defect.**

The deployment log is the one thing that may live in the application, and it may hold exactly four
columns, enforced by `src/routes/rhetoric.ts` rather than by convention: `occurred_on`,
`figure_slug`, `context`, `what_happened`. A fifth column is how a deployment log becomes a
commonplace book, so the route rejects one.

Six metrics measure the track, all falsifiable: `identification_accuracy`,
`construction_accuracy`, `copia_volume`, `deployment_outcomes`, `noticed_ratio`,
`recording_comparison`. Two carry notes that reverse a natural reading — bad renderings count toward
copia volume, and a cycle with no failure logged is an incomplete cycle rather than a perfect one.

**One metric inverts, and it is the one a progress view would render backwards.** Being noticed is
**the failure condition**: `noticed_ratio` is marked `better: 'lower'` in source, so a rising number
is a worsening result. `metricIsInverted` exists so that no view can render it as progress by
accident. The field default behind it is one figure, used once, never announced — if they walk away
thinking the conclusion was their own, he was correct; if they walk away remembering his style, he was
too loud.

## 18. How the track is measured

Measurement is scheduled, not continuous, and the schedule is part of the method.

The **P0 baseline** on Day 53 is a 3-minute recording across three segments — explaining, arguing,
narrating — plus a 200-word written baseline. Neither is listened back to or re-read at the time;
`BASELINE_NEVER_LISTENED_BACK` records that as data rather than as advice. Recordings then repeat
every 30 days.

**Re-listens happen at Day 143 and Day 204, and only then.** Comparing against the baseline more
often would turn a slow structural change into a daily verdict on himself, which is the failure this
schedule exists to avoid.

The same day the baseline is made, the nineteen chapters are self-audited with three marks: **U** for
already done unconsciously, **R** for recognised in others but not producible, and **N** for new. The
audit is what makes the first pass through the syllabus something other than uniform.

## 19. The campaign tables are empty on a clean install

This is the largest gap in the document, and it is the one a reader must plan around rather than
merely note.

`migrations/0001_initial_schema.sql` creates `phases`, `units` and `laws` — the tables the campaign,
the progress lock and the law ledger all read from. **No migration and no route seeds any of them.**
There is no `INSERT INTO phases`, no `INSERT INTO units`, no `INSERT INTO laws` anywhere in
`migrations/` or in `src/`.

The consequence is exact. `ensureUnlocks` in `src/curriculum.ts` seeds a `unit_progress` row per unit,
then walks `SELECT * FROM phases ORDER BY sort_order` and, within each phase, promotes the first
incomplete unit to active. On a clean install that walk iterates zero phases and zero units, so it
promotes nothing and reports nothing missing — it does not fail, which is what makes the absence hard
to notice. **A clean install therefore has no campaign at all:** no first unit, no unit to advance to,
and a progress lock with nothing to lock.

The rows that exist during development come from `test/setup.ts`, which seeds a legacy schema for the
suite. That is a fixture, not curriculum, and a fixture is the easiest thing in a repository to
mistake for shipped data — the tests pass over a populated campaign that no install ever receives.

The Farnsworth track in §13–§18 is unaffected: it is seeded, it does not depend on `phases`/`units`,
and it is the one curriculum front that a clean install actually receives. Book reading in §8 is also
unaffected. What is missing is the campaign that the units-and-phases model was built to deliver.

## 20. What is built but cannot be reached from the shipped client

The server registers **137** `/api` routes. The committed client bundle never references **72** of
them.

The rule those numbers come from matters as much as the numbers, because four different rules give
four different answers. Each route is reduced to its **static path prefix** — every segment up to the
first `:param` — and that prefix is searched for in `public/static/bundle.js`. A bare-word search
finds unrelated identifiers: `cursor`, `tone` and `state` all appear in the bundle as ordinary
variable names, which reports routes as reachable that nothing calls.

Of the 72, **11** are the `/api/agent/*` bridge. Those are not meant to be called by the browser and
are not dead code; they are the operator-agent surface. That leaves **61** routes that are
client-facing by design and unreferenced in fact, across thirteen modules:

| Module | Unreachable |
| --- | --- |
| `src/routes/rhetoric.ts` | 16 |
| `src/routes/rhetoric-lab.ts` | 12 |
| `src/routes/mastery.ts` | 7 |
| `src/routes/principles.ts` | 7 |
| `src/routes/push.ts` | 4 |
| `src/routes/reading.ts` | 4 |
| `src/routes/ratchet.ts` | 3 |
| `src/routes/cursor.ts` | 2 |
| `src/routes/economy.ts` | 2 |
| `src/routes/auth.ts` | 1 |
| `src/routes/day.ts` | 1 |
| `src/routes/intel-library.ts` | 1 |
| `src/routes/learn.ts` | 1 |

**What that arithmetic means for the curriculum, specifically.** Two gates described earlier in this
document are enforced server-side, and the surfaces that satisfy them are among the unreachable. §4's
measured reading requires a session the server judges, and every `/api/reading/*` route — `open`,
`progress`, `close`, and the per-chapter read — is unreferenced by the bundle, so no client call
records the traversal that `src/routes/learn.ts` then demands with its `plausible=1` check. §7's R0
requires a same-session retrieval with the source closed, and `POST /api/retrieval` is unreferenced
too.

So: **a non-exam unit cannot be advanced from the shipped client.** Both gates are correct, both
refuse for the right reason, and neither has a reachable way to be satisfied. The engine in §4–§7 is
real, tested and unreachable — which is a different and more recoverable problem than a missing
engine, and it is why this section belongs in the curriculum guide rather than only in
ARCHITECTURE.md.

The rhetoric figures, the commonplace log, the copia drill, the deployment log, the recordings, the
immune table, the principle graph, the concept scorer and the response lab are in the same position:
seeded, routed, tested, and not wired to a screen.

## 21. What this document does not claim

This guide **makes no claim** beyond what is in the repository, and several claims are worth denying
explicitly because a curriculum guide invites all of them.

It **contains no lesson content.** It is a map of formats, gates, schedules and seeded rows — not the
lessons themselves. Reading it is not a substitute for the material, and nothing in it teaches a
figure or a principle.

Books 9, 10 and 11 of `MASTERPROMPT.md` are a **specification**, and this repository is a partial
implementation of it. Where the two differ, this document follows the code, and §3, §9, §12 and §19
exist precisely because the difference is real. A clause described here as present is present; a
clause described as absent is absent as of this commit, and
`test/curriculum-doc-completeness.test.ts` fails if either changes.

**No text from Ward Farnsworth's books is reproduced.** The application holds the structure of the
nineteen chapters, figure records written from standard classical-rhetoric reference knowledge, short
specimens that are public domain by their own author and date, and page references into the operator's
own capture of his own copy. Farnsworth's selection and commentary are referenced, never reproduced —
and the two `sources` rows say so in the database, not only here.

**Nothing here claims anything about what the operator has actually studied.** No count in this
document is a record of work done; every one is a count of what the repository contains. The
application has not been taught to anyone, and this guide reports capability rather than history.

**Nothing described here has been deployed.** Every figure is derived from source in this repository.
Readiness in this document means repository-side readiness — source, migrations, tests, documentation
— and no statement about a running instance is made or implied.

And the boundary that Book 11.8 puts around the whole programme applies to this document too: the
handwritten commonplace book, the paper syllabus and the physical practice are not replaced by
anything described here. If a feature would make the paper obsolete without making the skill better,
it is a defect — and a guide that reads as if the application were the curriculum would be the first
such feature.

