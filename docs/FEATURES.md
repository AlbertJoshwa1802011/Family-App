# Family Vault — Feature Registry

Living reference for what is built, what is planned, and what gaps remain. Read this alongside `ARCHITECTURE.md` and `PLAN.md` before modifying the codebase.

---

## 1. Build Status

| Phase | Status | Description |
|---|---|---|
| Phase 0 | ✅ Complete | Scaffold, schema, route stubs, UI shell, security headers |
| Phase 0.5 | ✅ Complete | Calendar/Events/Tasks/Contacts schema + API stubs + frontend |
| Phase 1 | ✅ Complete | Real Google OAuth, sessions, family CRUD, invites (email-bound) |
| Phase 2 | ✅ Complete | Document CRUD + Drive proxy + private-visibility enforcement + full frontend flows |
| Phase 2.5 | ✅ Complete | Events/Tasks/Contacts on D1 + auth, wired frontend (composers, forms) |
| Phase 3 | ✅ Complete | Reminder cron (range + dedupe), in-app notifications, Resend email, prefs |
| Phase 5 (partial) | ✅ Complete | CSRF Origin/Referer checks, KV rate limiting, authz-matrix tests, real-D1 integration suite |
| Premium batch | ✅ Complete | Family chat + @mentions, tag-to-remind, dependents + member profiles, search + AI categories, ICS calendar feed, HTML email reports + weekly digest, Instagram-style nav |
| Assistant + expenses | ✅ Complete | In-app Gemini assistant (Claude fallback; D1 context + tools), family expenses, task due-date emails at 7/2/1 days |
| Phase 4 | ⏳ Planned | PWA offline, biometric lock, full-text search |
| Phase 5 (rest) | ⏳ Planned | a11y pass, E2E browser tests, component tests |
| Phase 6 | ⏳ Planned | WhatsApp reminders, push, OCR, shared Drive |

See `docs/TESTING.md` for the test process/catalog and `docs/DEPLOYMENT.md` for
the deployment runbook. Roles/segmentation roadmap: `docs/PLAN.md`.

---

## 2. Database Schema (26 tables, 6 migrations)

Schema source of truth: `worker/db/schema.ts`.  
Migrations: `0000` (13 tables), `0001` (events cluster), `0002` (utility tables),
`0003` (family_members → nullable user_id + member_type/display_name/date_of_birth for dependents),
`0004` (chat_messages + digest_log), `0005` (expenses + assistant_messages + task_reminders_log).
Validate any new migration with `python3 scripts/validate_migrations.py`.

### All Tables

| Table | Purpose | Migration |
|---|---|---|
| `users` | Google-authenticated accounts | 0000 |
| `families` | Family group with Drive folder | 0000 |
| `family_members` | Membership + role (owner/admin/member) + status | 0000 |
| `invites` | Email invites with hashed token (single-use) | 0000 |
| `sessions` | Opaque session IDs (single source of truth) | 0000 |
| `documents` | Document metadata with visibility + status | 0000 |
| `files` | Drive file versions per document | 0000 |
| `tags` | Family-scoped tags | 0000 |
| `document_tags` | Many-to-many join (indexable tag search) | 0000 |
| `notifications` | In-app notification inbox | 0000 |
| `reminders_log` | Dedupe table for document expiry reminders | 0000 |
| `reminder_prefs` | Per-user email/push enable + windows | 0000 |
| `audit_log` | Write-once activity log (upload/delete/role-change) | 0000 |
| `events` | Family events with type + lifecycle status | 0001 |
| `event_attendees` | Tagged family members per event (CASCADE) | 0001 |
| `event_documents` | Linked documents per event (CASCADE) | 0001 |
| `event_reminders_log` | Dedupe for event cron reminders (separate from doc reminders) | 0001 |
| `tasks` | Family to-dos, assignable, linked to doc/event | 0002 |
| `contacts` | Emergency contacts per family | 0002 |
| `member_health` | Blood type, allergies, medications per member | 0002 |
| `document_comments` | Threaded comments on documents (soft-delete) | 0002 |
| `digest_log` | Dedupe for Monday weekly digest | 0004 |
| `chat_messages` | Family chat (soft-delete) | 0004 |
| `expenses` | Family spending log (integer cents) | 0005 |
| `task_reminders_log` | Dedupe for task due-date reminders | 0005 |
| `assistant_messages` | Per-user assistant thread | 0005 |

