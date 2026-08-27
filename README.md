# WAR ROOM — Lock In

A private, single-owner command system: a schedule that closes its own windows, a
progress-locked curriculum over eleven real books, an append-only record, and an advisor
that can read the record but cannot act on it. Unit N unlocks when unit N-1 is conquered.
There are no shame mechanics; there is an honesty engine, which is not the same thing.

This file describes the repository as it stands on this branch, and nothing else. Every
number in it is derived from source by `test/readme-truthfulness.test.ts`, which fails the
gate if the code moves and this file does not. That guard is the only reason to believe a
number here — a hand-maintained README decays into falsehood without anybody deciding to
make it false, and the one this replaced had done exactly that.

## The navigation

Five tabs across the bottom: TODAY, LEARN, PRACTICE, REVIEW, MORE. Inside each tab a
segmented control selects a face, and there are 13 faces in total:

| Tab | Faces |
|---|---|
| TODAY | NOW, SCHEDULE |
| LEARN | CAMPAIGN, BOOKS, RHETORIC |
| PRACTICE | CARDS, MAXIMS, RESPONSE LAB |
| REVIEW | DEBRIEF, STATS |
| MORE | COUNCIL, INTEL, SETTINGS |

The faces are the destinations; the bar is how you get to them. Nothing was removed in
the collapse — the commander reaches everything one level in instead of nine targets
across.

**This README claimed eight tabs, and it was wrong in both directions.** The application
had nine bottom-bar tabs when the sentence was written, not eight; those nine were then
collapsed to the five above, and this file went on saying eight for months afterwards.
The discrepancy is recorded here rather than quietly corrected, because the record of
having been wrong is the only thing that makes the next number in this file worth
trusting. `STATUS.md` carries it as R10 and B3.X2.

## The books

The shelf holds 11 works: eleven public-domain texts, parsed to JSON, served as static
assets, and cached for offline reading. Chapter counts are pinned in `src/books.ts` and are what the progress
lock and the +20-points-per-chapter award read:

| Work | Chapters |
|---|---|
| The Art of War | 13 |
| The Prince | 26 |
| Discourses on Livy | 141 |
| Meditations | 12 |
| Enchiridion | 6 |
| Apology | 4 |
| Crito | 3 |
| The Republic | 4 |
| Thus Spoke Zarathustra | 25 |
| Beyond Good and Evil | 10 |
| On War | 12 |

The counts are deliberately uneven. *Discourses* is chaptered as the source chapters it, and
*The Republic* and *Apology* are held at their part divisions rather than being split
finer; an earlier version of this file implied a flat twelve chapters everywhere, which
would have made the progress lock look like something it is not. Translations are the
Project Gutenberg editions (www.gutenberg.org).

## The data

Cloudflare D1 (SQLite), reached through raw prepared statements. The schema is defined by
30 migrations in `migrations/`, applied in filename order, and they leave 98 live tables.

Both figures are derived by replaying the directory rather than by counting a remembered
number: `CREATE TABLE` minus `DROP TABLE`, with renames followed through, and with
comment lines stripped first. That last step matters — most `DROP TABLE` text in
`migrations/` sits inside a `-- ROLLBACK:` note written for a human, and counting those
makes the directory look an order of magnitude more destructive than it is. Only two
tables are genuinely dropped, each at the end of a cutover that renamed a `_v2`
replacement into its place. `MIGRATIONS.md` makes the same split and owns the detail.

Multi-row writes go through `DB.batch()`. Reward redemption is race-safe because the debit
insert's balance check is the atomic arbiter, and a flag's point penalty only posts when
the flag insert actually landed.

## The Hermes bridge

A scoped-credential agent surface, so a local agent on the commander's own device can read
and write exactly the capabilities its credential grants. Credentials are issued one per
device from COUNCIL, shown once, and stored only as a SHA-256 hash alongside a safe prefix
and metadata. Authentication is the `X-Agent-Token` header only; a token in a query string
is rejected. `export:read` is never part of a default credential.

Nine routes, all POST, so that authenticated usage accounting never makes a GET or HEAD
write to D1:

| Route | Scope |
|---|---|
| `POST /api/agent/v1/briefing` | `briefing:read` |
| `POST /api/agent/v1/pending` | `blocks:read` |
| `POST /api/agent/v1/debriefs` | `debriefs:read` |
| `POST /api/agent/v1/intel/read` | `intel:read` |
| `POST /api/agent/v1/intel` | `intel:write` |
| `POST /api/agent/v1/debrief` | `debriefs:write` |
| `POST /api/agent/v1/block-log` | `blocks:write` |
| `POST /api/agent/v1/message` | `hermes:write` |
| `POST /api/agent/v1/export` | `export:read` |

