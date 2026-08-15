# ⚔ WAR ROOM — Lock In

A private, progress-based, honesty-driven life-command system. Not a calendar app — a **campaign**: unit N unlocks only when unit N−1 is conquered. No shame mechanics — **ruthless honesty mechanics**: missed debriefs are flagged, skipped drills are called out, points are earned and lost.

## Project Overview
- **Name**: webapp (War Room)
- **Goal**: One system that runs the day (schedule + alarms), the mind (strategy & philosophy curriculum with the REAL books), the record (debriefs, intel, stats), and the counsel (Hermes AI advisor — in-app and via the Termux bridge).
- **Designed for**: a slow reader / slow doer — small units, mastery gates, no time pressure, only sequence pressure.

## URLs
- **Sandbox (dev)**: https://3000-iudnv7yitk8ls7mhkrw94-0e616f0a.sandbox.novita.ai
- **Production**: not yet deployed (awaiting deploy-path choice)

## The 8 Tabs
| Tab | Purpose |
|---|---|
| **NOW** | What should I be doing RIGHT NOW — current block, next block, one-tap log |
| **DAY** | Full day plan, block check-offs, the 7 Laws daily checklist |
| **WAR** | The Campaign — 5 phases, 41 progress-locked units (reading → lesson → field drill → debrief), self-scored exams (pass ≥70) |
| **BOOKS** | 11 REAL full books (Project Gutenberg official translations) with chaptered reader + progress (+20 pts/chapter) + alarm settings + .ics calendar export |
| **COUNCIL** | Hermes AI chat (knows the whole database via live Commander's File), Morning Council, Intel Log (16 life domains), **Hermes Bridge** setup |
| **MIND** | Maxim bank (26 maxims, naive vs MASTER reading) + SM-2 spaced-repetition flashcards |
| **LOG** | Nightly debrief (Law 4 targets mandatory), rewards store, past reports |
| **STATS** | Weekly adherence %, streaks, points ledger, honesty flags |

## Key Systems
- **Auth Gate (P0)** — the entire app sits behind a password. First open asks you to **SET a password** (PBKDF2, 100k iterations, per-install salt); after that it is login-only. Browser sessions are random opaque credentials stored SHA-256-hashed server-side and delivered in host-only `HttpOnly; Secure; SameSite=Lax` cookies with 30-day expiry, login rotation, logout revocation, and session-fixation protection. Five failed logins trigger a 15-minute lockout. Private browser routes require a valid session; versioned agent routes use separate scoped credentials. Browser CORS defaults to same-origin.
- **Server Clock** — the server owns the calendar. `POST /api/tick` sends the browser timezone ONCE (then locked in `settings.timezone`); all dates/times are derived server-side via `Intl.DateTimeFormat`. Client-supplied dates are clamped (format-checked, never-future). No more "log yesterday from the query string".
- **Honesty Engine** — runs server-side ONLY on `POST /api/tick` (the single engine crank; `GET /api/state` is a pure read): evaluates yesterday, files flags (missed debrief, unlogged blocks, tongue neglect), applies point penalties, awards victory-day (+30) and HELD-THE-LINE (+10) bonuses, finalizes yesterday into `day_summary`.
- **Weighted Adherence** — blocks carry weight: **CORE (3)** = non-negotiables, **STANDARD (1)** = normal work, **CONTEXT (0)** = meals/skincare/entertainment/sleep/rest. Score = Σ(weight × credit) / Σ(weight). Missing dinner no longer costs the same as missing deep work. Weight-0 blocks are auto-canceled silently when their window closes — no flag, no penalty, not scored.
- **Minimum Viable Day (MVD)** — 3 nominated CORE blocks. If ALL 3 land (done/partial), the day is **HELD THE LINE**: the streak survives even if overall adherence collapsed, no low-adherence flag, +10 bonus. Bad days end; the line doesn't break.
- **LOAD REDUCTION (replaces never-miss-twice)** — miss the same block two days running and instead of a doubled penalty, the block's expectation is **halved for 3 days** and the app asks WHY (wrong time / too long / wrong prerequisite / don't actually want it) with tailored advice. Repeated failure is design feedback, not moral failure.
- **Delta Scoring** — today's adherence is compared against your **trailing 14-day median** (needs ≥3 finalized days), shown as ▲/▼ delta. You compete against your own baseline, not an abstract 80%.
- **Weekly Appeal Token** — ONE appeal per ISO week (`UNIQUE(week_key)` is the arbiter). Requires a ≥100-character permanent written reason; if granted it reopens the canceled block's window, refunds the penalty, and acknowledges the flag. The reason is on the record forever.
- **Prediction Log (the instrument)** — seal claims about the future with a confidence (50–99%) and a resolve-by date. Grade them RIGHT / WRONG / VOID when due. The app computes your **Brier score**, a claimed-vs-actual **calibration curve** (5 confidence buckets, n≥3), and a plain-language bias verdict (OVERCONFIDENT / UNDERCONFIDENT / WELL CALIBRATED). Lives in the LOG tab.
- **day_summary Materialization** — every finalized day is written to a `day_summary` row (adherence, weighted score, MVD, debrief, victory, points). Streak computation is one indexed SELECT (victory extends, HELD-THE-LINE survives-neutral, anything else breaks). Stats strip reads from it directly; only today is computed live. Client poll relaxed 15s → 60s.
- **Same-Day Enforcement (REAL-TIME)** — any block whose window closed (`end_time` + `grace_minutes`, default 30) without a log is **AUTO-CANCELED live**: written as `status='missed'`, instant `missed_live` flag + penalty (−15 non-negotiable, −5 normal). The block renders struck-through with a red ✖ CANCELED pill and its buttons are gone. Re-logging returns **409 WINDOW CLOSED** — a missed block can never be reopened. Next-day engine skips already-punished blocks (no double jeopardy).
- **THE TONGUE — Wise-Response Armory** — capture every smart, wise, unreadable response you hear (situation + exact question + exact line + why it works + source + 10 categories: deflection/wit/power/mystery/boundaries/praise/conflict/small-talk/negotiation/silence). A supreme memorization engine then drills each line into long-term memory with **5 rotating attack modes** (situation drill, cloze gaps, first-letters, reverse-binding, out-loud delivery reps), SM-2 spaced repetition, and a **mastery ladder**: NEW → LEARNING → MEMORIZED → INGRAINED → REFLEX (25 solid recalls + 45-day interval = fires in live conversation without thinking). Strict **weekly exam** (10 random lines, pass ≥80% → +25 pts; fail → flag + −10). Letting 5+ drills rot 3+ days files a TONGUE NEGLECT flag. Capture = +3 pts; every mastery promotion pays a bonus.
- **Progress Locking** — `ensureUnlocks` walks each track; the first incomplete unit is the only active one. Locked units reject all writes.
- **Points Economy** — earn: blocks, units, exams, debriefs, book chapters. Lose: flags. Spend: rewards store.
- **Alarms** — 3 layers: (1) in-app **luxury grand-chime** (Web Audio bell synthesis: bronze bell partials, velvet attack, long decay, lowpass warmth + compressor, G4→B4→D5→G5 motif) + gold banner, (2) service-worker heads-up notifications (`requireInteraction`, refined vibration, action button; auto-cancel fires a dedicated ✖ CANCELED notification + toast), (3) `.ics` export with RRULE+VALARM → device-native alarms that ring even with the app closed.
  - *Android heads-up popups:* set the browser/PWA notification channel to **High/Urgent** ("pop on screen") in Settings → Apps → Notifications — web apps cannot force this.
