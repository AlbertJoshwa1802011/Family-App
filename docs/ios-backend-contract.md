# Albert iOS — Backend contract

Production origin (default): `https://fam.connect-cloud.workers.dev`

## Auth

### Session transport

| Client | Credential |
|---|---|
| Web PWA | Cookie `sid=<uuid>` (HttpOnly; Secure; SameSite=Lax) |
| Albert iOS | Header `Authorization: Bearer <sessionToken>` |

`sessionToken` is the same opaque session id stored in D1 `sessions`. Idle (2h)
and absolute (30d) expiry rules are unchanged.

### Start Google sign-in (iOS)

`GET /api/auth/google/start?client=ios`

- Same Google OAuth + PKCE as web.
- OAuth state records `client: "ios"`.
- On success, Worker redirects to:
  `albert://oauth-callback?code=<one-time-code>`
- The one-time code is stored in KV (`oauth:mobile:<code>`), TTL **60 seconds**,
  and maps to `{ sessionId }`. The session id is **never** placed in the URL.

### Exchange code

`POST /api/auth/mobile/exchange`

```json
{ "code": "<one-time-code>" }
```

**200**

```json
{
  "sessionToken": "<uuid>",
  "expiresAt": 1735689600,
  "user": { "id": "...", "email": "...", "name": "...", "picture": "..." },
  "families": [{ "id": "...", "name": "...", "role": "owner" }]
}
```

Errors: `400 validation_error` | `401 invalid_code` | `401 unauthorized`

### Current user

`GET /api/auth/me` — cookie or Bearer.

Unauthenticated → `{ "user": null, "families": [] }` (unchanged web contract).

### Logout

`POST /api/auth/logout` — cookie or Bearer; deletes D1 session. iOS also clears Keychain.

## Important Items ↔ Tasks

### List

`GET /api/tasks?familyId=<id>&view=priority`

iOS keeps items where `status === "open"` and `priority` ∈ `{ high, medium }`.

### Complete

`PATCH /api/tasks/:id`

```json
{ "status": "done" }
```

### Native model mapping

| Swift `ImportantItem` | Task field |
|---|---|
| `id` | `id` |
| `title` | `title` |
| `priority` | `high`→`.critical`, `medium`→`.important` |
| `dueDate` | `dueDate` (`yyyy-mm-dd` or null) |
| `isCompleted` | `status == "done"` |
| `webPath` | `/tasks/<id>` |

Due times are **date-only** on the backend today; the companion displays the date
(and schedules local notifications for morning-of / day-before).

## Device registration (stub)

`POST /api/auth/mobile/device` (optional, best-effort)

```json
{ "platform": "ios", "deviceToken": "<optional APNs token later>" }
```

Returns `{ "ok": true }`. No push delivery in v1.

## Errors (shared)

| Status | Shape |
|---|---|
| 400 | `{ "error": "validation_error", "issues": [...] }` |
| 401 | `{ "error": "unauthorized" }` / `{ "error": "invalid_code" }` |
| 403 | `{ "error": "csrf_rejected" }` (browsers with bad Origin) |
| 404 | `{ "error": "not_found" }` |

## Why these backend changes

Native URLSession cannot rely on ambient HttpOnly cookies the way the SPA can.
The smallest secure bridge is: **reuse D1 sessions** + **Bearer acceptance** +
**one-time OAuth handoff**. No new identity provider, no Google password in the
app, no duplicated business rules.
