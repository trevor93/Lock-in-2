# Lock-In / War Room Operator Runbook

This is the only repository-to-operator channel for GitHub, Cloudflare, production D1, secrets, credentials, scheduled Workers, and deployments. Execute sections in order. Do not infer missing steps from `MASTERPROMPT.md`; this runbook is self-contained.

## 0. Non-Negotiable Handling Rules

- [ ] Never paste secrets, credentials, D1 exports, personal data, private response bodies, or the contents of `MASTERPROMPT.md` into chat, tickets, logs, command history, screenshots, or git.
- [ ] Never apply a production migration before completing the production D1 backup gate in Section 4.
- [ ] Never deploy a commit unless its required tests, migration-copy tests, build, typecheck, approved commit SHA, and rollback target are recorded.
- [ ] Never rewrite git history or restore a production D1 backup without separate explicit approval. Both are destructive.
- [ ] Keep the Cloudflare Access perimeter enabled during every application rollback.
- [ ] Record only non-secret evidence listed in Section 9.

## 1. Make the GitHub Repository Private

**State:** Required operator action. The application repository currently protects `MASTERPROMPT.md` with `.gitignore` because that file contains personal production data.

**Preconditions**

- [ ] Sign in to GitHub as an administrator of `trevor93/Lock-in-2`.
- [ ] Confirm no automation depends on unauthenticated access to this repository.

**Procedure**

- [ ] Open `https://github.com/trevor93/Lock-in-2/settings`.
- [ ] Open **General**.
- [ ] Scroll to **Danger Zone**.
- [ ] Select **Change repository visibility** → **Make private**.
- [ ] Enter `trevor93/Lock-in-2` when GitHub requests confirmation.

**Verification**

- [ ] In a signed-out/incognito browser, open `https://github.com/trevor93/Lock-in-2` and confirm it returns 404 or a private-repository sign-in page.
- [ ] Tell the application owner exactly: `Repository trevor93/Lock-in-2 is private and signed-out access is denied.`
- [ ] Wait for the application owner to authorize the repository-side follow-up. The repository agent will then remove `MASTERPROMPT.md` from `.gitignore` and commit that exact file. Do not copy, rename, edit, or commit it manually.

**Rollback**

- [ ] GitHub **Settings** → **General** → **Danger Zone** → **Change repository visibility** → **Make public**.
- [ ] Consequence: rollback re-exposes the full current repository history and any committed private material. Do not perform it casually.

## 2. Put Cloudflare Access in Front of the Entire Application

**State:** Required before any new Pages deployment or production credential rotation.

**Preconditions**

- [ ] Sign in to the Cloudflare account that owns `lock-in-708.pages.dev`.
- [ ] Know the one authorized operator email address. Do not place that email in this repository.

**Procedure — human application**

- [ ] Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → **Add an application**.
- [ ] Choose **Self-hosted**.
- [ ] Application name: `Lock-In War Room`.
- [ ] Public hostname domain: `lock-in-708.pages.dev`.
- [ ] Path: `/*`.
- [ ] Set the session duration to the shortest practical operator-approved period.
- [ ] Add one policy named `Lock-In Owner Only` with action **Allow**.
- [ ] Policy include rule: **Emails** → the single authorized operator email.
- [ ] Do not add a **Bypass** policy.
- [ ] Save the application.

**Procedure — machine-only enforcement path**

- [ ] Zero Trust → **Access** → **Service Auth** → **Service Tokens** → **Create Service Token**.
- [ ] Name: `Lock-In Enforcement Cron`.
- [ ] Copy the generated client ID and client secret directly into a password manager. The client secret is shown once.
- [ ] Access → **Applications** → **Add an application** → **Self-hosted**.
- [ ] Application name: `Lock-In Enforcement Internal Job`.
- [ ] Public hostname domain: `lock-in-708.pages.dev`.
- [ ] Path: `/internal/jobs/enforcement`.
- [ ] Add one policy named `Lock-In Enforcement Service Token` with action **Service Auth**.
- [ ] Include the `Lock-In Enforcement Cron` service token.
- [ ] Do not add a **Bypass** policy.
- [ ] Save the application. The more-specific internal path application must be the only machine entry.

