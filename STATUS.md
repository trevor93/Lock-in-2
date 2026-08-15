# Lock-In / War Room Remediation Status

> Governing document: `MASTERPROMPT.md` (read-only). Branch: `refactor/strategic-judgment-os`. Last verified: 2026-08-15. Phase 0 is **IN PROGRESS**. No production deployment, production migration, production D1 backup, Cloudflare change, secret change, credential rotation, Cron deployment, or repository-visibility change is claimed here.

## Current Gate

- PHASE-0 [IN PROGRESS] Book 5 security and data integrity is the only active implementation phase.
- PHASE-0-ORDER [IN PROGRESS] The accepted first slice covered Books 5.1 and 5.3. Books 5.2 and 5.4 are complete in source and local tests; Books 5.5, 5.6, and 5.7 remain NOT STARTED. Every Book 5.8 item is enumerated below.
- OPERATOR-BOUNDARY [DONE] Production D1 backup/application, Cloudflare Access, Cloudflare secrets, production credential rotation, Cron deployment, repository visibility, and every deployment are permanently operator-controlled. Repository work is limited to code, local schema-copy tests, documentation, commits, and branch pushes.
- ASSUMPTION-2026-08-15 [IN PROGRESS] Smallest defensible ownership migration: create one durable owner from the existing installation during migration, preserve every record, and require independent route authorization; production application remains gated by `OPERATIONS.md`.

## Book 3 — Verified System Inventory

### Routes