- **Real Books** — 11 public-domain official translations parsed to JSON, served statically, cached offline by the service worker: Art of War, The Prince, Discourses on Livy, Meditations, Enchiridion, Apology, Crito, The Republic, Zarathustra, Beyond Good & Evil, On War.

## 🔗 Hermes Bridge (Termux / Telegram / CLI)
Scoped-credential agent API so a local Hermes agent (Termux on Android) can read and write only the capabilities granted to its device credential.

**Credentials** — sign in, then open COUNCIL → HERMES BRIDGE. Issue one credential per device. The raw value is shown once; the server stores only its SHA-256 hash and later lists only a safe prefix and metadata. Credentials carry explicit scopes, expiry, revocation, last-use details, and coarse request metadata. Default bridge credentials exclude `export:read`. Authentication is **`X-Agent-Token` header only**; query-string tokens are rejected.

**Versioned endpoints** — all agent operations use POST so authenticated usage accounting never makes a GET or HEAD mutate D1:
- `POST /api/agent/v1/briefing` with `{}` — live Commander's File (`briefing:read`)
- `POST /api/agent/v1/pending` with `{}` — current block, overdue unlogged blocks, flags, debrief status (`blocks:read`)
- `POST /api/agent/v1/debriefs` with `{}` — recent debriefs (`debriefs:read`)
- `POST /api/agent/v1/intel/read` with `{}` — recent intel (`intel:read`)
- `POST /api/agent/v1/intel` — file intel (`intel:write`)
- `POST /api/agent/v1/debrief` — merge into a debrief (`debriefs:write`)
- `POST /api/agent/v1/block-log` — log a block (`blocks:write`)
- `POST /api/agent/v1/message` — post counsel into the COUNCIL log (`hermes:write`)
- `POST /api/agent/v1/export` with `{}` — owner-scoped export (`export:read`, never default)

