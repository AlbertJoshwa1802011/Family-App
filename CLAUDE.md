# CLAUDE.md — Agent Operating Guide for Family Vault

> **Read this first.** It is the institutional memory of this repo. It tells you how to
> build, test, and extend Family Vault correctly, and records every hard-won decision and
> gotcha so you don't rediscover them painfully. Pair it with `docs/ARCHITECTURE.md`
> (the why), `docs/FEATURES.md` (the what/where), and `docs/PLAN.md` (the roadmap).

---

## 0. What this app is

Family Vault is a **mobile-first PWA** for families to store important documents (passports,
insurance, licenses, medical, warranties), track **expiry dates** with reminders, and
coordinate family life (calendar/events, tasks, emergency contacts). The phone is the primary
device. Documents physically live in the **family owner's Google Drive (5TB)**; metadata,
users, and notifications live in **Cloudflare D1**.

It runs as a **single Cloudflare Worker** that serves the built React SPA (via the `ASSETS`
binding) and a Hono API under `/api/*`, plus a daily **Cron Trigger** for reminders.

---

## 1. Commands you will use constantly

```bash
npm run dev            # vite dev w/ @cloudflare/vite-plugin (real workerd runtime + HMR)
npm run typecheck      # tsc -b + worker tsconfig + node tsconfig — run before EVERY commit
npm run lint           # eslint . — run before EVERY commit
npm run test           # vitest run — 136+ tests; must stay green
npm run build          # tsc -b && vite build — produces dist/client (+ sw.js, _headers)
npm run db:generate    # drizzle-kit generate — AFTER editing worker/db/schema.ts
python3 scripts/validate_migrations.py   # AFTER db:generate — catches bad migrations
```

**Definition of done for any change:** `typecheck` ✅, `lint` ✅, `test` ✅, `build` ✅.
If you touched the schema, also: `db:generate` ✅ and `validate_migrations.py` ✅.

---

## 2. The golden rules (violating these has bitten us before)

1. **`worker/db/schema.ts` is the single source of truth for the database.** Never hand-edit a
   migration to add columns. Change the schema, run `db:generate`, then validate. The one
   exception: fixing a drizzle-kit codegen bug in a *just-generated, never-applied* migration
   (see §6) — and only when there's no production data.

2. **Never set `assets.directory` in `wrangler.jsonc`.** `@cloudflare/vite-plugin` injects it at
   build time. Hard-coding it breaks dev. Keep only `binding`, `not_found_handling`, and
   `run_worker_first` in the source config.

3. **Keep `run_worker_first: ["/api/*"]`.** Without it, the SPA fallback returns `index.html`
   (HTTP 200) for unknown `/api/*` routes, which silently breaks TanStack Query error handling.
   Unknown API routes MUST return JSON `{ error: "not_found" }` 404.

4. **Scope Hono middleware to `/api/*` only** (`logger`, `secureHeaders`). They do not cover
   `ASSETS` responses. Static-asset security headers live in **`public/_headers`** (CSP,
   X-Frame-Options, nosniff) — Hono can't set them.

5. **Never runtime-cache `/api/*` responses in the PWA.** They are auth-gated, per-family PII.
   Caching them in browser Cache Storage survives logout and leaks on shared devices.
   `navigateFallbackDenylist: [/^\/api\//]` keeps the SW off API routes.

6. **All `/api/*` mutations validate input with Zod** via `@hono/zod-validator`. On failure return
   `c.json({ error: "validation_error", issues: result.error.issues }, 400)`. Be consistent —
   tests assert this exact shape.

7. **Private documents must be filtered server-side.** `documents.visibility` can be `private`.
   Every list/get/download query MUST filter
   `visibility='family' OR owner_user_id=:me OR role IN ('owner','admin')`. Never trust the
   client. This is security-critical and has a dedicated test requirement (see `docs/FEATURES.md §5.1`).

8. **D1 foreign-key cascades are advisory, not guaranteed.** D1 doesn't persistently honor
   `PRAGMA foreign_keys=ON` across autonomously-issued statements. For deletes that must cascade
   (e.g. removing a family), write **explicit multi-statement deletes in app code** + a test.
   Do not rely on DB-level `ON DELETE` for correctness.

---

## 3. Conventions

### Timestamps
- **Instants** → Unix epoch **integers (seconds)**, `integer(...).default(sql\`(unixepoch())\`)`.
  In the frontend, multiply by 1000 for `new Date(seconds * 1000)`.
- **Calendar dates** (expiry, issued, due, date-of-birth) → ISO `yyyy-mm-dd` **text**. Validate
  with regex `^\d{4}-\d{2}-\d{2}$`.

### Dates in React (purity)
ESLint rule `react-hooks/purity` flags bare `Date.now()` in render. Always snapshot via a
`useState` initializer so the query window is stable across re-renders:
```tsx
const [now] = useState(() => Math.floor(Date.now() / 1000));
```