**Verification**

- [ ] In a signed-out/incognito browser, request all of:
  - `https://lock-in-708.pages.dev/`
  - `https://lock-in-708.pages.dev/api/state`
  - `https://lock-in-708.pages.dev/api/agent/token`
  - `https://lock-in-708.pages.dev/calendar.ics`
- [ ] Confirm every request is denied or redirected to Cloudflare Access authentication.
- [ ] Authenticate with the authorized email and confirm the application shell loads.
- [ ] Confirm an unauthorized email is denied.

**Rollback**

- [ ] Zero Trust → **Access** → **Applications** → select the affected application → disable it or restore its prior policy.
- [ ] Consequence: disabling the full-host application removes the perimeter. Keep in-application authentication enabled and restore Access immediately.

## 3. Configure Required Cloudflare Secrets

### 3.1 Pages internal enforcement secret

**Preconditions**

- [ ] Generate one high-entropy secret locally and store it in a password manager without printing it. Do not put it in `wrangler.jsonc`, `.dev.vars`, git, or shell arguments.

**Procedure**

- [ ] Cloudflare dashboard → **Workers & Pages** → **lock-in-708** → **Settings** → **Variables and Secrets**.
- [ ] Under **Production**, add encrypted secret named exactly `ENFORCEMENT_JOB_SECRET`.
- [ ] Use the high-entropy value from the password manager.

### 3.2 Scheduled Worker secrets

From an interactive terminal opened at the repository root, run each command separately. Wrangler will prompt without placing the value in the command itself:

```text
! npx wrangler secret put ENFORCEMENT_JOB_SECRET --config workers/enforcement-cron/wrangler.jsonc
! npx wrangler secret put CF_ACCESS_CLIENT_ID --config workers/enforcement-cron/wrangler.jsonc
! npx wrangler secret put CF_ACCESS_CLIENT_SECRET --config workers/enforcement-cron/wrangler.jsonc
```

- [ ] For `ENFORCEMENT_JOB_SECRET`, enter the same value bound to Pages.
- [ ] For `CF_ACCESS_CLIENT_ID`, enter the Access service-token client ID.
- [ ] For `CF_ACCESS_CLIENT_SECRET`, enter the Access service-token client secret.
- [ ] Confirm all three names appear as encrypted Worker secrets; never reveal their values.

**Verification**

- [ ] Pages Production shows `ENFORCEMENT_JOB_SECRET` as encrypted.
- [ ] Worker `lock-in-enforcement-cron` shows all three exact secret names as encrypted.

**Rollback**

Run the relevant deletion command only when intentionally disabling the integration:

```text
! npx wrangler secret delete ENFORCEMENT_JOB_SECRET --config workers/enforcement-cron/wrangler.jsonc
! npx wrangler secret delete CF_ACCESS_CLIENT_ID --config workers/enforcement-cron/wrangler.jsonc
! npx wrangler secret delete CF_ACCESS_CLIENT_SECRET --config workers/enforcement-cron/wrangler.jsonc
```

Then remove or replace the Pages secret in **Workers & Pages** → **lock-in-708** → **Settings** → **Variables and Secrets**. Consequence: scheduled enforcement fails closed until both sides again share valid credentials.

## 4. Production D1 Backup Gate

Complete this section immediately before every production migration or deployment that depends on a schema change.

**Preconditions**

- [ ] Create an access-controlled local directory `C:\secure-backups` outside the repository.
- [ ] Confirm the terminal is authenticated to the Cloudflare account that owns D1 database `webapp-production`.

