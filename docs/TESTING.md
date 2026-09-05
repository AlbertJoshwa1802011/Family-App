# Family Vault — Testing Guide

How this app is tested, how to run everything, and the catalog of test cases the
suite guarantees. Read alongside `CLAUDE.md §7` (philosophy) and `docs/DEPLOYMENT.md`.

---

## 1. The testing process (run this before every commit)

```bash
npm run typecheck   # tsc project refs + worker + node configs
npm run lint        # eslint (incl. react-hooks/purity)
npm run test        # vitest — 321 tests across 21 files
npm run build       # tsc -b && vite build (catches PWA/plugin breakage)
```

If you touched `worker/db/schema.ts`:

```bash
npm run db:generate
python3 scripts/validate_migrations.py
```

All five green = definition of done. CI (`.github/workflows/ci.yml`) enforces the
same gate on every push/PR.

---

## 2. Test architecture — three layers

### Layer 1: Contract tests (no database)
`app.request(path, init)` calls the Hono app directly with no env. Verifies the
HTTP contract: status codes, JSON error shapes (`validation_error`, `not_found`,
`unauthorized`), security headers on every endpoint, Zod boundaries
(null / wrong type / out of range / bad format), 404-not-HTML for unknown
`/api/*` paths, and 401-before-400 middleware ordering.

Files: `worker.test.ts`, `worker-extended.test.ts`, `events.test.ts`,
`auth.test.ts`, `notifications.test.ts`.

### Layer 2: Integration tests (real database)
`tests/helpers/testEnv.ts` wraps Node's built-in `node:sqlite` in a
**D1-compatible adapter** and runs the actual generated migrations, plus an
in-memory KV with TTL. Tests exercise the real route → drizzle → SQL path with
seeded users, sessions, families, and documents — zero extra dependencies.

Files: `integration-flows.test.ts` (success paths), `authz-matrix.test.ts`
(security), `security-hardening.test.ts` (CSRF + rate limits), `chat.test.ts`,
`mentions-remind.test.ts`, `email-digest.test.ts` (fetch-stubbed Resend),
`search-categorize-calendar.test.ts`, `regression-deep.test.ts` (session
lifecycle, cross-family isolation matrix, trashed surfaces, unicode/limits),
`expenses.test.ts`, `assistant.test.ts` (tools + mocked tool loop + task
cron windows), `gemini.test.ts` (Gemini REST adapter + fetch-stubbed HTTP).

### Layer 2.5: Live application testing (real runtime, real users)
`npm run dev` + `npm run dev:seed` (two users with session cookies, no OAuth
needed) → drive real user journeys with curl → `npm run dev:screenshots` for
mobile-viewport UI review. The full scripted family journey lives in
`.claude/skills/live-test/SKILL.md`. Use this before shipping anything
user-visible.

Seed helpers: `seedUser`, `seedSession` (returns a `sid=` cookie),
`seedFamily`, `seedMember`, `seedActor` (user+membership+session in one call),
`seedDocument`.

### Layer 3: Pure-function unit tests
`expiry.test.ts`, `eventTime.test.ts`, `reminders.test.ts`, `email.test.ts` —
timezone-stable fixtures via `Date.UTC()`. `stress.test.ts` runs 20k mixed
concurrent requests against the pipeline and asserts a throughput floor and
zero 500s.

---

## 3. Test-case catalog — what the suite guarantees

### Security (the cases that protect family PII)

