# Architecture

## 1. What this document is

A map of the system as it exists, not as it was planned.

It is **not maintained by hand.** `test/architecture-doc-completeness.test.ts` derives every
list and every number below from the repository and fails the build when the two disagree:
every module of `src/`, `workers/` and `public/static/app/` must appear here with a stated
responsibility; each route module's row must state the number of routes that module registers;
the route table must be in the order `src/index.tsx` registers them; the global middleware chain
must appear in installed order; the build outputs, the configs and every stage of the gate must
be named; each stated count comes from a glob.

Both directions are checked. Silence about a module hides a part of the system the reader then
plans around as absent. A row for a module that no longer exists, a pointer to a document that
was never written, or an "unreachable" note on a module the build does reach are false claims,
and the rule this document is written under forbids those specifically: **make no claim that is
not technically guaranteed.**

For the security boundaries see `SECURITY.md`; for what data exists and why, `PRIVACY.md`; for
the operator runbook, `OPERATIONS.md` and `OPERATOR_HANDOFF.md`; for build status and the
outstanding work, `STATUS.md`.

## 2. The shape

One Hono application, deployed as a Cloudflare Pages Function, talking to one D1 (SQLite)
database. One HTML shell served from a string constant, which loads one bundled JavaScript file.
One separate Cron Worker whose only job is to POST to an internal path on a schedule. That is
the whole system.

What it deliberately does not use: no queue, no KV namespace, no Durable Object, no R2 bucket,
no cache API on the server side, no ORM, no client framework, no client-side router, no
server-side rendering of per-user data, and no build step for the server beyond bundling. State
lives in D1 or in the request. Nothing else is durable.

The consequences of that choice are real and are stated in §11 rather than left implied.

## 3. What the repository holds

| Path | Count | What it contains |
|---|---|---|
| `src/` | 57 | Every server module — 37 at the top level plus 20 under `routes/`. |
| `src/routes/` | 20 | The route modules, registering 140 routes between them. |
| `public/static/app/` | 15 | The client module graph: 7 in `core/`, 7 in `features/`, 1 entry. |
| `migrations/` | 30 | Forward-only SQL migrations, applied in filename order. |
| `public/static/books/` | 11 | The shelf: one JSON file per work, served as static assets. |
| `workers/` | 1 | One Cron Worker, deployed separately from the Pages application. |

## 4. The request lifecycle

Every request enters `src/index.tsx`. The global middleware chain, in the order that file
installs it:

`* → /api/* → /internal/* → /api/*`

**Layer 1 — `*` (every request).** Sets the hardening headers, then splits on whether the path
is private (`/api/*`, `/internal/*`, or `/calendar.ics`):

- A **public** path runs the handler and gets the hardening headers applied a second time on the
  way out, so a response built by a route cannot ship without them.
