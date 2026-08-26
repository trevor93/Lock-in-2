# PRIVACY

This document exists to answer one question precisely: **what leaves the database, where does
it go, and why is each field the minimum needed?** Book 17's Definition of Done requires a
data-minimisation justification for every field the Commander's File emits, and one rule
governs the whole document — *make no claim that is not technically guaranteed*. Where a
protection is real, it is named with the code that provides it. Where a protection is absent,
it says so instead of describing an intention.

The field tables in section 3 are not maintained by hand. `test/privacy-doc-completeness.test.ts`
derives the emitted field list from `src/commanders-file.ts` and fails the suite if a field is
emitted without a justified row here, or if a row here describes a field the code no longer
emits. That is deliberate: this repository's recurring defect is a hand-written list that stops
being true and says nothing, and a privacy document is the worst possible place for one.

---

## 1. Who the subject is

One person. This is a single-user, operator-owned application: the commander is the only
account holder, the only data subject, and the owner of the deployment. There is no
multi-tenancy, no analytics vendor, no advertising identifier, and no third-party session
tracking. Every row in every table is his own record of his own conduct.

Two consequences follow, and both cut against comfortable assumptions:

- **He is not protected from himself by obscurity.** R8 rejects prompt secrecy outright — the
  full prompt is readable on request, because hiding his own device from himself is theatre.
  The same logic applies here: this document does not soften what is collected.
- **The most sensitive data in the system is voluntary free text he wrote.** Debriefs, drill
  reports, and life intel are his own words. No inference engine invents a psychological
  profile; the sensitivity comes from candour, not from profiling.

---

## 2. Every place the record leaves the database

There are exactly three, and only one crosses a third-party boundary.

### 2.1 To a third-party model provider — the only external egress

`POST /api/hermes/message` and `POST /api/hermes/council` (`src/routes/hermes.ts`) build the
Commander's File and send it to an OpenAI-compatible chat-completions endpoint. **This is a
genuine disclosure of personal data to an external processor, and it is the most important
sentence in this document.** His debriefs, honesty flags, drill reports, and life intel are
transmitted verbatim, subject to the truncations recorded in section 3.

What is technically guaranteed about that egress:

| Guarantee | Provided by |
| --- | --- |
| The destination must be HTTPS | `modelBaseURL` rejects any non-`https:` protocol |
| The destination must be on an explicit allowlist | `modelBaseURL` requires an exact match in `OPENAI_ALLOWED_BASE_URLS`; an unlisted URL returns `null` and the call does not happen |
| The model is pinned, not floating | `PINNED_MODEL = 'gpt-5-mini-2025-08-07'` |
| The payload is size-bounded | `MODEL_TOTAL_INPUT_CHARS`; an oversized input returns `413` and is not sent |
| The briefing is fenced as untrusted input | `fencedModelData` wraps it in `<UNTRUSTED_RETRIEVED_SOURCE_CONTENT>` so its contents cannot be read as instructions |
| Without a configured key, nothing is sent | Missing `OPENAI_API_KEY` returns `503 MODEL SERVICE OFFLINE` |

What is **not** guaranteed, stated plainly: this repository cannot control what the provider
does with a payload after it arrives — retention, human review, or training use are governed by
the contract with whoever operates the allowlisted endpoint, not by any code here. Choosing
that endpoint is the operator's decision and its privacy terms are the operator's to read. The
allowlist exists so the choice is explicit and cannot drift silently.

### 2.2 To the authenticated agent bridge

`POST /api/agent/v1/briefing` returns the Commander's File in its JSON response to a caller
holding a valid `X-Agent-Token`. This stays inside the operator's own tooling, but it is a full
copy of the record, so whatever holds that token holds the record. Token handling is covered in
`SECURITY.md`.

### 2.3 To the authenticated browser session

`GET /api/continuity-brief` returns the Session Continuity Brief as `text/plain` to the logged-in
session. It is deliberately the leanest of the three — see section 3.2.

### 2.4 What protects all three in transit and at the edge

- **Private responses are never cached.** `src/index.tsx` sets `Cache-Control: no-store` on every
  request whose path matches `privatePath` — `/api/`, `/internal/`, and `/calendar.ics` — both
  before and after the handler runs.
- **A browser origin must match.** A request carrying an `Origin` header that is not this
  deployment's own origin or an entry in `ALLOWED_ORIGINS` is rejected `403 ORIGIN NOT ALLOWED`.
  Wildcard CORS does not exist in this codebase.