- B3.R1 [DONE] Auth — `GET /api/auth/status` at `src/index.tsx:482`; `POST /api/auth/setup` at `src/index.tsx:492`; `POST /api/auth/login` at `src/index.tsx:507`; `POST /api/auth/logout` at `src/index.tsx:535`.
- B3.R2 [DONE] State/enforcement — `GET /api/state` at `src/index.tsx:953`; `POST /api/tick` at `src/index.tsx:960`; protected `POST /internal/jobs/enforcement` at `src/index.tsx:990`.
- B3.R3 [DONE] Blocks/appeals/load — `POST /api/blocks/:id/log` at `src/index.tsx:1007`; `POST /api/appeals` at `src/index.tsx:1058`; `GET /api/appeals` at `src/index.tsx:1113`; `POST /api/load-reductions/:id/answer` at `src/index.tsx:1124`.
- B3.R4 [DONE] Predictions — `POST /api/predictions` at `src/index.tsx:1142`; `GET /api/predictions` at `src/index.tsx:1155`; `POST /api/predictions/:id/resolve` at `src/index.tsx:1162`; `GET /api/predictions/calibration` at `src/index.tsx:1177`.
- B3.R5 [DONE] Debriefs — `POST /api/debrief` at `src/index.tsx:1210`; `GET /api/debriefs` at `src/index.tsx:1251`.
- B3.R6 [DONE] Campaign — `GET /api/campaign` at `src/index.tsx:1292`; `POST /api/units/:id/step` at `src/index.tsx:1310`.
- B3.R7 [DONE] Maxims/cards — `GET /api/maxims` at `src/index.tsx:1402`; `POST /api/maxims` at `src/index.tsx:1408`; `POST /api/maxims/:id/my-words` at `src/index.tsx:1421`; `GET /api/cards/due` at `src/index.tsx:1442`; `POST /api/cards/:maximId/review` at `src/index.tsx:1453`.
- B3.R8 [DONE] Flags — `POST /api/flags/:id/ack` at `src/index.tsx:1487`; `GET /api/flags/history` at `src/index.tsx:1496`.
- B3.R9 [DONE] Tongue — `POST /api/tongue` at `src/index.tsx:1516`; `GET /api/tongue` at `src/index.tsx:1539`; `PUT /api/tongue/:id` at `src/index.tsx:1560`; `DELETE /api/tongue/:id` at `src/index.tsx:1572`; `GET /api/tongue/due` at `src/index.tsx:1584`; `POST /api/tongue/:id/review` at `src/index.tsx:1605`; `GET /api/tongue/exam` at `src/index.tsx:1663`; `POST /api/tongue/exam/submit` at `src/index.tsx:1673`; `GET /api/tongue/stats` at `src/index.tsx:1697`.
- B3.R10 [DONE] Laws/rewards/stats — `GET /api/laws` at `src/index.tsx:1739`; `POST /api/laws/:id/check` at `src/index.tsx:1749`; `GET /api/rewards` at `src/index.tsx:1770`; `POST /api/rewards/:id/redeem` at `src/index.tsx:1774`; `GET /api/stats` at `src/index.tsx:1804`.
- B3.R11 [DONE] Intel — `GET /api/intel` at `src/index.tsx:1907`; `POST /api/intel` at `src/index.tsx:1923`; `POST /api/intel/:id/verdict` at `src/index.tsx:1943`; `POST /api/intel/:id/analyze` at `src/index.tsx:2211`.
- B3.R12 [DONE] Library/calendar — `GET /api/library` at `src/index.tsx:1975`; `POST /api/library/:bookId/chapter/:idx` at `src/index.tsx:1989`; calendar authentication middleware at `src/index.tsx:2040`; `GET /calendar.ics` at `src/index.tsx:2045`.
- B3.R13 [DONE] Hermes — `POST /api/hermes` at `src/index.tsx:2126`; `GET /api/hermes/history` at `src/index.tsx:2172`; `POST /api/hermes/council` at `src/index.tsx:2180`.
- B3.R14 [DONE] Agent — retired read-only `GET /api/agent/token` at `src/index.tsx:2277`; `POST /api/agent/token/rotate` at `src/index.tsx:2280`; `GET /api/agent/briefing` at `src/index.tsx:2289`; `GET /api/agent/pending` at `src/index.tsx:2305`; `POST /api/agent/intel` at `src/index.tsx:2333`; `POST /api/agent/debrief` at `src/index.tsx:2349`; `POST /api/agent/block-log` at `src/index.tsx:2388`; `POST /api/agent/message` at `src/index.tsx:2425`; `GET /api/agent/export` at `src/index.tsx:2438`.
- B3.R15 [DONE] Shell/PWA — `GET /manifest.json` at `src/index.tsx:2450`; `GET /sw.js` at `src/index.tsx:2456`; `GET /` at `src/index.tsx:2481`.
- B3.R16 [DONE] Counts — baseline source had 61 explicit routes. Current source has 62 explicit routes: the compatibility token GET remains as a non-mutating 405 and the internal enforcement POST was added. Current mutating surface is 34 explicit POST/PUT/DELETE handlers including logout's cookie deletion and the protected internal job; no explicit HEAD handler exists.

### Data

- B3.D1 [DONE] `migrations/0001_initial_schema.sql` defines `schedule_blocks`, `block_logs`, `debriefs`, `phases`, `units`, `unit_progress`, `maxims`, `flashcards`, `card_reviews`, `honesty_flags`, `points_ledger`, `rewards`, `reward_redemptions`, `laws`, `law_checks`, and `settings` with the columns recorded in that migration plus additive changes in `migrations/0004_reforge.sql`.
- B3.D2 [DONE] `migrations/0002_intel_books_alarms.sql` defines `intel_entries`, `book_progress`, and `hermes_messages`.
- B3.D3 [DONE] `migrations/0003_tongue.sql` defines `responses`, `response_srs`, `tongue_reviews`, and `tongue_exams`.
- B3.D4 [DONE] `migrations/0004_reforge.sql` defines `day_summary`, `predictions`, `appeals`, and `load_reductions`, and adds weighting/MVD and flag-reference fields.
- B3.D5 [DONE] `migrations/0005_sessions_and_ownership.sql` adds durable `users` and hashed-token `sessions`, adds and backfills `user_id` on all 23 personal tables, and preserves the legacy verifier and all seeded rows in `test/migration-0005.test.ts`. Total current schema is 29 tables across five migrations, not README's claimed 24.

