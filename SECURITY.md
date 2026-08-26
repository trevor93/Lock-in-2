# SECURITY

This document describes the security boundaries of the War Room application **as the code in
this repository implements them**. It follows Book 17's rule for the documentation set: *make no
claim that is not technically guaranteed.* Where a protection is provided by a layer outside this
repository, that is said. Where a protection is absent, that is said too — §13 is a list of
things this application does **not** do, and it is not an appendix. It is the part of a security
document that is worth reading.

Nothing here describes a deployment. Deployment, secrets, Cloudflare Access, and credential
rotation belong to a separate operator (§14).

---

## 1. This document is derived, not written by hand

Every list below is extracted from the source that implements it by
`test/security-doc-completeness.test.ts`, which fails the build if the document and the code
disagree:

- the scope vocabulary, from the `AGENT_SCOPES` literal;
- the versioned agent routes **and the scope each one demands**, from `agentRoute`;
- the routes reachable with no credential, from the route registrations plus the global guard's
  own exemption;
- every response header, and **every relaxation** the Content-Security-Policy carries, from
  `setSecurityHeaders`;
- each numeric bound in §12, from the literal that enforces it.

Both directions are checked. A boundary the document omits is a boundary the reader cannot
reason about; a boundary the document describes and the code no longer has is a false assurance,
which is worse. The extractors also assert their own output is non-empty, because a coverage
check that runs over an empty list passes and proves nothing.

The consequence is practical: adding an agent route, opening a public path, widening the CSP, or
changing a bound breaks the build until this file is updated.

---

## 2. The authentication boundary

There is one human account: the owner. `ownerUser` (`src/auth.ts`) selects
`WHERE role='owner' ORDER BY id LIMIT 1`.

**Session issue.** `issueSession` mints a 32-byte random token with `crypto.getRandomValues`
(`randHex`, `src/crypto.ts`), stores **only** `sha256(token)` in `sessions.token_hash`, and
records `rotated_from_id` so a login rotates the previous session rather than adding to it. The
raw token exists in the response cookie and nowhere else — a database copy cannot be replayed as
a session.

