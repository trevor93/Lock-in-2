# Lock-In / War Room Remediation Status

> Governing document: `MASTERPROMPT.md` (read-only). Branch: `refactor/strategic-judgment-os`. Last verified: 2026-08-15. Phase 0 is **IN PROGRESS**. No production deployment, production migration, production D1 backup, Cloudflare change, secret change, credential rotation, Cron deployment, or repository-visibility change is claimed here.

## Current Gate

- PHASE-0 [IN PROGRESS] Book 5 security and data integrity is the only active implementation phase.
- PHASE-0-ORDER [DONE] The accepted first slice covered part of Books 5.1, 5.3, and 5.4. Books 5.2, 5.5, 5.6, and 5.7 remain NOT STARTED. Every Book 5.8 item is enumerated below.
- OPERATOR-BOUNDARY [DONE] Production D1 backup/application, Cloudflare Access, Cloudflare secrets, production credential rotation, Cron deployment, repository visibility, and every deployment are permanently operator-controlled. Repository work is limited to code, local schema-copy tests, documentation, commits, and branch pushes.
- ASSUMPTION-2026-08-15 [IN PROGRESS] Smallest defensible ownership migration: create one durable owner from the existing installation during migration, preserve every record, and require independent route authorization; production application remains gated by `OPERATIONS.md`.

## Book 3 — Verified System Inventory

### Routes

- B3.R1 [DONE] Auth — `GET /api/auth/status` at `src/index.tsx:125`; `POST /api/auth/setup` at `src/index.tsx:129`; `POST /api/auth/login` at `src/index.tsx:143`; `POST /api/auth/logout` at `src/index.tsx:163`.
- B3.R2 [DONE] State/enforcement — `GET /api/state` at `src/index.tsx:510`; `POST /api/tick` at `src/index.tsx:516`; protected `POST /internal/jobs/enforcement` at `src/index.tsx:541`.
- B3.R3 [DONE] Blocks/appeals/load — `POST /api/blocks/:id/log` at `src/index.tsx:555`; `POST /api/appeals` at `src/index.tsx:594`; `GET /api/appeals` at `src/index.tsx:632`; `POST /api/load-reductions/:id/answer` at `src/index.tsx:640`.
- B3.R4 [DONE] Predictions — `POST /api/predictions` at `src/index.tsx:656`; `GET /api/predictions` at `src/index.tsx:669`; `POST /api/predictions/:id/resolve` at `src/index.tsx:673`; `GET /api/predictions/calibration` at `src/index.tsx:686`.
- B3.R5 [DONE] Debriefs — `POST /api/debrief` at `src/index.tsx:718`; `GET /api/debriefs` at `src/index.tsx:739`.
- B3.R6 [DONE] Campaign — `GET /api/campaign` at `src/index.tsx:774`; `POST /api/units/:id/step` at `src/index.tsx:790`.
- B3.R7 [DONE] Maxims/cards — `GET /api/maxims` at `src/index.tsx:843`; `POST /api/maxims` at `src/index.tsx:847`; `POST /api/maxims/:id/my-words` at `src/index.tsx:855`; `GET /api/cards/due` at `src/index.tsx:864`; `POST /api/cards/:maximId/review` at `src/index.tsx:873`.
- B3.R8 [DONE] Flags — `POST /api/flags/:id/ack` at `src/index.tsx:897`; `GET /api/flags/history` at `src/index.tsx:901`.
- B3.R9 [DONE] Tongue — `POST /api/tongue` at `src/index.tsx:919`; `GET /api/tongue` at `src/index.tsx:936`; `PUT /api/tongue/:id` at `src/index.tsx:950`; `DELETE /api/tongue/:id` at `src/index.tsx:958`; `GET /api/tongue/due` at `src/index.tsx:965`; `POST /api/tongue/:id/review` at `src/index.tsx:985`; `GET /api/tongue/exam` at `src/index.tsx:1025`; `POST /api/tongue/exam/submit` at `src/index.tsx:1034`; `GET /api/tongue/stats` at `src/index.tsx:1053`.
- B3.R10 [DONE] Laws/rewards/stats — `GET /api/laws` at `src/index.tsx:1081`; `POST /api/laws/:id/check` at `src/index.tsx:1088`; `GET /api/rewards` at `src/index.tsx:1098`; `POST /api/rewards/:id/redeem` at `src/index.tsx:1102`; `GET /api/stats` at `src/index.tsx:1128`.
- B3.R11 [DONE] Intel — `GET /api/intel` at `src/index.tsx:1211`; `POST /api/intel` at `src/index.tsx:1219`; `POST /api/intel/:id/verdict` at `src/index.tsx:1233`; `POST /api/intel/:id/analyze` at `src/index.tsx:1433`.
- B3.R12 [DONE] Library/calendar — `GET /api/library` at `src/index.tsx:1255`; `POST /api/library/:bookId/chapter/:idx` at `src/index.tsx:1267`; calendar authentication middleware at `src/index.tsx:1287`; `GET /calendar.ics` at `src/index.tsx:1292`.
- B3.R13 [DONE] Hermes — `POST /api/hermes` at `src/index.tsx:1362`; `GET /api/hermes/history` at `src/index.tsx:1400`; `POST /api/hermes/council` at `src/index.tsx:1406`.
- B3.R14 [DONE] Agent — retired read-only `GET /api/agent/token` at `src/index.tsx:1486`; `POST /api/agent/token/rotate` at `src/index.tsx:1489`; `GET /api/agent/briefing` at `src/index.tsx:1496`; `GET /api/agent/pending` at `src/index.tsx:1509`; `POST /api/agent/intel` at `src/index.tsx:1530`; `POST /api/agent/debrief` at `src/index.tsx:1543`; `POST /api/agent/block-log` at `src/index.tsx:1566`; `POST /api/agent/message` at `src/index.tsx:1577`; `GET /api/agent/export` at `src/index.tsx:1587`.
- B3.R15 [DONE] Shell/PWA — `GET /manifest.json` at `src/index.tsx:1597`; `GET /sw.js` at `src/index.tsx:1603`; `GET /` at `src/index.tsx:1628`.
- B3.R16 [DONE] Counts — baseline source had 61 explicit routes. Current source has 62 explicit routes: the compatibility token GET remains as a non-mutating 405 and the internal enforcement POST was added. Current mutating surface is 33 explicit POST/PUT/DELETE handlers including logout's cookie deletion; no explicit HEAD handler exists.