### Key Design Decisions

- **All timestamps**: Unix epoch integers (seconds) via `DEFAULT (unixepoch())`. Exception: expiry/issued/due dates are ISO `yyyy-mm-dd` text (calendar dates, not instants).
- **Events `type` vs `status`**: `type` = what kind (`gathering|appointment|milestone|other`). `status` = lifecycle (`active|cancelled|trashed`). Never conflate — cancelled events stay visible (with strikethrough), trashed events are filtered out.
- **`event_reminders_log` is separate from `reminders_log`**: Different unique constraint keys (`event_id` vs `document_id`); ON DELETE cascade targets differ. Cron handles both independently.
- **Tasks use ON DELETE SET NULL for FKs**: Deleting a document/event/member does not cascade-delete tasks — the task survives with null FKs. Handle null `relatedDocumentId` gracefully in UI.
- **D1 FK cascades are advisory**: D1 does not persistently honor `PRAGMA foreign_keys=ON`. Explicit multi-statement deletes are required in app code for correctness (see ARCHITECTURE.md).

---

## 3. API Surface

All routes live under `/api` and are **fully implemented against D1**.
Middleware on `/api/*`: `requestId` → `logger` → `secureHeaders` → **CSRF
Origin/Referer check on mutations** → 1 MiB `bodyLimit`. Unknown `/api/*`
paths return `{ error: "not_found" }` JSON 404. Every route below (except
`/health`, OAuth, and the capability-URL calendar feed) requires a session;
family-scoped routes verify active membership; document routes additionally
enforce private visibility (`isDocHiddenFrom`, 404 not 403). RL = KV rate limit.

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/auth/me` | user + families (null when signed out) |
| POST | `/auth/google/start` | PKCE + state in KV · RL 10/min/IP |
| GET | `/auth/google/callback` | token exchange, jose ID-token verify, session cookie · RL 10/min/IP |
| POST | `/auth/logout` | revokes session server-side |
| GET/POST | `/families` | list / create (creator = owner) |
| GET | `/families/:id` · `/families/:id/members` · `/families/me/members` | details / member lists |
| POST | `/families/:id/members` | add **dependent** (admin+) |
| PATCH | `/families/:id/members/:mid` | role change / remove (admin+; owner protected) |
| POST | `/families/:id/invites` | email-bound single-use token + HTML invite email · admin+ · RL 20/h |
| POST | `/families/invites/:token/accept` | accepting account's email must match |
| GET | `/families/:id/activity` | audit feed w/ actor names |
| GET | `/documents?familyId&q&member` | visibility-filtered list + search + per-member filter |
| POST | `/documents` | create (subjectMemberId family-scope-validated) |
| POST | `/documents/suggest-category` | heuristics → Claude (if `ANTHROPIC_API_KEY`) · RL 30/min |
| GET/PATCH/DELETE | `/documents/:id` | get / update (null clears) / soft-trash |
| POST | `/documents/:id/remind` | tag a member → notification + email · RL 20/h |
| POST | `/documents/:id/files/upload-url` | Drive resumable URL · RL 30/min |
| GET/POST | `/documents/:id/files` | version list / record after Drive upload |
| GET | `/documents/:id/files/:fid/download` | streaming proxy, `attachment` + nosniff, CSRF-checked GET |
| GET/POST | `/documents/:id/comments` · DELETE `.../:cid` | comments (soft-delete; author or admin+) |
| GET | `/notifications?unreadOnly` | inbox + unread count |
| POST | `/notifications/:id/read` · `/notifications/read-all` | mark read |
| GET/PUT | `/notifications/prefs` | email/push toggles + lead-time windows |
| GET/POST | `/events?familyId&from&to` | range list / create (attendees+docs family-scope-validated) |
| GET/PATCH/DELETE | `/events/:id` | detail w/ attendees / update / trash |
| POST | `/events/:id/cancel` | cancelled stays visible |
| GET | `/events/:id/ics` | "Add to calendar" download |
| POST/DELETE | `/events/:id/attendees(/:memberId)` | manage attendees |
| GET/POST | `/tasks` · GET/PATCH/DELETE `/tasks/:id` | tasks (assignee/related family-scope-validated; null clears) |
| GET/POST | `/contacts` · GET/PATCH/DELETE `/contacts/:id` | emergency contacts |
| GET/POST/DELETE | `/chat` (+`/:id`) | family chat: paginated, @mentions notify, soft-delete · RL 60/min |
| GET/POST | `/expenses?familyId` · GET/PATCH/DELETE `/expenses/:id` | spending log (amount in major units; stored as cents) |
| GET/POST | `/assistant?familyId` | private Gemini assistant (Claude fallback); D1 snapshot + tools · RL 20/10min · needs `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` |
| POST | `/calendar/feed-token` | mint/rotate capability URL |
| GET | `/calendar/feed/:token.ics` | subscribable feed (events + expiries, per-user visibility, no cookie) |

### Zod Validation Rules (Critical Constraints)

**POST /events:** `title` min 1/max 200; `startAt` positive integer; `endAt` must be ≥ `startAt` (cross-field refine); `type` enum `["gathering","appointment","milestone","other"]`; `attendeeMemberIds` array.

**POST /tasks:** `title` min 1/max 300; `dueDate` regex `^\d{4}-\d{2}-\d{2}$` (zero-padded); `status` (update only) enum `["open","done","archived"]`.

**POST /contacts:** `name` min 1/max 200; `phone` regex allows `+`, digits, spaces, `-`, `(`, `)`, `.`; `email` must be valid or empty string.

**POST /expenses:** `amount` positive number (major units, stored as cents); `currency` `/^[A-Z]{3}$/` default INR; `category` enum food/groceries/transport/household/medical/education/entertainment/travel/other; `spentOn` yyyy-mm-dd.

**POST /assistant:** `familyId` required; `message` min 1 / max 2000. Returns 503 `ai_not_configured` without `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`. Gemini is preferred when both are set. GET includes `provider: "gemini" | "anthropic" | null`.

---

## 4. Frontend

### Routing

| Path | Component | Auth Guard |
|---|---|---|
| `/login` | `Login` | No |
| `/` | `Dashboard` | Yes |
| `/documents` | `Documents` | Yes |
| `/documents/:id` | `DocumentDetail` | Yes |
| `/calendar` | `CalendarPage` | Yes |
| `/calendar/events/new` | `EventForm` | Yes |
| `/calendar/events/:id` | `EventDetailPage` | Yes |
| `/calendar/events/:id/edit` | `EventForm` | Yes |
| `/tasks` | `Tasks` | Yes |
| `/contacts` | `Contacts` | Yes |
| `/chat` | `Chat` | Yes |
| `/assistant` | `Assistant` | Yes |
| `/expenses` | `Expenses` | Yes |
| `/family` | `FamilyPage` | Yes |
| `/settings` | `Settings` | Yes |
| `*` | `NotFound` | No |

### Bottom Navigation (Instagram-style)

5 tabs: **Home → Docs → Chat → Activity → Family**. Activity carries a live
unread badge (30s polling of `/notifications?unreadOnly=1`). Settings is behind
the gear on the Family tab (profile-style); Calendar, Tasks, Contacts, Expenses and the Assistant are in
the Dashboard "Quick access" grid. A **sparkles icon in the AppBar** on every
family screen opens the assistant as a sheet (stay on the current page). Active state: `text-vault-300` +
`strokeWidth 2.4`; inactive: `text-fg-subtle` + `strokeWidth 1.8`.

### Key Libraries

- **`src/lib/eventTime.ts`**: `formatEventDate`, `formatEventTime`, `formatMonthYear`, `eventMonthKey`, `eventTypeColor`
- **`src/lib/expiry.ts`**: `expiryStatus` — UTC-based, tone thresholds: ≤0d danger, ≤7d danger, ≤30d warning, >30d success
- **`src/lib/api.ts`**: Same-origin fetch wrapper; throws `ApiError`; 204 → `undefined`

### Date.now() in Render Rule

**Always use `useState` initializer**, not bare `Date.now()`:
```tsx
const [now] = useState(() => Math.floor(Date.now() / 1000));
```
ESLint rule `react-hooks/purity` will flag `Date.now()` in render as impure. The `useState` pattern captures the value once on mount and is stable across re-renders.

---

## 5. The 5 Most Critical Missing Features

### 5.1 Per-Document Private Visibility Enforcement ✅ ENFORCED + TESTED

**Implemented:** `visibilityWhere()` filters every list; `isDocHiddenFrom()`
guards get/update/delete/download/comments/file-list/upload-url/file-record.
Hidden docs return **404** (never 403) so existence isn't revealed.
**Tested:** `tests/authz-matrix.test.ts` covers the full matrix (member vs
doc-owner vs admin vs owner vs non-member) across all surfaces.

### 5.2 Member Profiles with Per-Member Document View ✅ DONE

Member list links to `/family/members/:id` (profile + that member's documents
via `GET /documents?member=`); DocumentForm has a "Belongs to" picker
(`subjectMemberId`, family-scope-validated). **Still open:** `member_health`
table has no API or UI yet (health notes per member).

### 5.3 Document Comments ✅ DONE

API live (`GET/POST /documents/:id/comments`, `DELETE .../:cid`, soft-delete,
author-or-admin delete, visibility-gated) + comments section on DocumentDetail.

### 5.4 Activity Feed Write Path ✅ DONE

`insertAuditEvent()` is called from family/member/invite/document/event
mutations; `GET /families/:id/activity` joins actor names and feeds the
Family page "Recent activity" section. Keep adding audit calls to NEW mutations.

### 5.5 Child / Non-User Family Members ✅ DONE

Migration 0003 (nullable `user_id`, `member_type`, `display_name`,
`date_of_birth`) + `POST /families/:id/members` (admin+) + add-dependent UI on
the Family page. Dependents appear in attendee pickers, "Belongs to", and
member profiles; they are excluded from notification/mention delivery (no account).

---

## 6. Test Coverage Map

**321 tests across 21 files** — see `docs/TESTING.md` for the authoritative
catalog (contract, integration-on-real-D1, authz matrix, CSRF/rate-limit,
pure-unit, stress). The table below is the historical Phase-0.5 snapshot.

**136 tests across 5 files** (all passing as of Phase 0.5).

| File | Tests | What It Covers |
|---|---|---|
| `tests/worker.test.ts` | 5 | Health endpoint, auth/me shape, JSON 404, security headers |
| `tests/worker-extended.test.ts` | 66 | Security headers on every endpoint, HTTP method correctness, Zod boundary tests, error response shapes |
| `tests/events.test.ts` | 35 | Events/tasks/contacts API shapes, Zod validation, deeply-nested 404s |
| `tests/expiry.test.ts` | 7 | expiryStatus() boundary + timezone stability |
| `tests/eventTime.test.ts` | 21 | All eventTime.ts utilities, eventMonthKey format |

### Not Covered (Blind Spots)

- `worker/routes/auth.ts` — no auth route tests
- `worker/routes/notifications.ts` — no notification tests
- `worker/cron.ts` — no cron logic tests
- All React components — no component tests (no @testing-library/react setup)
- D1 schema — no migration round-trip tests
- Private document visibility enforcement (test doesn't exist yet — must be added in Phase 2)

---

## 7. Architecture Decisions Quick Reference

| Decision | Rule |
|---|---|
| All timestamps | Unix epoch integers (seconds). Multiply by 1000 for `new Date()`. |
| Calendar dates | ISO `yyyy-mm-dd` text (expiry, issued, due dates) |
| Event type vs status | `type` = nature of event; `status` = lifecycle. Never conflate. |
| eventMonthKey | `"${year}-${month_index}"` (0-indexed). Never change to 1-indexed without updating test. |
| Date.now() in React | Always `useState(() => Math.floor(Date.now() / 1000))`, never bare in render |
| Schema source of truth | `worker/db/schema.ts` only. Run `npm run db:generate` after changes. |
| D1 cascades | Advisory only. Implement explicit multi-statement deletes in app code. |
| API Zod validation | Use `@hono/zod-validator`. Return `{ error: "validation_error", issues: [...] }` on 400. |
| Private docs | Filter at every list/get/download endpoint. Never trust the client. |
