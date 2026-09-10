---
name: add-api-resource
description: Add a new API resource or endpoint to Family Vault the house way — schema, migration, Hono route with session/family/visibility guards, registration, exhaustive tests, and frontend wiring. Use whenever creating or extending backend functionality.
---

# Adding an API resource (the house pattern)

Follow these steps IN ORDER. Every existing route (documents, events, tasks,
contacts, chat) follows this shape — read `worker/routes/chat.ts` as the
cleanest, most recent reference.

## 1. Schema (if new tables)

Add tables to `worker/db/schema.ts` ONLY (single source of truth). Rules:
- Primary keys: `text("id").primaryKey()` filled with `crypto.randomUUID()` in app code.
- Instants: `integer(...).notNull().default(now)` (unix seconds). Calendar dates:
  ISO `yyyy-mm-dd` text validated with `/^\d{4}-\d{2}-\d{2}$/`.
- Explicit `references(..., { onDelete: ... })` — but remember D1 cascades are
  advisory; deletes that MUST cascade need explicit app-code deletes.
- Add indexes for every family-scoped list query: `index(...).on(t.familyId, t.createdAt)`.

Then run the `db-migration` skill (generate + validate).

## 2. Route file `worker/routes/<name>.ts`

```ts
export const <name>Routes = new Hono<HonoEnv>();
```

Non-negotiable guards, in this order inside each handler:
1. `requireSession` middleware on EVERY route (sets `c.get("userId")`).
2. `const membership = await requireFamilyMember(c, familyId);`
   `if (membership instanceof Response) return membership;`
   — for GET lists take `familyId` from `c.req.query("familyId")` and 400 if missing.
3. **Visibility**: anything document-adjacent must apply `isDocHiddenFrom(doc, userId, role)`
   → return 404 (never 403 — don't reveal existence).
4. **Cross-family references**: any client-supplied ID written to a join/FK column
   must be validated with `worker/lib/familyScope.ts` helpers
   (`allMembersInFamily`, `allDocumentsInFamily`, `eventInFamily`) → 400 `invalid_*_ids`.
5. **Zod validation** on every mutation via the local `zv()` helper — error shape is
   exactly `{ error: "validation_error", issues }` 400 (tests assert this).
6. **Rate limit** anything spammable/expensive: `checkRateLimit(c, \`bucket:${userId}\`, {limit, windowSecs})`.
7. PATCH handlers: `null` means CLEAR the field — write `set.x = updates.x`
   (never `?? undefined`, which silently drops the clear).
8. Ordering ties: same-second rows need `desc(sql\`"table".rowid\`)` as tiebreaker
   (qualify the table when the query has joins).
9. Joined selects: EXPLICIT aliased fields only — `select({...})`, never bare
   `select()` with a join; duplicate result names break positional mapping.
   If two selected columns share a name, alias: `sql<string>\`${col}\`.as("x")`.

## 3. Register

In `worker/index.ts`: import and `api.route("/<name>", <name>Routes);`
(before the catch-all 404).

## 4. Tests (same commit, never later)

Add `tests/<name>.test.ts` using the real-DB harness:

```ts
import { createTestEnv, seedActor, seedFamily, seedUser } from "./helpers/testEnv";
```

Minimum coverage (mirror `tests/chat.test.ts`):
- happy-path roundtrip through the API (create → list → mutate → delete),
- 401 without session; 404 for non-members (both read and write),
- Zod boundaries (empty, over-max, wrong type) → 400 `validation_error`,
- cross-family injection attempt → 400/404,
- if visibility-relevant: add rows to `tests/authz-matrix.test.ts`.

Notifications/email side-effects: stub fetch —
`vi.stubGlobal("fetch", ...)` with `RESEND_API_KEY: "test-key"` in `createTestEnv`.

## 5. Frontend (if user-facing)

Page in `src/pages/`, route in `src/App.tsx` (inside the `Protected` layout),
data via TanStack Query + `src/lib/api.ts`. Rules:
- Every family-scoped query takes `activeFamily.id` from `useAuth()` and sets
  `enabled: Boolean(activeFamily)`; include the family id in the queryKey.
- Errors: `(e as Error).message` is already human-friendly (`src/lib/api.ts`
  maps codes); check `ApiError.code` for programmatic branching.
- Compose from `src/components/ui/` (Button's loading prop is `loading`,
  AppBar back prop is `back`). Add skeleton + empty state.

## 6. Finish

Run the `gate` skill. Update `docs/FEATURES.md` (API table) and, if the
workflow changed, `CLAUDE.md` §11.
