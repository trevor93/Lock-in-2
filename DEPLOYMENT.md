# DEPLOYMENT.md

## 1. What this document is

This is a description of **what gets deployed** — the two deployables, what each one requires at
runtime, what the build produces, and where the repository's own files disagree with each other.

It is not a runbook. The ordered steps an operator performs — making the repository private,
putting Cloudflare Access in front of the application, storing each secret, taking the D1
backup, applying migrations, deploying the Pages application, issuing agent credentials,
deploying the scheduled Worker, and recording acceptance evidence — are in `OPERATIONS.md` §1
through §9, and they live there in exactly one place. Nothing in this file is a step to perform,
and it deliberately contains no checklist: a second copy of a procedure is a copy that drifts
from the first one, silently, and this repository has already paid for that once.

Every figure below is derived from the repository by `test/deployment-doc-completeness.test.ts`
rather than written by hand. If a binding is added, a script renamed, a cron schedule edited or a
scheduler taught to call one more path, that test fails until this document says so.

## 2. The two deployables

| Deployable | Config | Configured name | What it is |
|---|---|---|---|
| The application | `wrangler.jsonc` | `webapp` | One Hono app served as a Cloudflare Pages Function, bound to one D1 database. |
| The scheduler | `workers/enforcement-cron/wrangler.jsonc` | `lock-in-enforcement-cron` | One Worker with a `scheduled` handler and no database binding, whose only job is to POST an internal path on a timer. |

They deploy separately, hold different bindings, and share exactly one value (§7). The
application does not require the scheduler to be present: every job path the scheduler calls can
also be invoked directly with the job secret. Without it, enforcement runs only when a browser
loads the app and posts `/api/tick`, which means closed-app enforcement does not happen.

## 3. The application

From `wrangler.jsonc`:

| Field | Value | What it decides |
|---|---|---|
| `name` | `webapp` | The Pages project a bare `wrangler pages deploy` would target. See §10 — this is not the project name in use. |
| `compatibility_date` | `2026-04-26` | The Workers runtime semantics the code was written against. |
| `compatibility_flags` | `nodejs_compat` | Node built-ins the bundle relies on. |
| `pages_build_output_dir` | `./dist` | The directory uploaded as the deployment. |
| `d1_databases[0].binding` | `DB` | The name the code reads the database as — `env.DB`, in 159 places. |
| `d1_databases[0].database_name` | `webapp-production` | The D1 database the binding points at. |
| `d1_databases[0].database_id` | `local-placeholder` | **A placeholder, not a real database id.** It is enough for local development and for the test suite, which builds its own SQLite database from `migrations/`. The real id is operator-supplied at the Cloudflare end; nothing in this repository knows it, and it is not a value this repository should hold. |

## 4. The scheduler

From `workers/enforcement-cron/wrangler.jsonc` and `workers/enforcement-cron/src/index.ts`:

| Field | Value |
|---|---|
| `name` | `lock-in-enforcement-cron` |
| `main` | `./src/index.ts` |
| `compatibility_date` | `2026-04-26` |
| `triggers.crons` | `*/5 * * * *` — every five minutes |
| `vars.ENFORCEMENT_JOB_URL` | `https://lock-in-708.pages.dev/internal/jobs/enforcement` |

The handler does one thing: POST that URL with `Content-Type: application/json`, a body of `{}`,
an `Authorization: Bearer` header carrying the job secret, and — only when both are configured —
the two Cloudflare Access service-token headers. A non-`2xx` response throws, so the failure
surfaces in the Worker's own logs. It holds no D1 binding and no application logic.

## 5. What the application requires at runtime

Every field of the `Bindings` type in `src/env.ts`, and what the code does when it is absent.
"Absent" here includes empty and whitespace-only: the model and push paths both trim before
testing.

| Binding | required | Absent means |
|---|---|---|
| `DB` | required | The D1 binding. Every read and write goes through it; without it the application cannot serve a single page of state. |
| `OPENAI_API_KEY` | required | The model provider key. Absent, every Hermes route answers `503` with `MODEL SERVICE OFFLINE` and writes one `model_audit_events` row with `event_type = 'offline'`. The application stays up; only the model routes degrade. |
| `OPENAI_BASE_URL` | required | The model endpoint. It must parse as a URL, its protocol must be `https:`, and it must appear in the allowlist below. Anything else is the same `503` and the same audit row. |
| `OPENAI_ALLOWED_BASE_URLS` | optional | Comma-separated allowlist. Absent, the allowlist is empty and **no** base URL can satisfy it, so the model routes are off. Optional in the type; required in practice for the model to work at all. |
| `ENFORCEMENT_JOB_SECRET` | optional | The bearer token both internal job paths require. Absent, both answer `401` with `INVALID INTERNAL CREDENTIAL` and nothing else runs. Optional in the type because the application is complete without it; required by the scheduler (§6). |
| `ALLOWED_ORIGINS` | optional | Extra browser origins permitted to make cross-origin requests. Absent, the allowed set is the request's own origin alone — same-origin only, which is the correct configuration for a single-hostname deployment. |
| `VAPID_PUBLIC_KEY` | optional | Web Push public key. |
| `VAPID_PRIVATE_JWK` | optional | Web Push private JWK. |
| `VAPID_SUBJECT` | optional | Web Push contact, which must begin `mailto:` or `https:`. |

