# Test Plan — Multi-User Coordination & Scheduling

> Scope: verify Family Vault end-to-end, with the sharp end on **many people in one family
> operating on the same data at the same time** — chiefly one member scheduling an event *for*
> another member.
>
> Status of this document: §1 records what was **empirically executed** against the real
> route → drizzle → SQLite path (not inferred from reading code). §2–§6 are the plan.

---

## 0. Baseline

| Check | Result |
|---|---|
| `npm run test` | **358 / 358 green**, 23 files |
| Probe suite (16 multi-user scenarios, temporary) | **6 pass / 10 fail** |

The 358 existing tests are strong on the **contract** (status codes, Zod boundaries, security
headers, cross-family isolation). They are close to silent on the **collaboration semantics** —
what other members see and are told when someone acts. That is exactly the gap this plan targets.

---

## 1. Verified behaviour (executed, not assumed)

> **Update — all findings in §1.2 are now fixed.** See §7 for what changed and
> which suite pins each behaviour. §1 is kept as the original evidence.

Each row below was run as a real request against the actual worker with seeded
multi-user sessions (`tests/helpers/testEnv.ts`, real migrations).

### 1.1 What already works ✅

| # | Scenario | Result |
|---|---|---|
| A | Owner schedules an event naming child + admin as attendees; attendees persist and are readable by another member | **201**, 2 attendees |
| I | Member of another family reads the event | **404** — isolation holds |
| N | Schedule an event for a **dependent** (child with no Google account) | **201** — the dependent model works |
| O | Member whose status is `removed` reads a family event | **404** — revocation is immediate |
| — | Cross-family attendee injection (`attendeeMemberIds` from family B) | **400 `invalid_member_ids`** |
| — | Cancelled events stay visible; trashed events are filtered | correct |

Isolation and authorization *between families* are solid. The dependent/guardian data model is
sound. This is a good foundation.

### 1.2 What is broken or missing ❌

| # | Scenario | Expected | **Actual** |
|---|---|---|---|
| **B** | Attendee is notified when someone schedules an event **for** them | notification | **0 notifications** |
| **E** | Attendee is notified when that event is **cancelled** | notification | **0 notifications** |
| **F** | Attendee is notified when that event is **rescheduled** | notification | **0 notifications** |
| **M** | Assignee is notified when a task is **assigned** to them | notification | **0 notifications** |
| **G** | Attendee can **RSVP** (accept / decline / tentative) | 200 | **404 — no endpoint, no column** |
| **H** | Scheduling a second event over the same member's existing event | conflict surfaced | **201, silently double-booked** |
| **C** | Plain `member` **deletes** the owner's event | 403 | **200 — allowed** |
| **D** | Plain `member` **reschedules** the owner's event | 403 | **200 — allowed** |
| **K** | Event reminder for an event only the child attends | attendee-scoped | **every family member is reminded** |
| **L** | Two members PATCH the same event concurrently | 409 on one | **200 / 200 — last write wins, silently** |
| **Q** | `PATCH /events/:id` changing only the title | other fields untouched | **wiped every attendee, reset `type` to "other", cleared `allDay`** |
| **R** | `PATCH` moving `startAt` past the stored `endAt` | 400 | **accepted — event ended before it began** |
| **S** | Opening any event's detail page in the browser | renders | **crashed: read `ev.attendees`, but the API returns `attendees` beside `event`** |
| **P** | `GET /events?member=<id>` — "what is on *my* calendar" | filtered | **no such filter existed** (documents had one; events did not) |
| **J** | `GET /families/me/members?familyId=<B>` for a user in two families | family B's members | **returns the *first* family's members** |

### 1.3 The three findings that matter most

**(1) The app promises a notification it never sends.**
`src/pages/EventForm.tsx:339` renders, under the attendee picker:

> *"Tagged members will be notified when the event is created."*

No code path creates that notification. `createNotification` is called from exactly two places —
`worker/cron.ts` (daily reminders) and `worker/lib/mentions.ts` (chat @mentions). Not from
`worker/routes/events.ts`, and not from `worker/routes/tasks.ts`. So today the *only* way a family
member learns you scheduled something for them is the daily cron reminder firing inside their
lead-time window — for an event booked 2 months out with a 30-day window, that is silence for a
month. **For an app whose specialty is scheduling for other people, this is the core defect.**

**(2) There is no attendance state — only a tag.**
`event_attendees` is `(event_id, member_id)` and nothing else (`worker/db/schema.ts:307`). Being
an attendee is a label the organizer applies to you. You cannot accept, decline, propose another
time, or be recorded as "no response". Everyone downstream — reminders, the calendar, the ICS
feed — therefore treats "invited" and "coming" as the same thing.