### Expiry / timezone
`src/lib/expiry.ts` compares at **UTC midnight** (`Date.UTC(...)`) to avoid off-by-one near
local midnight. Tone thresholds: ≤0d & ≤7d → `danger`, ≤30d → `warning`, else → `success`.
Never reintroduce `new Date(dateStr + "T00:00:00")` (local-time parse) — it caused a real bug.

### IDs
All primary keys are **text UUIDs** generated in app code (`crypto.randomUUID()`), not autoincrement.

### Icons & UI
- Icons: **lucide-react** only (tree-shakable, 1.5px stroke, `currentColor`).
- Buttons: use `src/components/ui/Button.tsx`; the loading prop is **`loading`** (not `isLoading`).
- AppBar back button prop is **`back`** (boolean), not `showBack`.
- Reusable UI lives in `src/components/ui/`. Prefer composing these over bespoke markup.
- Bottom nav is mobile-first, fixed, safe-area-aware, 44px+ targets. 5 tabs:
  Home, Docs, Calendar, Family, Settings. Tasks/Contacts are reached from the Dashboard
  "Quick access" row (keeps the nav uncluttered).

### Events: `type` vs `status` are orthogonal
- `type` = nature: `gathering | appointment | milestone | other` (permanent).
- `status` = lifecycle: `active | cancelled | trashed`. Cancelled stays visible (strikethrough +
  badge); trashed is filtered out of all lists. Never conflate the two.

### `eventMonthKey()`
Returns `"${year}-${month_index}"` with a **0-indexed** month (June → `"2026-5"`). Used only for
grouping; the visible label uses `Intl.DateTimeFormat`. A test pins the format — don't switch to
1-indexed without updating it.

---

## 4. How to add a new API resource (the pattern)

1. **Schema:** add the table(s) to `worker/db/schema.ts` with explicit `references(..., {onDelete})`.
2. `npm run db:generate` → review the SQL → `python3 scripts/validate_migrations.py`.
3. **Route file:** create `worker/routes/<name>.ts` exporting `new Hono<HonoEnv>()`. Define Zod
   schemas; wire `zValidator("json", schema, (r,c)=>{ if(!r.success) return c.json({error:"validation_error",issues:r.error.issues},400)})`.
   Stub unimplemented handlers as `c.json({ error: "not_implemented", phase: N }, 501)`.
4. **Register:** import in `worker/index.ts` and `api.route("/<name>", <name>Routes)`.
5. **Tests:** add to `tests/` — cover GET-shape (200), POST-valid (501), POST-invalid (400 with
   `validation_error`), unknown-deep-path (404 `not_found`), and content-type. Mirror the
   exhaustive style in `tests/events.test.ts` / `tests/worker-extended.test.ts`.
6. **Frontend (if user-facing):** page in `src/pages/`, route in `src/App.tsx`, data via
   TanStack Query + `src/lib/api.ts`. Add loading skeleton + empty state.

When you later implement real logic, add `requireSession` + family-membership authz first, then
the D1 queries. Every family-scoped route checks membership before reading/writing.

---

## 5. Version-sensitive dependency triangle (do not bump blindly)

Vite 8 + the Cloudflare plugin + PWA + React are tightly coupled. Confirmed-working pins live in
`package.json`. Before upgrading any of these, verify peer compatibility across **all** of:
`vite`, `@cloudflare/vite-plugin`, `vite-plugin-pwa`, `@vitejs/plugin-react`, `@tailwindcss/vite`.
Plugin order in `vite.config.ts` matters: `react()` → `cloudflare()` → `tailwindcss()` → `VitePWA()`.

PWA uses `registerType: 'prompt'` (NOT autoUpdate) so an upload/edit in progress isn't clobbered
by a forced `skipWaiting`. A "new version" toast handles updates.

---

## 6. Known gotchas & their fixes (so you don't relive them)

| Symptom | Cause | Fix |
|---|---|---|
| Dev server serves stale/garbled assets | `assets.directory` hard-coded in wrangler.jsonc | Remove it; let the plugin inject it |
| Unknown `/api/x` returns HTML 200 | Missing `run_worker_first` | Re-add `run_worker_first: ["/api/*"]` |
| SW intercepts API calls | No denylist | `navigateFallbackDenylist: [/^\/api\//]` |
| PII visible after logout | Runtime caching of `/api/*` | Remove all API `runtimeCaching` |
| Expiry badge off by one near midnight | Local-time date parse | Use `Date.UTC()` (see `src/lib/expiry.ts`) |
| `typecheck` misses vite.config.ts | tsconfig.node not compiled | typecheck script includes `tsc -p tsconfig.node.json` |
| Asset responses missing CSP | secureHeaders only covers `/api/*` | `public/_headers` |
| ESLint: "Cannot call impure function" | `Date.now()` in render | `useState(() => Date.now())` |
| Migration apply fails: "no such column" | drizzle-kit table-recreation `INSERT...SELECT` lists new cols | Edit the just-generated migration's INSERT to copy only old columns; new ones take defaults. Validate with the python script. Only safe pre-production. |
| `.partial()` throws on a refined Zod schema | `.refine()` returns ZodEffects, which has no `.partial()` | Call `.partial()` on the base ZodObject, then `.refine()` |