The three VAPID values are one unit. If any of them is absent, or the subject is malformed, push
is off: `GET /api/push/key` and `POST /internal/jobs/alarms` answer `503` with
`PUSH SERVICE OFFLINE`, the alarms run closes with `error_class = 'PushServiceOffline'`, and the
UI directs the commander to the calendar export instead. Nothing half-works.

## 6. What the scheduler requires at runtime

Every field of the `Env` interface in `workers/enforcement-cron/src/index.ts`:

| Binding | required | Absent means |
|---|---|---|
| `ENFORCEMENT_JOB_URL` | required | The URL to POST. Supplied as a plain `vars` entry in the config, so it is visible in the repository — it is a public path on a public hostname, not a secret. |
| `ENFORCEMENT_JOB_SECRET` | required | The bearer token. Absent, the Worker sends `Bearer undefined`, the application answers `401`, and the handler throws. |
| `CF_ACCESS_CLIENT_ID` | optional | Cloudflare Access service-token id. |
| `CF_ACCESS_CLIENT_SECRET` | optional | Cloudflare Access service-token secret. |

The two Access headers are a pair: the Worker sends them only when **both** are present. With
Cloudflare Access in front of the application — which `OPERATIONS.md` §2 requires — a scheduler
without both values is refused by Access before the application ever sees the request.

## 7. The one value that must match, and the silence when it does not

`ENFORCEMENT_JOB_SECRET` is the only binding both deployables read. The application compares the
supplied bearer token against its own copy in constant time; the scheduler sends its copy. Two
different values is not a partial failure, it is a total one.

It is worth knowing exactly what that failure looks like, because it looks like nothing. In both
internal routes the credential check runs **before** the run is recorded:

```
401 INVALID INTERNAL CREDENTIAL   ->  no job_runs row is written
```

So a scheduler calling with the wrong secret and a scheduler that was never deployed produce the
same evidence: an empty `job_runs` table. The table does distinguish a *configuration* failure
after that point — the alarms run is opened before the VAPID check, so "called, but push was not
configured" is a row with `error_class = 'PushServiceOffline'` rather than silence — but it
cannot distinguish a wrong secret from an absent scheduler. The place that distinction is visible
is the Worker's own logs, where a `401` is explicit.

## 8. What the build produces

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with the Hono adapter. |
| `npm run build:client` | Bundles `public/static/app/main.js` into one readable, unminified IIFE at `public/static/bundle.js`. |
| `npm run build` | `npm run build:client`, then the Pages build into `dist/`. |
| `npm run test:server` | The Workers-pool suite. |
| `npm run test:dom` | The happy-dom suite. |
| `npm run test` | Both suites in order. `npm test` is the same thing. |
| `npm run verify` | The whole gate: build, both suites, `tsc --noEmit`, whitespace check, and the committed-bundle comparison. |
| `npm run preview` | `wrangler pages dev` — a local Pages runtime. Operator-credentialled. |
| `npm run deploy` | Builds, then deploys. Operator-credentialled, and not the command the runbook uses; see §10. |
| `npm run cf-typegen` | Regenerates the Cloudflare binding types. |

Two artifacts, handled in opposite ways, and confusing them is a real deployment error:

- **`public/static/bundle.js` is committed.** It is in git, and `npm run verify` ends with
  `git diff --exit-code -- public/static/bundle.js`, which rebuilds it and fails if the committed
  copy differs by one byte. That is what makes "the shipped bundle is the bundle these sources
  produce" a checked claim rather than a hope.
- **`dist/` is gitignored.** It holds `_worker.js`, `_routes.json` and the copied static
  directory, and it does not exist until something builds it. A deploy from a tree where nothing
  ran `npm run build` has nothing to upload.

## 9. What CI does, and what it is forbidden to do

`.github/workflows/verify.yml` runs on pushes to `main` and `refactor/**` and on pull requests
into `main`. It checks out, installs Node 22, runs `npm ci`, and runs `npm run verify`. That is
the entire workflow.

