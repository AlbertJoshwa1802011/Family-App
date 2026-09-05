# Family App

A mobile-first **PWA** for one family: documents, vault, calendar, chat-adjacent
family tools, and money (personal expenses + church fund settlements).

**Status: live on `main`.** Merge deploys the Cloudflare Worker and applies D1
migrations (`.github/workflows/deploy.yml`).

- **Frontend:** React 19 + Vite + TypeScript + Tailwind CSS v4, installable PWA.
- **Backend:** Cloudflare Worker + Hono (single deployable unit, same-origin API).
- **Database:** Cloudflare D1 (SQLite) via Drizzle ORM. **Cache:** Cloudflare KV.
- **Storage:** Documents upload to Cloudflare R2 when bound; otherwise the
  connected family Google Drive (Admin → Storage). R2 is optional.
- **Auth:** Google OAuth 2.0 (Auth Code + PKCE), opaque session cookie.
  Money and Vault ask for Face ID / fingerprint (or a 6-digit PIN) each visit.
- **Reminders:** Daily Cron → in-app notifications + email via Gmail
  (`albertjoshrock101@gmail.com` after reconnecting Admin → Storage) or Resend.
- **Contacts:** Two-way sync with Google Contacts (phone address book must
  sync to that Google account).

## What works today

- **Documents & vault** — family files, expiry reminders, encrypted vault items.
- **Money / expenses** — fast add, nested spends, coloured categories (built-in
  + family-created). Private by default.
- **Church funds** — live collected / purchase totals from
  [light-of-jesus-ministry-contributions](https://light-of-jesus-ministry-contributions.pages.dev).
  This app only records **monthly settlements**; it does not duplicate every
  contribution. Requires Worker secret `CONTRIBUTIONS_API_TOKEN` (same value as
  the contributions app `ADMIN_API_TOKEN`).
- **Calendar** — create/edit events (edit form hydrates from `GET /events/:id`).
  On save, events email you and write to **Google Calendar** (`calendar.events`
  scope). ICS download + optional subscribe feed as backup (Google polls feeds
  slowly).
- **Emails** — event create/update/cancel, daily expiry/event reminders, test
  send in Settings. Needs `RESEND_API_KEY` and `EMAIL_FROM` on a verified domain.
- **Navigation** — pinned liquid-glass tab bar (Home, Vault, Docs, Money,
  Family) like WhatsApp / iOS. Long-press and drag slides the active pill
  *inside* the bar; the bar stays at the bottom.

## Quick start

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite + workerd, HMR |
| `npm run gate` / `test:gate` | **The process:** typecheck + lint + test + build. CI and deploy run this. |
| `npm run test:regression` | Events, church, expenses, calendar, nav contracts |
| `npm run test:ship` | Home, tasks, Contacts, Face ID, email, cron, uploads |
| `npm run test` / `test:watch` | Full Vitest suite / watch |
| `npm run test:catalog` | ≥1000 cases per module (`tests/catalog/`) |
| `npm run db:generate` | After editing `worker/db/schema.ts` |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply D1 migrations |
| `npm run deploy` | Build + wrangler deploy (normally CI) |

See `docs/OPS.md` for Google redirect URIs, Drive upload, Gmail/Resend, church
token, Contacts verification, and Face ID. See `docs/TESTING.md` for the
regression catalog and the per-module 1000-case grids (`npm run test:catalog`).

## Production secrets

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_FROM
npx wrangler secret put CONTRIBUTIONS_API_TOKEN   # church app machine token
# optional:
npx wrangler secret put GEMINI_API_KEY
```

Google Cloud: enable **Drive API**, **Calendar API**, **Gmail API**, and
**People API**. Add both OAuth redirect URIs (login + storage). Full click-path:
`docs/OPS.md`.

**Migrations:** merging to `main` runs `wrangler d1 migrations apply` then
deploys. If categories or settlements 500 with `schema_missing`, re-run the
Deploy workflow.

## Project structure

```
src/            React PWA
worker/         Hono API + cron (schema in worker/db/schema.ts)
migrations/     D1 SQL (0000–0013+)
tests/          Vitest, real D1 adapter
docs/           Architecture / features / deploy
```
