# Operator Handoff — What Only You Can Do

This file is the complete list of actions the repository **cannot** perform, written so
you can execute each one without reading anything else. Everything here is outside the
repository agent's scope by standing instruction: production D1 backup, Cloudflare Access,
secrets, production credential rotation, Cron Worker deployment, repository visibility,
and every deploy.

`OPERATIONS.md` remains the detailed runbook (per-migration purpose, verification SQL and
rollback). This file is the ordered checklist and the parts that need code you must paste
somewhere the repository does not control.

**Handling rules that never change**

- Never paste a secret, a D1 export, a private response body, or the contents of
  `MASTERPROMPT.md` into chat, tickets, logs, screenshots, or git.
- Never apply a production migration before the D1 backup gate below succeeds.
- Record only non-secret evidence: migration filenames, command status, and the
  non-secret verification query results.

---

## 0. State of play — what the repository has ready for you

| Area | Repository status | Needs you |
|---|---|---|
| Migrations `0012`–`0029` | written, applied to a local schema copy, tested | apply to production D1 (§2) |
| Web Push (alarms) | endpoints, service-worker handler, subscribe flow, delivery ledger, tests | VAPID secrets (§3) + Cron Worker (§4) |
| Enforcement Cron | `POST /internal/jobs/enforcement` exists and is secret-guarded | Cron Worker (§4) |
| Everything else in Books 5–12 | source + local tests green | deploy (§5) |

The preflight in §1 must produce: **572 server tests across 61 files + 48 DOM tests
across 9 files green, `npx tsc --noEmit` clean, `npm run build` clean.**

If your run reports different totals, the tree you are holding is not the tree this
document describes. Stop and reconcile before you deploy — do not assume the document is
right and the runner is wrong. `test/handoff-consistency.test.ts` derives the two file
counts from the repository itself and fails if this sentence drifts from them again.

---

## 1. Preflight (do this first, every time)

Run these from the repository root and record the output status only:

```powershell
npm ci
npm run build
npx tsc --noEmit
npm test
npx vitest run --config vitest.dom.config.ts
git diff --check
```

All six must pass. Not five, and not "the important ones" — there is no CI in this
repository, so this block is the entire gate. Two of the six look skippable and are not:
`npm test` is bare `vitest run`, which **excludes** `**/*.dom.test.ts`, so the DOM suite
runs only because the line above names it explicitly; and `git diff --check` is what
catches a whitespace-mangled file before it reaches production rather than after.

Then record the deploy target:

```powershell
git rev-parse HEAD
```

Write down that SHA — it is the deploy target and the rollback reference. It prints a
value rather than passing or failing, which is why it is not one of the six.

---

## 2. Apply migrations 0012–0029 to production D1

### 2.1 The backup gate (mandatory, blocking)

Follow `OPERATIONS.md` Section 4 to take and verify the production D1 backup. Do not
continue until you have a restorable backup recorded. **Never** run a restore casually —
it is destructive and needs its own explicit approval.

### 2.2 What these migrations do

They must be applied **in filename order**. All eighteen are additive or preserve a full
backup table; none deletes user data. (Eighteen files, seventeen descriptions below:
`0022` and `0023` are described together, exactly as `OPERATIONS.md` §5.18 does.)

- `0012_unify_captures.sql` — creates `captures`, `review_items`, `exams` and backfills
  them 1:1 from `intel_entries` / `maxims` / `responses` / `response_srs` /
  `tongue_exams`, stamping `(legacy_table, legacy_id)` on every row. The legacy tables are
  untouched.
- `0013_maxims_cutover.sql` — copies `flashcards` verbatim into
  `flashcards_pre0013_backup`, then recreates `flashcards` with its `maxim_id` foreign key
  pointing at `captures(id)` and remaps every row. (D1 enforces foreign keys, so the
  column cannot simply be re-pointed.)
- `0014_intel_cutover.sql` — re-creates the Law-23 alternative-explanation triggers on
  `captures` so the brake follows the data.