**(3) Every member has full write power over everyone's schedule.**
`requireFamilyMember` defaults to `minRole: "member"` and events never check `createdBy`
(`worker/routes/events.ts` — every handler). A teenager on the family plan can delete their
parent's hospital appointment, and the audit row is the only trace. Compare this to
documents, which *do* enforce a per-row `visibility` rule.

---

## 2. The multi-user model to test against

Before writing tests, the intended semantics must be decided — several failures above are only
bugs relative to an intent. Proposed model (recommended; adjust before implementing):

- **Roles.** `owner` > `admin` > `member`. Any member may **create** events. **Editing,
  rescheduling, cancelling, or deleting** an event is allowed for the event's `createdBy`, plus
  `admin` and `owner`. A plain member may always change **their own RSVP**.
- **Attendance.** `event_attendees.status ∈ (invited, accepted, declined, tentative)`,
  default `invited`. Dependents are auto-`accepted` — a 6-year-old does not RSVP; their guardian
  answers for them.
- **Notification is the product.** Every scheduling act that changes someone else's obligations
  notifies the affected members — invited, rescheduled, cancelled, un-invited, task assigned or
  reassigned. Never notify the actor about their own action.
- **Reminders are attendee-scoped** when an event has attendees, family-wide when it has none.
- **Conflicts are advisory, not blocking.** Overlaps get reported in the create/update response
  so the UI can warn ("Timmy is already at football practice") — the organizer decides.
- **Concurrent edits** are resolved with an `updatedAt` precondition → `409 conflict`.

---

## 3. Test layers

| Layer | Tool | What it owns |
|---|---|---|
| L1 Unit | vitest | pure logic — overlap maths, RSVP transitions, recipient resolution, permission function |
| L2 Contract | vitest + `app.request` | status codes, Zod boundaries, 404/403 shapes, headers |
| L3 Integration (multi-actor) | vitest + real SQLite via `testEnv.ts` | **the bulk of this plan** — N seeded actors acting on shared rows |
| L4 Cron/async | vitest + `runExpiryReminders` | who gets reminded, dedupe, digest |
| L5 Live | `live-test` skill | dev server, seeded cookies, real journeys, mobile screenshots |
| L6 UI | Playwright | two browser contexts = two logged-in members on one event |

L3 is where multi-user correctness lives, and it is cheap here because `testEnv.ts` already gives
real migrations and `seedActor()` gives a user + membership + cookie in one call.

---

## 4. The multi-user test matrix

### 4.1 Standard cast (one `beforeEach` fixture for all scheduling tests)

| Actor | Role | Purpose |
|---|---|---|
| `dad` | owner | organizer |
| `mum` | admin | co-organizer, tests admin parity with owner |
| `teen` | member | tests member restrictions |
| `timmy` | dependent (no `userId`) | tests the no-account path |
| `gran` | member, `status: invited` | tests not-yet-active |
| `expelled` | member, `status: removed` | tests revocation |
| `stranger` | owner of family B | tests isolation |

Plus `dad` also a member of family B — the two-family user, which is where the `me/members` bug
lives.

### 4.2 Scenario suites to write

**S1 — Scheduling for another person** (`tests/scheduling-multiuser.test.ts`)
1. dad schedules for timmy + teen → both attendee rows exist, teen is notified, timmy is not (no account), dad is **not** notified of his own action.
2. mum (admin) reschedules → teen notified with old *and* new time; dad (creator) notified too.
3. dad cancels → all attendees notified once; event still visible, `status=cancelled`.
4. dad removes teen from attendees → teen notified they are no longer needed; teen's calendar drops it.
5. teen is added to an event **already** within their reminder window → notified immediately, not only on the next cron.
6. Idempotency: adding the same attendee twice → one row, one notification.

**S2 — RSVP** (`tests/rsvp.test.ts`)
1. teen accepts → status persists, organizer notified.
2. teen declines → organizer notified, teen still sees the event (declined ≠ hidden).
3. teen flips accepted → declined → tentative; only the final state is stored, each flip notifies once.
4. Non-attendee tries to RSVP → 403. Other-family member → 404.
5. teen cannot RSVP **on behalf of** mum → 403.
6. Guardian RSVPs for dependent timmy → allowed.
7. RSVP on a cancelled event → 409. On a trashed event → 404.
8. Event detail returns a per-attendee status breakdown; ICS carries `PARTSTAT`.

**S3 — Permissions on the shared calendar** (`tests/scheduling-authz.test.ts`)
Full 4-actor × 6-action matrix, asserting exact status codes:

| | create | read | reschedule | cancel | delete | RSVP self |
|---|---|---|---|---|---|---|
| owner | 201 | 200 | 200 | 200 | 200 | 200 |
| admin | 201 | 200 | 200 | 200 | 200 | 200 |
| member (creator) | 201 | 200 | 200 | 200 | 200 | 200 |
| member (not creator) | 201 | 200 | **403** | **403** | **403** | 200 |
| invited (inactive) | 404 | 404 | 404 | 404 | 404 | 404 |
| removed | 404 | 404 | 404 | 404 | 404 | 404 |
| other family | 404 | 404 | 404 | 404 | 404 | 404 |

