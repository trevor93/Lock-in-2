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

### 3.2 Pages model-service configuration

Book 5.6 fails closed unless the API key, configured base URL, and explicit allowlist are all present. Configuration is operator-controlled; the repository agent did not set or inspect any value.

- [ ] Cloudflare dashboard → **Workers & Pages** → **lock-in-708** → **Settings** → **Variables and Secrets** → **Production**.
- [ ] Store `OPENAI_API_KEY` as an encrypted secret. Never print, paste into source, commit, logs, tickets, screenshots, or chat.
- [ ] Set `OPENAI_BASE_URL` to the exact OpenAI-compatible HTTPS API root, without a trailing slash (for example, a trusted `/v1` root).
- [ ] Set `OPENAI_ALLOWED_BASE_URLS` to a comma-separated list of exact trusted HTTPS API roots. Include the exact normalized `OPENAI_BASE_URL`; a missing allowlist intentionally disables all model calls.
- [ ] Do not use wildcards, HTTP URLs, path prefixes that do not exactly match, or an arbitrary configured URL as its own implicit authorization.
- [ ] Keep the pinned application model at `gpt-5-mini-2025-08-07`; changing snapshots requires a reviewed source/migration/test change, not an environment-only override.

**Verification**

- [ ] Confirm the three configuration names are present in Production and `OPENAI_API_KEY` is encrypted; never reveal values.
- [ ] With an owner application session, confirm a bounded Council request succeeds only when `OPENAI_BASE_URL` exactly matches an entry in `OPENAI_ALLOWED_BASE_URLS`.
- [ ] Temporarily test in an approved non-production environment that a missing key, missing allowlist, HTTP URL, or non-matching HTTPS URL returns `503 MODEL SERVICE OFFLINE` without contacting the provider or returning configuration details.

**Rollback / disable**

Remove or replace `OPENAI_API_KEY`, or remove `OPENAI_ALLOWED_BASE_URLS`, to fail model routes closed while leaving the rest of the application available. Consequence: owner model requests return 503 and no provider request or model-derived application record is created. Do not delete D1 accounting or audit rows.

### 3.3 Scheduled Worker secrets

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

**State:** Repository-authored migrations currently listed here are `migrations/0005_sessions_and_ownership.sql`, `migrations/0006_agent_credentials.sql`, and `migrations/0007_model_security.sql`. Each local populated-schema-copy preservation test must pass at the approved commit. Production application remains an operator action and is not claimed by the repository agent.

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

### 5.3 `migrations/0007_model_security.sql`

**Purpose**

- Creates `model_requests`, the owner-bound reservation ledger used for atomic request and reserved-output-token controls.
- Creates append-only `model_audit_events` containing metadata only: owner, request identifier, logical route, pinned model, event type, attempt, character/token counts, upstream status, and timestamp. It stores no prompt, answer, API key, authorization header, or raw upstream error.
- Pins database reservations and audit rows to `gpt-5-mini-2025-08-07` and the three current logical routes.
- Enforces per owner: 10 requests per rolling minute, 100 requests and 20,000 reserved output tokens per UTC day, and 2,000 requests and 100,000 reserved output tokens per UTC calendar month. Each accepted request reserves at most 1,300 output tokens before provider contact.
- Adds only tables, indexes, and triggers. It does not alter or delete an existing personal row.

**Repository evidence required before production application**

```powershell
npx vitest run test/migration-0007.test.ts test/model-security.test.ts
npm test
npx tsc --noEmit
npm run build
git diff --check
```