- `0015_responses_cutover.sql` — remaps `review_items.item_id` onto the new capture ids and
  recreates `tongue_reviews` without its old `responses` foreign key, keeping
  `tongue_reviews_pre0015_backup`.
- `0016_sm2_to_fsrs.sql` — fills the FSRS columns (`stability`, `difficulty`) on existing
  review rows from the SM-2 columns using the documented mapping.
- `0017_push_notifications.sql` — creates `push_subscriptions`,
  `notification_preferences` and the append-only `push_deliveries` ledger.
- `0018_ratchet.sql` — Book 8.1's ratchet: `schedule_blocks.ratchet_tier`,
  `ratchet_state`, and the append-only `ratchet_events`. The mandatory set is
  seeded from the commander's own CORE nominations (else his non-negotiables),
  capped at three; if he declared neither it is left empty and the application
  asks him to name his anchors. See `OPERATIONS.md` §5.14.
- `0019_block_statuses_and_causes.sql` — Books 8.3/8.4: the append-only
  `block_miss_causes` ledger, one diagnosis per block per day. See §5.15.
- `0020_learning_sources_reading.sql` — Book 10.1/10.5: measured reading
  (`reading_sessions` + append-only `reading_events`) and source provenance
  (`sources`, `source_editions`, `source_sections`, `section_variants`). See §5.16.
- `0021_mastery_rubric_calibration.sql` — Books 10.2/10.3/10.4: the append-only
  `mastery_evidence` trail, the derived `mastery` cache, `retrieval_attempts` and
  `calibration_events`, plus nullable confidence columns on `review_items`. See §5.17.
- `0022_principles_graph.sql` and `0023_immune_table_seed.sql` — Books 10.6-10.10:
  the concept model, the immune table, Machiavelli framings, Greene as UNREAD
  non-examinable hypotheses, and the cross-book principle graph with its
  contradiction edges. CURRICULUM ROWS ONLY — neither touches personal data.
  See §5.18.
- `0024_rhetoric_track.sql` — Books 11/12: twenty-four new tables carrying the
  Farnsworth syllabus, the figure records, the specimen tiers, the seven-day cycle,
  the fixed 1/3/7/16/35 ladder, the page index, and the Rhetoric/Response Lab.
  Three of Book 11.8's constraints are enforced in schema rather than in code:
  `commonplace_log` has no text column (the commonplace book stays handwritten),
  `recordings` has no audio column (it references a file on his machine), and
  `rhetoric_card_reviews` is append-only by trigger. See `OPERATIONS.md` §5.19.
- `0025_rhetoric_seed.sql` — the syllabus as data: six phases, nineteen chapters with
  Book 11.2's exact day ranges, five non-chapter cycles, the two books as
  bibliographic records holding NO text, and **eight page anchors, every one
  confirmed by reading the page**. The other seventeen chapter openings are absent
  rather than estimated. It also archives (never deletes) the three shipped starter
  lines Book 12.7 orders removed. See §5.20.
- `0026_figure_records.sql` — Book 11.7: twenty-two figure records, each carrying both
  faces (legitimate use and manipulative misuse) plus the inbound detection question
  and the overuse tells. Written from standard classical-rhetoric reference knowledge;
  no Farnsworth prose is reproduced. See §5.21.
- `0027_response_lab_seed.sql` — Book 11.4's Tier 3 ear bank (thirty public-domain
  lines, all attributed) with **Tier 1 deliberately empty** because Tier 1 is his and
  copied by hand, and Book 12.7's eleven response intents stored as architectures with
  their logic rather than as lines. See §5.22.
- `0028_attempt_deployed.sql` — Book 12.4: `rhetoric_attempts.deployed` and
  `deployed_on`, so the outbound red-team card can be mandatory before a draft is
  marked deployed. Additive with safe defaults; nothing is deployed by the migration.
  See §5.23.