**Procedure — PowerShell**

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "C:\secure-backups\lock-in-pre-change-$stamp.sql"
npx wrangler d1 export webapp-production --remote --output $backup
if ($LASTEXITCODE -ne 0) { throw 'D1 export failed; do not migrate or deploy.' }
Get-Item $backup | Select-Object FullName, Length, LastWriteTime
Get-FileHash $backup -Algorithm SHA256 | Select-Object Algorithm, Hash
```

- [ ] Confirm the export command exits successfully.
- [ ] Confirm the file exists and has a non-zero length.
- [ ] Store the path and SHA-256 hash in the private operator record. Never attach or commit the export.

**Verification**

```powershell
if (-not (Test-Path $backup)) { throw 'Backup file missing.' }
if ((Get-Item $backup).Length -le 0) { throw 'Backup file is empty.' }
```

**Rollback**

A D1 restore overwrites production state and is destructive. Do not import or restore automatically. If rollback requires data restoration, stop, preserve the failed database and backup, state the consequence, and obtain explicit destructive-operation approval.

## 5. Production Migration Gate

**State:** Repository-authored migrations currently listed here are `migrations/0005_sessions_and_ownership.sql` and `migrations/0006_agent_credentials.sql`. Each local populated-schema-copy preservation test must pass at the approved commit. Production application remains an operator action and is not claimed by the repository agent.

For each future migration entry, execute only after Section 4 succeeds and the approved commit is checked out.

**Preflight — PowerShell**

```powershell
git fetch origin
git switch refactor/strategic-judgment-os
git pull --ff-only origin refactor/strategic-judgment-os
git status --short
npm ci
npm test
npm run build
npx tsc --noEmit
```

- [ ] Require a clean `git status --short` before applying a migration.
- [ ] Require every listed command to exit successfully.
- [ ] Record `git rev-parse HEAD` as the approved commit.
- [ ] Confirm Section 4 produced a fresh backup for this exact change window.

**Apply only migrations explicitly listed in a later subsection of this file**

```powershell
npx wrangler d1 migrations list webapp-production --remote
npx wrangler d1 migrations apply webapp-production --remote
```

**Verification**

```powershell
npx wrangler d1 migrations list webapp-production --remote
```

- [ ] Confirm only the expected migration filenames changed from pending to applied.
- [ ] Run the migration-specific non-secret verification queries that will be appended to this section.

**Rollback**

- [ ] Prefer application rollback while preserving additive schema and user data.
- [ ] Never execute `DROP`, mass `DELETE`, or backup restore as an automatic rollback.
- [ ] Follow the migration-specific rollback note appended here. If it requires destructive data restoration, stop for explicit approval.

### 5.1 `migrations/0005_sessions_and_ownership.sql`

**Purpose**

- Creates the durable single-owner `users` record and revocable `sessions` table.
- Promotes the existing `settings.auth_hash` and `settings.auth_salt` verifier into the durable owner without exposing or changing the password.
- Adds `user_id` to every current personal table and assigns every existing personal row to that owner.
- Adds ownership lookup indexes. This migration is additive and intentionally retains the installation's legacy global uniqueness constraints; it does not claim self-service multi-user support.

**Repository evidence required before production application**

```powershell
npm test -- --run test/migration-0005.test.ts test/session-ownership.test.ts
npm test
npm run build
npx tsc --noEmit
```

- [ ] `test/migration-0005.test.ts` passes against a populated pre-`0005` schema copy.
- [ ] The test confirms the legacy verifier is preserved exactly.
- [ ] The test confirms every seeded personal-table row remains present and belongs to the durable owner.
- [ ] Session and cross-user read/update/append/calendar/export denial tests pass.

**Apply**

After Section 4 and the Section 5 preflight succeed, first confirm that `0005_sessions_and_ownership.sql` is the only newly pending migration. Then apply the pending D1 migrations using the commands in Section 5. Record only the migration filename and command status, never row contents.

**Non-secret verification queries**

Run these through the Cloudflare D1 console or an authenticated Wrangler command. Record counts only.

```sql
SELECT COUNT(*) AS owner_count FROM users WHERE role='owner';
SELECT COUNT(*) AS active_session_count
FROM sessions
WHERE revoked_at IS NULL
  AND unixepoch(expires_at) > unixepoch('now');