- [ ] `test/migration-0007.test.ts` passes against the populated schema copy created before `0005` and migrated in order through `0005`, `0006`, and `0007`.
- [ ] Every pre-existing personal-table row count is unchanged.
- [ ] Focused tests prove owner-session denial, explicit HTTPS allowlisting, safe no-key behavior, user/total input limits, pinned snapshot and output bound, 15-second abort signals, two-attempt retry bounds, redacted upstream failures, prompt layer/fence ordering, retrieved-text no-write authority, strict model-authored structured output, per-owner rate/daily/monthly budgets, and metadata-only append-only model audit evidence.
- [ ] If `0005` or `0006` is still pending, confirm the pending list contains `0005_sessions_and_ownership.sql`, `0006_agent_credentials.sql`, then `0007_model_security.sql` in that order. Never apply `0007` before both dependencies.

**Apply**

After Section 4 and the Section 5 preflight succeed, confirm that the expected pending list contains `0007_model_security.sql` and no unreviewed migration. Apply pending migrations using the commands in Section 5. Record only migration filenames and command status, never model prompts, answers, keys, audit-row contents, or private application rows.

**Non-secret verification queries**

Run these through the Cloudflare D1 console or an authenticated Wrangler command. Record counts and schema names only.

```sql
SELECT COUNT(*) AS model_request_table_count
FROM sqlite_schema
WHERE type='table' AND name='model_requests';

SELECT COUNT(*) AS model_audit_table_count
FROM sqlite_schema
WHERE type='table' AND name='model_audit_events';

SELECT COUNT(*) AS model_budget_trigger_count
FROM sqlite_schema
WHERE type='trigger' AND name='trg_model_requests_budget';

SELECT COUNT(*) AS model_audit_append_only_trigger_count
FROM sqlite_schema
WHERE type='trigger'
  AND name IN ('trg_model_audit_no_update','trg_model_audit_no_delete');

SELECT COUNT(*) AS unowned_model_request_count
FROM model_requests mr
LEFT JOIN users u ON u.id=mr.user_id
WHERE u.id IS NULL;

SELECT COUNT(*) AS unowned_model_audit_count
FROM model_audit_events ma
LEFT JOIN users u ON u.id=ma.user_id
WHERE u.id IS NULL;

SELECT COUNT(*) AS unpinned_model_row_count
FROM (
  SELECT model FROM model_requests
  UNION ALL
  SELECT model FROM model_audit_events
)
WHERE model<>'gpt-5-mini-2025-08-07';
```

Expected results:

- [ ] `model_request_table_count`, `model_audit_table_count`, and `model_budget_trigger_count` are each `1`.
- [ ] `model_audit_append_only_trigger_count` is `2`.
- [ ] `unowned_model_request_count`, `unowned_model_audit_count`, and `unpinned_model_row_count` are each `0`.
- [ ] After an authorized non-sensitive smoke request, confirm only counts and event types—not row contents—show one accepted reservation and an accepted plus terminal audit event.
- [ ] Confirm owner model requests return 503 rather than raw configuration details when the service is intentionally disabled as described in Section 3.2.

**Rollback**

Deploy the recorded prior application deployment while retaining `model_requests`, `model_audit_events`, all indexes/triggers, and every row. Do not drop either table, update or delete audit events, delete reservations, or import the D1 backup automatically. The prior application ignores this additive evidence. Consequence: the prior application does not provide the Book 5.6 model-security boundary, so disable model calls by removing the allowlist or API key until the corrected application is restored. If a data restore is believed necessary, preserve both databases and stop for explicit destructive-operation approval under Section 4.

### 5.4 `migrations/0008_audit_idempotency.sql`

**Purpose**

- Creates `audit_events` with the exact Book 5.7 column set (owner, actor type/id, request id, action, entity type/id, before/after/metadata JSON, timestamp), the two mandated indexes, append-only `BEFORE UPDATE`/`BEFORE DELETE` triggers, and an actor-type guard trigger. It stores metadata and before/after state only — never tokens, passwords, hashes, or keys.
- Creates `idempotency_keys` with `UNIQUE(user_id, scope, request_id)` and a stored first-response for verbatim replay of a redelivered request.
- Adds only tables, indexes, and triggers. It does not alter or delete an existing personal row.

**Repository evidence required before production application**