- `0029_job_runs.sql` — Book 7's `job_runs`: one metadata row per enforcement or alarm
  run, recording whether the **Cron** called or a browser tick did. That distinction is
  the reason it exists — without it a dead scheduler looks exactly like the app quietly
  catching itself up. Counts, timestamps and an error class only; no `user_id`, no
  journal text, never the shared secret. See §5.24.

### 2.3 Apply

Use the Section 5 commands in `OPERATIONS.md`. Confirm the pending list contains only
these files and in this order, then apply.

### 2.4 Verify (non-secret queries — run all of them)

```sql
-- unification landed and nothing was lost
SELECT (SELECT COUNT(*) FROM captures) AS captures_rows,
       (SELECT COUNT(*) FROM intel_entries) + (SELECT COUNT(*) FROM maxims) + (SELECT COUNT(*) FROM responses) AS legacy_rows;
SELECT COUNT(*) AS unowned FROM captures c LEFT JOIN users u ON u.id=c.user_id WHERE u.id IS NULL;
-- maxims cutover: backup kept, no orphaned cards
SELECT (SELECT COUNT(*) FROM flashcards) AS cards, (SELECT COUNT(*) FROM flashcards_pre0013_backup) AS backup;
SELECT COUNT(*) AS orphan_cards FROM flashcards f LEFT JOIN captures c ON c.id=f.maxim_id AND c.kind='maxim' WHERE c.id IS NULL;
-- intel brake present on the unified table
SELECT COUNT(*) AS alt_triggers FROM sqlite_schema WHERE type='trigger'
  AND name IN ('trg_captures_alt_gate_insert','trg_captures_alt_gate_update');
-- responses/SR cutover
SELECT COUNT(*) AS orphan_sr FROM review_items ri
  LEFT JOIN captures c ON c.id=ri.item_id AND c.kind='response'
  WHERE ri.kind='response' AND c.id IS NULL;
-- FSRS migrated
SELECT COUNT(*) AS missing_fsrs FROM review_items
  WHERE kind='response' AND (stability IS NULL OR difficulty IS NULL);
-- push tables
SELECT COUNT(*) AS push_tables FROM sqlite_schema WHERE type='table'
  AND name IN ('push_subscriptions','notification_preferences','push_deliveries');
-- the ratchet and the miss-cause ledger
SELECT COUNT(*) AS tier_column FROM pragma_table_info('schedule_blocks') WHERE name='ratchet_tier';
SELECT COUNT(*) AS mandatory FROM schedule_blocks WHERE ratchet_tier='mandatory';
SELECT COUNT(*) AS causes_table FROM sqlite_schema WHERE type='table' AND name='block_miss_causes';
-- the learning engine
SELECT COUNT(*) AS learning_tables FROM sqlite_schema WHERE type='table'
  AND name IN ('reading_sessions','reading_events','sources','source_editions','source_sections',
               'section_variants','mastery_evidence','mastery','retrieval_attempts','calibration_events',
               'concepts','concept_components','principles','principle_frames','hypotheses',
               'graph_nodes','graph_edges');
SELECT COUNT(*) AS examinable_hypotheses FROM hypotheses WHERE examinable <> 0;
-- the rhetoric track (Books 11/12)
SELECT COUNT(*) AS track_tables FROM sqlite_schema WHERE type='table' AND name IN (
  'rhetoric_phases','rhetoric_chapters','rhetoric_milestones','figures','figure_own_examples',
  'specimens','commonplace_log','cycle_days','copia_sessions','copia_renderings','deployments',
  'deployment_pivots','canon_maps','rhetoric_attempts','figure_detections','inbound_cards',
  'outbound_cards','response_intents','response_builds','recordings','book_page_refs',
  'rhetoric_cards','rhetoric_card_reviews','book_chapter_anchors');
-- Law 22 in schema form: no passage text, no audio. Both must return NO ROWS.
SELECT name FROM pragma_table_info('commonplace_log') WHERE name IN ('text','passage','content');
SELECT name FROM pragma_table_info('recordings') WHERE name IN ('audio','blob','data','file_body');
-- the syllabus, the figures, the intents, and the confirmed anchors
SELECT (SELECT COUNT(*) FROM rhetoric_phases) AS phases,
       (SELECT COUNT(*) FROM rhetoric_chapters) AS chapters,
       (SELECT COUNT(*) FROM rhetoric_milestones) AS milestones,
       (SELECT COUNT(*) FROM figures) AS figures,
       (SELECT COUNT(*) FROM response_intents) AS intents,
       (SELECT COUNT(*) FROM book_chapter_anchors) AS anchors;
-- no anchor exists without the sentence recording how it was confirmed. NO ROWS.
SELECT id, label FROM book_chapter_anchors WHERE confirmed_by IS NULL OR TRIM(confirmed_by)='';
-- Tier 1 is his, by hand: 0 on application, and it rises only as he copies.
SELECT SUM(tier=1) AS tier1, SUM(tier=3) AS tier3 FROM specimens;
-- Book 12.4's gate as a data check, and nothing deployed by the migration. NO ROWS / 0.
SELECT COUNT(*) AS deployed_rows FROM rhetoric_attempts WHERE deployed <> 0;
-- the job-run ledger: table, index and append-only trigger present, no owner column,
-- and nothing seeded. Expected: 1 / 1 / 1, NO ROWS, 0.
SELECT (SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='job_runs') AS job_runs_table,
       (SELECT COUNT(*) FROM sqlite_schema WHERE type='index' AND name='idx_job_runs_job_time') AS job_runs_index,
       (SELECT COUNT(*) FROM sqlite_schema WHERE type='trigger' AND name='trg_job_runs_no_reopen') AS no_reopen_trigger;
SELECT name FROM pragma_table_info('job_runs') WHERE name='user_id';
SELECT COUNT(*) AS job_runs_rows FROM job_runs;
```