SELECT 'schedule_blocks' AS table_name, COUNT(*) AS unowned FROM schedule_blocks WHERE user_id IS NULL
UNION ALL SELECT 'block_logs', COUNT(*) FROM block_logs WHERE user_id IS NULL
UNION ALL SELECT 'debriefs', COUNT(*) FROM debriefs WHERE user_id IS NULL
UNION ALL SELECT 'unit_progress', COUNT(*) FROM unit_progress WHERE user_id IS NULL
UNION ALL SELECT 'maxims', COUNT(*) FROM maxims WHERE user_id IS NULL
UNION ALL SELECT 'flashcards', COUNT(*) FROM flashcards WHERE user_id IS NULL
UNION ALL SELECT 'card_reviews', COUNT(*) FROM card_reviews WHERE user_id IS NULL
UNION ALL SELECT 'honesty_flags', COUNT(*) FROM honesty_flags WHERE user_id IS NULL
UNION ALL SELECT 'points_ledger', COUNT(*) FROM points_ledger WHERE user_id IS NULL
UNION ALL SELECT 'reward_redemptions', COUNT(*) FROM reward_redemptions WHERE user_id IS NULL
UNION ALL SELECT 'law_checks', COUNT(*) FROM law_checks WHERE user_id IS NULL
UNION ALL SELECT 'settings', COUNT(*) FROM settings WHERE user_id IS NULL
UNION ALL SELECT 'intel_entries', COUNT(*) FROM intel_entries WHERE user_id IS NULL
UNION ALL SELECT 'book_progress', COUNT(*) FROM book_progress WHERE user_id IS NULL
UNION ALL SELECT 'hermes_messages', COUNT(*) FROM hermes_messages WHERE user_id IS NULL
UNION ALL SELECT 'responses', COUNT(*) FROM responses WHERE user_id IS NULL
UNION ALL SELECT 'response_srs', COUNT(*) FROM response_srs WHERE user_id IS NULL
UNION ALL SELECT 'tongue_reviews', COUNT(*) FROM tongue_reviews WHERE user_id IS NULL
UNION ALL SELECT 'tongue_exams', COUNT(*) FROM tongue_exams WHERE user_id IS NULL
UNION ALL SELECT 'day_summary', COUNT(*) FROM day_summary WHERE user_id IS NULL
UNION ALL SELECT 'predictions', COUNT(*) FROM predictions WHERE user_id IS NULL
UNION ALL SELECT 'appeals', COUNT(*) FROM appeals WHERE user_id IS NULL
UNION ALL SELECT 'load_reductions', COUNT(*) FROM load_reductions WHERE user_id IS NULL;
```

Expected results:

- [ ] `owner_count` is exactly `1` for the supported single-owner installation.
- [ ] Every `unowned` count is `0`.
- [ ] `active_session_count` may be `0` immediately after migration; a successful application login creates one active hashed session.
- [ ] Compare pre-migration and post-migration counts for every personal table using private operator records; every count must be unchanged. Stop before deployment if any count falls.
- [ ] Confirm a successful login, logout, expired-session denial, and old-session denial after a subsequent login.

**Rollback**

Deploy the recorded prior application deployment while retaining the additive `users`, `sessions`, and `user_id` schema. Do not drop tables or columns, mass-delete sessions/users, or restore the D1 backup automatically. The prior application ignores the additive columns, so application rollback is reversible without deleting user data. If data restoration is required, preserve both databases and stop for explicit destructive-operation approval under Section 4.

### 5.2 `migrations/0006_agent_credentials.sql`

**Purpose**

- Creates owner-bound `agent_credentials` records with SHA-256 token hashes, safe token prefixes, device labels, JSON scope sets, expiry, revocation, last-use details, coarse request metadata, and rate-window state.
- Creates append-only credential lifecycle events for issuance, successful use, revocation, scope denial, and rate limiting.
- Retires the legacy plaintext `settings.agent_token` by erasing its value while retaining the settings row. The migration does not delete the settings row or any user data.
- Adds only new tables and indexes except for the intentional erasure of the legacy-token value. Production application remains operator-controlled.

**Repository evidence required before production application**

```powershell
npx vitest run test/migration-0006.test.ts test/agent-credentials.test.ts test/session-ownership.test.ts test/get-read-only.test.ts test/hermes-bridge.test.ts
npm test
npm run build
npx tsc --noEmit
git diff --check
```

- [ ] `test/migration-0006.test.ts` passes against the populated schema copy created before `0005` and migrated through `0005` and `0006`.
- [ ] Every pre-existing personal-table row count is unchanged, including the retained `settings.agent_token` row.
- [ ] The legacy plaintext value is absent and the retained settings row has an empty value.
- [ ] If production `0005_sessions_and_ownership.sql` is not already applied, confirm the pending list contains both `0005_sessions_and_ownership.sql` and `0006_agent_credentials.sql` in that order; never apply `0006` before `0005`.
- [ ] Issuance, hash-only storage, one-time raw disclosure, safe metadata listing, scope enforcement, expiry, revocation, default export exclusion, explicit export scope, coarse metadata, atomic rate limiting, 64 KiB request limits, versioning, ownership, and GET/HEAD zero-write tests pass.
- [ ] Hermes bridge source tests prove HTTPS-only base URLs, default TLS verification, bounded timeouts, distinct 401/403/429/5xx handling, versioned routes, no secret/error-body printing, and explicit full-export authorization.

**Apply**

After Section 4 and the Section 5 preflight succeed, confirm that the expected pending list contains `0006_agent_credentials.sql` and no unreviewed migration. Apply pending D1 migrations using the commands in Section 5. Record only the migration filename and command status, never credential values, token hashes, event metadata, or private row contents.

**Non-secret verification queries**

Run these through the Cloudflare D1 console or an authenticated Wrangler command. Record counts only.

```sql
SELECT COUNT(*) AS credential_table_count
FROM sqlite_schema
WHERE type='table' AND name='agent_credentials';