```powershell
npx vitest run test/migration-0008.test.ts test/audit-idempotency.test.ts test/enforcement-idempotency.test.ts
npm test
npx tsc --noEmit
npm run build
git diff --check
```

- [ ] `test/migration-0008.test.ts` passes against the populated schema copy migrated in order through `0008`.
- [ ] Every pre-existing personal-table row count is unchanged.
- [ ] Focused tests prove append-only audit rejection, the actor-type guard, verbatim idempotent replay across the mandated consequence classes, and single-award enforcement when the job runs twice.
- [ ] Confirm the pending list applies `0008_audit_idempotency.sql` only after `0005`–`0007`.

**Apply**

After Section 4 and the Section 5 preflight succeed, apply pending migrations using the Section 5 commands. Record only migration filenames and command status.

**Non-secret verification queries**

```sql
SELECT COUNT(*) AS audit_table FROM sqlite_schema WHERE type='table' AND name='audit_events';
SELECT COUNT(*) AS idem_table FROM sqlite_schema WHERE type='table' AND name='idempotency_keys';
SELECT COUNT(*) AS audit_append_only_triggers FROM sqlite_schema
  WHERE type='trigger' AND name IN ('trg_audit_no_update','trg_audit_no_delete');
SELECT COUNT(*) AS idem_unique_index FROM sqlite_schema
  WHERE type='index' AND name='idx_idempotency_identity';
SELECT COUNT(*) AS unowned_audit FROM audit_events a LEFT JOIN users u ON u.id=a.user_id WHERE u.id IS NULL;
```

Expected: `audit_table`, `idem_table`, `idem_unique_index` each `1`; `audit_append_only_triggers` is `2`; `unowned_audit` is `0`.

**Rollback**

Deploy the recorded prior application while retaining both tables, all indexes/triggers, and every row. Do not drop tables, update/delete audit rows, or import the D1 backup automatically. The prior application ignores this additive evidence. Consequence: the prior application does not enforce delivery idempotency, so a retried bridge write may duplicate; disable the bridge if that risk is unacceptable until the corrected application is restored.

### 5.5 `migrations/0009_recovery_catchup.sql`

**Purpose**

- Adds the additive column `day_summary.mvr_held` (default 0): a Minimum Viable Recovery was logged, so the streak survives that day (survival, never victory).
- Creates `recovery_actions` with `UNIQUE(user_id, action_date)` (one restoring action per day) and append-only `catchup_sessions` recording each `/catchup` re-entry run as metadata.
- Adds only a column, tables, indexes, and triggers. It does not alter or delete an existing personal row.

**Repository evidence required before production application**

```powershell
npx vitest run test/recovery-catchup.test.ts test/catchup-wiring.test.ts
npm test
npx tsc --noEmit
npm run build
git diff --check
```

- [ ] `test/recovery-catchup.test.ts` passes; pre-existing row counts unchanged.
- [ ] Focused tests prove MVR marks the day survived without creating a victory, one recovery per day, append-only `catchup_sessions`, and the fixed six-part protocol.

**Apply**

Apply pending migrations after the Section 5 preflight; record filenames and status only.

**Non-secret verification queries**

```sql
SELECT COUNT(*) AS mvr_column FROM pragma_table_info('day_summary') WHERE name='mvr_held';
SELECT COUNT(*) AS recovery_table FROM sqlite_schema WHERE type='table' AND name='recovery_actions';
SELECT COUNT(*) AS catchup_table FROM sqlite_schema WHERE type='table' AND name='catchup_sessions';
SELECT COUNT(*) AS catchup_append_only FROM sqlite_schema
  WHERE type='trigger' AND name IN ('trg_catchup_no_update','trg_catchup_no_delete');
```

Expected: `mvr_column`, `recovery_table`, `catchup_table` each `1`; `catchup_append_only` is `2`.

**Rollback**

