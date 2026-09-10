# Albert iOS — Architecture

Albert (Family Vault) is a **monorepo** with two clients of one backend:

| Layer | Role |
|---|---|
| **Web PWA** (`src/`) | Primary application — accounts, Google Sign-In, Drive/Calendar, full UI |
| **Backend** (`worker/`) | Source of truth — Hono `/api/*`, D1, KV, cron |
| **Albert iOS** (`ios/`) | Native Apple companion — widgets, notifications, App Intents, offline glance |

```
                 ALBERT WEB  (brain + main app)
                       │
                  Cloudflare Worker
                       │
                 Albert iOS companion
        ┌──────────────┼──────────────┐
        ↓              ↓              ↓
   SwiftUI UI     WidgetKit     UserNotifications
```

## Repository boundaries

- **Do not move** the existing web app into `web/`. Paths stay `src/` + `worker/`.
- **Do not mix** Swift into Vite/Node config; iOS builds only with Xcode.
- **Do not mix** npm into the iOS target; web builds without Xcode.
- Additive only: web deploy unit is unchanged.

```
/
├── src/                 # Existing React PWA
├── worker/              # Existing Hono API (tiny mobile-auth additions)
├── ios/                 # Native companion
│   ├── Albert/          # App target
│   ├── AlbertWidget/    # WidgetKit extension
│   ├── Shared/          # Models, API, sync, Keychain wrappers
│   ├── Tests/
│   └── README.md
└── docs/ios-*.md
```

## Important Items (first feature)

There is **no separate “Important Items” table**. The companion maps Albert’s
existing **tasks** with priority `high` / `medium` and status `open`:

| Task priority | Native label |
|---|---|
| `high` | DON’T FORGET (critical) |
| `medium` | IMPORTANT |
| `low` | omitted from companion surfaces |

APIs reused: `GET /api/tasks`, `PATCH /api/tasks/:id` (`status: "done"`).
See `docs/ios-backend-contract.md`.

## Authentication

Web continues to use the HttpOnly `sid` cookie.

iOS uses the **same D1 session rows**, delivered via:

1. `ASWebAuthenticationSession` → existing Google OAuth (server-side PKCE).
2. OAuth callback issues a **one-time exchange code** (KV, ~60s) and redirects to
   `albert://oauth-callback?code=…` (never puts the session id in the URL).
3. App calls `POST /api/auth/mobile/exchange` → `{ sessionToken, expiresAt, … }`.
4. Token stored in **Keychain** only; sent as `Authorization: Bearer <sessionToken>`.

`requireSession` and `/auth/me` accept cookie **or** Bearer. CSRF still applies
to browsers; native clients without Origin/Referer remain allowed (existing rule).

## Sync & widgets

```
Backend tasks API
      ↓
 SyncManager (app)
      ↓
 Local cache (App Support) + widget-state.json (App Group)
      ↓
 WidgetKit timeline (no network secrets)
```

App Group holds **only** glanceable widget payloads (id, title, priority, due,
completed, lastSync). Session tokens never leave the Keychain / main app.

## Notifications

v1 uses **local** `UserNotifications` scheduled from due dates of high-priority
open items (due soon / due now / overdue). APNs `registerDevice` is a client
stub for a later phase.

## Deep links

- Custom scheme: `albert://tasks/<id>`
- Universal Links (AASA): `https://<APP_URL>/tasks/<id>`
- Opening an item can jump to Albert Web for full detail when needed.

## Security

- HTTPS only in Release.
- Keychain for session token; never UserDefaults / App Group / logs / URLs.
- Logout deletes Keychain session + clears caches + reloads widgets.
- Widget surfaces minimum PII.

## Out of scope (v1)

Watch, Live Activities, Siri beyond Complete intent, Apple Calendar/Reminders
mirroring, Control Center — extension points only.