### Frontend, integrations, and dependencies

- B3.F1 [DONE] `public/static/app.js` owns setup/login, API calls, NOW/DAY, blocks, appeals, load reduction, drafts, navigation, and refresh via `POST /api/tick`.
- B3.F2 [DONE] `public/static/app2.js` owns campaign/unit progression; `public/static/app3.js` owns maxims/cards; `public/static/app4.js` owns debriefs/rewards/predictions/stats; `public/static/app5.js` owns alarms/books/calendar; `public/static/app6.js` owns Hermes/intel/bridge; `public/static/app7.js` owns Tongue; `public/static/fx.js` owns effects.
- B3.F3 [DONE] Bridge token display is now explicit rotation-only: in-memory `BRIDGE_TOKEN` at `public/static/app6.js:28`, bridge dialog at `public/static/app6.js:29`, and rotation at `public/static/app6.js:52`. It no longer retrieves a credential by GET.
- B3.F4 [DONE] `public/static/hermes_bridge.py` reads `WARROOM_URL`, `WARROOM_TOKEN`, optional Telegram settings, and authenticates with `X-Agent-Token`; it uses TLS verification defaults and request timeouts.
- B3.F5 [DONE] Model routes read private D1 context, call `${OPENAI_BASE_URL}/chat/completions` with `OPENAI_API_KEY`, use `gpt-5-mini`, and persist model output. Book 5.6 controls remain absent.
- B3.F6 [DONE] The service worker is generated by `src/index.tsx:2456`; it lazy cache-first stores only `/static/books/*`, does not intercept private APIs, has no shell precache/offline write queue/old-cache cleanup, and uses `warroom-v1`.
- B3.F7 [DONE] `package.json` has Hono and Zod as runtime dependencies and Vite, Wrangler, Vitest, the Cloudflare Workers pool, and Workers types as development dependencies. `vite.config.ts`, `vitest.config.ts`, `wrangler.jsonc`, and `workers/enforcement-cron/wrangler.jsonc` are the verified runtime/test configurations.
- B3.F8 [DONE] Credential/configuration names—not values—are `DB`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `ENFORCEMENT_JOB_SECRET`, `ALLOWED_ORIGINS`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `WARROOM_URL`, `WARROOM_TOKEN`, `TG_BOT_TOKEN`, `TG_CHAT_ID`, and `WATCH_INTERVAL`. Values were not copied.

### Confirmed discrepancies and risks

- B3.X1 [DONE] Governing document repository identity differs from actual configured repository `trevor93/Lock-in-2`.
- B3.X2 [DONE] `README.md` says production is pending, eight tabs, and 24 tables; repository/deployment evidence shows a live deployment, nine frontend tabs, and 27 tables.
- B3.X3 [DONE] Inspected production is older than source: production `/api/auth/status` returned 404 while source defines it.
- B3.X4 [DONE] Governing provisional service-worker inventory says book data is precached; source lazy-caches each book only after a successful request.
- B3.X5 [DONE] `src/index.tsx` remains a multi-responsibility server monolith. The fixed Book 7 refactor remains deferred until Phase 0 and the deliberately earlier product corrections pass.
- B3.X6 [DONE] Dependency installation reported audit advisories and blocked install scripts. These are observations, not confirmed exploitable defects; dependency remediation may not displace P0 work.

## Book 5 — Phase 0 Security and Data Integrity

### 5.1 Perimeter

- B5.1.1 [BLOCKED — OPERATOR] Production agent credential exposure is remediated in source but remains a production risk until operator deployment and rotation under `OPERATIONS.md`.
- B5.1.2 [BLOCKED — OPERATOR] Full-host Cloudflare Access remains operator-controlled under `OPERATIONS.md`.
- B5.1.3 [BLOCKED — OPERATOR] Repository privacy remains operator-controlled. `MASTERPROMPT.md` is ignored in `.gitignore` until the operator confirms signed-out repository denial; `OPERATIONS.md` tells the operator to notify the owner before the ignore is removed and the exact file is committed.
- B5.1.4 [BLOCKED — DESTRUCTIVE] Git-history stripping is destructive and cannot proceed without backup, stated consequence, and explicit approval.