It holds no credentials and performs no deploy, and that is enforced rather than promised:
`test/gate-completeness.test.ts` sweeps every executable line of every workflow for `wrangler`,
`CLOUDFLARE_API_TOKEN`, `secrets.`, `pages deploy` and `npm run deploy`, and fails if any of them
appears. Comment lines are excluded, so the workflow is still free to explain in prose what it
refuses to do.

## 10. Four places the repository disagrees with itself

These are not defects in the deployed system. They are places where two files in this repository
describe the same thing differently, and an operator reading only one of them would act on a
wrong picture. Each one is derived, so it cannot quietly stop being true or quietly stay stated
after it is fixed.

**1. The project name.** `wrangler.jsonc` sets `name` to `webapp`. `OPERATIONS.md` §6 deploys
with `--project-name lock-in-708`, which overrides it, and `lock-in-708` is the project that
exists. `npm run deploy` carries no `--project-name`, so it takes the name from the config —
meaning that script, run as-is against production credentials, targets a project called `webapp`
rather than the live one. The runbook command is the correct one.

**2. The database id.** The committed `database_id` is `local-placeholder` (§3). This is
deliberate and correct for a repository that must not hold production identifiers, but it means
the config in git is not a deployable config on its own.

**3. Two different schedulers.** `workers/enforcement-cron/` is a Worker named
`lock-in-enforcement-cron`, under version control, deployed by `OPERATIONS.md` §8, calling one
path every five minutes. `OPERATOR_HANDOFF.md` §4 walks an operator through creating a *different*
Worker by pasting source into the dashboard: a different name, a different origin variable, two
cron triggers (`* * * * *` and `0 * * * *`), and calls to **both** internal job paths. An operator
who follows both files deploys two schedulers, and enforcement then runs on two timers. Enforcement
is idempotent — a second run creates no duplicate flags or points, which `OPERATIONS.md` §8
verification requires — so this is a configuration inconsistency rather than a data hazard. The
committed Worker is the one under version control and the one the test suite covers.

**4. An internal job path that nothing in this repository calls.** The application registers
`POST /internal/jobs/enforcement` and `POST /internal/jobs/alarms`. The committed scheduler calls
only the first. So `/internal/jobs/alarms` has **no committed caller**: an operator who deploys
exactly what is in this repository gets an endpoint that is reachable, authenticated and never
invoked, and push alarms never fire even with all three VAPID values configured. The comment above
that route says it is "called every minute by the operator's Cron Worker" — true of the Worker
`OPERATOR_HANDOFF.md` §4 describes, not of the one committed here. Closing this needs a second
trigger, which is operator work (§11).

## 11. What is the operator's, and only theirs

Deploying either deployable to Cloudflare **is an operator action**. This repository does not
perform it, cannot perform it, and does not claim to have performed it. Cloudflare is owned by a
separate operator agent, and nothing in `package.json`, in CI, or in any test applies a migration
to a remote database, deploys a Worker, or reads a production credential. `npm run deploy` and
`npm run preview` exist as scripts and both require Cloudflare credentials this repository does
not hold; the deploy the runbook actually performs is

```
npx wrangler pages deploy dist --project-name lock-in-708 --branch main --commit-hash <approved commit>
```

and it is performed by the operator, from `OPERATIONS.md` §6, after that section's preconditions.

The same boundary covers, permanently: the production D1 backup, Cloudflare Access configuration,
every secret value, production credential rotation, the scheduler's deployment and its cron
triggers, repository visibility, and the real `database_id`. Each has a section in `OPERATIONS.md`
and none of them is reachable from this repository.

## 12. What this document does not claim

- It does not claim any deployment has happened, or that the live system matches this repository.
  Everything above is read from files in git.
- It does not claim the placeholder `database_id`, the project-name divergence, or the missing
  alarms trigger have been resolved at the Cloudflare end. It states what the repository contains.
- It does not claim the scheduler is running, on any schedule. `triggers.crons` in a config file
  is a request; a live cron trigger is a dashboard fact this repository cannot observe.
- It does not claim `OPERATOR_HANDOFF.md` §4's Worker is wrong, only that it is a different Worker
  from the committed one, and that following both files deploys two.
- It does not restate the operator procedure, the rollback notes, or the append-only guarantees.
  Those are in `OPERATIONS.md`, `MIGRATIONS.md` §8 and `SECURITY.md` §12, each in one place.
- It does not claim CI is safe because it is described as safe. That is asserted by
  `test/gate-completeness.test.ts`, and every derived figure above is asserted by
  `test/deployment-doc-completeness.test.ts`.