Deploy the prior application while retaining the column, tables, and rows. `mvr_held` defaults to 0, so the prior application simply never reads it. No user data is deleted. Consequence: the prior application offers no re-entry protocol; the operator resumes manually.

### 5.6 `migrations/0010_alternative_explanation_gate.sql`

**Purpose**

- Adds nullable `intel_entries.heat` and `intel_entries.alternative_explanation`.
- Creates the append-only, counted `alternative_explanations` ledger (`none_plausible` flag) and indexes.
- Installs `BEFORE INSERT`/`BEFORE UPDATE` triggers on `intel_entries` that abort a non-calm capture with no alternative explanation (`ALT_EXPLANATION_REQUIRED`) — Law 23 enforced in schema.
- Adds only columns, a table, indexes, and triggers. It does not alter or delete an existing personal row.

**Repository evidence required before production application**

```powershell
npx vitest run test/alt-explanation-gate.test.ts test/alt-gate-wiring.test.ts
npm test
npx tsc --noEmit
npm run build
git diff --check
```

- [ ] Focused tests prove the schema gate rejects a heated capture with no alternative, allows a calm one, counts the "none plausible" tell, and surfaces the counts in `/api/stats`.
- [ ] Pre-existing row counts unchanged.

**Apply**

Apply pending migrations after the Section 5 preflight; record filenames and status only.

**Non-secret verification queries**

```sql
SELECT COUNT(*) AS heat_col FROM pragma_table_info('intel_entries') WHERE name='heat';
SELECT COUNT(*) AS alt_col FROM pragma_table_info('intel_entries') WHERE name='alternative_explanation';
SELECT COUNT(*) AS alt_table FROM sqlite_schema WHERE type='table' AND name='alternative_explanations';
SELECT COUNT(*) AS gate_triggers FROM sqlite_schema
  WHERE type='trigger' AND name IN ('trg_intel_alt_gate_insert','trg_intel_alt_gate_update');
```

Expected: `heat_col`, `alt_col`, `alt_table` each `1`; `gate_triggers` is `2`.

**Rollback**

Deploy the prior application while retaining the columns, table, and rows. The added columns are nullable and ignored by the prior application; no user data is deleted. Consequence: the prior application does not enforce the alternative-explanation brake.

### 5.7 `migrations/0011_chapter_cursor.sql`

**Purpose**

- Creates `chapter_cursor` (one row per owner) holding book, part, chapter, figure, and cycle day. The application reads it read-only and returns the documented default (Chapter 2 — Anaphora) when no row exists; the row is persisted only by `POST /api/cursor`.
- Adds only a table. It does not alter or delete an existing personal row.

**Repository evidence required before production application**

```powershell
npx vitest run test/cursor-continuity.test.ts test/get-read-only.test.ts
npm test
npx tsc --noEmit
npm run build
git diff --check
```

- [ ] Focused tests prove the cursor persists an update, rejects an out-of-range cycle day, drives the Continuity Brief, and that `GET /api/cursor` and `GET /api/continuity-brief` perform zero writes.

**Apply**

Apply pending migrations after the Section 5 preflight; record filenames and status only.

**Non-secret verification queries**

```sql
SELECT COUNT(*) AS cursor_table FROM sqlite_schema WHERE type='table' AND name='chapter_cursor';
SELECT COUNT(*) AS unowned_cursor FROM chapter_cursor c LEFT JOIN users u ON u.id=c.user_id WHERE u.id IS NULL;
```

Expected: `cursor_table` is `1`; `unowned_cursor` is `0`.

**Rollback**

Deploy the prior application while retaining the table and rows. The prior application ignores it; no user data is deleted. Consequence: the chapter cursor and Continuity Brief are unavailable until the corrected application is restored.

### 5.8 `migrations/0012_unify_captures.sql`

**Purpose**