### Data

- B3.D1 [DONE] `migrations/0001_initial_schema.sql` defines `schedule_blocks`, `block_logs`, `debriefs`, `phases`, `units`, `unit_progress`, `maxims`, `flashcards`, `card_reviews`, `honesty_flags`, `points_ledger`, `rewards`, `reward_redemptions`, `laws`, `law_checks`, and `settings` with the columns recorded in that migration plus additive changes in `migrations/0004_reforge.sql`.
- B3.D2 [DONE] `migrations/0002_intel_books_alarms.sql` defines `intel_entries`, `book_progress`, and `hermes_messages`.
- B3.D3 [DONE] `migrations/0003_tongue.sql` defines `responses`, `response_srs`, `tongue_reviews`, and `tongue_exams`.
- B3.D4 [DONE] `migrations/0004_reforge.sql` defines `day_summary`, `predictions`, `appeals`, and `load_reductions`, and adds weighting/MVD and flag-reference fields.
- B3.D5 [DONE] Total current schema: 27 tables across four migrations, not README's claimed 24. No migration was changed by the first slice.

### Frontend, integrations, and dependencies

- B3.F1 [DONE] `public/static/app.js` owns setup/login, API calls, NOW/DAY, blocks, appeals, load reduction, drafts, navigation, and refresh via `POST /api/tick`.
- B3.F2 [DONE] `public/static/app2.js` owns campaign/unit progression; `public/static/app3.js` owns maxims/cards; `public/static/app4.js` owns debriefs/rewards/predictions/stats; `public/static/app5.js` owns alarms/books/calendar; `public/static/app6.js` owns Hermes/intel/bridge; `public/static/app7.js` owns Tongue; `public/static/fx.js` owns effects.
- B3.F3 [DONE] Bridge token display is now explicit rotation-only: in-memory `BRIDGE_TOKEN` at `public/static/app6.js:28`, bridge dialog at `public/static/app6.js:29`, and rotation at `public/static/app6.js:52`. It no longer retrieves a credential by GET.
- B3.F4 [DONE] `public/static/hermes_bridge.py` reads `WARROOM_URL`, `WARROOM_TOKEN`, optional Telegram settings, and authenticates with `X-Agent-Token`; it uses TLS verification defaults and request timeouts.
- B3.F5 [DONE] Model routes read private D1 context, call `${OPENAI_BASE_URL}/chat/completions` with `OPENAI_API_KEY`, use `gpt-5-mini`, and persist model output. Book 5.6 controls remain absent.
- B3.F6 [DONE] The service worker is generated by `src/index.tsx:1603`; it lazy cache-first stores only `/static/books/*`, does not intercept private APIs, has no shell precache/offline write queue/old-cache cleanup, and uses `warroom-v1`.
- B3.F7 [DONE] `package.json` has Hono as runtime dependency and Vite, Wrangler, Vitest, the Cloudflare Workers pool, and Workers types as development dependencies. `vite.config.ts`, `vitest.config.ts`, `wrangler.jsonc`, and `workers/enforcement-cron/wrangler.jsonc` are the verified runtime/test configurations.
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