Expected: `captures_rows` equals `legacy_rows`; `unowned`, `orphan_cards`, `orphan_sr` and
`missing_fsrs` are all `0`; `cards` equals `backup`; `alt_triggers` is `2`;
`push_tables` is `3`; `tier_column` and `causes_table` are each `1`; `mandatory` is at most `3` (a `0` is valid and means the app will ask him to name his anchors); `learning_tables` is `17`; `examinable_hypotheses` is `0`; `track_tables` is `24`;
the two Law 22 `pragma_table_info` queries return **no rows**; `phases` is `6`, `chapters` is `19`,
`milestones` is `5`, `figures` is `22`, `intents` is `11`, `anchors` is `8`; the
`confirmed_by` query returns **no rows**; `tier1` is `0` and `tier3` is `30`;
`deployed_rows` is `0`; `job_runs_table`, `job_runs_index` and `no_reopen_trigger` are each
`1`, the `job_runs` owner-column query returns **no rows**, and `job_runs_rows` is `0`.

### 2.5 Rollback

Each migration's rollback is in `OPERATIONS.md` §5.8–§5.24. In every case the legacy
tables and their rows survive, so an application rollback is enough; you never need to
restore the D1 backup to undo these.

---

## 3. Create and store the VAPID keys (Web Push)

Web Push is off until these three values exist. The application fails closed: the key
route answers `503 PUSH SERVICE OFFLINE`, the alarms job answers `503`, and the UI tells
the commander to use the calendar export instead. Nothing breaks; alarms simply do not
push.

### 3.1 Generate a key pair

Run this **locally**, once. It prints the two values you need. Do not commit the output,
do not paste it into chat, and close the terminal afterwards.

```powershell
node -e "const c=require('crypto');const{publicKey,privateKey}=c.generateKeyPairSync('ec',{namedCurve:'prime256v1'});const pub=publicKey.export({type:'spki',format:'der'}).subarray(26);const jwk=privateKey.export({format:'jwk'});console.log('VAPID_PUBLIC_KEY=',pub.toString('base64url'));console.log('VAPID_PRIVATE_JWK=',JSON.stringify({kty:jwk.kty,crv:jwk.crv,d:jwk.d,x:jwk.x,y:jwk.y}));"
```

