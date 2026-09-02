# Family App

A mobile-first **PWA** for one family: documents, vault, calendar, chat-adjacent
family tools, and money (personal expenses + church fund settlements).

**Status: live on `main`.** Merge deploys the Cloudflare Worker and applies D1
migrations (`.github/workflows/deploy.yml`).

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
- **Navigation** — draggable coloured bubble tab bar (snaps to the left/right
  edge like iOS AssistiveTouch / GitHub). Position is remembered on the device.

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
| `npm run typecheck` / `lint` / `test` / `build` | Gate — all must pass before merge |
| `npm run db:generate` | After editing `worker/db/schema.ts` |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply D1 migrations |
| `npm run deploy` | Build + wrangler deploy (normally CI) |

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

Google Cloud: enable **Drive API** and **Calendar API**. OAuth scopes are
`openid email profile`, `drive.file`, and `calendar.events`. Existing users
should sign in once more so Google issues a refresh token that includes calendar.

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