The unversioned agent API and the legacy master-token endpoints are gone. The Termux
client is served at `/static/hermes_bridge.py`; it requires an HTTPS host, reads its
credential from an owner-only file rather than a command line, and refuses a full export
without both an `export:read` credential and an explicit authorisation flag.

## The gate

One command:

```bash
npm run verify
```

which is `npm run build && npm test && tsc --noEmit && git diff --check` plus a check that
the committed client bundle matches its source. There is no second command to remember and
no partial pass — either that exits 0 or the work is not done.

Behind it: 72 server test files running in the Cloudflare Workers pool against a real local
D1, and 10 DOM test files running under happy-dom. The two suites are separate projects
because the workers runtime and the DOM runtime cannot share one. Both counts above are
derived from the files that exist, including the one test that lives outside `test/`, in
`workers/`.

## Development

```bash
npm install
npm run build                  # vite build -> dist/
npm run dev                    # local dev server
npm test                       # both suites
npm run verify                 # the gate
```

Local D1 migration and seeding commands, the seed files, and the local page index are
documented in `OPERATIONS.md` and `LOCAL_PAGE_INDEX.md`. Model access needs
`OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_ALLOWED_BASE_URLS`; supply them locally
through an uncommitted `.dev.vars`, never through a committed file.

## Deployment

**This application has not been deployed.** No deploy has been performed by repository
work, and this file carries no URL to anything running. The previous version of this README advertised a development sandbox
host; it was unreachable and unverifiable from the repository, and a URL in a README is
read as an invitation.

The platform target is Cloudflare Pages with D1 and a Cron Worker. Every step that touches
it — backup, migration application, secrets, credential rotation, the Cron Worker, and the
deploy itself — belongs to a separate operator and is written out step by step in
`OPERATIONS.md` and `DEPLOYMENT.md`. Repository work does not perform those steps, does not
simulate them, and does not claim they have happened. "Production-ready" in `STATUS.md`
means repository-side readiness only.

## Known gaps

These are open, and named here because a gap nobody wrote down is a gap that gets
rediscovered by a user:

- **Only the book JSON is cached offline.** The service worker caches `/static/books/*`
  under a versioned name, deletes every superseded generation of its own on activate, and
  revalidates a cache hit in the background so a corrected chapter reaches the reader on the
  next read. It deliberately does not cache the app shell or the client bundle, so those
  still need the network — full offline app-shell caching and an offline write queue are
  scheduled, not present.
- **Android heads-up notifications cannot be forced from the web.** The notification channel
  has to be set to High/Urgent in the device's own settings; the app can request, not
  compel.
- **The in-app advisor is offline without a model key**, and fails closed rather than
  degrading into a guess.
- `AI_SAFETY.md` §14 lists the open weaknesses in the advisor path, and `SECURITY.md` §13
  lists the accepted residual risks in the security model. Neither list is decoration.

## Where the detail lives

This file is a map, not the territory. Each of these owns claims that must exist in exactly
one place, because a second copy is a copy that drifts:

| Document | Owns |
|---|---|
| `SECURITY.md` | the security model, the trust boundaries, the accepted residual risks |
| `PRIVACY.md` | every field the Commander's File emits, and why each one is needed |
| `ARCHITECTURE.md` | the request path, the modules, and where state actually lives |
| `MIGRATIONS.md` | the schema, the migration order, and the rollback note for each |
| `DEPLOYMENT.md` | what a deploy consists of, for the operator who performs it |
| `OPERATIONS.md` | the operator runbook, step by step, including what is out of scope |
| `CURRICULUM_GUIDE.md` | the phases, the units, the exams, and the progress lock |
| `AI_SAFETY.md` | what the model may see, what is enforced in code, and what is not |
| `STATUS.md` | the only progress record: what is done, what is owed, what was found |

## What this README does not claim

- It does not claim a deployment. Nothing above describes a running service, and no host
  named here is presented as reachable.
- It makes no claim that has not been derived from source or enforced by a test. Where a
  figure appears, the guard that derives it is the reason it is here.
- It is not an audit, not a security review, and not a certification. `SECURITY.md` and
  `AI_SAFETY.md` describe a model and its known holes; describing a control is not the same
  as having had it independently reviewed.
- Its silence is not a guarantee. A risk this file does not name may be absent, or may
  simply not have been found yet — the absence of a warning is not evidence of safety.
- It does not claim to be complete about work still in progress. `STATUS.md` is the record;
  where the two disagree, `STATUS.md` is correct and this file is stale.