- `VAPID_PUBLIC_KEY` — the 65-byte uncompressed P-256 point, base64url. It is public by
  design (the browser needs it to subscribe).
- `VAPID_PRIVATE_JWK` — the private JWK. **This is a secret.** Store it in your password
  manager as well, because it cannot be recovered from Cloudflare.

### 3.2 Store them

Cloudflare dashboard → **Workers & Pages** → **lock-in-708** → **Settings** →
**Variables and Secrets** → **Production**:

| Name | Type | Value |
|---|---|---|
| `VAPID_PUBLIC_KEY` | plain text is acceptable | the public value from §3.1 |
| `VAPID_PRIVATE_JWK` | **encrypted secret** | the JWK from §3.1 |
| `VAPID_SUBJECT` | plain text | `mailto:` plus a contact address you control |

`VAPID_SUBJECT` must start with `mailto:` or `https:` — the application refuses anything
else. Push services use it to reach you if your pushes misbehave.

### 3.3 Verify

With an owner session in the app, open the alarms panel (BOOKS tab → ALARMS &
ENGAGEMENT) and press **ENABLE** on the push row. Expected: the browser asks for
notification permission, then the app says push is armed. Then check:

```sql
SELECT COUNT(*) AS devices FROM push_subscriptions;
```

Expected: `1` per device you armed. The table stores the browser's opaque endpoint and the
public key material the browser handed out — never a password, and never any journal text.

### 3.4 Rotation / disable

Replace `VAPID_PRIVATE_JWK` and `VAPID_PUBLIC_KEY` together, then have each device press
**ENABLE** again (a subscription is bound to the key that created it). To disable push
entirely, delete `VAPID_PRIVATE_JWK`; the application fails closed as described above.

---

## 4. Deploy the Cron Worker (the only scheduler)

Cloudflare Pages has no native scheduled handler, so a small separate Worker is the clock.
It calls two secret-guarded endpoints on the Pages app. It holds one secret and no data.

### 4.1 Worker source

Create a new Worker (dashboard → **Workers & Pages** → **Create** → **Worker**), name it
`lock-in-cron`, and paste exactly this:

```js
// lock-in-cron — the only scheduler for the Lock-In war room.
// Every minute: fire due push alarms. Once an hour: run the enforcement pass.
// It holds only the shared job secret and never touches D1 directly.
export default {
  async scheduled(event, env, ctx) {
    const call = async (path) => {
      const response = await fetch(env.APP_ORIGIN + path, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + env.ENFORCEMENT_JOB_SECRET,
          'Content-Type': 'application/json',
          // Cloudflare Access service-token headers (see §4.4)
          'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
          'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
        },
        body: '{}',
      });
      // Log status only. Never log the body: it can contain personal counts.
      console.log(path, response.status);
    };
    // Minute cadence drives alarms; the hourly cron also runs enforcement.
    ctx.waitUntil(call('/internal/jobs/alarms'));
    if (event.cron === '0 * * * *') ctx.waitUntil(call('/internal/jobs/enforcement'));
  },
};
```

### 4.2 Worker variables

In the Worker's **Settings** → **Variables and Secrets**:

| Name | Type | Value |
|---|---|---|
| `APP_ORIGIN` | plain text | `https://lock-in-708.pages.dev` |
| `ENFORCEMENT_JOB_SECRET` | **encrypted secret** | the same value stored on the Pages project |
| `CF_ACCESS_CLIENT_ID` | plain text | the service-token client id from `OPERATIONS.md` §2 |
| `CF_ACCESS_CLIENT_SECRET` | **encrypted secret** | the service-token client secret |

### 4.3 Cron triggers

Worker → **Settings** → **Triggers** → **Cron Triggers** → add both:

- `* * * * *` — every minute (alarms)
- `0 * * * *` — hourly (alarms + the enforcement pass)

### 4.4 Cloudflare Access must let it through