| Case | File |
|---|---|
| Member A cannot list/get/PATCH/download/comment-on/enumerate-files-of/attach-files-to member B's **private** document (404, never 403 — existence not revealed) | `authz-matrix` |
| Owner, admin, and the doc's owner CAN see a private doc | `authz-matrix` |
| A non-member of the family sees nothing, even family-visible docs | `authz-matrix` |
| Member cannot delete another's family doc (403); admin can | `authz-matrix` |
| Cross-origin POST/PATCH/DELETE → 403 `csrf_rejected` before auth runs | `security-hardening` |
| Forged Referer (no Origin) → 403; same-origin and APP_URL origins pass; header-less non-browser clients pass | `security-hardening` |
| Download proxy GET is Origin/Referer-checked (Lax-cookie CSRF vector) | `security-hardening` |
| OAuth start: 10/min/IP → 429 with Retry-After; per-IP isolation | `security-hardening` |
| Invites: 20/h/user → 429; upload-url: 30/min/user → 429 | `security-hardening` |
| Rate limiter fails open without KV (never 429 in unit envs) | `security-hardening` |
| Invite tokens are email-bound (403 `invite_email_mismatch`), single-use (409), expire (410) | `integration-flows` |
| Cross-family injection rejected: event attendees/documents, task assignee/related IDs (400 `invalid_*_ids`) | `integration-flows`, `events` |
| All protected routes 401 without a session cookie | `auth`, `worker-extended` |
| Security headers present on every endpoint incl. errors | `worker-extended` |
| Oversized bodies → 413, never OOM | `stress` |

### Success paths (the "basic functionality" cases)

| Case | File |
|---|---|
| Create family → creator is owner → listed in /families | `integration-flows` |
| Create document with all fields → list → get → update → **clear fields with null** → trash → audit-logged | `integration-flows` |
| Record file v1, v2 → version increments, currentFileId advances | `integration-flows` |
| Create event with attendees → range query finds it → cancel keeps it visible as cancelled | `integration-flows` |
| Create task → toggle done → unassign via null → delete | `integration-flows` |
| Contact create → update → delete | `integration-flows` |
| Invite → accept with matching email → new member can read family docs | `integration-flows` |
| **Reminder pipeline**: expiring doc → cron run → in-app notification for every active member → second run dedupes → mark read works | `integration-flows` |
| Private-doc reminders go ONLY to the doc owner | `integration-flows` |
| Reminder prefs PUT persists, normalizes windows; GET returns defaults | `integration-flows` |
| Assistant: Gemini preferred over Anthropic; 503 without either key; snacks expense via stubbed generateContent | `gemini`, `assistant` |
| Assistant tools write family-scoped expenses/tasks/events; private docs omitted from member snapshot; threads are per-user | `assistant` |
| Task due emails/notifications at 7, 2, and 1 days; assigned tasks notify only the assignee | `assistant` |

### Boundaries & regressions

- Zod: every mutation's min/max/enum/regex/format boundaries (`worker-extended`, `events`).
- Expiry badge timezone stability at UTC midnight (`expiry`).
- `eventMonthKey` 0-indexed month pin (`eventTime`).
- Reminder windowing: tightest-due-window selection, past-expiry handling (`reminders`).
- Email: no-op without `RESEND_API_KEY`, failure → dedupe row removed for retry (`email`, `integration-flows`).

---

## 4. High-value cases still worth adding (next)

1. **Component tests** (`@testing-library/react` is installed): DocumentForm
   validation, CreateFamily onboarding, EventForm hydration on edit,
   AcceptInvite error states.
2. **E2E (Playwright)** against `npm run dev`: login-stubbed cookie → create
   family → add document → upload (mock Drive) → see expiry badge → reminder
   notification appears. The dev server runs real workerd + local D1.
3. **Migration round-trip test**: apply all migrations to a fresh DB and diff
   against `drizzle-kit` schema snapshot (guards hand-edited migrations).
4. **Drive lib contract tests** with a mocked `fetch` (token refresh, 401 retry,
   resumable-URL Location handling).
5. **Session lifecycle**: idle-window slide, absolute expiry, purge cron.
6. **Concurrency**: two simultaneous file records on one document (currentFileId
   must settle on the later version).

---

## 5. Conventions for new tests

- One resource = one describe block; name cases by behavior, not endpoint.
- Integration tests: build state through the API when the API can do it;
  seed directly only for preconditions the API can't create (users, sessions).
- Always assert the **error body shape**, not just the status.
- Never assert on wall-clock timing; use seeded dates relative to `Date.now()`.
- Keep the D1 adapter honest: use explicit aliased field selections in drizzle
  queries (see the header comment in `tests/helpers/testEnv.ts`).