### 5.2 Sessions and ownership

- B5.2 [DONE — SOURCE/LOCAL TESTED] `migrations/0005_sessions_and_ownership.sql` creates the durable owner and hashed-token session store, preserves the legacy verifier, and additively backfills `user_id` across all 23 personal tables without deleting or rebuilding records. Browser sessions use random opaque tokens, SHA-256 hashes at rest, expiry, `HttpOnly; Secure; SameSite=Lax` host-only cookies, logout revocation, login rotation, and fixation denial in `src/index.tsx:124-238`. Personal browser, calendar, Hermes/model-context, internal-enforcement, and current agent-bridge queries enforce the credential/session owner. `test/migration-0005.test.ts:6` proves exact per-table row-count preservation and ownership on a populated pre-`0005` schema copy; `test/session-ownership.test.ts:96` covers cookie attributes, hashed storage, production-format expiry, revocation, rotation, rollback-era row claiming, ownership columns, cross-user reads/updates/appends, calendar, Hermes context, agent export, and load reductions. The full 26-test suite, production build, TypeScript no-emit check, and diff-integrity check passed on 2026-08-15. This is explicitly a durable single-owner boundary, not self-service multi-tenancy; Book 5.5 still owns the agent-credential redesign.

### 5.3 Read safety and enforcement

- B5.3.1 [DONE — SOURCE] Private path classification is `src/index.tsx:25`; private-response middleware begins at `src/index.tsx:60`.
- B5.3.2 [DONE — SOURCE] Shared enforcement is `src/index.tsx:978`, browser invocation remains `POST /api/tick` at `src/index.tsx:960`, and protected internal invocation is `src/index.tsx:990`.
- B5.3.3 [DONE — TESTED] `test/get-read-only.test.ts:113` proves repeated `GET`/`HEAD /api/state` executes zero mutating SQL; `test/get-read-only.test.ts:131` covers every explicit private GET/HEAD route and missing-token paths.
- B5.3.4 [DONE — TESTED] `test/security-boundary.test.ts:244` and `test/security-boundary.test.ts:263` prove the internal route is POST-only, authenticated, server-clocked, and consequence-idempotent.
- B5.3.5 [DONE — SOURCE/TEST] Scheduled caller implementation is `workers/enforcement-cron/src/index.ts:8`; scheduled handler is `workers/enforcement-cron/src/index.ts:26`; Access-header coverage is `workers/enforcement-cron/src/index.test.ts:30`. Deployment is operator-controlled.

### 5.4 CORS, headers, validation, and CSRF