- A **private** path additionally gets `Cache-Control: no-store`; an `Origin` header that is
  neither this deployment's own origin nor in the configured allowlist is refused with `403
  ORIGIN NOT ALLOWED`; an `OPTIONS` preflight is answered `204` only if every requested header
  is one of `content-type`, `x-csrf-token`, `x-request-id`, and refused `403` otherwise; and an
  unsafe method on `/api/*` carrying a session cookie must present a matching `X-CSRF-Token`,
  compared in constant time. Password entry (`/api/auth/setup`, `/api/auth/login`) and agent
  requests bearing `X-Agent-Token` are exempt from that last check, because neither is driven
  by a browser holding a session cookie. On the way out the headers and `no-store` are
  re-applied and, if the request carried an allowed `Origin`, the CORS response headers are
  added with `Vary: Origin`.

**Layers 2 and 3 — `/api/*` and `/internal/*`.** A 64 KiB body limit each, refusing with `413
PAYLOAD TOO LARGE`. Because the CSRF check lives in layer 1, it runs *before* the body is read:
a forged cross-origin write is rejected without the body ever being parsed.

**The error handler.** A `RequestValidationError` becomes the one shared validation-failure
response; anything else is logged with `console.error` and becomes `500 INTERNAL SERVER ERROR`.
No error message from an exception ever reaches the client.

**`registerAuthRoutes(app)` is called before layer 4.** The four authentication routes are
therefore outside the API guard by construction, and the guard *also* exempts `/api/auth/` by
name — the openness of that surface is expressed twice, and `test/security-doc-completeness.test.ts`
reads the second one to derive the unauthenticated surface.

**Layer 4 — `/api/*` (the guard).** Four cases, in order: `/api/auth/*` passes through; the
credential-management paths require a valid owner session; `/api/agent/v1/*` is looked up in
`agentRoute` (unknown path `404`, known path with the wrong method `405`), then authenticated as
an agent credential, then checked against the scope that route demands — a failure writes a
`scope_denied` credential event and returns `403 AGENT SCOPE REQUIRED`; everything else under
`/api/` requires an owner session.

**Per-route middleware.** One path installs its own: `/calendar.ics`, guarded by a session check
inside `src/routes/calendar.ts`. It is a private path for header purposes but it is not under
`/api/`, so the guard in layer 4 never sees it — the check has to live with the route.

**The public routes**, registered last: `GET /manifest.json`, `GET /sw.js`, and `GET /` (the
shell). All three are static payloads from `src/renderer.ts`.

**The internal job paths** are not part of any of the above's authentication: `POST
/internal/jobs/enforcement` and `POST /internal/jobs/alarms` authenticate with a bearer job
secret. They exist so the nightly close and the alarm sweep can be triggered by the Cron Worker
rather than by a logged-in browser.

## 5. The route layer

In the order `src/index.tsx` registers them, which is the order Hono matches them and therefore
what decides which middleware each has already passed.

| Module | Routes | What it serves |
|---|---|---|
| `src/routes/auth.ts` | 4 | Setup, login, logout, status — the only surface reachable with no credential. |
| `src/routes/day.ts` | 14 | The read-only `/api/state` heartbeat, the schedule blocks, block status writes, and the enforcement job path. |
| `src/routes/recovery.ts` | 2 | Re-entry after a break: minimum viable recovery and the catch-up credit. |
| `src/routes/cursor.ts` | 3 | The chapter cursor and the Continuity Brief that reads from it. |
| `src/routes/learn.ts` | 9 | Campaign progression: units, steps, exams, and the progress lock. |
| `src/routes/tongue.ts` | 9 | The wise-response armory and its memorisation drills. |
| `src/routes/economy.ts` | 8 | The seven laws, the daily checks, and the insight surface over them. |
| `src/routes/intel-library.ts` | 6 | Life intel (the Council log) and the books library. |
| `src/routes/calendar.ts` | 1 | The `.ics` export, so device-native alarms can read the schedule. |
| `src/routes/push.ts` | 7 | Web Push subscription and preferences, plus the internal alarm-sweep job path. |
| `src/routes/ratchet.ts` | 3 | The mandatory set, the hold, and promotion. |
| `src/routes/miss-cause.ts` | 2 | Miss diagnosis: a cause is demanded before a miss can be closed. |
| `src/routes/reading.ts` | 4 | Opening, traversing and anchoring a chapter — reading measured rather than clicked. |
| `src/routes/mastery.ts` | 7 | The mastery ladder, its rubric, and calibration. |
| `src/routes/principles.ts` | 7 | Concepts taught with range, and the immune-response drills over them. |
| `src/routes/rhetoric.ts` | 21 | The Farnsworth programme as a track: chapters, slots, drills, metrics. |
| `src/routes/rhetoric-lab.ts` | 15 | Rhetoric Lab and Response Lab: composition, scoring, and history. |
| `src/routes/hermes.ts` | 4 | The council routes — the only routes that can cause an outbound model call. |
| `src/routes/agent-credentials.ts` | 5 | Owner-only credential management: issue, list, revoke, rotate. |
| `src/routes/agent-v1.ts` | 9 | The versioned, scoped agent bridge. POST-only; every route named in `SECURITY.md`. |

## 6. The server modules

### Composition and transport

| Module | Responsibility |
|---|---|
| `src/index.tsx` | The entry. Composes the app: the middleware chain, the error handler, the API guard, all 20 route registrations, and the three public routes. |
| `src/env.ts` | The binding and per-request variable contracts every other module types against. |
| `src/security-headers.ts` | `setSecurityHeaders` and `CONTENT_SECURITY_POLICY` — the only place response hardening is written. |
| `src/validation.ts` | The validation error type and the single failure response every rejected body returns. |
| `src/schemas.ts` | Every request and response schema. Objects are strict, so an unknown key is a rejection rather than a silent acceptance. |
| `src/renderer.ts` | The three static client payloads: the shell HTML, the manifest, and the service worker. No database access, no per-user data. |
| `src/renderer.tsx` | **Unreachable.** A JSX renderer left from before the shell became a static string. `./renderer` resolves to the `.ts` sibling, so it has no importer and the build does not contain it. Recorded rather than removed: deleting it is a code change, and it is scheduled for the work that next touches the renderer. |
| `src/request-support.ts` | Request-time support: the request id, the audit write, idempotency keys, and the alternative-explanation gate. |
| `src/repositories.ts` | Pure data access — settings and schedule blocks — with no business rules of its own. |

### Identity, credentials, and egress

| Module | Responsibility |
|---|---|
| `src/auth.ts` | Sessions: the cookie, the 30-day lifetime, issue, find, validate, revoke, and the owner lookup. |
| `src/crypto.ts` | PBKDF2-SHA256 hashing, the CSRF token derivation, and a timing-safe comparison. |
| `src/agent-auth.ts` | The agent bridge's authority: the scope vocabulary, the route table, credential authentication, the rate limit, and the credential event log. |
| `src/ai.ts` | The model service. The only outbound network call in the application, with its own timeout and an audit row per call. |

### The honesty engine

| Module | Responsibility |
|---|---|
| `src/enforcement.ts` | The close: what a missed window costs, what it locks, and what it writes down. |
| `src/block-status.ts` | The block status vocabulary and the eleven miss causes. The client mirrors this file; `test/block-status-mirror.test.ts` keeps the two in step. |
| `src/scoring.ts` | Adherence arithmetic, extracted so no route can invent its own. |
| `src/scoring-limits.ts` | The caps that keep the ledger honest instead of punitive. |
| `src/streak.ts` | Streak state and delta scoring. |
| `src/ratchet.ts` | The ratchet: three anchors mandatory, the hold, and the promotion rule. |
| `src/state.ts` | The read-only state builder behind the heartbeat. It writes nothing, which is what makes the heartbeat safe to poll. |
| `src/clock.ts` | The server clock. The timezone is captured once; every date after that is derived here, so the client cannot time-travel the engines. |
| `src/time.ts` | Pure date arithmetic with no I/O, so the calendar rules are testable in isolation. |
| `src/tone.ts` | The language rules — firmness without contempt — applied to generated text. |
| `src/commanders-file.ts` | The Commander's File export. Every field it emits is justified individually in `PRIVACY.md`. |
| `src/cursor.ts` | The chapter cursor, held as a database value so no code constant can drift from where the commander actually is. |

### Learning and curriculum

| Module | Responsibility |
|---|---|
| `src/curriculum.ts` | Phase and unit progression, including the progress lock that forbids skipping ahead. |
| `src/books.ts` | The shelf, and what "finished" means for each work on it. |
| `src/reading.ts` | Reading as a measured act: a chapter is opened, traversed, and anchored. |
| `src/mastery.ts` | The mastery ladder and the rubric that decides movement on it. |
| `src/calibration.ts` | Calibration: the distance between claimed confidence and demonstrated recall. |
| `src/cloze.ts` | The cheap half of adversarial grading, done without a model call. |
| `src/fsrs.ts` | Spaced repetition scheduling, FSRS rather than SM-2. |
| `src/principles.ts` | The principle model: a concept, its range, and the immune response to its misuse. |
| `src/intel-domains.ts` | The six domains that sixteen intel categories collapse into. |
| `src/push.ts` | Web Push over VAPID. The message carries no payload; the client fetches after waking. |
| `src/rhetoric.ts` | The Farnsworth programme modelled as a track with chapters and slots. |
| `src/rhetoric-lab.ts` | Scoring for Rhetoric Lab and Response Lab. |

### The Cron Worker

| Module | Responsibility |
|---|---|
| `workers/enforcement-cron/src/index.ts` | A separate Worker with one `scheduled` handler: POST the enforcement job path with the bearer job secret, forwarding Cloudflare Access service-token headers when they are configured. It holds no database binding and no application logic. |

It is a second deployable with its own `wrangler.jsonc`. Deploying it, setting its secrets, and
setting its schedule are operator work (§12). The application does not depend on it being
present — every job path it calls can also be invoked directly with the job secret — but without
it nothing triggers the nightly close automatically.

## 7. The client

`public/static/app/main.js` imports the graph; `vite.client.config.ts` bundles it with Rollup
into the single tracked file `public/static/bundle.js`, as an IIFE targeting ES2020, unminified
so the shipped file stays auditable. `axios` stays external and is provided by a CDN `<script>`
as a global. The shell in `src/renderer.ts` loads that one file. Because Rollup resolves every
import at build time, a misspelled import fails the build instead of becoming a runtime
`ReferenceError` in the browser.

| Module | Responsibility |
|---|---|
| `public/static/app/main.js` | The entry. Imports every module in dependency order; the graph, not a list of script tags, is what defines load order. |
| `public/static/app/core/sanitize.js` | The only place user or model text becomes HTML-safe. Dependency-free, so it initialises before anything that renders. |
| `public/static/app/core/events.js` | Delegated events: one listener maps `data-act` to a registered handler, which is what removes the need for inline `onclick` in generated HTML. |
| `public/static/app/core/block-status.js` | The client mirror of the server's block-status taxonomy: which spelling a button writes, and whether a returned row counts as landed. |
| `public/static/app/core/morph.js` | A self-contained DOM morph, so a re-render does not destroy focus, cursor position, or half-typed text. |
| `public/static/app/core/fx.js` | Feedback: haptics, count-ups, rings, ranks, and sounds. |
| `public/static/app/core/store.js` | The shared store. Every value that used to be a cross-file global is a property of one exported object instead. |
| `public/static/app/core/shell.js` | The frame: the API client, the tab shell, the header, the segments, the status buttons, and the draft mirroring. The largest client module and the one most worth splitting. |
| `public/static/app/features/campaign.js` | The campaign tab: units, step forms, and exam forms. |
| `public/static/app/features/council.js` | The council, Hermes, and intel views, including the bridge-scope selection. |
| `public/static/app/features/debrief.js` | The debrief and stats views: rewards, predictions, and the day's numbers. |
| `public/static/app/features/library.js` | The library and reader views, plus the in-page alarm that reads block times. |
| `public/static/app/features/mind.js` | The mind, cards, and bank views over spaced repetition. |
| `public/static/app/features/response-lab.js` | The Response Lab: categories, modes, cloze and first-letter drills, scoring, and history. |
| `public/static/app/features/rhetoric.js` | The Farnsworth track view: chapters, slots, and metrics. |

## 8. Data

One D1 database, bound as `DB`. Access is raw prepared statements with bound parameters —
`.prepare(...).bind(...)` — with no ORM and no query builder anywhere in `src/`. String
interpolation into SQL appears in exactly one place, in `src/routes/agent-v1.ts`, over a table
name drawn from a fixed in-code list rather than from a request.

Schema changes are forward-only files in `migrations/`, applied in filename order, each with a
rollback note in `OPERATIONS.md`. Evidence tables are made append-only by SQLite triggers rather
than by application discipline; `SECURITY.md` §12 lists which ones, and names the one table
where that is discipline rather than a trigger. `job_runs` records each job invocation so a run
leaves a trace that a later run cannot rewrite.

The static shelf under `public/static/books/` is read-only content served as assets, not rows.

## 9. Build and test topology

| Artifact | Produced by | Tracked |
|---|---|---|
| `dist/_worker.js` | `vite.config.ts` via `@hono/vite-build/cloudflare-pages`, from `src/index.tsx` | No — gitignored |
| `public/static/bundle.js` | `vite.client.config.ts`, from `public/static/app/main.js` | Yes |

`wrangler.jsonc` pins the compatibility date and the bindings; `vitest.config.ts` pins the same
compatibility date so tests run against the runtime semantics the deployment has rather than
against today's calendar.

Two test projects, kept separate so the two runtimes never collide:

- `vitest.config.ts` — the Cloudflare Workers pool, running against `src/index.tsx` with a real
  D1 binding. It excludes `**/*.dom.test.ts`.
- `vitest.dom.config.ts` — happy-dom in plain Node, running only `test/**/*.dom.test.ts`. These
  import the **built** bundle, so the client build has to happen before them.

One command is the whole gate — `npm run verify` — and it runs, in order:

1. `npm run build` — the client bundle and then the worker.
2. `npm test` — both projects, server then DOM.
3. `tsc --noEmit` — types, which neither test project checks.
4. `git diff --check` — whitespace damage.
5. `git diff --exit-code -- public/static/bundle.js` — the tracked bundle must already match
   what the build produces, so a source change committed without its rebuilt bundle fails here
   instead of shipping a stale client.

CI runs the same single command; there is no second list of steps to drift from this one.

## 10. How the tests read the repository

Many guards in `test/` assert things about the repository itself — that a document matches the
code, that a count matches a glob. They can do that inside the Workers pool, which cannot read
disk at runtime, because Vite resolves `?raw` imports and `import.meta.glob` at build time. Two
consequences are worth knowing before writing another such guard: a `?raw` import of a file that
does not exist breaks the module graph rather than returning empty, and `import.meta.glob`
excludes the file that calls it.

## 11. What this architecture does not have

Stated because a reader who assumes otherwise will plan wrongly.

1. **No client-side routing.** Tabs are DOM state. There is no hash route and no History API use,
   so a reload returns to the default view and no view is linkable.
2. **No offline write queue.** `localStorage` holds textarea drafts and alarm preferences only. A
   write attempted with no connectivity fails and is not retried; the draft survives, the request
   does not. The service worker caches responses but does not queue requests.
3. **The service worker's cache name is a fixed literal**, and `activate` claims clients without
   deleting older caches. A deploy therefore cannot reliably invalidate what a returning client
   already holds. This is known, recorded in `STATUS.md`, and owed.
4. **No shared validation between client and server.** Schemas exist only on the server; the
   client is not a second validator and must not be trusted as one.
5. **The block-status taxonomy exists twice** — once in `src/block-status.ts` and once in
   `public/static/app/core/block-status.js` — because the interface has to decide what a button
   writes. That duplication is deliberate and guarded by `test/block-status-mirror.test.ts` and
   `test/status-literal-drift.test.ts`, which is what keeps it from becoming a fork.
6. **No retry or delivery guarantee on push.** A failed send is recorded and not retried.
7. **`src/routes/rhetoric.ts` and `public/static/app/core/shell.js` are large** — 21 routes and
   the entire client frame respectively. Both work and both are harder to reason about than the
   modules around them.
8. **One module is present and not built** — see `src/renderer.tsx` in §6.
9. **No structured logging, no metrics, no tracing.** `console.error` in the error handler is the
   whole observability story, and it is readable only by the operator.
10. **No multi-user design.** The application is single-owner throughout: one owner row, one
    session cookie name, and at least one uniqueness constraint that is correct only while a
    single owner exists (`SECURITY.md` §13.9).

## 12. The operator boundary

This repository ends at its source, its migrations, its tests, and its runbook. A separate
operator owns everything at the edge, and nothing here can guarantee any of it:

- The Cloudflare Pages project, its domain, and every deploy.
- Cloudflare Access — the outer authentication layer in front of the application.
- All secrets and bindings: the D1 binding, the model provider key, the VAPID keys, the job
  secret, the allowed origins.
- The Cron Worker's deployment, its schedule, and its service tokens.
- Production credential rotation and database backup.

`OPERATIONS.md` documents how each of those is done; `OPERATOR_HANDOFF.md` records what has been
handed over. Where this document describes the deployed shape of the system, it is describing
what the source expects — not something it can verify.
