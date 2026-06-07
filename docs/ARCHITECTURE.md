# Family Vault — Architecture

## Overview

Family Vault is a PWA for families to store important documents (passports, insurance,
licenses, warranties, medical records, etc.) securely, with **expiry reminders** so nothing
lapses unnoticed. Documents are stored in the family owner's Google Drive (5TB); metadata,
users, families, and notifications live in Cloudflare D1.

```
                ┌──────────────────────────────────────────────┐
   Browser ───▶ │  Cloudflare Worker (single deployable unit)   │
  (React PWA)   │                                                │
                │  ├─ Static assets (built SPA) via ASSETS       │
                │  ├─ Hono API  /api/*                           │
                │  │    ├─ /auth/*      Google OAuth + sessions  │
                │  │    ├─ /families/*  family + membership      │
                │  │    ├─ /documents/* metadata + up/download   │
                │  │    └─ /notifications/*                      │
                │  └─ scheduled()  daily expiry-reminder cron    │
                └───────┬──────────────┬──────────────┬─────────┘
                        │              │              │
                  D1 (metadata)   KV (token/   Google Drive API
                                   session cache)  (owner 5TB)
                                                  + Resend (email)
```

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite + TypeScript |
| UI | Tailwind CSS + headless components; React Router |
| Data fetching | TanStack Query |
| PWA | vite-plugin-pwa (Workbox, prompt update) |
| Backend | Cloudflare Worker + Hono (TypeScript) |
| DB | Cloudflare D1 (SQLite) + Drizzle ORM |
| Cache | Cloudflare KV (owner access token, sessions) |
| Storage | Google Drive API (owner account, `drive.file`) |
| Auth | Google OAuth 2.0 (Auth Code + PKCE), `jose` for ID-token verify, HttpOnly session cookie |
| Email | Resend |
| Build/Dev | `@cloudflare/vite-plugin`, Wrangler |

## Auth & Session Model

- **User identity:** Sign in with Google → verify ID token → upsert `users` row keyed by Google `sub`.
- **Session:** Server creates an opaque session id, **stored in D1 `sessions` (single source of
  truth — lets us list/revoke)**, set as an `HttpOnly; Secure; SameSite=Lax` cookie. No JWT in the
  browser. Rotate session id on login; enforce both **idle** and **absolute** expiry; a cleanup
  cron deletes expired rows; "log out everywhere" deletes all rows for a user.
- **CSRF:** `SameSite=Lax` protects cross-site POSTs, but `Lax` cookies ARE sent on top-level GET
  navigations — so the **download proxy and all mutations also require an `Origin`/`Referer` check
  (or a double-submit CSRF token)**. Downloads always send `Content-Disposition: attachment` +
  `X-Content-Type-Options: nosniff` and are never embeddable/cacheable.
- **Owner Drive credentials:** A single owner refresh token is a Worker **secret**
  (`GOOGLE_OWNER_REFRESH_TOKEN`). Access tokens cached in KV (~55 min TTL).
  - **Token-refresh race:** concurrent cache-miss refreshes are guarded by a single-flight lock
    (KV lock key with short TTL); KV is eventually consistent, so tolerate rare double-refresh
    (Google permits reuse of an unexpired access token). Document this caveat.
  - **SPOF mitigation:** the daily cron pings Drive; on `invalid_grant` it raises an alert and an
    in-app owner notification. A documented **owner re-consent route** re-issues the refresh token.
- **Authorization:** Every document/family route checks the caller's family membership + role
  before reading/writing or proxying a Drive download. Defense-in-depth: scope queries by
  `family_id`, and an **authz-matrix test** runs from Phase 1 (not deferred to hardening).

## ⚠️ Trust, Privacy & Storage Model (read before onboarding real users)

All families' documents (passports, medical, financial — real PII) physically reside in **one
human's personal Google Drive**. The owner can technically open them in drive.google.com, and
Google associates them with a personal account. Implications:

- **MVP/prototype constraint** — acceptable for a single trusted family (the owner's own family).
  For multiple unrelated families this is a trust/legal problem.
- **Must be disclosed in-product** (consent at family creation/join).
- **Roadmap (P1, not "future"):** migrate to a **Google Shared Drive** or per-family service
  identity; add **client-side / envelope encryption of file bytes before upload** for sensitive
  categories so the storage owner cannot read contents.
- **`drive.file` scope assumption is unproven and load-bearing.** `drive.file` only exposes files
  the app created under its grant. Before building UI breadth, a **spike (Phase 0.5)** must verify:
  create folder+file → revoke → re-consent → confirm old files still readable. The entire storage
  model depends on this.

## Data Model (D1)

```sql
users        (id, google_sub UNIQUE, email, name, picture, created_at, last_login_at)
families     (id, name, owner_user_id, drive_folder_id, created_at)
family_members (id, family_id, user_id, role[owner|admin|member], status[active|invited|removed],
                created_at, UNIQUE(family_id, user_id))
-- invite tokens stored HASHED (token_hash); single-use; bound to email on accept
invites      (id, family_id, email, token_hash UNIQUE, role, invited_by, expires_at,
              accepted_at, created_at)
-- sessions are the single source of truth (D1) so we can list/revoke; cookie holds opaque id only
sessions     (id, user_id, created_at, expires_at, idle_expires_at, last_seen_at, user_agent)
documents    (id, family_id, owner_user_id, title, category, subject_member_id NULL,
              description, expiry_date NULL, issued_date NULL, current_file_id NULL,
              visibility[family|private], status[active|trashed], trashed_at NULL,
              created_at, updated_at)
-- files keep a status + deleted_at so we can reconcile Drive vs metadata and purge orphans
files        (id, document_id, drive_file_id, file_name, mime_type, size_bytes, version,
              is_current, status[active|deleted], deleted_at NULL, created_at)
tags         (id, family_id, name, UNIQUE(family_id, name))
document_tags(document_id, tag_id, PRIMARY KEY(document_id, tag_id))   -- indexable tag search
notifications(id, user_id, family_id NULL, type, title, body, link, read, created_at)
reminders_log(id, document_id, user_id, window_days, channel, sent_at,
              UNIQUE(document_id,user_id,window_days,channel))
reminder_prefs(user_id PK, email_enabled, push_enabled, windows_json /*e.g. [30,7,1]*/)
audit_log    (id, family_id, actor_user_id, action, target_type, target_id, meta, created_at)
```

Indexes: `documents(family_id, expiry_date)`, `documents(family_id, status)`,
`notifications(user_id, read, created_at)`, `family_members(user_id)`,
`invites(email)`, `sessions(expires_at)` (cleanup cron), `files(document_id, is_current)`,
`document_tags(tag_id)`.

> **Tags** use a join table (not a JSON column) so the "smart collections" / tag-filter feature
> is actually indexable. **`current_file_id`** + `files.is_current` model versioning (renewed docs
> keep old versions). **`files.status`/`deleted_at`** let a purge cron remove orphaned Drive bytes.

## API Surface (Hono, `/api`)

```
POST   /auth/google/start            -> {authUrl} (PKCE, state)
GET    /auth/google/callback         -> set session cookie, redirect
POST   /auth/logout
GET    /auth/me                      -> current user + families

GET    /families                     -> my families
POST   /families                     -> create family (creates Drive folder)
GET    /families/:id/members
POST   /families/:id/invites         -> email invite
POST   /invites/:token/accept
PATCH  /families/:id/members/:mid    -> change role / remove

GET    /documents?family=&category=&expiringInDays=&q=
POST   /documents                    -> create metadata
GET    /documents/:id
PATCH  /documents/:id
DELETE /documents/:id                -> soft delete (trash)
POST   /documents/:id/files          -> upload to Drive (multipart/resumable)
GET    /documents/:id/files/:fid/download  -> proxy stream from Drive

GET    /notifications?unread=1
POST   /notifications/:id/read
GET    /reminder-prefs ; PUT /reminder-prefs
```

## Cron: Daily Expiry Reminders (`scheduled`, `0 8 * * *`)

> **Range, not equality.** Cloudflare cron is best-effort; "expiring exactly N days out" silently
> skips any day the cron misses. Use `expiry_date <= today + window` combined with the
> `reminders_log` dedupe (so a doc is reminded once per window, and a missed day is caught the
> next run).

1. For each user's reminder windows (default [30,7,1], from `reminder_prefs`), query the family's
   active documents where `expiry_date <= today + window_days` AND no `reminders_log` row exists
   for `(document, recipient, window_days, channel)`.
2. For each (document, recipient): insert a `notifications` row and (if enabled) send a Resend
   email; record in `reminders_log` (dedupe / idempotent re-runs).
3. Throttle email + Drive calls (app-wide token bucket — see below); wrap in `ctx.waitUntil`.
4. Health check: ping Drive once; on `invalid_grant` raise an owner alert (refresh-token SPOF).

## Drive Throughput & Lifecycle

- **App-wide caps** (single owner account): ≤3 sustained writes/sec, 750 GB/day. Uploads go
  through a shared throttle/queue with exponential backoff + jitter on 403/429/5xx — one family's
  bulk upload must not starve others.
- **Deletion:** `DELETE /documents/:id` trashes metadata only (`status=trashed`, `trashed_at`).
  A **purge cron** (after N days in trash) deletes the underlying Drive files and marks
  `files.status=deleted` — preventing orphaned bytes and reconciling Drive vs metadata.

## Security Principles

- Tokens (Google refresh/access, session secrets) never reach the browser.
- All Drive downloads proxied with per-request authz checks.
- Input validation with `zod` on every API route.
- Parameterized D1 queries (Drizzle) — no string concatenation.
- Rate limiting on auth + upload endpoints.
- CSP, secure cookies, `state` + PKCE for OAuth, signed/expiring invite tokens.
- Audit log for sensitive actions (upload, download, role change, delete).

## Migrations & ORM (decision)

**Drizzle schema (`worker/db/schema.ts`) is the single source of truth.** SQL migrations are
**generated** with `drizzle-kit generate` and applied to D1 via `wrangler d1 migrations apply`.
We do not hand-maintain both a SQL file and a TS schema (avoids drift). Foreign keys are declared
in the schema with explicit `ON DELETE` policy and **enabled in D1**:

- `family_members`, `documents`, `files`, `tags`, `document_tags`, `invites`, `audit_log` →
  `family_id` `ON DELETE CASCADE`.
- `documents.subject_member_id` → `family_members` `ON DELETE SET NULL` (a member leaving must not
  delete their documents; column is nullable).
- `files.document_id`, `document_tags.*` → `ON DELETE CASCADE`.
- `notifications.user_id`, `reminders_log.user_id`, `sessions.user_id` → `ON DELETE CASCADE`.

## Environments

- **Local:** `vite` dev + `@cloudflare/vite-plugin`, D1 `--local`, `.dev.vars` secrets.
- **Production:** `wrangler deploy`, D1 `--remote`, secrets via `wrangler secret put`, GitHub Actions CI.
