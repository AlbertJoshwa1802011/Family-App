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
| Phase 4 | ⏳ Planned | PWA offline, biometric lock, full-text search |
| Phase 5 (rest) | ⏳ Planned | a11y pass, E2E browser tests, component tests |
| Phase 6 | ⏳ Planned | WhatsApp reminders, push, OCR, shared Drive |

See `docs/TESTING.md` for the test process/catalog and `docs/DEPLOYMENT.md` for
the deployment runbook. Roles/segmentation roadmap: `docs/PLAN.md`.

---

## 2. Database Schema (21 tables, 4 migrations)

Schema source of truth: `worker/db/schema.ts`.  
Migrations: `0000` (13 tables), `0001` (events cluster), `0002` (utility tables),
`0003` (family_members → nullable user_id + member_type/display_name/date_of_birth for dependents).
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

### Key Design Decisions

- **All timestamps**: Unix epoch integers (seconds) via `DEFAULT (unixepoch())`. Exception: expiry/issued/due dates are ISO `yyyy-mm-dd` text (calendar dates, not instants).
- **Events `type` vs `status`**: `type` = what kind (`gathering|appointment|milestone|other`). `status` = lifecycle (`active|cancelled|trashed`). Never conflate — cancelled events stay visible (with strikethrough), trashed events are filtered out.
- **`event_reminders_log` is separate from `reminders_log`**: Different unique constraint keys (`event_id` vs `document_id`); ON DELETE cascade targets differ. Cron handles both independently.
- **Tasks use ON DELETE SET NULL for FKs**: Deleting a document/event/member does not cascade-delete tasks — the task survives with null FKs. Handle null `relatedDocumentId` gracefully in UI.
- **D1 FK cascades are advisory**: D1 does not persistently honor `PRAGMA foreign_keys=ON`. Explicit multi-statement deletes are required in app code for correctness (see ARCHITECTURE.md).

---

## 3. API Surface

All routes live under `/api`. Middleware: `logger()` + `secureHeaders()` on all `/api/*`. Unknown `/api/*` paths return `{ error: "not_found" }` JSON 404.

### Route Status Legend
- **Stub-200**: Returns empty data (e.g. `{ events: [] }`)
- **Stub-501**: Returns `{ error: "not_implemented", phase: N }`
- **Val-501**: Zod validation wired; stub returns 501 on valid input; 400 on invalid
- **Real**: Actually queries D1 and returns live data

| Method | Path | Status | Phase |
|---|---|---|---|
| GET | `/health` | Real | 0 |
| GET | `/auth/me` | Stub-200 (`user:null`) | 0 |
| POST | `/auth/google/start` | Stub-501 | 1 |
| GET | `/auth/google/callback` | Stub-501 | 1 |
| POST | `/auth/logout` | Stub-200 (`ok:true`) | 0 |
| GET | `/families` | Stub-200 | 1 |
| POST | `/families` | Val-501 | 1 |
| GET | `/families/:id` | Stub-501 | 1 |
| GET | `/families/:id/members` | Stub-200 | 1 |
| GET | `/families/me/members` | Stub-200 | 1 |
| PATCH | `/families/:id/members/:mid` | Val-501 | 1 |
| POST | `/families/:id/invites` | Val-501 | 1 |
| POST | `/invites/:token/accept` | Stub-501 | 1 |
| GET | `/families/:id/activity` | Stub-200 | 5 |
| GET | `/documents` | Stub-200 | 2 |
| POST | `/documents` | Val-501 | 2 |
| GET | `/documents/:id` | Stub-501 | 2 |
| PATCH | `/documents/:id` | Val-501 | 2 |
| DELETE | `/documents/:id` | Stub-501 | 2 |
| POST | `/documents/:id/files` | Stub-501 | 2 |
| GET | `/documents/:id/files/:fid/download` | Stub-501 | 2 |
| GET | `/documents/:id/comments` | Stub-200 | 2 |
| POST | `/documents/:id/comments` | Val-501 | 2 |
| DELETE | `/documents/:id/comments/:cid` | Stub-501 | 2 |
| GET | `/notifications` | Stub-200 | 3 |
| POST | `/notifications/:id/read` | Stub-200 | 3 |
| GET | `/events` | Stub-200 | 2.5 |
| POST | `/events` | Val-501 | 2.5 |
| GET | `/events/:id` | Stub-501 | 2.5 |
| PATCH | `/events/:id` | Val-501 | 2.5 |
| DELETE | `/events/:id` | Stub-501 | 2.5 |
| POST | `/events/:id/cancel` | Stub-501 | 2.5 |
| POST | `/events/:id/attendees` | Val-501 | 2.5 |
| DELETE | `/events/:id/attendees/:memberId` | Stub-501 | 2.5 |
| GET | `/tasks` | Stub-200 | 2.5 |
| POST | `/tasks` | Val-501 | 2.5 |
| GET | `/tasks/:id` | Stub-501 | 2.5 |
| PATCH | `/tasks/:id` | Val-501 | 2.5 |
| DELETE | `/tasks/:id` | Stub-501 | 2.5 |
| GET | `/contacts` | Stub-200 | 2.5 |
| POST | `/contacts` | Val-501 | 2.5 |
| GET | `/contacts/:id` | Stub-501 | 2.5 |
| PATCH | `/contacts/:id` | Val-501 | 2.5 |
| DELETE | `/contacts/:id` | Stub-501 | 2.5 |