- Book 7 table unification, **Slice 1 (additive + reversible)**. Creates `captures` (a `kind`-discriminated union of `intel_entries` + `maxims` + `responses`), `review_items` (unifies `response_srs`, with FSRS-ready `stability`/`difficulty`/`last_review` columns left NULL until the SM-2→FSRS migration), and `exams` (unifies `tongue_exams`), then backfills each 1:1 from its legacy source, stamping `(legacy_table, legacy_id)` provenance on every row.
- Adds only tables, indexes, and rows in the new tables. It does **not** alter, drop, or delete `intel_entries`, `maxims`, `responses`, `response_srs`, or `tongue_exams`, which remain the authoritative stores that the current application still reads and writes. Application behaviour is unchanged by this slice; the unified tables are populated shadows that later slices will dual-write and switch reads onto, one feature at a time.

**Repository evidence required before production application**

```powershell
npx vitest run test/migration-0012.test.ts
npm test
npx tsc --noEmit
npm run build
git diff --check
```

- [ ] `test/migration-0012.test.ts` proves `captures` = intel+maxim+response split by `kind`, `review_items` = `response_srs`, `exams` = `tongue_exams`, that field values and owner (`user_id`) survive the mapping, that the legacy tables are left byte-for-byte unchanged, and that the backfill is idempotent (re-runnable, `NOT EXISTS`-guarded).
- [ ] Every pre-existing personal-table row count is unchanged.

**Apply**

Apply pending migrations after the Section 5 preflight; record filenames and status only.

**Non-secret verification queries**

```sql
SELECT COUNT(*) AS captures_table FROM sqlite_schema WHERE type='table' AND name='captures';
SELECT COUNT(*) AS review_table FROM sqlite_schema WHERE type='table' AND name='review_items';
SELECT COUNT(*) AS exams_table FROM sqlite_schema WHERE type='table' AND name='exams';
SELECT
  (SELECT COUNT(*) FROM captures) AS captures_rows,
  (SELECT COUNT(*) FROM intel_entries) + (SELECT COUNT(*) FROM maxims) + (SELECT COUNT(*) FROM responses) AS legacy_rows;
SELECT COUNT(*) AS unowned FROM captures c LEFT JOIN users u ON u.id=c.user_id WHERE u.id IS NULL;
```

Expected: the three `*_table` counts are each `1`; `captures_rows` equals `legacy_rows`; `unowned` is `0`.

**Rollback**

Drop the three shadow tables only — `DROP TABLE IF EXISTS exams; DROP TABLE IF EXISTS review_items; DROP TABLE IF EXISTS captures;` — leaving every legacy source table and row untouched. The prior application never referenced the shadows, so it continues to work unchanged. No user data is deleted by applying or rolling back this migration.

### 5.9 `migrations/0013_maxims_cutover.sql`

**Purpose**

- Book 7 table unification, **maxims cutover**. After 0012 backfilled every maxim into `captures(kind='maxim')`, this repoints the `flashcards` spaced-repetition rows from `maxims(id)` onto `captures(id)`. Because D1 **enforces** foreign keys, the declared `flashcards.maxim_id REFERENCES maxims(id)` cannot be re-pointed by `UPDATE`; the table is recreated with the FK targeting `captures(id)` and its rows copied with `maxim_id` remapped via `captures.legacy_id`.
- **Data safety**: `flashcards` is the sole home of maxim SR state (interval/ease/due/reps/lapses), so the whole table is first copied verbatim into the retained `flashcards_pre0013_backup`. The copy into the new table is a JOIN on `captures`, and 0012 backfilled every maxim, so no row is lost. The `maxims` table is left untouched as a second backup. The application (learn/curriculum/export routes) now reads and writes maxims through `captures`; the `maxims` table is frozen (never written), retained for rollback.

**Repository evidence required before production application**

```powershell
npx vitest run test/maxims-cutover.test.ts test/legal-state-transitions.test.ts
npm test
npx tsc --noEmit
npm run build
git diff --check
```

