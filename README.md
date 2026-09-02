# 🗄️ Family Vault

A mobile-first **PWA** for families to store important documents (passports, insurance,
licenses, warranties, medical records…) securely — and **never miss an expiry**.

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

> **Status: Phase 0 — scaffold.** Runnable skeleton (build/lint/typecheck/test green) with
> stubbed routes. See [`docs/PLAN.md`](docs/PLAN.md) for the phased roadmap,
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design, and
> [`docs/RESEARCH.md`](docs/RESEARCH.md) / [`docs/REVIEW_NOTES.md`](docs/REVIEW_NOTES.md)
> for the research + plan-review history.

## Quick start

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in secrets (see below)
npm run dev                      # Vite + Cloudflare Worker (workerd) with HMR
```

Open the printed local URL. The API is served same-origin under `/api` (try `/api/health`).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server (Vite + `@cloudflare/vite-plugin`, real `workerd` + bindings) |
| `npm run build` | Type-check then build client + worker |
| `npm run typecheck` | TS type-check (app + worker + config) |
| `npm run lint` | ESLint (flat config) |
| `npm run test` | Vitest unit tests |
| `npm run db:generate` | Generate D1 SQL migrations from the Drizzle schema |
| `npm run db:migrate:local` | Apply migrations to local D1 |
| `npm run db:migrate:remote` | Apply migrations to production D1 |
| `npm run deploy` | Build + `wrangler deploy` |

## First-time Cloudflare setup

```bash
npx wrangler login
npx wrangler d1 create family-vault-db          # paste database_id into wrangler.jsonc
npx wrangler kv namespace create KV             # paste id into wrangler.jsonc
npm run db:generate && npm run db:migrate:remote
# set secrets:
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_OWNER_REFRESH_TOKEN
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put SESSION_SECRET
npm run deploy
```

## Google Cloud setup (summary)

1. Enable the **Google Drive API**.
2. **OAuth consent screen** (External): scopes `openid email profile` (identity) + `drive.file`
   (storage). All non-sensitive → no restricted-scope verification needed.
3. Create a **Web OAuth client**; add exact redirect URIs (e.g. `https://<app>/api/auth/google/callback`).
4. **Publish to production** (Testing mode expires refresh tokens after 7 days).
5. Obtain the owner's long-lived refresh token via an offline-consent flow → store as
   `GOOGLE_OWNER_REFRESH_TOKEN`.

> ⚠️ **Trust/privacy:** all families' documents physically reside in one Google account's Drive.
> Acceptable for a single trusted family; see `docs/ARCHITECTURE.md` → "Trust, Privacy & Storage
> Model" before onboarding unrelated families (Shared Drive + envelope encryption are on the roadmap).

## Project structure

```
src/            React PWA (pages, components, context, lib)
worker/         Hono API + scheduled() cron; db/ (Drizzle schema = source of truth), routes/
migrations/     Generated D1 SQL migrations
docs/           PLAN, ARCHITECTURE, RESEARCH, REVIEW_NOTES
scripts/        Icon generator
tests/          Vitest
```
