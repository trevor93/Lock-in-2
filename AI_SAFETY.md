# AI SAFETY

What constrains the model in this application, and what only asks it nicely.

This application makes model calls on three routes. Everything below describes the boundary
around those calls: what leaves, what is allowed back, what is enforced by a schema or a trigger
or an escape, and what is only text sent to a provider and therefore not enforced at all. The
distinction is the whole point of the document. A system prompt containing an ethics paragraph is
not a safety property, and a document that presents one as though it were is worse than silence.

---

## 1. This document is derived, not written by hand

Every number, route name, fence label, budget, audit event and trigger name below is extracted
from source by `test/ai-safety-doc-completeness.test.ts` and compared against this file. Change a
bound in `src/ai.ts` and the suite fails until this document states the new one. That is the only
mechanism that makes a safety document true tomorrow as well as on the day it was written.

The absences are derived too, and in both directions. A count goes stale loudly — the number
stops matching and the guard says so. An absence goes stale silently and in the flattering
direction: someone closes a gap, this document keeps describing it as open, and a reader plans
around a weakness that is gone. Worse in the other direction: someone opens a path this document
promises is closed, and the promise survives because nothing checks it. So §11, §12 and §14 each
hold **one** pattern, required while the condition holds and forbidden once it stops holding.

Sources: `src/ai.ts`, `src/schemas.ts`, `src/routes/hermes.ts`,
`migrations/0007_model_security.sql`, `public/static/app/features/council.js`, and
`public/static/app/core/sanitize.js`.

---

## 2. The one egress path

Personal data leaves this application in exactly one direction — to the configured model
provider — and from exactly one module: `src/routes/hermes.ts`, which holds 3 `callModel` call
sites, one per route. `src/ai.ts` owns the boundary itself and is called by nothing else. The
guard derives the caller list from every module under `src/` and fails if a second module ever
reaches the model, because a second caller is a second place the fences and budgets can be
forgotten.

The three routes are `hermes:chat`, `hermes:council` and `intel:analyze`. Both accounting tables
carry a `CHECK` restricting the route column to those three names, so a fourth route cannot
record itself as one of them.

`PRIVACY.md` states what travels. `SECURITY.md` §11 states the transport-level boundary. This
document states what happens to the model's words once they come back.

---

## 3. The layer order the provider actually receives

`callModel` builds the provider message array itself, so the order is a property of the code
rather than a convention the callers are trusted to follow. Two system messages first —
`HERMES_SYSTEM`, the persona, then `MODEL_POLICY`, the application policy — and then whatever
the caller passes.

`MODEL_POLICY` carries 6 rules, and its first line asserts that it outranks every user and source
block below it. The callers then pass, in this order: the user's own request, the retrieved
briefing, the commander's journal, and quoted external messages.

Each non-request layer is wrapped by `fencedModelData`, which produces an explicit opening and
closing marker around the content:

- `UNTRUSTED_RETRIEVED_SOURCE_CONTENT` — the briefing assembled from the commander's own records,
  and on `intel:analyze` the single capture being analysed.
- `UNTRUSTED_PERSONAL_JOURNAL_CONTENT` — prior council messages the commander himself wrote.
- `UNTRUSTED_QUOTED_EXTERNAL_MESSAGES` — council rows written through the agent bridge, which
  carry a fixed prefix so they can be separated from the commander's own words. These are other
  parties' text and are the least trusted layer in the array.

The separation of the last two is the part that matters and the part a hand-written document
would drop: a bridge-authored message rendered as the commander's own journal would let anything
that can reach the bridge speak in his voice inside the prompt.

**What this is not.** The layer order is a real property of the request. Whether the model
*honours* it is not, and nothing in this repository can make it so. Every guarantee that follows
in §4 through §11 holds regardless of what the model decides to do with these instructions.

---

## 4. The model authorises nothing

Tool authorisation lives outside the model. The model is never given a tool, never given a
credential, and never consulted about whether a write is permitted. It returns one string.

That string reaches persistent storage in exactly two tables, and in exactly three statements,
all of them in `src/routes/hermes.ts`:

- `hermes_messages` — the answer is appended as an assistant message on `hermes:chat`, and on
  `hermes:council` as one assistant message prefixed with the council date.
- `captures` — on `intel:analyze` the answer is written to the `hermes_analysis` column of the one
  capture the owner asked about, addressed by both `id` and `user_id`.

Nothing else. No points are awarded, no block is logged, no flag is acknowledged, no schedule is
changed, and no row is deleted on the strength of a model answer. The guard derives that list of
tables from the route module, so a fourth statement writing model output somewhere new fails this
suite until this section names it.

The write target is also not negotiable by content: the `UPDATE` is bound to the id parsed from
the URL and to the authenticated owner, so an answer that asks to be stored elsewhere has nowhere
to put that request.

---

## 5. Structured output, validated before use

The provider is asked for `response_format: json_object`, and the response is then checked twice
rather than trusted once.