**Session cookie.** `wr_session`, set `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, host-only
(no `Domain` attribute), `Max-Age` 30 days.

**Session validation.** `findSession` requires
`token_hash=? AND revoked_at IS NULL AND unixepoch(expires_at) > unixepoch('now')` — expiry and
revocation are checked in the same statement that looks the session up, so neither can be
skipped by a code path that forgets to.

**Password storage.** `pbkdf2` (`src/crypto.ts`): PBKDF2-SHA256, 100,000 iterations, 256-bit
output, per-user 16-byte random salt. See §13.3 for what this is not.

**Failed logins.** The fifth consecutive failure sets `locked_until` to 15 minutes ahead; a
successful login clears both the counter and the lock. The lockout response is
`429 GATE SEALED`. See §13.4.

**Proved by** `test/session-ownership.test.ts` (rotation on login, session fixation rejected,
expiry, revocation on logout, hash-only storage, cross-owner record access denied at the route
boundary) and `test/route-denial.test.ts` (every private route denies an anonymous and a forged
caller; no denial body leaks personal data).

---

## 3. The unauthenticated surface

`privatePath()` in `src/index.tsx` treats `/api/*`, `/internal/*`, and `/calendar.ics` as
private. The global `/api/*` guard waves through exactly one prefix — `/api/auth/` — and denies
everything else without a valid owner session (`401 AUTH REQUIRED`).

That leaves the following reachable with no credential at all. This table is derived; a new
public route fails the build until it appears here.

| Route | Method | Why it is open |
|---|---|---|
| `/` | GET | The application shell: static HTML with no personal data in it. Every figure on screen arrives later from an authenticated `/api/*` call. |
| `/manifest.json` | GET | The PWA manifest — name, colours, icons. Contains no personal data and must be readable before install. |
| `/sw.js` | GET | The service worker script. A browser will not register a worker it cannot fetch unauthenticated. Contains no personal data. |
| `/api/auth/status` | GET | Answers only whether a password has been set, which decides whether the shell shows setup or login. Discloses nothing about the owner. |
| `/api/auth/setup` | POST | First-open password creation. It is the act of creating the credential, so it cannot require one. |
| `/api/auth/login` | POST | Password entry. It *is* the gate. |
| `/api/auth/logout` | POST | Revokes whatever session was presented, clears the cookie, and always answers `ok`. Answering `401` instead would disclose whether a session was valid and would make logout non-idempotent. It reads no personal data. |

---

## 4. Token handling

Four kinds of secret exist. None is stored in a form that can be replayed, and none is written
to a response or a log.

**Session token** — random 32 bytes; `sha256` stored; raw value only in the `HttpOnly` cookie.

**Agent credential** — `wr_agent_v1_` plus 32 random bytes (`genAgentToken`). The raw value is
returned **once**, in the response to the issuing request, and never again. Storage is
`sha256(token)` plus a 12–24 character `token_prefix` used to narrow the lookup before hashing.
`agent_credentials.token_hash` carries `CHECK (length(token_hash) = 64)`, so a plaintext token
cannot be written to that column by accident.

**CSRF proof** — `csrfToken(raw) = sha256('csrf:' + raw)`, *derived* from the session token on
demand and stored nowhere. A database reader cannot mint one; a session cookie holder can.

**Model provider key** — read from the environment binding, sent only in the `Authorization`
header of the outbound provider request. Upstream error bodies are never forwarded: every
failure path returns a fixed string (`MODEL SERVICE UNAVAILABLE`, `MODEL RESPONSE INVALID`,
`MODEL REQUEST TIMED OUT`). `test/model-security.test.ts` asserts that raw upstream errors and
API keys are redacted.

**Cron job secret** — `ENFORCEMENT_JOB_SECRET`, presented as `Authorization: Bearer …` and
compared with `timingSafeEq` (length check, then XOR accumulation over the whole string). A
missing binding denies rather than defaults open: `!expected` is part of the same condition.

Legacy note: migration `0006` deliberately erases the pre-existing plaintext master agent token
(`UPDATE settings SET value='' WHERE key='agent_token'`) rather than migrating it. Agent access
stays off until the owner issues a scoped credential. The rollback note in that migration says
the erased token must not be restored.

---

## 5. Agent credentials and scopes

Bridge access uses a separate credential type — hashed, scoped, expiring, revocable, and
rate-limited. It never uses the browser session, and the browser session never satisfies an
agent route.

`agentCredentialBodySchema` is a `z.strictObject`: `deviceLabel` 1–100 characters, `scopes` a
1–9 entry array of known scopes with duplicates refused, `expiresInDays` an integer 1–365.
`DEFAULT_AGENT_SCOPES` is every scope **except** `export:read`, so the whole-file export is
never granted by default.

| Scope | Grants |
|---|---|
| `briefing:read` | Read the assembled daily briefing — the same personal summary the Commander's File emits. The broadest read in the vocabulary. |
| `blocks:read` | Read today's pending blocks: what is scheduled, what is still open. |
| `blocks:write` | Log a block outcome, which advances streaks, penalties, and the never-miss-twice state. |
| `debriefs:read` | Read past debrief free text, including honesty flags. |
| `debriefs:write` | Append a debrief for the current window. Append only — a debrief cannot be rewritten later through this scope or any other. |
| `intel:read` | Read stored life-intel entries, including the situation text described in `PRIVACY.md`. |
| `intel:write` | Add a life-intel entry. |
| `hermes:write` | Send a message to the counsel route, which forwards personal context to the external model provider. Granting this grants provider egress. |
| `export:read` | Read the entire Commander's File in one response. Excluded from `DEFAULT_AGENT_SCOPES` and must be asked for explicitly. |

Every versioned route, and the scope the guard actually requires for it. The required scope in
each row is checked against `agentRoute` by the guard test, so this table cannot understate a
credential's reach.

| Route | Method | Required scope | Notes |
|---|---|---|---|
| `/api/agent/v1/briefing` | POST | `briefing:read` | The daily briefing. |
| `/api/agent/v1/pending` | POST | `blocks:read` | Blocks still open in the current window. |
| `/api/agent/v1/debriefs` | POST | `debriefs:read` | Past debriefs. |
| `/api/agent/v1/debrief` | POST | `debriefs:write` | Appends one debrief. |
| `/api/agent/v1/intel/read` | POST | `intel:read` | Reads life intel. Ordered before `/intel` in this table because the two paths differ by suffix, not by verb. |
| `/api/agent/v1/intel` | POST | `intel:write` | Adds one life-intel entry. |
| `/api/agent/v1/block-log` | POST | `blocks:write` | Logs a block outcome, with consequences. |
| `/api/agent/v1/message` | POST | `hermes:write` | Counsel message; causes model egress. Its audit label is `hermes:message` while the scope it demands is `hermes:write` — the two strings differ on purpose and are recorded here so neither is mistaken for the other. |
| `/api/agent/v1/export` | POST | `export:read` | The whole file in one response. |

**Method and path handling.** A known path with the wrong method answers `405 METHOD NOT
ALLOWED`; an unknown path under `/api/agent/v1/` answers `404 AGENT ROUTE NOT FOUND`. Any
unversioned `/api/agent/*` path answers `410 AGENT API VERSION RETIRED. Use /api/agent/v1.` —
the old surface is closed, not silently re-routed.

**Authentication.** `authenticateAgent` requires the `X-Agent-Token` header. A credential in the
query string is refused without being authenticated, so it cannot be accepted from a URL that
may be logged or shared. Every failure — unknown, revoked, expired, malformed — returns the same
opaque `401 INVALID AGENT CREDENTIAL`.

**Scope denial** returns `403 AGENT SCOPE REQUIRED` together with `requiredScope`, and appends a
`scope_denied` event.

**Rate limiting.** 60 requests per 60-second window per credential, enforced by a single
conditional `UPDATE` whose `changes === 1` is the grant. There is no read-then-write gap for
concurrent requests to slip through. Exceeding it returns `429 AGENT RATE LIMIT EXCEEDED` with
`Retry-After` and appends a `rate_limited` event.

**Request metadata** is deliberately coarsened before storage: `coarseNetwork` reduces IPv4 to a
`/24` and IPv6 to a `/48`. Request bodies are never stored on the credential.

**Proved by** `test/agent-credentials.test.ts` (shown once, hash-only storage, scope
enforcement, revoked and expired denial, export separated from the default grant, atomic
concurrent rate limiting, coarse IPv6) and `test/route-denial.test.ts` (every agent route denies
a missing and a forged credential; a query-string credential is rejected).

---

## 6. The internal job path

Cloudflare Pages has no scheduled handler, so enforcement and alarms are driven by an
operator-configured Cron Worker calling two POST-only endpoints:
`/internal/jobs/enforcement` (`src/routes/day.ts`) and `/internal/jobs/alarms`
(`src/routes/push.ts`).

Both require `Authorization: Bearer <ENFORCEMENT_JOB_SECRET>` compared with `timingSafeEq`, both
deny when the binding is absent, and both then require a genuinely empty body
(`parseEmptyBody`). Neither reads a client-supplied clock: the date and time come from the
server, so no caller can time-travel the engines. Both open a `job_runs` row **before** doing
work, so an operator can distinguish "the Cron never called" from "the Cron called and the
service was not configured" — those need different fixes.

**Proved by** `test/security-boundary.test.ts` (POST-only, missing and invalid credentials
rejected, enforcement runs on server time and stays consequence-idempotent).

---

## 7. Origin, CORS, and CSRF

**Origin.** For any request carrying an `Origin` header, `allowedOrigins(c)` is the request's own
origin plus the comma-separated `ALLOWED_ORIGINS` binding. A mismatch answers
`403 ORIGIN NOT ALLOWED`. There is no wildcard, and no reflection of an arbitrary origin.
Non-browser bridge callers send no `Origin` and authenticate with `X-Agent-Token`.

**Preflight.** `OPTIONS` on a private path allowlists exactly three request headers —
`content-type`, `x-csrf-token`, `x-request-id`. A preflight asking for anything else answers
`403 CORS PREFLIGHT NOT ALLOWED` rather than being narrowed silently. A permitted preflight
returns `Access-Control-Allow-Origin` (the specific origin), `-Credentials`, `-Methods`,
`-Headers`, `Max-Age: 600`, and an appended `Vary`.

**CSRF.** Any unsafe method on `/api/*` presented with a session cookie must also carry
`X-CSRF-Token` matching `csrfToken(rawSession)` under `timingSafeEq`, or it answers
`403 CSRF VALIDATION FAILED`. Three exemptions, each for a reason: `/api/auth/setup` and
`/api/auth/login` have no session to derive a proof from, and `/api/agent/v1/*` requests
carrying `x-agent-token` are not cookie-authenticated, so there is no ambient credential for a
foreign page to abuse.

**Proved by** `test/security-boundary.test.ts` (disallowed origins rejected without wildcard
CORS, allowlisted preflight answered without opening CORS, CSRF proof required for
cookie-authenticated mutations, CSRF proof returned when a valid session is restored).

---

## 8. Response headers

`setSecurityHeaders` (`src/security-headers.ts`) runs on the shell and on every private
response. `Cache-Control: no-store` is set both before and after the handler, so a private
response cannot be stored by an intermediary or replayed from a browser cache — including
`/calendar.ics`, which is a personal schedule.

| Header | Value | Effect |
|---|---|---|
| `Content-Security-Policy` | see §9 | Bounds where script, style, fonts, images, and connections may come from. |
| `X-Content-Type-Options` | `nosniff` | The browser must honour the declared content type instead of guessing it. |
| `Referrer-Policy` | `no-referrer` | No URL of this application is sent to any third party as a referrer. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Camera, microphone, and location are denied to the page and to every frame in it. |

Note for a future book: Book 14's Arena needs the microphone. Building it will require relaxing
one of those three denials, and that relaxation has to be argued for here when it happens rather
than slipped in.

---

## 9. Content-Security-Policy, including what it permits

The policy restricts: `default-src 'self'`, `base-uri 'self'`, `form-action 'self'`,
`frame-ancestors 'none'` (the application cannot be framed), `object-src 'none'`,
`img-src 'self' data:`, and `connect-src 'self'` — so the page's own scripts cannot call out to
a third-party host.

It also **permits** the following. A policy document that listed only its restrictions would
describe a stricter application than the one that ships, so each relaxation is named here and
checked against the policy by the guard test in both directions.

| Relaxation | Directive | Why it is there |
|---|---|---|
| `unsafe-inline` | `script-src`, `style-src` | Inline styles are used throughout the shell. Inline *script* is no longer required — event handling is delegated — but the keyword is still present, so the policy does not currently stop an injected inline handler. See §13.2. |
| `cdn.tailwindcss.com` | `script-src` | The CSS framework is loaded as a script from this host. |
| `cdn.jsdelivr.net` | `script-src`, `style-src`, `font-src` | The HTTP client and the icon font are loaded from this host. |
| `fonts.googleapis.com` | `style-src` | Web-font stylesheets. |
| `fonts.gstatic.com` | `font-src` | The font files those stylesheets reference. |

No other relaxation keyword appears in the policy — dynamic code evaluation is not permitted by
any directive.

---

## 10. Input validation and size

**Body size.** `bodyLimit({ maxSize: 64 * 1024 })` is applied to `/api/*` and `/internal/*` and
answers `413 PAYLOAD TOO LARGE` **before** the route parses anything.

**Shape.** Route bodies are parsed with Zod through `parseJson`; unknown keys are rejected
rather than ignored, so a mass-assignment attempt fails instead of being silently dropped.
Mutations that take no body use `parseEmptyBody`, which accepts an empty body or `{}` and
nothing else. Unparseable JSON and schema failures both surface as a controlled
`400 VALIDATION FAILED` through `app.onError`; every other thrown error becomes
`500 INTERNAL SERVER ERROR` with no detail in the body.

**Dates and times** are validated rather than coerced — an invalid date query is refused instead
of quietly falling back to today, which would silently write to the wrong day.

**Reads do not write.** Every `GET` and `HEAD` on a private route is free of D1 writes and
penalties, including repeated crawler requests, which is what stops a prefetch from advancing
the commander's state.

**Output escaping.** The rendered surfaces escape interpolated text; the DOM suites
`test/xss-escaping.dom.test.ts` and `test/xss-surfaces.dom.test.ts` assert it against the built
bundle rather than the source.

**Proved by** `test/request-validation.test.ts`, `test/get-read-only.test.ts`,
`test/security-boundary.test.ts` (the 64 KiB boundary), and the two DOM suites above.

---

## 11. The model egress boundary

Personal data leaves this application in exactly one direction: to the configured model
provider, on the counsel routes. `PRIVACY.md` states what travels. This section states what
constrains it.

- **Endpoint allowlist.** `modelBaseURL` returns `null` unless the configured URL parses, uses
  `https:`, and is an **exact match** for one entry in `OPENAI_ALLOWED_BASE_URLS`. No allowlist
  configured means no egress. A rejected URL is not echoed back.
- **Pinned model.** `PINNED_MODEL` is sent on every request, and both accounting tables carry
  `CHECK (model = 'gpt-5-mini-2025-08-07')`, so a silent model swap cannot be recorded as if it
  were the pinned one.
- **Bounded input.** Total input above `MODEL_TOTAL_INPUT_CHARS` answers `413 MODEL INPUT TOO
  LARGE` before any provider call.
- **Bounded output.** `max_completion_tokens` is fixed, the response must parse as JSON against
  a strict schema, and an over-long or malformed answer is discarded with no record written.
- **Bounded time and retries.** One 15,000 ms abort per attempt, at most 2 attempts, and only
  `5xx` responses are retried — a `4xx` is not repeated.
- **Untrusted-source fences.** `fencedModelData` wraps external content in explicit
  `<UNTRUSTED_…>` markers, and quoted external messages are fenced separately from the
  commander's own journal so the two cannot be confused for one another.
- **No key, no service.** An absent `OPENAI_API_KEY` degrades to `503 MODEL SERVICE OFFLINE`
  with no reservation consumed and no message recorded.
- **Per-owner budgets**, enforced inside the reservation `INSERT` by a SQLite trigger rather
  than by application arithmetic: 10 requests/minute, 100/day, 2,000/month, 20,000 reserved
  output tokens/day, 100,000/month. Because the trigger runs within the insert, concurrent
  requests cannot pass a read-then-write race.

**Proved by** `test/model-security.test.ts`.

---

## 12. Evidence that cannot be rewritten

The honesty engine depends on records that cannot be edited after the fact, so append-only is
enforced by SQLite triggers in the migrations — not by application discipline. Eleven tables
carry a trigger whose own abort message says append-only. For nine of them that holds in both
directions and under every condition; for two it does not. The difference is stated rather than
rounded off, because a partial protection described as a total one is a false assurance. Both
lists below are derived from `migrations/` by the guard test, so a table that loses a trigger,
gains one, or is renamed fails the build instead of quietly changing what this section means.

`audit_events` records metadata only. `auditEvent` writes actor type, actor id, request id,
action, and entity — never a credential, a prompt, or model output. A failure to audit never
breaks the request it describes.

### Append-only by trigger

Each table below carries an unconditional `BEFORE UPDATE` **and** an unconditional
`BEFORE DELETE` trigger, both of which `RAISE(ABORT, …)`. Once a row is written, no statement
can change it and no statement can remove it.

| Table | Triggers | Installed by |
|---|---|---|
| `alternative_explanations` | `trg_alt_expl_no_update`, `trg_alt_expl_no_delete` | `0010_alternative_explanation_gate.sql` |
| `audit_events` | `trg_audit_no_update`, `trg_audit_no_delete` | `0008_audit_idempotency.sql` |
| `block_miss_causes` | `trg_miss_causes_no_update`, `trg_miss_causes_no_delete` | `0019_block_statuses_and_causes.sql` |
| `catchup_sessions` | `trg_catchup_no_update`, `trg_catchup_no_delete` | `0009_recovery_catchup.sql` |
| `mastery_evidence` | `trg_mastery_evidence_no_update`, `trg_mastery_evidence_no_delete` | `0021_mastery_rubric_calibration.sql` |
| `model_audit_events` | `trg_model_audit_no_update`, `trg_model_audit_no_delete` | `0007_model_security.sql` |
| `ratchet_events` | `trg_ratchet_events_no_update`, `trg_ratchet_events_no_delete` | `0018_ratchet.sql` |
| `reading_events` | `trg_reading_events_no_update`, `trg_reading_events_no_delete` | `0020_learning_sources_reading.sql` |
| `rhetoric_card_reviews` | `trg_rhetoric_card_reviews_no_update`, `trg_rhetoric_card_reviews_no_delete` | `0024_rhetoric_track.sql` |

### Protected, but not unconditionally

Two more tables abort with an append-only message while guaranteeing strictly less than the nine
above. They are named here rather than there, because the message is what a reader greps for and
the message is broader than the trigger.

- **`push_deliveries`** (`0017_push_notifications.sql`). `DELETE` is refused outright by
  `trg_push_delivery_no_delete`. `UPDATE` is refused by `trg_push_delivery_no_update` only
  `WHEN OLD.ok_count IS NOT NULL AND NEW.sent_at <> OLD.sent_at` — a delivery whose attempt has
  already been recorded cannot have its send time rewritten, but no trigger protects its other
  columns. What makes the ledger safe against double-notifying is its
  `UNIQUE(user_id, kind, ref, occurs_on)` index, not this trigger.
- **`job_runs`** (`0029_job_runs.sql`). `UPDATE` is refused by `trg_job_runs_no_reopen`
  `WHEN OLD.status <> 'running'`, which permits exactly the completion write — `running` to `ok`
  or `error` — and refuses every later edit. There is **no** `BEFORE DELETE` trigger: a run row
  can be deleted. So the table guarantees that a run which finished cannot be rewritten to claim
  it went differently. It is not evidence that no run record was ever removed.

### One exception, stated because it is one

**`agent_credential_events` carries no append-only trigger.** It is append-only because exactly
one statement in `src/agent-auth.ts` touches it and that statement is an `INSERT` — no code path
updates or deletes it. That is application discipline, not a schema guarantee, and it is weaker
than the tables listed above.

### Enforced bounds

Each value below is read from the literal that enforces it by the guard test, so a bound changed
in code and left unchanged here fails the build.

| Symbol | Value | What it bounds |
|---|---|---|
| `pbkdf2` | 100,000 iterations | PBKDF2-SHA256 rounds over the owner password, 256-bit output, 16-byte random salt. |
| `SESSION_DAYS` | 30 | Browser session lifetime in days, applied to both the cookie `Max-Age` and the stored `expires_at`. |
| `AGENT_RATE_LIMIT` | 60 | Agent requests permitted per window, per credential. |
| `AGENT_RATE_WINDOW_SECONDS` | 60 | Length of that window in seconds. |
| `bodyLimit` | 64 KiB | Maximum request body on `/api/*` and `/internal/*`, refused before parsing. |
| `locked_until` | 5 failures, 15 minutes | Consecutive failed logins before the gate seals, and how long it stays sealed. |
| `MODEL_TOTAL_INPUT_CHARS` | 48000 | Maximum characters sent to the model provider in one request, including both system messages. |
| `MODEL_TIMEOUT_MS` | 15000 | Abort deadline per provider attempt, of at most two attempts. |

---

## 13. What this application does not do

Every item here is a real limitation. None is a to-do list entry dressed as a risk note; where a
decision was made deliberately, the reason is given.

**13.1 No subresource integrity on four external hosts.** The shell loads a script from
`cdn.tailwindcss.com` and a script, a stylesheet, and a font from `cdn.jsdelivr.net`, with no
`integrity` attribute on any of them. The CSP permits those hosts *by name*; it does not verify
what they return. A compromise of either host executes script in this application's origin with
the session cookie present. Pinning hashes or vendoring the assets would close this; neither has
been done.

**13.2 The CSP permits `unsafe-inline` script.** The frontend no longer needs it — handlers are
delegated — but the keyword is still in `script-src`. What stands between an injected string and
execution is therefore the output escaping and the two DOM suites that assert it, not the
policy. Removing the keyword is a real hardening step that has not been taken.

**13.3 PBKDF2 is not a memory-hard hash.** 100,000 iterations of PBKDF2-SHA256 is a genuine work
factor against a leaked hash, but it is not equivalent to Argon2id or scrypt, which resist
GPU-parallel attack in a way PBKDF2 does not. Workers' Web Crypto exposes no memory-hard KDF,
which is why this is what ships. It is stated rather than described as "strong hashing".

**13.4 The login lockout can be used against the owner.** There is one account, so five wrong
passwords lock *the* commander out for fifteen minutes. Anyone who can reach
`/api/auth/login` can keep doing that. The intended mitigation is Cloudflare Access in front of
the application — which is operator-scoped (§14), so this repository cannot guarantee it is
there.

**13.5 A stolen session cookie is valid until it expires.** Sessions last 30 days with no idle
timeout. Revocation exists and logout uses it, and a login rotates the previous session — but
nothing detects theft, and there is no "sign out everywhere" control in the interface.

**13.6 Errors reach the platform log.** `app.onError` calls `console.error(error)` before
returning a redacted `500`. The response body carries no detail; the deployment's log carries
the stack. Whoever can read those logs is the operator.

**13.7 `agent_credential_events` is append-only by discipline, not by trigger.** See §12.

**13.8 No local-data deletion control.** Nothing in `public/static/app/` clears cached personal
data from the device. Book 17's PWA requirements ask for one. `PRIVACY.md` records the same gap.

**13.9 `unit_progress.unit_id` carries a bare `UNIQUE`** rather than `UNIQUE(user_id, unit_id)`.
On a single-owner install this is unreachable. It is deliberately not being corrected now,
because the migration that introduces a second owner is the one that can correct it safely;
`STATUS.md` records that decision.

**13.10 Nothing here protects against a compromised operator or provider.** What the model
provider does with a payload after it arrives is governed by the operator's contract with them,
not by any code in this repository.

---

## 14. The operator boundary

The following are **permanently outside** this repository and are not performed, simulated, or
claimed here:

- **Cloudflare Access** configuration — the outer authentication layer in front of the
  application;
- secret and binding configuration (`ENFORCEMENT_JOB_SECRET`, `OPENAI_API_KEY`,
  `OPENAI_ALLOWED_BASE_URLS`, `ALLOWED_ORIGINS`, the VAPID keys);
- production credential rotation;
- production database backup;
- Cron Worker deployment;
- repository visibility;
- any deploy.

`OPERATIONS.md` and `OPERATOR_HANDOFF.md` describe how the operator performs those steps.
Nothing in this repository has been deployed by the process that wrote it, and no claim above
should be read as saying otherwise: each one describes what the code does when it runs, not that
it is running.

---

## 15. Reporting

This is a single-owner private application. Security concerns go to the owner and the operator
directly. There is no bug-bounty programme and no public disclosure address, and this document
does not invite third-party testing of a deployed instance.