The internal paths sit behind Access. `OPERATIONS.md` §2 already describes the
`Lock-In Enforcement Internal Job` application and its service token; extend that
application's path to cover both internal jobs, or add a second application for
`/internal/jobs/alarms` with the same **Service Auth** policy. Do not add a Bypass policy.

### 4.5 Verify

- Worker → **Logs** (or `wrangler tail lock-in-cron`): each minute you should see
  `/internal/jobs/alarms 200`. A `401` means the job secret or the Access service token is
  wrong; a `503` means VAPID is not configured (§3).
- Then confirm delivery accounting, which is append-only and idempotent by design:

```sql
SELECT kind, occurs_on, COUNT(*) AS rows FROM push_deliveries
  GROUP BY kind, occurs_on ORDER BY occurs_on DESC LIMIT 10;
SELECT COUNT(*) AS duplicates FROM (
  SELECT user_id, kind, ref, occurs_on, COUNT(*) c FROM push_deliveries
  GROUP BY user_id, kind, ref, occurs_on HAVING c > 1);
```

Expected: `duplicates` is `0`, always. One row per alarm per day is the guarantee; the
minute-by-minute Cron cannot double-notify.

- The database answers the same question without reading a log, which matters because
  logs expire and a missing log looks like a quiet night:

```sql
-- Did the SCHEDULER fire, or only the browser? If every row says 'user', the Cron is
-- not reaching the application no matter how healthy the Worker dashboard looks.
SELECT job, actor_type, status, COUNT(*) AS runs, MAX(started_at) AS latest
  FROM job_runs GROUP BY job, actor_type, status ORDER BY latest DESC;

-- Runs that opened and never closed. A steady trickle means the pass is dying midway.
SELECT id, job, actor_type, started_at FROM job_runs
 WHERE status='running' AND started_at < datetime('now','-1 hour');
```

  Expected once the Cron is live: at least one `alarms` / `cron` row, and — after the
  07:31 enforcement trigger — at least one `enforcement` / `cron` row. A `PushServiceOffline`
  in `error_class` is the 503 above recorded honestly: the Cron *did* call, and VAPID is
  not configured. The stale-`running` query returns no rows.

### 4.6 Rollback

Delete the Cron triggers (the Worker becomes inert) or delete the Worker. The application
keeps working: enforcement still runs on the next `POST /api/tick` from the browser, and
the calendar `.ics` export keeps ringing.

---

## 5. Deploy the application

Follow `OPERATIONS.md` Section 6. Two notes specific to this handoff:

- `npm run build` now builds **two** artifacts: the client bundle
  (`public/static/bundle.js`, from the ES-module tree in `public/static/app/`) and the
  worker (`dist/_worker.js`). The committed `bundle.js` is what the shell loads, so a
  deploy without a build would still serve a valid app — but always build, so the bundle
  matches the source you are shipping.
- The shell now loads exactly one application script. If you see 404s for
  `/static/app.js` … `/static/app7.js` in production logs, a stale HTML page is cached
  somewhere; a hard reload clears it.

---

## 6. Honest limits to tell the commander

- **Push does not ring when the phone is off or has no network.** It wakes the app when the
  device is reachable. On Android and desktop this works with the app closed. On iPhone it
  works **only** if the war room has been added to the home screen (iOS 16.4+); a tab open
  in Safari will not ring.
- **The in-page war horn is cosmetic.** It needs the app open in a foreground tab, and it
  tolerates missed intervals rather than pretending to be a scheduler.
- **The calendar `.ics` export is the layer that always rings**, because the phone's own
  alarm clock owns it. Import it once; every block becomes a repeating native event with a
  two-minute-before alert. Keep using it even with push armed.
- Push messages carry **no payload**. The push wakes the service worker, which then asks
  the origin what is due, so no journal text ever passes through a third-party push
  service.

---

## 7. Permanently out of the repository's scope

For the record, these remain yours alone and the repository has never attempted, simulated,
or claimed any of them: production D1 backup and restore, Cloudflare Access configuration,
secrets configuration, production credential rotation, Cron Worker deployment, repository
visibility, and every deploy.