SELECT COUNT(*) AS credential_event_table_count
FROM sqlite_schema
WHERE type='table' AND name='agent_credential_events';

SELECT COUNT(*) AS legacy_plaintext_token_count
FROM settings
WHERE key='agent_token' AND value<>'';

SELECT COUNT(*) AS malformed_hash_count
FROM agent_credentials
WHERE length(token_hash)<>64
   OR token_hash GLOB '*[^0-9a-f]*';

SELECT COUNT(*) AS raw_token_shaped_storage_count
FROM agent_credentials
WHERE token_hash LIKE 'wr_agent_v1_%'
   OR token_prefix NOT LIKE 'wr_agent_v1_%';
```

Expected results:

- [ ] `credential_table_count` and `credential_event_table_count` are each exactly `1`.
- [ ] `legacy_plaintext_token_count`, `malformed_hash_count`, and `raw_token_shaped_storage_count` are each `0`.
- [ ] In the application, issue one default credential for a clearly labeled test device, copy it once into a secure destination, close the dialog, reopen the dialog, and confirm the raw value cannot be retrieved.
- [ ] Confirm that default credential can perform only its listed versioned POST operations and receives 403 from `POST /api/agent/v1/export`.
- [ ] Issue a separate short-lived credential explicitly carrying only `export:read`, verify `POST /api/agent/v1/export`, then revoke it and confirm the same credential receives 401. Never record either raw credential.
- [ ] Confirm every GET and HEAD under `/api/agent/v1/*` returns 405 for known paths or 404 for unknown paths and creates no D1 writes.

**Rollback**

Deploy the recorded prior application deployment while retaining `agent_credentials`, `agent_credential_events`, their indexes, and every row. Do not drop either table, delete credential events, restore `settings.agent_token`, or import the D1 backup automatically. The legacy plaintext master token is intentionally unrecoverable; the prior unversioned agent API therefore remains disabled after rollback until the corrected application is restored and the owner issues a new scoped credential. If a data restore is believed necessary, preserve both databases and stop for explicit destructive-operation approval under Section 4.

## 6. Deploy and Verify the Pages Application

### 6.1 Book 5.4 application-only change

Book 5.4 adds same-origin/allowlisted CORS, private no-store and security headers, cookie-mutation CSRF proof, 64 KiB request limits, strict Zod validation, and legal state-transition enforcement. It adds no table, column, index, trigger, or migration; Section 4 is therefore not a Book 5.4 schema precondition unless the approved deployment also includes an unapplied migration such as `0005_sessions_and_ownership.sql`.

**Repository evidence required before operator deployment**

```powershell
npm test
npx tsc --noEmit
npm run build
git diff --check
```

- [ ] Confirm the Book 5.4 focused request-validation and legal-transition suites pass as part of the full suite.
- [ ] Confirm browser login/setup/status return a CSRF proof and the application shell can complete a same-origin mutation using it.
- [ ] Confirm malformed JSON, unknown fields, invalid identifiers/dates/times/enums/numbers, and bodies larger than 64 KiB fail without a write.
- [ ] Confirm disallowed browser origins receive 403, no response emits wildcard CORS, private success/error responses use `Cache-Control: no-store`, and CSP contains `frame-ancestors 'none'`.
- [ ] Record only counts, status codes, and header names/values that are not credentials; never record cookies, CSRF proof values, agent credentials, or private response bodies.

**Rollback**

Roll back to the previously recorded Pages deployment while retaining the current D1 schema and all user data. Book 5.4 has no database rollback and requires no D1 restore. Consequence: the prior application version removes the Book 5.4 browser, validation, and transition protections, so use application rollback only as temporary containment, keep Cloudflare Access enabled, and investigate before resuming writes. Never drop schema or restore a backup solely to roll back Book 5.4.

**Preconditions**

- [ ] Sections 1–3 are complete.
- [ ] If the approved commit includes a schema migration, Sections 4–5 are also complete.
- [ ] The approved commit is checked out on `refactor/strategic-judgment-os` with a clean working tree.
- [ ] Record the current production deployment ID from Cloudflare dashboard → **Workers & Pages** → **lock-in-708** → **Deployments** as the rollback target.

**Build and test — PowerShell**

```powershell
git fetch origin
git switch refactor/strategic-judgment-os
git pull --ff-only origin refactor/strategic-judgment-os
git status --short
npm ci
npm test
npm run build
npx tsc --noEmit
$ApprovedCommit = git rev-parse HEAD
$ApprovedCommit
```

- [ ] Require a clean working tree and successful tests, build, and typecheck.
- [ ] Record the test pass count and `$ApprovedCommit` without recording private data.

**Deploy — PowerShell**

```powershell
npx wrangler pages deploy dist --project-name lock-in-708 --branch main --commit-hash $ApprovedCommit
```

**Verification**

- [ ] Cloudflare **Workers & Pages** → **lock-in-708** → **Deployments** shows the approved commit as Production.
- [ ] Signed-out access remains blocked by Access.
- [ ] Authorized-email Access login succeeds.
- [ ] Application login succeeds.
- [ ] Verify NOW, DAY, campaign, cards, books, Council, and calendar export still read.
- [ ] Verify `GET /api/agent/token` returns 410 and never returns a credential.
- [ ] Verify a disallowed browser `Origin` receives 403 and no `Access-Control-Allow-Origin: *`.
- [ ] Verify private success and error responses include `Cache-Control: no-store`.
- [ ] Verify repeated GET and HEAD calls do not change D1 counts for flags, points, block logs, day summaries, progress rows, flashcards, settings, or later personal tables.

**Rollback**

- [ ] Cloudflare dashboard → **Workers & Pages** → **lock-in-708** → **Deployments**.
- [ ] Open the recorded prior production deployment and select **Rollback to this deployment**.
- [ ] Keep Cloudflare Access enabled.
- [ ] Consequence: the earlier deployment contains known private-route and credential defects. Rollback is a temporary containment action, not a secure steady state.

## 7. Issue or Revoke a Production Agent Credential

Perform this only after the corrected Pages deployment and `0006_agent_credentials.sql` are live behind Cloudflare Access.

**Issue a bridge credential**

- [ ] Sign in through Cloudflare Access and the application login.
- [ ] Open **COUNCIL** → **HERMES BRIDGE**.
- [ ] Enter a device-specific label that identifies only the authorized bridge, not a person or secret.
- [ ] Select **ISSUE DEFAULT BRIDGE CREDENTIAL** exactly once. Default bridge scopes exclude `export:read`.
- [ ] In Termux, create `~/.config/warroom` with owner-only permissions (`umask 077` before writing) and copy the one-time-displayed value into `~/.config/warroom/agent_token` without placing it in a command-line argument or shell history.
- [ ] Set `WARROOM_TOKEN_FILE=$HOME/.config/warroom/agent_token`; the bridge reads the credential from that file and does not accept it through a process environment variable.
- [ ] Close the dialog. Reopening it must show only the safe prefix and metadata, never the raw credential or hash.
- [ ] Restart the Termux watcher/bridge process so it reloads `WARROOM_TOKEN_FILE`.

**Issue an export credential only when explicitly authorized**

- [ ] Do not add `export:read` to the normal bridge credential.
- [ ] Issue a separate, short-lived credential carrying only `export:read` for the approved export operation.
- [ ] Invoke the bridge export command only with `--authorize-full-export`.
- [ ] Revoke the export credential immediately after the approved export and keep the export outside git, logs, tickets, screenshots, and chat.

**Verification**

- [ ] The default bridge credential can call `POST /api/agent/v1/pending` with an empty JSON body.
- [ ] The default credential receives HTTP 403 from `POST /api/agent/v1/export`.
- [ ] Every credential listed in the UI has the expected device label, safe prefix, scopes, expiry, revocation state, and coarse last-request metadata; no raw value or hash appears.
- [ ] A revoked or expired credential receives HTTP 401.
- [ ] Neither current nor prior credential values appear in logs, screenshots, history, tickets, git, or GET responses.

**Revocation / rollback**

- [ ] In **COUNCIL** → **HERMES BRIDGE**, revoke the affected device credential and issue a replacement only for that device.
- [ ] Consequence: that Termux, Telegram, or CLI bridge immediately receives 401 until updated. A revoked credential cannot be safely restored; do not edit D1 to clear `revoked_at`.
- [ ] Application rollback retains credential tables and events and does not restore the legacy plaintext master token; follow Section 5.2.

## 8. Deploy the Scheduled Enforcement Worker

**Preconditions**

- [ ] Sections 2–3 and 6 are complete.
- [ ] Confirm `workers/enforcement-cron/wrangler.jsonc` contains `https://lock-in-708.pages.dev/internal/jobs/enforcement` and Cron `*/5 * * * *`.

**Deploy**

```text
! npx wrangler deploy --config workers/enforcement-cron/wrangler.jsonc
```

**Verification**

- [ ] Cloudflare dashboard → **Workers & Pages** → **lock-in-enforcement-cron** → **Triggers** confirms `*/5 * * * *`.
- [ ] Trigger or wait for one run and inspect only status and HTTP metadata—never secret headers or private response bodies.
- [ ] Confirm the internal request succeeds through Access and application authentication.
- [ ] Allow a second run and confirm it creates no duplicate honesty flags, point entries, or other consequences.

**Rollback**

- [ ] Cloudflare dashboard → **Workers & Pages** → **lock-in-enforcement-cron** → **Triggers** → disable/delete the Cron trigger, or roll back the Worker deployment.
- [ ] Consequence: browser `POST /api/tick` continues enforcement on app load, but closed-app enforcement stops.

## 9. Acceptance Evidence to Record

Record only non-secret evidence:

- [ ] Approved Git commit SHA and Pages production deployment ID.
- [ ] `npm test` pass count, `npm run build` success, and `npx tsc --noEmit` success.
- [ ] Migration-copy test success and exact production migration filenames applied, when applicable.
- [ ] D1 backup path identifier, size, timestamp, and SHA-256 hash—not its contents.
- [ ] Signed-out Access denial, authorized-email success, and unauthorized-email denial.
- [ ] Signed-out GitHub denial confirming repository privacy.
- [ ] Header checks showing no wildcard CORS and `Cache-Control: no-store`.
- [ ] Prior agent credential rejected; never record either credential value.
- [ ] Cron timestamp/status and duplicate-consequence counts.
- [ ] Rollback deployment ID and whether rollback was exercised.