- B5.4.1 [DONE — SOURCE/LOCAL TESTED] The global response boundary at `src/index.tsx:25-132` defaults browser CORS to same-origin, accepts only explicitly configured origins, handles allowlisted credentialed preflight without wildcard CORS, keeps the separately authenticated Termux bridge available to non-browser requests, applies `Cache-Control: no-store` to private success/error responses, sets CSP with `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a restrictive `Permissions-Policy`, and caps API/internal payloads at 64 KiB. `test/security-boundary.test.ts:58-241` covers the browser origin boundary, private no-store behavior, calendar protection, required headers, issued/restored CSRF proof, valid/invalid/missing CSRF proof, and oversize rejection.
- B5.4.2 [DONE — SOURCE/LOCAL TESTED] Browser session setup/login/status issue the derived SHA-256 CSRF proof at `src/index.tsx:403-458` and `src/index.tsx:482-533`; cookie-authenticated API mutations require it at `src/index.tsx:96-109`. The frontend stores the proof only in memory and attaches it to same-origin unsafe requests at `public/static/app.js:6-16`, `public/static/app.js:67-74`, and `public/static/app.js:405-415`. Agent requests with `X-Agent-Token` and the independently authenticated internal job do not inherit the browser-cookie CSRF contract.
- B5.4.3 [DONE — SOURCE/LOCAL TESTED] Zod is a direct runtime dependency. Controlled malformed-JSON handling, strict empty-body parsing, and parameter/query parsing are at `src/index.tsx:133-344`. All explicit mutation handlers parse strict schemas or an explicit empty body; route IDs, book IDs/chapter ranges, dates, times, enums, bounded strings, booleans, integers, arrays, and numeric ranges are validated. Parsed schema output is the only assignment input, so unknown fields and mass assignment are rejected. `test/request-validation.test.ts:82-270` covers 14 malformed/unknown/mass-assignment/identifier/range/date/query/time/empty-body/valid-request cases, including rejection of identifiers outside JavaScript's safe-integer range.
- B5.4.4 [DONE — SOURCE/LOCAL TESTED] Legal workflow transitions are enforced for ordinary units, active/failed/passed exams, book reading/completion, prediction resolution, intel verdicts, due flashcard/tongue reviews, archived tongue responses, and browser/agent attempts to rewrite auto-missed blocks. `test/legal-state-transitions.test.ts:108-510` contains 9 focused tests and proves terminal rewards are not duplicated.
- B5.4.5 [DONE — VERIFIED] On 2026-08-15, focused validation passed 14/14, focused legal transitions passed 9/9, focused browser-boundary coverage passed 10/10, the complete suite passed 54/54 across 7 files, `npx tsc --noEmit` passed, and the Vite production build passed with 108 modules and `dist/_worker.js` at 175.28 kB. `git diff --check` reported no whitespace errors and LF-to-CRLF warnings for `OPERATIONS.md`, `STATUS.md`, `test/security-boundary.test.ts`, and `test/session-ownership.test.ts`; a value-suppressing secret-pattern scan across source, public assets, workers, and root configuration found zero high-confidence credential signatures. The independent read-only reviewer could not complete because its provider returned HTTP 429, so no reviewer approval is claimed. Book 5.4 introduces no schema change or migration; rollback is application-code rollback under `OPERATIONS.md` Section 6 while retaining the additive Book 5.2 schema.

### 5.5 Agent tokens as scoped credentials

- B5.5 [NOT STARTED] The emergency first slice retired raw-token GET/generation-on-read, but the durable requirement is absent: no hashed credential table, device labels, scopes, expiry, revocation, last-used metadata, coarse request metadata, rate limit, versioned API, revocation interface, or default export separation. Current `settings.agent_token` remains a broad plaintext credential until this section is implemented.

### 5.6 Model security, prompt injection, and cost

- B5.6 [NOT STARTED] Model routes lack complete owner-only tests, rate limits, daily/monthly budgets, request/output limits, timeout/bounded retry policy, pinned allowlist, audit events, safe no-key behavior, upstream-error redaction, explicit untrusted-content fencing/layering, and structured-output validation.

### 5.7 Audit and idempotency

- B5.7 [NOT STARTED] `audit_events` and general request/job idempotency do not exist. Local uniqueness prevents some duplicate flags/points/reward effects, but it does not satisfy append-only actor/request auditing or all required idempotency paths.

### 5.8 Blocking acceptance matrix

- B5.8.1 [PARTIAL] Unauthenticated private access denied — `test/security-boundary.test.ts:90-107` covers `/api/state` and `/calendar.ics`; exhaustive private-route denial is NOT COVERED.
- B5.8.2 [COVERED] Valid session accepted — `test/session-ownership.test.ts:127-142` proves a real hashed session is accepted; calendar success is also asserted at `test/security-boundary.test.ts:103-106`.
- B5.8.3 [COVERED] Expired session rejected — `test/session-ownership.test.ts:144-164` covers fixed-past and production ISO timestamps.
- B5.8.4 [COVERED] Logout revokes the server-side session — `test/session-ownership.test.ts:167-181`.
- B5.8.5 [COVERED FOR CURRENT PERSONAL SURFACE] Cross-user reads, record updates, append attempts, state totals, calendar export, Hermes briefing/model context, agent export, predictions, responses, and load reductions are denied or filtered in `test/session-ownership.test.ts:215-525`.
- B5.8.6 [NOT COVERED] Agent scope enforced.
- B5.8.7 [NOT COVERED] Revoked agent credential denied.
- B5.8.8 [NOT COVERED] Expired agent credential denied.
- B5.8.9 [NOT COVERED / CURRENTLY FAILS DESIGN] Raw agent credential never stored; current source stores `settings.agent_token` plaintext.
- B5.8.10 [NOT COVERED] Export scope separated and not granted by default.
- B5.8.11 [COVERED] `GET /api/state` performs zero writes — `test/get-read-only.test.ts:113`.
- B5.8.12 [COVERED] Repeated GET produces zero penalties — `test/get-read-only.test.ts:113` repeats GET/HEAD and instruments all mutating SQL.
- B5.8.13 [COVERED] Crawler-pattern access alters nothing — `test/get-read-only.test.ts:113` and all-route coverage at `test/get-read-only.test.ts:131`.
- B5.8.14 [NOT COVERED] Model endpoint denies unauthenticated calls with model-specific proof.
- B5.8.15 [NOT COVERED] Model rate limit fires.
- B5.8.16 [NOT COVERED] Model input-size limit fires.
- B5.8.17 [NOT COVERED] Model/API key and raw upstream errors never leak.
- B5.8.18 [NOT COVERED] Retrieved content cannot authorize a write.
- B5.8.19 [NOT COVERED] Structured model output is schema-validated.

## Book 17 — Fixed Execution and Reporting

- B17.1 [IN PROGRESS] Fixed sequence: finish Book 5/5.8; Book 6; `/catchup` plus Books 8.6 and 8.2 recovery scoring; Book 13.2 alternative-explanation gate; Books 14 and 16 Continuity Brief/chapter cursor; Book 7 refactor; Book 9 UX/ratchet; Book 10 learning; Books 11–12 rhetoric; Book 13 decision lab; Book 15 Hermes offices; PWA/accessibility/performance.
- B17.2 [DONE] Baseline rollback base is `a927e97`; first-slice commits are `c3e3557`, `f725397`, `1c25ce9`, and `ad19313`.
- B17.3 [DONE] First-slice verification: 9 tests across 3 files, Vite build, TypeScript no-emit check, Cron Worker Wrangler dry run, and `git diff --check` passed on 2026-08-15.
- B17.4 [DONE] Account/operator documentation is consolidated into root `OPERATIONS.md`; `OPERATIONS_FIRST_SLICE.md` is superseded and removed.
- B17.5 [IN PROGRESS] Every schema change must add a numbered migration, migration-specific rollback note in `OPERATIONS.md`, and a test against a local D1/schema copy before code may be reported complete. Book 5.2 satisfies this repository gate through `migrations/0005_sessions_and_ownership.sql`, `OPERATIONS.md` Section 5.1, and `test/migration-0005.test.ts`; production application remains operator-controlled.
- B17.6 [IN PROGRESS] Commits remain separated by concern. Push `refactor/strategic-judgment-os` at each completed phase boundary. Never claim production application or deployment.
- B17.7 [DONE — LOCAL COMMIT] Book 5.2 source, migration, and regression coverage are committed as `9125f45`; operator and status documentation are committed separately. Production migration and deployment remain unclaimed and operator-controlled.
- B17.8 [DONE — LOCAL COMMITS] Book 5.4 headers, CORS, no-store, CSRF, payload limits, strict request validation, mass-assignment prevention, and legal-transition controls passed the evidence recorded in B5.4.5 and are committed as `980c20b`; operator/status documentation is committed separately. This slice has no schema migration. Phase 0 remains IN PROGRESS because Books 5.5-5.7 and uncovered Book 5.8 acceptance items remain open; no production deployment or operator action is claimed.