**S4 — Conflicts & availability** (`tests/scheduling-conflicts.test.ts`)
1. Exact overlap for a shared attendee → reported in `conflicts`.
2. Boundary: B starts exactly when A ends → **not** a conflict (half-open intervals).
3. Zero-length / instant events; `endAt` absent.
4. All-day event vs timed event on the same date → conflict.
5. Conflict only counts **shared** attendees — dad's meeting never conflicts with timmy's dentist.
6. Cancelled and trashed events never generate conflicts.
7. Rescheduling *into* a clash reports it; rescheduling *out of* one clears it.
8. Free-busy across the family for a date range returns each member's busy blocks.

**S5 — Concurrency** (`tests/scheduling-concurrency.test.ts`)
1. Two simultaneous PATCHes on one event → one 200, one **409**, and the loser's write is absent.
2. Two members add different attendees concurrently → both survive (attendee add must not be a
   full replace — note that today `PATCH` with `attendeeMemberIds` **deletes then re-inserts** the
   whole set, so a concurrent add is silently dropped).
3. Cancel racing a reschedule → deterministic final state.
4. Delete racing an RSVP → RSVP returns 404, no orphan row.
5. Double-submit of create (same idempotency key) → one event.
6. Cron running while an event is edited → no duplicate reminder.

**S6 — Reminders & notification fan-out** (extends `tests/reminders.test.ts`)
1. Attendee-scoped: only attendees are reminded for an event with attendees; family-wide when empty.
2. Each member's own lead-time windows are honoured independently in one cron pass.
3. Declined attendees are not reminded.
4. Dependents produce no reminder rows (nobody to send to) and do not crash the pass.
5. Dedupe holds across two cron runs in one window; a reschedule into a *new* window re-arms it.
6. Email failure rolls back the log row so the next run retries (already covered — extend to events).
7. 3 members × 3 windows × 5 events = exact expected notification count, no cross-talk.

**S7 — Multi-family** (`tests/multi-family.test.ts`)
1. `dad` in families A and B: `/families/me/members?familyId=B` returns **B's** members.
2. Switching active family re-scopes events, tasks, chat, expenses; no cache bleed.
3. Same email invited to both families → two memberships, distinct member IDs.
4. Attendee IDs from A rejected on a B event (already passing — keep).
5. Notification list is per-user and shows the right family label.

**S8 — Task assignment** (extends `tests/tasks.test.ts`)
Mirror S1 for tasks: assign → assignee notified; reassign → both old and new notified; complete →
assigner notified; assignee-scoped due reminders; assigning to a dependent; cross-family assignee
rejected (passing).

**S9 — Family lifecycle under load**
Removing a member with future events they attend; deleting a family with events, tasks, chat
(explicit cascade per CLAUDE.md §2.8); ownership transfer; last-owner-cannot-leave.

**S10 — Live / UI (L5–L6)**
Two Playwright contexts logged in as dad and teen on one event: dad reschedules → teen's view
updates and a badge appears; teen declines → dad sees it. Plus mobile screenshots of the attendee
picker, RSVP control, and conflict warning.

---

## 5. What was implemented

Phases 0–8 of the original order are done. Phase 9 (Playwright two-context UI)
remains open.

### 5.1 Notifications — the core fix

`worker/lib/scheduleNotify.ts` (new). Every scheduling act that changes someone
else's obligations now reaches them in-app and by email (email best-effort, per
`reminder_prefs`, and a failure never fails the request):

| Trigger | Notification type | Who hears |
|---|---|---|
| Added to an event | `event_invite` | the new attendees |
| Event moved | `event_rescheduled` | all attendees + the creator |
| Event cancelled or deleted | `event_cancelled` | all attendees |
| Dropped from the guest list | `event_uninvited` | the removed member |
| An attendee answers | `event_rsvp` | the organizer |
| Task assigned | `task_assigned` | the new assignee |
| Task reassigned away | `task_unassigned` | the previous assignee |

Invariants held everywhere: the actor is never notified of their own action;
dependents (no account) are skipped; invited/removed members are skipped;
re-adding an existing attendee notifies nobody twice.

### 5.2 RSVP

`event_attendees` gains `rsvp` (`invited|accepted|declined|tentative`, default
`invited`) and `rsvpAt` — migration `0007_salty_sway.sql`, additive.
`POST /events/:id/rsvp` answers. Answering is the attendee's own right and is
deliberately *not* behind the edit permission; answering *for* someone else is
allowed only for dependents, whose guardian speaks for them. Dependents are
seeded `accepted` on being scheduled. `GET /events/:id` returns per-attendee
status plus an `rsvpSummary` count.