---

## 7. Testing philosophy

Tests are **exhaustive and adversarial** by design — future agents should find it hard to break
things silently. We test the **contract**: response shapes, status codes, security headers on
every endpoint, and Zod validation boundaries (null / wrong-type / out-of-range / format).
`app.request(...)` calls the Hono app directly (no HTTP server). Keep new routes covered to the
same depth. Current baseline: **182 tests across 10 files**, all green.

Frontend libs (`expiry.ts`, `eventTime.ts`) have pure-function unit tests using `Date.UTC()` for
timezone-stable fixtures. `@testing-library/react` + `jsdom` are installed if you add component
tests.

---

## 8. Security posture (carry this forward)

- Tokens (Google refresh/access, session secret) **never** reach the browser.
- Session = opaque ID in D1 (source of truth for revocation); `HttpOnly; Secure; SameSite=Lax`
  cookie; rotate on login; idle + absolute expiry; cleanup cron.
- CSRF: Origin/Referer check on mutations **and** the download proxy (Lax cookies ride top-level
  GETs). Downloads always `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`.
- Google OAuth: Auth Code + PKCE + `state`; ID token verified with `jose` against Google JWKS.
- Drive scope is `drive.file` (non-sensitive). Its durability across re-consent is **unproven** —
  a Phase 0.5 spike must validate create→revoke→re-consent→still-readable before Phase 2 UI breadth.
- Audit log: write entries on upload/download/delete/role-change (Phase 2 write path is mandatory,
  else the log is permanently empty for early actions).

---

## 9. Git workflow in this repo

- Develop on the designated feature branch (currently `claude/family-vault-pwa-plan-TrvxG`).
- Conventional-style commit subjects (`feat:`, `security:`, `docs:`, `test:`). Body explains the
  why + lists notable changes. Push with `git push -u origin <branch>`.
- **Do not open a PR unless explicitly asked.**
- Never commit secrets, `.dev.vars`, or `*.tsbuildinfo` (gitignored).

---

## 10. Where things live (map)

```
worker/
  index.ts              Hono app + scheduled() cron export; route registration
  types.ts              Env bindings (ASSETS, DB, KV) + HonoEnv
  cron.ts               runExpiryReminders() — Phase 3 range-based scan + per-window dedupe (docs+events)
  db/schema.ts          ★ single source of truth for all 21 tables
  lib/                   crypto, session, audit, drive, reminders (pure windowing), email (Resend), notify
  routes/               auth, families, documents, notifications, events, tasks, contacts
src/
  App.tsx               routes + Protected wrapper
  context/AuthContext   /auth/me query (retry:false), {user,families,isLoading,isAuthenticated}
  components/ui/         Button, Card, Badge, ListItem, AppBar, Fab, EmptyState, Skeleton, Avatar...
  components/BottomNav   5-tab mobile nav
  lib/                   api.ts (fetch wrapper), expiry.ts, eventTime.ts, cn.ts
  pages/                 Dashboard, Documents, DocumentDetail, Calendar, EventDetail, EventForm,
                         Tasks, Contacts, Family, Settings, Login, NotFound
migrations/             generated SQL (0000–0003) + meta/ snapshots
scripts/                gen_icons.py, validate_migrations.py
docs/                   ARCHITECTURE, FEATURES, PLAN, RESEARCH, REVIEW_NOTES, UI_UX_AUDIT
public/_headers         CSP + security headers for static assets
wrangler.jsonc          Worker config (no assets.directory!)
vite.config.ts          plugin chain + PWA config
```

---

## 11. Current state & next priorities

**Phases 1 → 3 are implemented** against real D1 + auth:
- **Phase 1**: Google OAuth (PKCE), session lifecycle in D1, family CRUD with authz.
- **Phase 2**: documents CRUD + Drive proxy with private-visibility enforcement.
- **Phase 2.5**: events / tasks / contacts wired to D1 (all `/api/*` mutations require a session).
- **Phase 3**: daily cron does a range-based expiry/event scan with per-window dedupe
  (`reminders_log` / `event_reminders_log`), writes in-app notifications, and sends Resend email
  (no-op without `RESEND_API_KEY`); session purge runs in the same cron. In-app notification
  center + per-user reminder prefs (channels + lead-time windows) are live on the frontend.

The intended remaining build order is Phase 4 (offline/biometric/search) → Phase 5 (hardening +
E2E: CSRF Origin/Referer checks, rate limiting, the private-doc authz-matrix test) → Phase 6
(WhatsApp/push/OCR/shared-drive). See `docs/FEATURES.md §5` for the highest-value gaps.
