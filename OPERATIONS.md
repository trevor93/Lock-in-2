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

**State:** No migration beyond `0001`–`0004` is currently authorized for production in this runbook. New repository-authored migrations will be appended here by exact filename after local schema-copy tests pass.

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

## 6. Deploy and Verify the Pages Application

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
- [ ] Verify `GET /api/agent/token` returns 405 and never returns a credential.
- [ ] Verify a disallowed browser `Origin` receives 403 and no `Access-Control-Allow-Origin: *`.
- [ ] Verify private success and error responses include `Cache-Control: no-store`.
- [ ] Verify repeated GET and HEAD calls do not change D1 counts for flags, points, block logs, day summaries, progress rows, flashcards, settings, or later personal tables.

**Rollback**

- [ ] Cloudflare dashboard → **Workers & Pages** → **lock-in-708** → **Deployments**.
- [ ] Open the recorded prior production deployment and select **Rollback to this deployment**.
- [ ] Keep Cloudflare Access enabled.
- [ ] Consequence: the earlier deployment contains known private-route and credential defects. Rollback is a temporary containment action, not a secure steady state.

## 7. Rotate the Production Agent Credential

Perform this only after the corrected Pages deployment is live behind Cloudflare Access.

**Procedure**

- [ ] Sign in through Cloudflare Access and the application login.
- [ ] Open **COUNCIL** → **HERMES BRIDGE**.
- [ ] Select **ROTATE TOKEN** exactly once.
- [ ] Copy the one-time-displayed value directly into the secure Termux environment as `WARROOM_TOKEN`.
- [ ] Close the dialog. Reopening it must not retrieve the credential.
- [ ] Restart the Termux watcher/bridge process so it reloads `WARROOM_TOKEN`.

**Verification**

- [ ] The new credential can call `/api/agent/pending`.
- [ ] The prior credential receives HTTP 401.
- [ ] Neither credential value appears in logs, screenshots, history, tickets, or git.

**Rollback**

- [ ] Rotate again and update every authorized bridge.
- [ ] Consequence: every current Termux, Telegram, or CLI bridge immediately receives 401 until updated. The prior credential cannot be safely restored.

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
