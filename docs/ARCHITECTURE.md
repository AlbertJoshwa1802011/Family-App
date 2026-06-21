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

> ⚠️ **D1 caveat:** D1 does not reliably honor a persistent `PRAGMA foreign_keys=ON` across
> autonomously-issued statements, so the `ON DELETE` actions above are **advisory, not
> guaranteed**. Deletes that must cascade (e.g. removing a family) will be implemented as
> **explicit transactional multi-statement deletes in app code** (Phase 1), with a test asserting
> the behavior — we do not rely on DB-level cascade for correctness.

## Environments

- **Local:** `vite` dev + `@cloudflare/vite-plugin`, D1 `--local`, `.dev.vars` secrets.
- **Production:** `wrangler deploy`, D1 `--remote`, secrets via `wrangler secret put`, GitHub Actions CI.
- **Shipping a change:** follow `docs/SHIPPING.md` (spec gate → green gate → security/UI gates →
  migrate-then-deploy → prod verify → rollback plan). One phase = one PR = one deploy.

---

# v2 Expansion — Encrypted Vault, Voice, Responsive, Platform Ops

> The app is growing from a documents+calendar PWA into the family's single place for all the
> "boring but important" things. Every capability below is **additive** — the 21 original tables,
> routes, and tests stay. The risk is not implementation; it is getting a handful of one-way-door
> decisions right up front. Those are **locked** here so future migrations are avoided.

## Locked decisions (the one-way doors)

| # | Decision | Locked choice |
|---|---|---|
| D1 | Encryption model | **Hybrid: client-side encryption + per-family data key, wrapped per member, with owner-escrow recovery.** Not zero-knowledge — an elders' family app cannot accept "forgot passphrase = data gone forever" for its most important data. |
| D2 | Key hierarchy | Per-family **VDK** (Vault Data Key), wrapped by each member's **KEK** + one **escrow** copy. VDK is family-wide and feature-agnostic (reusable for health/contacts/file bytes later). |
| D3 | Crypto primitives | **AES-256-GCM** (data), **AES-KW/GCM** (key wrap), **HKDF-SHA-256** (PRF→KEK, blind-index key), **PBKDF2-SHA-256 ≥600k** (passphrase→KEK). A `schemeVersion` column is the rotation escape hatch. |
| D4 | Unlock + recovery | **Passkey/WebAuthn-PRF primary**, passphrase fallback, **owner-escrow recovery** + one-time owner recovery code. Escrow default ON; per-private-item opt-out (documented zero-knowledge tradeoff). |
| D5 | Search over secrets | **Blind index (HMAC-SHA-256 tags) present from day one** + client-side decrypt-and-search. Server never sees plaintext. Tags are populated on every write even though client search ships first. |
| D6 | Worker key invariant | **The Worker never holds the VDK.** It stores only opaque ciphertext + wrapped blobs + blind tags. All encrypt/decrypt is client-side. This shapes every vault route signature and test. |
| D7 | Theming | **Semantic color tokens move behind `data-theme` on `<html>` now** (dark default = zero visual change; light added). Brand ramp stays static in `@theme`. |
| D8 | Density / Elder mode | **`data-density="elder"`** attribute drives token overrides (type scale, contrast, spacing, 56px targets). Per-user preference (`users.prefersSimpleMode`), not inferred from dependents. |
| D9 | New use-cases | **Hybrid module model:** a generic `items` table (type + promoted columns + JSON) for the long tail; keep typed tables for rich domains. One generic reminder scan covers all future modules. |
| D10 | Audit = source of truth | Extend `audit_log` (`severity`, `visibility`, + indexes); the user-facing activity feed is a **view** over it. `notifications` stays separate. |
| D11 | Platform role | A `platform_admins` table (runtime source of truth), bootstrapped lazily from `env.PLATFORM_ADMIN_EMAILS`. Admin routes mount at `/api/admin/*` and return **404 (not 403)** to non-admins. |
| D12 | Schema conventions | text-UUID PKs, `unixepoch()` integer instants, ISO `yyyy-mm-dd` date text, `familyId` scoping, `visibility: ['family','private']` mirroring `documents`. |

**Voice:** on-device Web Speech first (free, private — **spoken secret values never leave the
device**); cloud STT/TTS is opt-in fallback for *non-secret* commands only. Requires the
`microphone=(self)` header in `public/_headers`.

## New schema (Phase 0 applied — migration 0004, additive)

The data model is now **34 tables** (was 21). Added:

- **Vault (8):** `vaults` (per-family, `schemeVersion` + KDF defaults), `vault_keys` (wrapped VDK
  copies: per-member + escrow), `vault_member_keys` (per-member ECDH pubkey + wrapped privkey for
  grants), `vault_passkeys` (WebAuthn creds + PRF salt), `vault_items` (split `cipher`/`iv` for
  metadata vs `secretCipher`/`secretIv` for the value, so list views decrypt titles without
  touching secrets; `blind_*` columns; `type`/`visibility`/`escrowExcluded`/`voiceReadable`/
  `status`), `vault_blind_tags` (trigram HMAC tags for substring search), `vault_item_keys`
  (per-item subkey for escrow-excluded privates), `vault_item_versions` (undo/audit). Every
  `*_cipher`/`wrapped_*` column is opaque base64url the server never decrypts.
- **Modules (2):** `items` (generic: `type`, `ownerUserId`, `title`, promoted `dueDate`/
  `amountCents`, JSON `data`, `searchText`, visibility/status), `item_reminders_log` (dedupe).
- **Platform ops (3):** `platform_admins` (`level: maintainer|superadmin`, `grantedBy`),
  `storage_snapshots` (long-narrow `metric`/`value`/`capturedAt`/`scope` — new metrics need no
  migration), `job_runs` (`running`→`ok`/`error` + stats).
- **Altered:** `audit_log` (+`severity` `[info|security]`, +`visibility` `[family|private]`
  snapshotted at write time, + indexes `family+time`, `actor+time`, `family+severity+time`);
  `users` (+`prefersSimpleMode`).

## Audit as source of truth (Pillar 5)

`worker/lib/audit.ts` exposes a frozen `ACTIONS` map (`domain.verb_pasttense`, typed so a typo
fails `typecheck`), `insertAuditEvent(db, event)`, and an `audit(c, event)` helper that pulls the
actor from context and is error-safe (a failed audit write never breaks the request).
Security-class actions auto-tag `severity: security`. Coverage spans every mutation (documents,
events, tasks, contacts, families) plus auth (`login`/`logout`/`login_failed`) and a deduped
`document.viewed`. User-facing views: `GET /api/activity/me` (own trail) and
`GET /api/families/:id/activity` (privacy-filtered: members see family-visible + own actions;
owners/admins see all). Both keyset-paginated on `createdAt`.

## Build sequencing

Phase 0 (shared foundation — schema, theming tokens, audit) **done & deployed**. Then, each as
its own PR/deploy: **Phase 1** Secrets Vault (the headline) → **Phase 2** responsive shell +
Simple/Elder mode → **Phase 3** voice → **Phase 4** platform/maintainer + ops → **Phase 5**
generic module system + first modules. See `docs/PLAN.md` and the task list.
