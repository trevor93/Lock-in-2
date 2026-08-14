# Book 17 First-Slice Operator Runbook

This runbook covers account-level actions only. The repository changes do not perform these actions. Do not paste tokens into chat, tickets, logs, git, command history, or screenshots.

## Preconditions

1. Confirm the working branch is `refactor/strategic-judgment-os`.
2. Run `npm test` and require all tests to pass.
3. Run `npm run build` and require success.
4. Record the current Cloudflare Pages production deployment ID and Git commit as the rollback target.
5. Create a D1 backup before deployment. One non-interactive method is:

   ```powershell
   npx wrangler d1 export webapp-production --remote --output "C:\secure-backups\lock-in-pre-first-slice.sql"
   ```

   Store the export outside the repository in an access-controlled location. Consequence: the export contains private application data. Never attach or commit it.

## 1. Make the GitHub Repository Private

This is an account-level GitHub action and has not been performed by the code change.

1. Open `https://github.com/trevor93/Lock-in-2/settings` while signed in as a repository administrator.
2. Open **General**.
3. Scroll to **Danger Zone**.
4. Select **Change repository visibility** → **Make private**.
5. Enter the repository name when GitHub asks for confirmation.
6. Verify from a signed-out/incognito browser that the repository URL returns 404 or a sign-in/private-repository page.

Rollback: repeat the visibility workflow and make the repository public. Consequence: making it public re-exposes the entire current history. Do not rewrite history in this slice; history cleanup is destructive and requires a separate backup and explicit approval.

## 2. Configure Cloudflare Access for the Entire Application

This is a Cloudflare Zero Trust account action and has not been performed by the code change.

1. In Cloudflare Zero Trust, open **Access** → **Applications** → **Add an application**.
2. Choose **Self-hosted**.
3. Name it `Lock-In War Room`.
4. Add the public hostname:
   - Domain: `lock-in-708.pages.dev`
   - Path: `/*`
5. Set session duration to the shortest practical operator-approved period.
6. Add one **Allow** policy:
   - Include → **Emails** → the single authorized operator email.
7. Do not add a Bypass policy for the hostname.
8. Save the application.
9. In a signed-out/incognito browser, request each of:
   - `/`
   - `/api/state`
   - `/api/agent/token`
   - `/calendar.ics`
   All must be denied or redirected to Access authentication.
10. Authenticate as the authorized email and verify the application loads.

The scheduled Worker must still reach `/internal/jobs/enforcement`. Use a Cloudflare Access service token only for that machine path if Access blocks the Worker-to-Pages request:

1. Zero Trust → **Access** → **Service Auth** → **Service Tokens** → create `Lock-In Enforcement Cron`.
2. Add a second Access policy scoped to `/internal/jobs/enforcement` with action **Service Auth** and include that service token.
3. Add `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` as Worker secrets. The Cron Worker sends them as `CF-Access-Client-Id` and `CF-Access-Client-Secret` when both are configured:

   ```text
   ! npx wrangler secret put CF_ACCESS_CLIENT_ID --config workers/enforcement-cron/wrangler.jsonc
   ! npx wrangler secret put CF_ACCESS_CLIENT_SECRET --config workers/enforcement-cron/wrangler.jsonc
   ```

4. Never use a broad Bypass policy.

Rollback: disable the Access application or restore its prior policy. Consequence: rollback removes the perimeter and must be temporary while the in-app auth remains active.

## 3. Configure the Internal Enforcement Secret

Generate one high-entropy value locally without printing it. Store the same value as a Pages secret and scheduled Worker secret.

1. Cloudflare dashboard → **Workers & Pages** → the Pages project → **Settings** → **Variables and Secrets**.
2. Add encrypted secret `ENFORCEMENT_JOB_SECRET` for Production.
3. Do not put this value in `wrangler.jsonc` or `.dev.vars` under version control.
4. From a secure interactive terminal, run:

   ```text
   ! npx wrangler secret put ENFORCEMENT_JOB_SECRET --config workers/enforcement-cron/wrangler.jsonc
   ```

5. Paste the secret only into Wrangler's hidden prompt.

Rollback: delete/replace both secret bindings. Consequence: scheduled enforcement fails closed until both sides again share a value.

## 4. Deploy and Verify the Pages First Slice

Deployment is not authorized merely because this runbook exists. Execute only after the operator confirms the tested diff and rollback target.

1. Deploy the tested Pages build using the repository's established Cloudflare Pages workflow.
2. Verify the production deployment points to the approved commit.
3. From an authenticated browser, open the app and verify NOW, DAY, campaign, cards, books, Council, and calendar export still read.
4. Verify a disallowed `Origin` request receives 403 and no wildcard `Access-Control-Allow-Origin`.
5. Verify private success and error responses carry `Cache-Control: no-store`.
6. Verify `GET /api/agent/token` returns 405 and never returns a credential.
7. Verify repeated GET and HEAD calls do not change D1 counts for flags, points, block logs, day summaries, progress rows, flashcards, or settings.

Rollback: use Cloudflare Pages **Deployments** to roll back to the recorded deployment ID. Consequence: the prior deployment has known public/private-route defects, so keep Access enabled during rollback.

## 5. Rotate the Production Agent Credential

Perform this only after the corrected deployment is live behind Access.

1. Sign in through Cloudflare Access and the application login.
2. Open **COUNCIL** → **HERMES BRIDGE**.
3. Select **ROTATE TOKEN** once.
4. Copy the one-time-displayed value directly into the secure Termux environment as `WARROOM_TOKEN`.
5. Close the dialog; reopening it must not retrieve the credential.
6. Restart the Termux watcher/bridge process so it reads the new environment.
7. Verify the new token can call `/api/agent/pending`.
8. Verify the previous token receives 401.

Consequence: rotation immediately invalidates every current Termux, Telegram, or CLI bridge until its `WARROOM_TOKEN` is updated. Rollback is another rotation; the old token cannot be restored safely.

## 6. Deploy the Scheduled Enforcement Worker

1. Review `workers/enforcement-cron/wrangler.jsonc`; confirm the Pages URL is correct.
2. Deploy:

   ```text
   ! npx wrangler deploy --config workers/enforcement-cron/wrangler.jsonc
   ```

3. In Cloudflare, confirm the `*/5 * * * *` Cron trigger is present.
4. Trigger or wait for one run and inspect only status/HTTP metadata—never secret headers or private response bodies.
5. Verify enforcement consequences are idempotent by allowing a second run and confirming no duplicate flags or point entries.

Rollback: disable/delete the Cron trigger or roll back the Worker deployment. Consequence: browser `POST /api/tick` continues to enforce on app load, but closed-app enforcement stops.

## Acceptance Evidence to Record

Record only non-secret evidence:

- Approved Git commit and Pages deployment ID.
- `npm test` pass count and `npm run build` success.
- Signed-out Access denial and authorized-email success.
- Repository private verification.
- Header checks showing no wildcard CORS and `Cache-Control: no-store`.
- Old agent token rejected; never record either token value.
- Cron timestamp/status and duplicate-consequence counts.
- D1 backup location identifier, not its contents.