### Zod Validation Rules (Critical Constraints)

**POST /events:** `title` min 1/max 200; `startAt` positive integer; `endAt` must be ≥ `startAt` (cross-field refine); `type` enum `["gathering","appointment","milestone","other"]`; `attendeeMemberIds` array.

**POST /tasks:** `title` min 1/max 300; `dueDate` regex `^\d{4}-\d{2}-\d{2}$` (zero-padded); `status` (update only) enum `["open","done","archived"]`.

**POST /contacts:** `name` min 1/max 200; `phone` regex allows `+`, digits, spaces, `-`, `(`, `)`, `.`; `email` must be valid or empty string.

**POST /documents:** `familyId` required; `title` min 1/max 300; `visibility` enum `["family","private"]`; `expiryDate`/`issuedDate` regex `^\d{4}-\d{2}-\d{2}$`.

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
| `/family` | `FamilyPage` | Yes |
| `/settings` | `Settings` | Yes |
| `*` | `NotFound` | No |

### Bottom Navigation

5 tabs: Home → Docs → Calendar → Family → Settings. Active state: `text-vault-300` + `strokeWidth 2.4`. Inactive: `text-fg-subtle` + `strokeWidth 1.8`. Tasks (`/tasks`) and Contacts (`/contacts`) are reached from the Dashboard "Quick access" row (keeps the nav at 5 items).

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

### 5.2 Member Profiles with Per-Member Document View

**Schema:** `documents.subject_member_id` exists for per-member document assignment.  
**Gap:** `FamilyPage` was an empty state; it now shows a member list UI but requires real data from Phase 1 (`GET /families/:id/members`). Per-member document filtering (`WHERE subject_member_id = :memberId`) has no UI surface.  
**What to build in Phase 1:** Real member list endpoint → click member → profile page → their documents  
**Also needed:** `member_health` table has no API or UI yet (health notes per member)

### 5.3 Document Comments

**Schema:** `document_comments` fully defined (soft-delete, compound index).  
**API:** `GET/POST /documents/:id/comments` and `DELETE /documents/:id/comments/:cid` are stubbed but not connected to D1.  
**UI:** `DocumentDetail` has no comments section.  
**Phase:** Phase 2 — implement alongside document detail UI.

### 5.4 Activity Feed Write Path

**Schema:** `audit_log` exists.  
**Gap:** Nothing writes to `audit_log` yet. The read path (`GET /families/:id/activity`) is stubbed. But if Phase 2 document mutations don't call `insertAuditEvent()`, the audit log will be permanently empty for all early actions.  
**Must-do in Phase 2:** Add `insertAuditEvent(db, { familyId, actorUserId, action, targetType, targetId })` helper and call it from: document create/upload/download/delete, family invite, member remove.  
**Read path:** Phase 5.

### 5.5 Child / Non-User Family Members ✅ SCHEMA DONE

**Resolved (migration 0003):** `family_members.user_id` is now **nullable**, plus new columns
`member_type` (`user|dependent`), `display_name`, and `date_of_birth`. Dependents (children,
elderly relatives without a Google account) can be represented; NULL user_ids are distinct in the
unique index so multiple dependents coexist in one family.  
**Still TODO (Phase 1 API/UI):** `POST /families/:id/members` to create a dependent (name only,
no invite); member-list UI to add/manage dependents. The EventForm attendee picker already renders
`name ?? email ?? "Member"`, so it works structurally once data flows.

---

## 6. Test Coverage Map

**218+ tests across 14 files** — see `docs/TESTING.md` for the authoritative
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