The legacy master-token endpoints and unversioned agent API are retired. Production migration, deployment, and credential replacement are operator-controlled under `OPERATIONS.md`; repository work does not claim they have occurred.

**Termux client**: download `/static/hermes_bridge.py` — commands: `briefing | pending | watch | done | intel | journal | say | export`. The bridge requires an HTTPS `WARROOM_URL`, reads the agent credential from an owner-only file selected by `WARROOM_TOKEN_FILE` (default `~/.config/warroom/agent_token`; paste it through `cat` so it does not enter shell history), uses bounded timeouts and default TLS verification, and distinguishes 401/403/429/5xx without printing credentials or raw server errors. Full export additionally requires a separate `export:read` credential and `--authorize-full-export`. The `watch` daemon polls every 60s and fires `termux-notification` and optional Telegram messages (`TG_BOT_TOKEN`/`TG_CHAT_ID`) on block starts, unlogged blocks, honesty flags, and missing debriefs after 21:00.

## Data Architecture
- **Storage**: Cloudflare D1 (SQLite) — 31 tables across 6 migrations
- **Core tables**: schedule_blocks (+weight, +is_mvd), block_logs, debriefs, phases, units, unit_progress, maxims, flashcards, card_reviews, honesty_flags (+ref_type/ref_id with UNIQUE identity index — flags can never double-file), points_ledger, rewards, laws, law_checks, settings, intel_entries, book_progress, hermes_messages
- **New in 0004**: `day_summary` (materialized daily record), `predictions` (claim/confidence/outcome), `appeals` (UNIQUE per ISO week), `load_reductions`
- **New in 0005–0006**: durable `users`, hashed/revocable browser `sessions`, owner-scoped personal rows, hashed/scoped/revocable `agent_credentials`, and `agent_credential_events`. The legacy plaintext agent-token setting is erased by migration `0006`.
- **Integrity**: multi-writes go through `DB.batch()`; reward redemption is race-safe (the debit INSERT's WHERE-balance check is the atomic arbiter); flag penalties only post when the flag insert actually landed
- **AI**: `gpt-5-mini` via OpenAI-compatible proxy (env: `OPENAI_API_KEY`, `OPENAI_BASE_URL`; local dev via `.dev.vars`)

## Development
```bash
npm run build                          # vite build → dist/
pm2 start ecosystem.config.cjs         # wrangler pages dev dist --d1 --local :3000
npm run db:migrate:local               # apply migrations
npm run db:seed                        # seed schedule/laws/rewards
# also seeded: seed_curriculum.sql, seed_curriculum2.sql, seed_maxims.sql
```

## Deployment
- **Platform**: Cloudflare Pages (pending — user to choose deploy path)
- **Tech Stack**: Hono + TypeScript + Cloudflare D1 + Tailwind CDN + vanilla JS + PWA
- **Status**: ✅ Fully working in sandbox (⚠ in-app Hermes chat requires a valid LLM API key injection)
- ⚠ **SECURITY — operator action required before real use**: an inspected existing production deployment was older than the authenticated source and must not be treated as remediated. The separate operator must follow `OPERATIONS.md` for backup, migration application, deployment, verification, and issuance of replacement per-device scoped credentials; repository work does not perform or claim those actions.
- **Design**: Luxury v2 — layered-black glassmorphism, engraved gold (Cinzel), FX engine (confetti, haptics, count-up, progress rings), rank ladder (RECRUIT→SOVEREIGN), streak flame tiers, timeline day view, WhatsApp-grade council chat, premium book reader with drop caps
- **Last Updated**: 2026-08-12 (Reforge wave 1: auth gate, server clock, weighted adherence, MVD, load reduction, appeals, prediction log, day_summary)
