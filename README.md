# 🗄️ Family Vault

A mobile-first **PWA** where a family stores its important documents (passports,
insurance, licenses, warranties, medical records…), **never misses an expiry**,
and coordinates life together — chat, events, tasks, reminders.

> **Status: live in production.** All core product phases are implemented and
> tested (270+ tests). New here? Read [`CLAUDE.md`](CLAUDE.md) first — it is the
> institutional memory of this repo — then [`docs/FEATURES.md`](docs/FEATURES.md)
> for what exists and [`docs/TESTING.md`](docs/TESTING.md) /
> [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for how to work on it.
> Agent workflows live in [`.claude/skills/`](.claude/skills/) (gate,
> add-api-resource, live-test, db-migration, email-template, release).

## What the product does today

- 📄 **Documents** — upload to the family's Google Drive, categories with
  **AI suggestions**, expiry tracking, search by name, per-person assignment
  ("Ella's passport"), **family vs private visibility** (enforced server-side,
  covered by an authz-matrix test suite), comments, version history.
- ⏰ **Reminders** — daily cron scans expiries/events with per-window dedupe:
  in-app notifications + urgency-coded HTML emails; per-user channels and
  lead-time windows; **tag someone** to remind them (`@mention` in chat or
  "Remind a family member" on a document).
- 💬 **Family chat** — WhatsApp-style bubbles, @mentions with notifications,
  soft-delete, 5s polling.
- 📅 **Calendar** — events with attendees, per-event `.ics` download, and a
  subscribable feed (Google/Apple/Outlook) carrying events + document expiries.
- 👨‍👩‍👧 **Family management** — Google-login invites (email-bound, single-use,
  beautiful HTML invite email), roles (owner/admin/member), dependents without
  accounts, member profiles, activity feed.
- 📱 **App-like UI** — Instagram-style bottom tabs (Home · Docs · Chat ·
  Activity with live unread badge · Family), installable PWA, dark theme,
  safe-area aware.
- 📧 **Weekly digest** — Monday "your family week ahead" email report
  (expiring docs, events, open tasks), per-recipient privacy, deduped.

**Stack:** React 19 + Vite + Tailwind v4 PWA · Cloudflare Worker + Hono
(single deploy unit, same-origin `/api`) · D1 (Drizzle) + KV · Google Drive
(`drive.file`) for bytes · Google OAuth (PKCE) + opaque session cookies ·
Resend email · optional Claude API for document categorization.

## Quick start

```bash
npm install
cp .dev.vars.example .dev.vars   # secrets optional for local UI work
npm run db:migrate:local         # create local D1
npm run dev                      # real workerd runtime + HMR
npm run dev:seed                 # seed two users w/ session cookies (no OAuth needed locally)
```

Open the printed URL. API is same-origin under `/api` (try `/api/health`).
Full local multi-user walkthrough: `.claude/skills/live-test/SKILL.md`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server (Vite + `@cloudflare/vite-plugin`, real `workerd` + bindings) |
| `npm run dev:seed` | Seed local D1 with two users + live sessions (`sid=sess-priya` / `sid=sess-ravi`) |
| `npm run dev:screenshots` | Playwright mobile screenshots of every screen → `screenshots/` |
| `npm run typecheck` / `lint` / `test` / `build` | The gate — ALL must pass before every commit |
| `npm run db:generate` | Generate D1 migrations from `worker/db/schema.ts` (then `python3 scripts/validate_migrations.py`) |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply migrations (remote is **manual** after deploys!) |
| `npm run deploy` | Build + `wrangler deploy` (normally done by the merge pipeline) |

## Deployment

Merging to the default branch triggers the production pipeline. **Migrations
are not auto-applied** — run `npm run db:migrate:remote` after merging a PR
that contains one. Full runbook incl. first-time provisioning, secrets, Google
Cloud setup, smoke tests, and ops: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

> ⚠️ **Trust/privacy:** all families' documents physically reside in one Google
> account's Drive. Acceptable for a single trusted family; see
> `docs/ARCHITECTURE.md` → "Trust, Privacy & Storage Model" before onboarding
> unrelated families (Shared Drive + envelope encryption are on the roadmap).

## Project structure

```
src/              React PWA — pages/, components/ (ui/ kit + BottomNav), context/, lib/
worker/           Hono API + cron — db/schema.ts (★ source of truth), routes/, lib/, middleware/
migrations/       Generated D1 SQL (0000–0004) — never hand-edit applied ones
tests/            Vitest — contract + real-D1 integration + authz matrix + stress
scripts/          dev-seed, dev-screenshots, validate_migrations.py, gen_icons.py
docs/             FEATURES, ARCHITECTURE, TESTING, DEPLOYMENT, PLAN, PRODUCTION_READINESS…
.claude/skills/   Agent workflows: gate, add-api-resource, live-test, db-migration,
                  email-template, release
```

## Documentation map

| Read… | When you need… |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | **Start here** — commands, golden rules, gotchas, current state |
| [`docs/FEATURES.md`](docs/FEATURES.md) | What exists: schema, API surface, frontend routes |
| [`docs/TESTING.md`](docs/TESTING.md) | Test architecture, full test-case catalog, what to add next |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Provisioning, secrets, deploy, ops, rollback |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The why: auth, Drive model, cron design, trust model |
| [`docs/PLAN.md`](docs/PLAN.md) | Roadmap + roles/segmentation plan |
| [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md) | Honest scorecard + remaining hardening |