The envelope is parsed against a schema requiring exactly one choice carrying a message with
string content, and a completion-token count that cannot exceed the ceiling. The content is then
parsed as JSON and checked against a strict object schema permitting exactly one field, `answer`,
which must be a non-empty trimmed string of at most 12000 characters.

Strict means strict: an extra field fails. A model answer arriving with an additional key is
discarded, not partially accepted. On any failure the route records an `invalid_output` audit
event and returns a redacted `502`, and **no message row is written** — a malformed answer leaves
no trace in the commander's council history.

---

## 6. The endpoint allowlist and the pinned model

`modelBaseURL` returns `null` unless the configured URL parses, uses `https:`, and is an exact
string match for an entry in the configured allowlist. No allowlist means no egress. A rejected
URL is never echoed back in a response.

`gpt-5-mini-2025-08-07` is sent on every request, and both accounting tables carry a `CHECK`
pinning the model column to that exact string, so a silent model swap cannot be recorded as if it
were the pinned one.

Input is bounded twice. A single user message above 16000 characters is refused by the route
before anything is assembled; the assembled total — persona, policy, request and every fenced
layer — is measured in `callModel` and refused above 48000 characters. Both refusals answer
`413` before any provider call, and the second is the one that matters, because the layers the
user does not control are what make a small message into a large request.

---

## 7. Budgets, enforced inside the insert

Per-owner limits are 10 requests per minute, 100 per day, 2,000 per month, 20,000 reserved output
tokens per day and 100,000 reserved output tokens per month.

They are enforced by a SQLite **trigger** on the reservation insert, not by application
arithmetic. That choice is the guarantee: a read-then-write check in application code can be
passed by two concurrent requests that both read the old count, while a trigger firing inside the
insert cannot. The reservation is taken **before** the provider is called and reserves the full
output ceiling of 1300 tokens, so a burst cannot spend a budget it has not yet accounted for.

A denied reservation records a `rate_limited`, `daily_budget_denied` or `monthly_budget_denied`
audit event, answers `429`, and — for the rate limit only — sets `Retry-After`. No provider call
is made.

---

## 8. Bounded time, bounded retries, redacted errors

Each attempt runs under a 15000 ms abort, and there are at most 2 attempts. Only `5xx` responses
are retried; a `4xx` is not repeated, because retrying a refusal is how a bounded system spends a
budget on a request that was never going to succeed.

Upstream failures are never passed through. The commander sees one of five fixed strings —
`MODEL SERVICE OFFLINE`, `MODEL SERVICE UNAVAILABLE`, `MODEL RESPONSE INVALID`, `MODEL REQUEST
TIMED OUT`, `MODEL INPUT TOO LARGE` — and the upstream status code is recorded in the audit row
rather than rendered. The API key is never included in a response, a log line, or an audit row.

---

## 9. Degradation with no key

An absent API key, or a base URL that fails the allowlist, degrades to `503 MODEL SERVICE
OFFLINE`. Each of the three routes checks this before assembling anything, records an `offline`
audit event, consumes no reservation, and writes no message.

Nothing else in the application depends on that outcome. With no key configured, the counsel
routes answer 503 and every other feature behaves exactly as it does with a key present.

---

## 10. Evidence that cannot be rewritten

Two tables carry the accounting. `model_requests` holds one row per reservation. `model_audit_events`
holds one row per event, across nine event types: `accepted`, `succeeded`, `rate_limited`,
`daily_budget_denied`, `monthly_budget_denied`, `offline`, `upstream_error`, `timeout`, and
`invalid_output`.

Both are **metadata-only**. The audit row records the request id, route, pinned model, event type,
attempt number, input and output character counts, prompt and completion token counts, and the
upstream status. It does not record the prompt, the fenced content, the answer, or any credential.
That claim is derived from the column names rather than asserted: the guard scans the table
definition for any column that could hold content or a credential, and if one ever appears, this
section is **required to stop** calling the evidence metadata-only.

The audit table is append-only by database trigger, not by convention: `trg_model_audit_no_update`
and `trg_model_audit_no_delete` both raise `MODEL_AUDIT_APPEND_ONLY`. The application cannot
rewrite its own record of what it sent, and neither can anything else holding the same connection.

---

## 11. The render path in the browser

Model output is displayed as formatted text, which means the answer passes through a formatter,
which means the formatter is a security boundary.

`mdLite`, in `public/static/app/features/council.js`, **escapes the answer first** — it calls
`esc` on the whole string before it introduces any markup — and only then substitutes bold,
headings, list markers and line breaks. Order is the entire guarantee. Escaping after formatting
would neutralise the markup the formatter had just added and leave the model's own angle brackets
live. The guard reads the function and asserts that order, and if the order is ever inverted the
sentence claiming it must disappear from this section rather than survive as a comforting
leftover.

`esc`, in `public/static/app/core/sanitize.js`, replaces the five HTML metacharacters and is the
single place text becomes HTML-safe. `test/xss-surfaces.dom.test.ts` sends a hostile payload
through the council transcript and the intel analysis surface and asserts that no element is
created from it while the emphasis markup still renders.