- [ ] `test/maxims-cutover.test.ts` proves the pre-migration backup is retained with full parity, `flashcards` row count is unchanged (no SR state lost), every flashcard remaps onto a real `kind='maxim'` capture (no orphans), the new FK rejects a non-existent capture, and the maxim routes read/write `captures` while the card queue still surfaces a new maxim.
- [ ] Every pre-existing personal-table row count is unchanged.

**Apply**

Apply pending migrations after the Section 5 preflight; record filenames and status only. Applies only after `0012`.

**Non-secret verification queries**

```sql
SELECT COUNT(*) AS backup_table FROM sqlite_schema WHERE type='table' AND name='flashcards_pre0013_backup';
SELECT (SELECT COUNT(*) FROM flashcards) AS cards, (SELECT COUNT(*) FROM flashcards_pre0013_backup) AS backup;
SELECT COUNT(*) AS orphans FROM flashcards f LEFT JOIN captures c ON c.id=f.maxim_id AND c.kind='maxim' WHERE c.id IS NULL;
```

Expected: `backup_table` is `1`; `cards` equals `backup`; `orphans` is `0`.

**Rollback**

`DROP TABLE flashcards; ALTER TABLE flashcards_pre0013_backup RENAME TO flashcards;` then redeploy the prior application (which reads maxims from the `maxims` table). The `maxims` rows were never modified, and the backup restores the original SR state exactly. No user data is destroyed by applying or rolling back.

### 5.10 `migrations/0014_intel_cutover.sql`

**Purpose**

- Book 7 table unification, **intel cutover**. After 0012 backfilled every intel entry into `captures(kind='intel')`, this re-establishes the Law-23 alternative-explanation brake ON `captures` (a `BEFORE INSERT` and a `BEFORE UPDATE` trigger, scoped to `kind='intel'`, that abort a non-calm capture with an empty `alternative_explanation`). `intel_entries` has **no incoming foreign keys**, so — unlike the maxims cutover — no table is recreated: `intel_entries` and its own 0010 triggers are simply frozen (never written) and kept as a backup.
- The application (intel-library, hermes analyze, agent read/write, commander's-file briefing, stats count, agent export) now reads and writes intel through `captures`; the app-level `altGate` still returns a clean 400 before insert, and these triggers are the schema backstop on the unified table.

**Repository evidence required before production application**

```powershell
npx vitest run test/intel-cutover.test.ts test/alt-explanation-gate.test.ts test/alt-gate-wiring.test.ts
npm test
npx tsc --noEmit
npm run build
git diff --check
```

- [ ] `test/intel-cutover.test.ts` proves intel is written to `captures` (not the frozen `intel_entries`), read back through the API, verdict finality holds, the heated-capture brake returns 400 through the API, and the captures trigger aborts a non-calm intel row with no alternative while accepting a calm one or a heated one with an alternative.
- [ ] Every pre-existing personal-table row count is unchanged.

**Apply**

Apply pending migrations after the Section 5 preflight; record filenames and status only. Applies only after `0012`.

**Non-secret verification queries**

```sql
SELECT COUNT(*) AS captures_alt_triggers FROM sqlite_schema
  WHERE type='trigger' AND name IN ('trg_captures_alt_gate_insert','trg_captures_alt_gate_update');
SELECT (SELECT COUNT(*) FROM captures WHERE kind='intel') AS intel_captures,
       (SELECT COUNT(*) FROM intel_entries) AS legacy_intel;
```

Expected: `captures_alt_triggers` is `2`; at cutover time `intel_captures` equals `legacy_intel` (they diverge afterward as new intel is written only to captures).

**Rollback**

`DROP TRIGGER IF EXISTS trg_captures_alt_gate_insert; DROP TRIGGER IF EXISTS trg_captures_alt_gate_update;` then redeploy the prior application, which reads and writes `intel_entries` (untouched, triggers intact). No user data is destroyed by applying or rolling back.

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