### 5.3 Permissions

`canMutateEvent`: creating stays open to every active member; changing,
cancelling, deleting or re-guest-listing an event requires its creator or an
admin/owner, else `403`. `GET /events/:id` returns `canEdit` so the client can
hide controls the server would reject.

### 5.4 Conflicts and availability

`worker/lib/conflicts.ts` (new). Create/update responses carry a `conflicts`
array — **advisory, never blocking**. Half-open intervals, so back-to-back is
not a clash; all-day events span the UTC day; an absent `endAt` occupies 30
minutes; cancelled, trashed and declined attendances hold nobody's time; a
clash requires a *shared* attendee. `GET /events/availability` returns free/busy
per member for a range.

### 5.5 Reminders

Event reminders are attendee-scoped, mirroring private documents. An event with
no attendees stays family-wide. Declined attendees are dropped.

### 5.6 Concurrency

`events.version` (migration `0008_modern_xorn.sql`) is a monotonic counter;
`PATCH` accepts `expectedVersion` and returns `409` with `currentVersion` on a
stale write. **A timestamp could not do this job** — `updatedAt` has one-second
granularity, so two members saving inside the same second both looked current;
this was caught by the concurrency suite itself. The precondition is opt-in, so
omitting it keeps last-write-wins for existing clients.

### 5.7 Bugs found while writing the tests

Three defects the original probe did not reach, all pre-existing:

1. **`PATCH` wiped data on every edit.** `.partial()` was applied to a schema
   whose fields carried `.default()`. Zod still fills a default when the key is
   absent, so every patch arrived carrying `attendeeMemberIds: []`,
   `type: "other"` and `allDay: false` — and since the handler treats a present
   attendee array as a full replace, **renaming an event deleted its entire
   guest list and reset its type**. Fixed by splitting the default-free field
   set (`eventFieldsSchema`) from the create schema. None of the 358 original
   tests caught this.
2. **`endAt` could precede `startAt`.** The Zod refine only compares the two
   fields when both are in the payload, so moving `startAt` alone left the
   stored `endAt` behind it. The handler now validates the *merged* state.
3. **The event detail page crashed.** `EventDetail.tsx` read `ev.attendees`,
   but the API returns `attendees` as a sibling of `event` — `undefined.length`
   on every event. `api<T>()` is an unchecked cast, so TypeScript could not see
   it and no test rendered the component.

### 5.8 Frontend

`EventForm` now scopes the attendee picker to the active family (`?familyId=`,
and `familyId` in the query key so switching families cannot serve a stale
picker). `EventDetail` unwraps the response envelope correctly, shows per
attendee RSVP badges and a going-count, offers Going / Maybe / Not going to
attendees, and hides edit/cancel/delete when `canEdit` is false.

---

## 6. Coverage delivered

| Area | Before | After |
|---|---|---|
| Total tests | 358 | **508** (31 files, all green) |
| Multi-actor scheduling notifications | 0 | 20 (`scheduling-multiuser.test.ts`) |
| RSVP | 0 | 24 (`rsvp.test.ts`) |
| Scheduling authorization | ~6 | 24 (`scheduling-authz.test.ts`) |
| Conflicts + availability | 0 | 27 (`scheduling-conflicts.test.ts`) |
| Concurrency + patch integrity | 0 | 14 (`scheduling-concurrency.test.ts`) |
| Attendee-scoped reminders | 0 | 12 (`scheduling-reminders.test.ts`) |
| Multi-family scoping | ~2 | 16 (`multi-family.test.ts`) |
| Task assignment | 0 | 13 (`task-assignment.test.ts`) |

`tests/helpers/family.ts` provides the standard cast — owner, admin, plain
member, dependent, invited-inactive, removed, and an outsider — because
multi-user bugs live in the members people forget.

Gate at time of writing: `typecheck` ✅ `lint` ✅ `test` ✅ (508) `build` ✅
`db:generate` ✅ `validate_migrations.py` ✅ (26 tables).

---

## 7. Still open

- **Phase 9 — browser tests.** Two Playwright contexts (Dad and Teen) on one
  event: Dad reschedules, Teen's view updates; Teen declines, Dad sees it. Plus
  mobile screenshots of the RSVP control and conflict warning. Needs the
  `live-test` skill.
- **Conflict warnings are returned but not yet rendered.** The API reports
  `conflicts` on create/update; `EventForm` does not display them.
- **ICS `PARTSTAT`.** The feed does not yet carry attendance status.
- **Recurring events.** Still unmodelled — every occurrence is a separate row.
- **Push notifications.** `reminder_prefs.pushEnabled` exists but nothing sends.
- **A `declined` attendee still sees the event.** Deliberate, but the calendar
  does not visually distinguish it.