The Content-Security-Policy adds a second layer: `connect-src 'self'` means a model answer that
somehow became live markup still could not reach an external host, and `object-src 'none'` with
`frame-ancestors 'none'` closes the embedding paths.

---

## 12. The engines that never call a model

The honesty engine, the scoring ledger, the streak and never-miss-twice rules, the progress
ratchet, the block-status vocabulary and the calibration scoring make **no model call** and read
no model output. `enforcement.ts`, `scoring.ts`, `streak.ts`, `ratchet.ts`, `block-status.ts` and
`calibration.ts` contain no reference to the model boundary or to the API key, and the guard
asserts that for each of them by name.

This is the property that makes the application usable with the model switched off, and the
property that keeps a model's mistake from becoming a false record of what the commander did. If
one of those modules ever reaches for the model, the sentence above must be deleted rather than
softened — the guard requires exactly that.

---

## 13. The persona is prose, not a mechanism

`HERMES_SYSTEM` describes a character: a private counsel with the commander's file, fluent in the
canon, forbidden to flatter, and instructed to advise defence and positioning rather than fraud or
revenge. It carries 7 numbered doctrine points and ends with an ethics line.

**None of it is enforced.** It is a string sent to a provider. It is not a filter, not a
validator, and not a guarantee; no test in this repository asserts that the model obeys any part
of it, and no test could, because the behaviour it describes belongs to a system this repository
does not contain. Treating that paragraph as a safety control is the specific mistake this
document exists to avoid.

What *is* enforced is everything in §4 through §11: the model has no tools, its output is
schema-validated, it can write to two columns through three statements chosen by the server, its
answer is escaped before it is rendered, and its cost is capped by a trigger. Those hold whether
the persona is honoured, ignored, or overwritten by something in a fenced block.

The interface register is separate and also not the model's: `src/tone.ts` governs the severity
ladder and the tone setting for the application's own text, and says in its own comment that
Hermes stays cold and exact regardless of what is set there.

---

## 14. Known weaknesses, stated because they are real

**The fence markers are not escaped.** `fencedModelData` wraps content in
`UNTRUSTED_RETRIEVED_SOURCE_CONTENT` style markers and **does not escape** the same markers if
they appear inside the content it is wrapping. Content that contains a closing marker can
therefore present the text that follows it as though it were outside the fence. The exposure is
narrow — every fenced layer is assembled from the commander's own stored records, and the only
externally-authored layer is bridge-written council text, which requires a scoped credential — but
it is a real gap and it is not closed. The guard reads the function; if escaping is ever added,
this paragraph must stop claiming the gap is open.

**Injection resistance is not proved, only structured.** `test/model-security.test.ts` proves
that an injected instruction reaches the model inside a fence and that the flag it asks to
acknowledge stays unacknowledged. That is a test of the authorisation boundary, not of the
model's judgment. No test asserts that the model refuses an instruction, and none should pretend
to.

**Bridge-written council rows are model input.** Anything holding a credential with the council
write scope can place text where the next `hermes:chat` prompt will read it, fenced as a quoted
external message. Scopes are enforced and the prefix is applied server-side, so the text cannot
arrive labelled as the commander's own journal — but the path exists by design and is worth
knowing about.

**The audit cannot distinguish a wrong key from an absent one.** Both produce silence at the
provider, and `offline` is recorded only when the key or allowlist is missing locally. An upstream
`401` is recorded as `upstream_error` with its status, which is as far as this side of the
boundary can see.

**One column is client-chosen.** On mastery evidence, `graded_by` is supplied by the request and
constrained only to the three permitted words. It labels how a piece of evidence was graded; it
does not decide admission — `admitEvidence` never reads it, and never reads `self_score` either.

---

## 15. What this document does not claim

This document **makes no claim** beyond what this repository enforces, and several claims are
worth denying explicitly because a document with this title invites all of them.

**It is not a safety certification and not an audit.** It is a description of mechanisms, written
alongside the code that implements them and checked against it. No third party has reviewed it.

**No claim is made about how the model will behave.** Nothing here asserts that the model is
aligned, that it will refuse a harmful request, or that it will honour the persona or the policy.
Every guarantee in this document is a property of the surrounding code — the schema, the trigger,
the escape, the absent tool — precisely because the model's own behaviour cannot be one.

**The provider is outside this repository.** What the upstream provider logs, retains, or trains
on is governed by its own terms, not by this document. The repository controls what is sent, that
it goes only to an allowlisted HTTPS endpoint, and how much of it goes; it controls nothing after
that.

**Nothing described here has been deployed.** Every figure is derived from source in this
repository. No statement is made about a running instance, and no model call has been made from a
production environment on the strength of this document.

**Its silence is not a guarantee.** A risk this document does not name is a risk nobody wrote
down, not a risk that was assessed and dismissed. §14 lists what is known to be open; it does not
claim to be the complete set of what could be.
