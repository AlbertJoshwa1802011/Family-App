# Testing process

One command before every commit and on every CI / production deploy:

```bash
npm run gate
```

That is the same as `npm run test:gate`. It runs **typecheck → lint → vitest → production build**. GitHub Actions (`.github/workflows/ci.yml` and `deploy.yml`) call `npm run gate` so local and CI cannot drift.

| Script | When to use it |
|---|---|
| `npm run gate` / `test:gate` | Before commit, before merge, what CI runs |
| `npm run test` | All Vitest files (fast loop while implementing) |
| `npm run test:regression` | Events, church, expenses, calendar, nav |
| `npm run test:ship` | Home, tasks, Contacts, Face ID, email, cron |
| `npm run test:watch` | Vitest watch mode |

Integration tests use a real in-memory SQLite that applies every file in
`migrations/` (`tests/helpers/testEnv.ts`). Do not mock the database.

## Regression catalog (must stay green)

These cases lock the bugs this branch fixed. They live in
`tests/regression-v16.test.ts` plus the focused files below.

### Event edit + email
- `GET /events/:id` returns title, type, startAt, endAt, location, description, nested `event.attendees` (edit form hydrates from this).
- Create writes `event_created` in-app notification for the actor.
- Tagged attendees also get `event_created` even if their email prefs are off.
- PATCH keeps the edit-form fields and writes `event_updated`.
- Cancel writes `event_cancelled`.
- Empty title → `400 validation_error`.
- Event CRUD is `201` even when Google Calendar returns 403 (`needs_reconnect`).
- Successful Calendar upsert stores `googleCalendarEventId`.

### Google Calendar + ICS
- OAuth start includes `calendar.events`, `drive.file`, and `include_granted_scopes=true`.
- Timed ICS uses `DTSTART:`; all-day ICS uses `VALUE=DATE`.
- Feed token is 401 without a session; `url` is null before mint; rotate invalidates the old URL.
- Feed does not leak another family's events or private document expiries.
- Per-event ICS is 401 unauthenticated, 404 for another family / unknown id.

### Church funds
- Snapshot / settle require a session.
- Missing `CONTRIBUTIONS_API_TOKEN` → `503 church_not_configured`.
- Unknown fund → 404; other family → 404; invalid `periodKey` → `400 validation_error`.
- Duplicate month → 409; upstream 500 → 502.
- Settle stores rupees as minor units (`1000` → `100000`) and snapshot lists it.

### Expenses
- Built-in categories have `#` colours.
- `POST /expenses` with `categoryId: null` still creates the row (add is not blocked).
- `GET /categories` without `familyId` → 400.

### Bubble nav
- Clamp stays inside the padded viewport.
- Snap is left/right by centre vs midline (no rubber-band back to the start).
- Default position is bottom-centre.

## Adding a new API surface

Mirror `tests/events.test.ts` / `tests/regression-v16.test.ts`:

1. Unauthenticated → 401 `unauthorized`.
2. Unknown deep path → 404 `not_found` JSON (never HTML).
3. Invalid body → 400 `{ error: "validation_error", issues }`.
4. Happy path status + response shape.
5. Cross-family → 404 (do not leak existence).
6. Security headers (`x-content-type-options: nosniff`) on the route.

If you change `worker/db/schema.ts`: `npm run db:generate`, then
`python3 scripts/validate_migrations.py`, then `npm run test:gate`.