- B5.2 [NOT STARTED] No `users` or hashed-token `sessions` table exists; personal tables lack comprehensive `user_id`; current sessions derive from settings-held HMAC material rather than durable revocable session records; cross-user authorization is unimplemented.

### 5.3 Read safety and enforcement

- B5.3.1 [DONE — SOURCE] Private path classification is `src/index.tsx:13`; private-response middleware begins at `src/index.tsx:28`.
- B5.3.2 [DONE — SOURCE] Shared enforcement is `src/index.tsx:529`, browser invocation remains `POST /api/tick` at `src/index.tsx:516`, and protected internal invocation is `src/index.tsx:541`.
- B5.3.3 [DONE — TESTED] `test/get-read-only.test.ts:91` proves repeated `GET`/`HEAD /api/state` executes zero mutating SQL; `test/get-read-only.test.ts:110` covers every explicit private GET/HEAD route and missing-token paths.
- B5.3.4 [DONE — TESTED] `test/security-boundary.test.ts:80` proves the internal route is POST-only, authenticated, server-clocked, and consequence-idempotent.
- B5.3.5 [DONE — SOURCE/TEST] Scheduled caller implementation is `workers/enforcement-cron/src/index.ts:8`; scheduled handler is `workers/enforcement-cron/src/index.ts:26`; Access-header coverage is `workers/enforcement-cron/src/index.test.ts:30`. Deployment is operator-controlled.

### 5.4 CORS, headers, validation, and CSRF

- B5.4.1 [DONE — SOURCE/TESTED] Same-origin/explicit allowlist CORS and private no-store behavior are implemented at `src/index.tsx:28` and tested in `test/security-boundary.test.ts:28`.
- B5.4.2 [NOT STARTED] CSP including `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy` are not implemented.
- B5.4.3 [NOT STARTED] Comprehensive Zod/Hono validation, strict unknown-field rejection, payload limits, legal transition validation, mass-assignment prevention, and CSRF protection are not implemented.

### 5.5 Agent tokens as scoped credentials

- B5.5 [NOT STARTED] The emergency first slice retired raw-token GET/generation-on-read, but the durable requirement is absent: no hashed credential table, device labels, scopes, expiry, revocation, last-used metadata, coarse request metadata, rate limit, versioned API, revocation interface, or default export separation. Current `settings.agent_token` remains a broad plaintext credential until this section is implemented.

### 5.6 Model security, prompt injection, and cost

- B5.6 [NOT STARTED] Model routes lack complete owner-only tests, rate limits, daily/monthly budgets, request/output limits, timeout/bounded retry policy, pinned allowlist, audit events, safe no-key behavior, upstream-error redaction, explicit untrusted-content fencing/layering, and structured-output validation.

### 5.7 Audit and idempotency

- B5.7 [NOT STARTED] `audit_events` and general request/job idempotency do not exist. Local uniqueness prevents some duplicate flags/points/reward effects, but it does not satisfy append-only actor/request auditing or all required idempotency paths.

### 5.8 Blocking acceptance matrix

- B5.8.1 [PARTIAL] Unauthenticated private access denied — `test/security-boundary.test.ts:65` covers `/api/state`; `test/security-boundary.test.ts:69` covers `/calendar.ics`; exhaustive private-route denial is NOT COVERED.
- B5.8.2 [COVERED] Valid session accepted — `test/get-read-only.test.ts:72` creates a real session and all private browser reads use it; calendar success is asserted at `test/security-boundary.test.ts:73`.
- B5.8.3 [NOT COVERED] Expired session rejected.
- B5.8.4 [NOT COVERED] Logout revokes the server-side session.
- B5.8.5 [NOT COVERED] Cross-user access denied.
- B5.8.6 [NOT COVERED] Agent scope enforced.
- B5.8.7 [NOT COVERED] Revoked agent credential denied.
- B5.8.8 [NOT COVERED] Expired agent credential denied.
- B5.8.9 [NOT COVERED / CURRENTLY FAILS DESIGN] Raw agent credential never stored; current source stores `settings.agent_token` plaintext.
- B5.8.10 [NOT COVERED] Export scope separated and not granted by default.
- B5.8.11 [COVERED] `GET /api/state` performs zero writes — `test/get-read-only.test.ts:92`.
- B5.8.12 [COVERED] Repeated GET produces zero penalties — `test/get-read-only.test.ts:92` repeats GET/HEAD and instruments all mutating SQL.
- B5.8.13 [COVERED] Crawler-pattern access alters nothing — `test/get-read-only.test.ts:92` and all-route coverage at `test/get-read-only.test.ts:110`.
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
- B17.5 [IN PROGRESS] Every schema change must add a numbered migration, migration-specific rollback note in `OPERATIONS.md`, and a test against a local D1/schema copy before code may be reported complete.
- B17.6 [IN PROGRESS] Commits remain separated by concern. Push `refactor/strategic-judgment-os` at each completed phase boundary. Never claim production application or deployment.