- **No referrer leaks the path.** `Referrer-Policy: no-referrer` on every response.
- **Devices are denied by default.** `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
  Recorded honestly: Book 14's Arena needs the microphone, so building it will require relaxing
  exactly one of those three, and that change must be argued for in this document when it happens
  rather than slipped in.
- **Push notifications carry no payload.** The service worker's `push` handler receives an empty
  event and then asks this origin what is due (`/api/next-alarm`). Nothing about his day travels
  through a third-party push service — if the fetch fails, the worker shows a neutral prompt.

---

## 3. The fields, and why each one is the minimum

Read the tables as the answer to "why is this field here at all?" A row whose justification
could not be written would be a field to delete, not a field to explain.

### 3.1 The Commander's File — `hermesBriefing`, `src/commanders-file.ts`

This is the briefing injected into model calls. It is the largest disclosure in the system.

| Value | Source | What it reveals | Why it is emitted, and why this is the minimum |
| --- | --- | --- | --- |
| `date` | server clock | which day is being briefed | Every other field is day-scoped; without it the model cannot tell today's adherence from a stale figure. A date alone reveals nothing personal. |
| `streak` | `computeStreak` | consecutive victory days | One integer. The register in R2 must be calm and exact rather than congratulatory, which requires knowing whether a run exists before commenting on it. |
| `pts.t` | `SUM(points_ledger.points)` | lifetime points total | One integer, the economy's state. Emitted as a sum, never as the ledger — individual award rows would reveal his day-by-day conduct for no added benefit. |
| `adh.pct` | `dayAdherence(blocks)` | today's adherence percentage | The single most decision-relevant number in the briefing: orders for the rest of the day depend on how much of it is already spent. |
| `adh.done` | `dayAdherence(blocks)` | blocks completed today | A percentage alone cannot distinguish 1-of-2 from 5-of-10; the model must not overstate a thin day. |
| `adh.total` | `dayAdherence(blocks)` | blocks scheduled today | The denominator for the above. Emitted as a count — the block titles and times are not in the briefing. |
| `cursor.book` | `readChapterCursor` | which book is the active front | R1 fixes Farnsworth as the sole active front; R9 requires every figure selection to read the cursor rather than default. Curriculum position, not personal data. |
| `cursor.part` | `readChapterCursor` | which part of that book | Same clause. Bounds which figures are legitimately available. |
| `cursor.chapter` | `readChapterCursor` | the chapter number | R9's mechanism: no default starter figure is permitted, so the chapter must travel with the request. |
| `cursor.figure` | `readChapterCursor` | the figure being drilled | The model must use one figure, once, unannounced. It cannot comply without knowing which. |
| `cursor.cycle_day` | `readChapterCursor` | day 1-7 of the drill cycle | Determines what stage of drilling is appropriate; a single small integer. |
| `d.log_date` | `debriefs` (last 7) | which day each debrief covers | R2 forbids inventing patterns; dating his words is what lets a claim be checked against a day rather than asserted. |
| `d.wins` | `debriefs` (last 7) | his own account of what went well | His words, and the evidence base for any commendation. A summary generated here instead would be this application inventing his history. |
| `d.breaks` | `debriefs` (last 7) | his own account of what he broke | The honesty engine's core input. Omitting it would leave only system-detected failures, which is the flattering half of the record. |
| `d.tomorrow_targets` | `debriefs` (last 7) | what he committed to next | Today's orders are worthless if they contradict a commitment he already made. |
| `d.strategy_insight` | `debriefs` (last 7) | his own strategic conclusions | Prevents the model re-teaching a lesson he has already drawn, which is the most common way this kind of tool becomes noise. |
| `d.sleep_hours` | `debriefs` (last 7) | hours slept, self-reported | **Health-adjacent, and narrowly scoped on purpose.** Used only as load evidence for the ratchet: the ratchet governs how much can be asked of him, and asking a full day of a two-hour night is the failure mode it exists to prevent. Not used for any inference beyond load. |
| `d.mood` | `debriefs` (last 7) | a 1-5 self-rating | **Health-adjacent, same bound as sleep.** A single ordinal with no free text; the ratchet needs a load signal and this is the smallest one that exists. No affective profile is built or stored. |
| `f.flag_date` | `honesty_flags` (last 10) | when a flag was raised | A flag with no date cannot be told from a current one, which would let old failures be re-litigated as though fresh. |
| `f.severity` | `honesty_flags` (last 10) | how serious the flag was | Proportion. Without it every flag reads as equally grave, which is the shame register R2 bans. |
| `f.message` | `honesty_flags` (last 10) | what the system recorded he did | The flag itself. A count of flags without content cannot be acted on or contested. Capped at ten. |
| `l.title` | `laws` via `law_checks` | which laws he breaks most | Top three only, so the briefing names the live pattern rather than the whole history. |
| `l.n` | `COUNT(law_checks)` | how many times, per law | A bare count. The individual breach records stay in the database — the pattern is the useful part and the incidents are not. |
| `u.code` | `phases` / `units` | curriculum unit identifier | Lets the model refer to a unit unambiguously rather than by a guessed name. Not personal data. |
| `u.title` | `units` | the unit's name | Human-readable counterpart to the code, so its output is legible to him. Not personal data. |
| `u.status` | `unit_progress` | progress state of that unit | The six-level ladder is enforced by status; without it the model could advance him past a level he has not cleared. Locked units are excluded from the query. |
| `u.drill_report` | `unit_progress` | his written drill report | **Truncated to 200 characters in the emitter.** Enough for the EXAMINER to judge whether a report is thin; not the whole essay. Twelve units maximum. |
| `i.log_date` | `captures` where `kind='intel'` | when a real-world move happened | Recency decides whether something is a live situation or a closed one. |
| `i.domain` | `captures` where `kind='intel'` | which life area (money, family, network…) | A short label. Lets the model weigh a pattern by area without reading every entry in full. |
| `i.verdict` | `captures` where `kind='intel'` | his own smart/dumb judgment | His self-assessment, so the model can agree or dissent with something rather than grading him unprompted. |
| `i.title` | `captures` where `kind='intel'` | the entry's short name | The index into his own record; how he refers back to an episode. |
| `i.situation` | `captures` where `kind='intel'` | the circumstances he recorded | **Truncated to 150 characters.** The one field most likely to mention another person — see the residual risk in section 5. Kept because a move cannot be assessed without its circumstances, and truncated because the full account is rarely needed for that. |
| `i.my_move` | `captures` where `kind='intel'` | what he actually did | **Truncated to 150 characters.** The subject of the assessment. Without it, only outcomes remain, and outcomes without actions teach nothing transferable. |
| `i.outcome` | `captures` where `kind='intel'` | what happened as a result | **Truncated to 100 characters** — the shortest of the three, because an outcome is usually a sentence and the pattern engine needs the direction, not the detail. Fifteen entries maximum. |

### 3.2 The Session Continuity Brief — `continuityBrief`, `src/commanders-file.ts`

Book 14's brief survives conversation compaction in external tools. The clause in Book 17 names
the Commander's File, but documenting one emitter and staying silent about the other would be
true and misleading at once, so it is pinned by the same test.

It is markedly leaner than the Commander's File, and that is a design decision rather than an
accident: **due reviews are emitted as counts by kind and never as content.**

| Value | Source | What it reveals | Why it is emitted, and why this is the minimum |
| --- | --- | --- | --- |
| `date` | server clock | the day the brief was generated | A continuity brief with no date cannot be told from an old paste, which is the exact failure it exists to prevent. |
| `programmeDay` | derived from `start_date` | how far into the programme he is | One integer, computed from a setting he chose. Locates him in the arc without exposing any dated record. |
| `cur.book` | `readChapterCursor` | the active book | The brief's job is to restore position in a fresh session; the front is half of that position. |
| `cur.part` | `readChapterCursor` | the active part | Bounds the legitimate figure set on resumption. |
| `cur.chapter` | `readChapterCursor` | the chapter number | R9 again: no default figure, so the cursor must be carried explicitly. |
| `cur.figure` | `readChapterCursor` | the figure under drill | Named in the brief's own NEXT MOVE line, so a new session resumes the same drill instead of starting over. |
| `cur.cycle_day` | `readChapterCursor` | day 1-7 of the cycle | Tells him and any external tool which stage of the cycle to resume at. |
| `streak` | `computeStreak` | consecutive victory days | One integer, carried so a fresh session does not congratulate or scold him about a run it cannot see. |
| `pts.t` | `SUM(points_ledger.points)` | lifetime points total | One integer. The sum only; the ledger stays in the database. |
| `unitsWon` | `COUNT(unit_progress)` complete | how many units are conquered | A count, not a list — enough to place him on the ladder without enumerating his curriculum history. |
| `b.book_id` | `book_progress` grouped | which works are fully complete | Identifiers of finished books only. Chapter-level progress is not emitted; a completed work is the coarsest useful unit. |
| `dueCards` | `COUNT(flashcards)` due | how many reviews are waiting | **A count, never card content.** The brief needs to say work is waiting; the questions themselves are not needed to say it. |
| `dueTongue` | `COUNT(review_items)` due | how many tongue drills are waiting | Same bound as `dueCards`, and for the same reason. |
| `lastDebrief.log_date` | `debriefs` (latest 1) | the date of his most recent debrief | Lets a resumed session see whether yesterday was logged at all, which is the first thing the never-miss-twice rule needs. |
| `lastDebrief.tomorrow_targets` | `debriefs` (latest 1) | what he committed to | **Truncated to 200 characters**, one row only. The single most useful line for resuming, and the only free text in this brief. |

---

## 4. What is prohibited outright

**Book 2.3, restated by R6, is the one limit in this application that is not a matter of
preference or configuration.** No schema, view, or prompt may hold other people's insecurities,
dependencies, or pressure points. The Thumbscrew, the Reliability Index scored as mutual
advantage, and every variant of "map their latent insecurity and hidden dependency" are rejected
permanently and prohibited at schema level. No feature collects data about third parties beyond
the operator's own direct observation.

The People Map that survives is a **seven-row self-model of his own exposure**, encrypted and
role-substituted — a record of where *he* is dependent, not of where anyone else is weak.
R13 carries the same correction for the 將 Jiàng commander factor: it audits his own wisdom,
credibility, benevolence, courage, and strictness, and any redefinition that turns it outward
into other people's emotional fault lines is a corruption of the source.

Current status, stated so the boundary is not mistaken for a shipped feature: **the People Map
does not exist yet.** There is no `people` table in any migration. It is assigned to Phase 12
(see `STATUS.md`), and its requirements — encrypted at rest, never rendered into screenshotable
output, never placed in a system prompt, role-substituted in any model payload — are constraints
on work not yet done, not descriptions of code that is running.

---

## 5. Residual risks, named rather than smoothed over

1. **`i.situation` can contain another person's details, and nothing mechanically prevents it.**
   It is free text about real episodes involving family, friends, and counterparts. R6 bounds it
   to his own direct observation, and that bound is a rule he follows, not a constraint the
   schema enforces. It travels to the model provider truncated to 150 characters. Recorded here
   because the honest description of a rule with no enforcement is "a rule with no enforcement".
2. **The model provider's handling of a payload is outside this repository's control.** The
   allowlist and the HTTPS requirement make the destination explicit and stable; they say
   nothing about retention on the far side.
3. **Debrief free text is emitted untruncated while intel is truncated.** `d.wins`, `d.breaks`,
   `d.tomorrow_targets`, and `d.strategy_insight` have no length cap in the emitter, whereas
   `u.drill_report`, `i.situation`, `i.my_move`, and `i.outcome` do. The total payload is bounded
   by `MODEL_TOTAL_INPUT_CHARS`, so this is not unbounded egress, but it is an inconsistency in
   minimisation rather than a considered decision, and it is written down instead of tidied away.
4. **The three `SELECT *` queries fetch more columns than the briefing emits.** `debriefs`,
   `honesty_flags`, and `captures` are read with `SELECT *`. Only the fields tabled above are
   interpolated into the output, so nothing extra leaves the function — but a column list would
   be the minimal form, and adding a sensitive column to one of those tables would place it in
   memory in this code path without any change here to notice it.
5. **There is no local-data deletion control.** Book 17's PWA requirements include clear
   local-data deletion; no `localStorage.clear` or `caches.delete` exists anywhere in
   `public/static/app/`. It is scoped in Phase 11 and is listed as a gap in `STATUS.md`, not
   presented here as a capability.

---

## 6. How this document is kept true

`test/privacy-doc-completeness.test.ts` runs in `npm run verify` and in CI. It:

- derives the emitted value list from `src/commanders-file.ts` rather than trusting this file;
- fails if any emitted value has no row here, naming the missing ones;
- fails if a row's justification is empty or a single word, because documenting *that* a field is
  emitted without saying *why* is what the clause forbids;
- fails if this document describes a field the code no longer emits, since overstating a
  disclosure is also inaccurate;
- asserts a floor on the extracted counts, so a broken extractor fails loudly instead of
  reporting a clean privacy document for an emitter it never read.

Adding a field to the briefing therefore breaks the build until it is justified in writing here
or removed from the emitter. That is the intended cost.
