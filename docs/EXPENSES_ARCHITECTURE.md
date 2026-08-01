# Expense Intelligence — Architectural Assessment & Proposal

> **Status: APPROVED. Phase A (schema + migration + seed + money) is IMPLEMENTED.**
> Phases B–H below are not started. Read alongside `CLAUDE.md` (rules),
> `docs/ARCHITECTURE.md` (why), `docs/FEATURES.md` (what).

## Approved decisions (locked)

| # | Decision |
|---|---|
| D1 | A **private expense is creator-only**. Owners and admins do **not** see other members' private expenses. Family-visible expenses follow normal membership rules. Pinned by `tests/expenses-visibility.test.ts`; `worker/lib/expenses/visibility.ts` takes no `role` argument so privilege has no path to widen visibility. |
| D2 | Default currency **INR**, stored **per expense**, as **integer minor units**. **No conversion in V1.** Analytics never silently combines currencies — results are split per currency or flagged `mixed` (`totalByCurrency` in `shared/money.ts`). |
| D3 | **BottomNav unchanged.** Entry via the Dashboard quick-access / month-spend widget; module-local nav Overview / Expenses / Insights; persistent Add-Expense FAB. |
| D4 | V1 scope exactly as scoped below — no tags, accounts, budgets, recurring, CSV, bank sync, receipts/OCR, AI categorisation or NL search. |

### Additional architectural constraints folded into Phase A

- **Transaction semantics.** `TransactionKind` (`expense · income · transfer · refund · reversal ·
  fee · unknown`) and `TRANSACTION_KIND_TREATMENT` in `worker/lib/expenses/types.ts` fix the
  future boundary now. Transfers and income are `never_expense`, so "HDFC → SBI ₹20,000" and a
  credit-card bill payment can never surface as spending or double-count already-imported
  purchases. Nothing in V1 assumes an incoming financial event is an expense.
- **Refund semantics.** V1 amounts are strictly positive (DB CHECK `ck_exp_amount_positive`).
  Refunds/reversals are `adjusts_expense`, not negative rows; the documented model nets
  ₹2,000 − ₹500 = ₹1,500 via a future `expense_adjustments` table without disturbing the
  purchase's category, merchant or date.
- **Attribution.** `created_by_user_id` (who recorded it), `payer_member_id` (who actually paid,
  dependents included) and `visibility` are three independent columns.
- **Categories.** Self-referencing, depth ≤ 2, fully data-driven. Seed data carries no business
  meaning — nothing branches on a name or slug; analytics groups by id.
- **Analytics philosophy.** Every planned visualization answers a stated user question (see §12).

---

## 1. Current architecture (what I found)

**One Cloudflare Worker serves everything.** `worker/index.ts` mounts a Hono app; `/api/*` is
handled by the Worker (`run_worker_first`), everything else falls through to the `ASSETS`
binding serving the built React SPA. A daily Cron Trigger (`0 8 * * *`) runs
`runExpiryReminders` + `runWeeklyDigest` + `purgeExpiredSessions`.

| Layer | Technology | Notes |
|---|---|---|
| Runtime | Cloudflare Workers (`workerd`), `nodejs_compat` | single worker, single deploy |
| API | Hono 4.12 | `/api/*` only; middleware scoped there |
| Validation | Zod 4 + `@hono/zod-validator` | uniform `{error:"validation_error",issues}` 400 |
| DB | Cloudflare D1 (SQLite) via Drizzle 0.45 | `worker/db/schema.ts` is the single source of truth |
| Migrations | drizzle-kit generate → `migrations/*.sql` (0000–0004, 23 tables) | validated by `scripts/validate_migrations.py` |
| Frontend | React 19 + react-router 7 + TanStack Query 5 | SPA, mobile-first, dark theme |
| Styling | Tailwind 4 CSS-first (`@theme` tokens in `src/index.css`) | no config file, token-driven |
| Icons | lucide-react only | 1.5–2.4px stroke, `currentColor` |
| PWA | vite-plugin-pwa, `registerType: 'prompt'` | **no runtime caching of `/api/*`** |
| Tests | vitest 4, 18 files, 270+ tests | real D1 via `node:sqlite` adapter in `tests/helpers/testEnv.ts` |
| CI | GitHub Actions | typecheck → lint → validate_migrations → test → build |

**Middleware pipeline on `/api/*`:** `requestId` → `logger` → `secureHeaders` → `csrfProtect`
(Origin/Referer) → `bodyLimit(1 MiB)`. Static-asset security headers live in `public/_headers`.
`app.onError` returns `{error:"internal_error",requestId}` and never leaks internals.

**Version-sensitive dependency triangle** (`CLAUDE.md §5`): Vite 8 + `@cloudflare/vite-plugin`
+ `vite-plugin-pwa` + React 19 + Tailwind 4 are pinned to confirmed-working versions. Any new
frontend dependency is a risk to this triangle — this drives my charting recommendation (§9).

---

## 2. Relevant existing modules (the pattern to copy)

`worker/routes/tasks.ts` is the cleanest template. Every family-scoped resource follows the
identical shape:

```
GET  /api/<res>?familyId=…   requireSession → requireFamilyMember(c, familyId) → drizzle query
POST /api/<res>              requireSession → zv(schema) → requireFamilyMember → familyScope guards → insert
GET/PATCH/DELETE /:id        load row → requireFamilyMember(c, row.familyId) → role/ownership check
```

Reusable pieces I will consume rather than reinvent:

- `worker/middleware/requireSession.ts` — opaque session cookie → `c.set("userId")`, 401 otherwise.
- `worker/middleware/requireMember.ts` — `requireFamilyMember(c, familyId, minRole)` returns the
  membership row **or** a `Response` (404 for non-members — deliberately not 403, no family
  enumeration). Role ranking owner > admin > member.
- `worker/lib/familyScope.ts` — cross-family reference guards (`allMembersInFamily`, …). Any
  client-supplied ID written into an FK column must be proven in-family first.
- `worker/lib/rateLimit.ts` (`checkRateLimit`, KV fixed-window, fails open without KV).
- `worker/lib/audit.ts` (`insertAuditEvent`), `worker/lib/notify.ts`, `worker/lib/emailTemplates.ts`.
- `worker/lib/categorize.ts` — **already the exact pattern the expense auto-categoriser needs**:
  an AI path behind `ANTHROPIC_API_KEY` with a deterministic heuristic fallback. Merchant→category
  suggestion should mirror this file's shape, not invent a new one.
- `zv()` local helper (3 lines, duplicated per route file — I'll follow the convention).

**Pagination:** the only existing convention is `worker/routes/chat.ts` — a keyset cursor
(`?before=<epoch>`, `PAGE_SIZE+1` fetch, `{items, hasMore}`), with a `rowid` tiebreaker for
same-second rows. Expenses will use the same idea keyed on `(spent_on, rowid)`.

**Search:** `documents.ts` uses `?q=` with `like()` across a few columns. Adequate for V1.

---

## 3. Existing database structure

23 tables, all with **text UUID primary keys generated in app code**. Conventions I must match:

- **Instants** → `integer` Unix **seconds**, `.default(sql\`(unixepoch())\`)`.
- **Calendar dates** → ISO `yyyy-mm-dd` **text**, validated by `/^\d{4}-\d{2}-\d{2}$/`.
- Explicit `references(..., { onDelete })` on every FK — but **D1 does not reliably honour
  `PRAGMA foreign_keys=ON`**, so cascades are advisory; deletes that must cascade are written as
  explicit multi-statement deletes in app code + a test (`CLAUDE.md §2.8`).
- `type` (nature, permanent) and `status` (lifecycle: active/cancelled/trashed) are kept
  orthogonal; soft-delete via `status` + `trashedAt`, filtered out of all lists.
- Named indexes `idx_<entity>_<cols>`, uniques `uq_<name>`.

Family scoping is universal: `family_id NOT NULL REFERENCES families(id)` on every content table,
plus `family_members(family_id, user_id, role, status)` as the authorization spine. `member_type`
supports **dependents** (children with no Google account) — directly relevant to per-member
expense attribution.

**Nothing in the current schema stores money.** There is no existing currency, amount, or
financial concept to conflict with. The expense module is additive.

---

## 4. Existing authentication & authorization flow

Google OAuth (Auth Code + PKCE + `state`), ID token verified with `jose` against Google JWKS →
user upsert → **opaque session ID row in D1** (source of truth for revocation) → `HttpOnly;
Secure; SameSite=Lax` cookie named `sid`, with idle + absolute expiry, rotated on login and
purged by cron. Tokens never reach the browser.

Authorization is **always server-derived**: `userId` comes from the session, never the client;
every family-scoped route takes `familyId` and calls `requireFamilyMember`. Private documents are
filtered *in the SQL WHERE clause* (`visibilityWhere` / `isDocHiddenFrom` in `documents.ts`), not
in the client.

**The expense module will add zero new auth surface.** It reuses `requireSession` +
`requireFamilyMember` verbatim. CSRF and body limits are already global on `/api/*`.

---

## 5. Existing UI / component system & mobile patterns

- `src/components/ui/`: `AppBar` (sticky, `back` boolean prop), `Page` (`mx-auto max-w-md px-4
  pt-4 pb-28` — the standard mobile container that clears the bottom nav), `Card`, `Badge`
  (tones: neutral/success/warning/danger/info/vault), `ListItem`, `Button` (`loading` prop,
  variants, `min-h-11`), `Fab` (fixed `bottom-24 right-4`, `size-14`), `EmptyState`, `Skeleton`
  (shimmer), `Spinner`, `Avatar`.
- `BottomNav`: 5 fixed tabs — Home · Docs · Chat · Activity(badge) · Family — safe-area aware,
  ≥44px targets. `CLAUDE.md §3` is explicit that the nav stays uncluttered; Calendar/Tasks/
  Contacts are reached from the Dashboard "Quick access" grid.
- Data flow: TanStack Query + `src/lib/api.ts` (`api<T>()`, `ApiError` with `.code` +
  friendly `.message`). Query keys are arrays like `["tasks", familyId]`.
- `AuthContext` exposes `activeFamily` (persisted in localStorage, switchable). **Every list query
  passes `activeFamily.id`.**
- Purity rule: `Date.now()` in render trips `react-hooks/purity` — snapshot with
  `useState(() => …)`.

**Gaps the expense module must fill (and should contribute back to `ui/`):**
1. **No form primitives.** `inputCls` is a local const in `DocumentForm.tsx`. I'll extract
   `ui/Field.tsx` (label + input/select/textarea + error) so expense forms and future forms share it.
2. **No bottom sheet.** Required for fast expense entry — new `ui/Sheet.tsx` (focus trap, ESC,
   backdrop, safe-area, `prefers-reduced-motion` aware).
3. **No charts, no chart library.** See §9.
4. **No number/currency formatting.** New `src/lib/money.ts`.

---

## 6. Recommended integration points

| Concern | Decision |
|---|---|
| Backend routes | `worker/routes/expenses.ts` (+ `expenseCategories.ts`, `expenseAnalytics.ts`), registered in `worker/index.ts` as `/api/expenses`, `/api/expense-categories`, `/api/expenses/analytics` |
| Business logic | `worker/lib/expenses/` — `analytics.ts`, `defaults.ts` (seed tree), `merchant.ts` (normalisation), `ingest.ts` (future transaction contract) |
| Schema | append to `worker/db/schema.ts`, one generated migration (`0005_*`) |
| Frontend routes | `/expenses` (module home) · `/expenses/list` · `/expenses/analytics` · `/expenses/:id` · `/expenses/settings` under the existing `Layout` |
| Navigation | **Do not touch `BottomNav`.** Add an "Expenses" card to the Dashboard Quick-access grid, plus a month-spend widget on the Dashboard. Inside `/expenses/*`, a sticky **segmented control** under the AppBar (Overview · Expenses · Insights) + a persistent **FAB → Add-expense bottom sheet**. |
| Auth | reuse `requireSession` + `requireFamilyMember`; no new concepts |
| Tests | `tests/expenses.test.ts` (contract + authz), `tests/expenses-analytics.test.ts` (real-D1 aggregation), `tests/money.test.ts` + `tests/expenseRange.test.ts` (pure frontend libs) |

**Why not a 6th bottom tab:** the nav is deliberately capped at 5 and rebalancing it regresses
existing IA. A module-local segmented control keeps one-handed navigation inside Expenses while
the global nav remains the escape hatch. If, after using it, Expenses earns a tab, swapping one in
is a two-line change — the decision stays reversible.

---

## 7. Risks & conflicts

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Floating-point money.** SQLite `REAL` sums drift; D1 has no DECIMAL. | Store `amount_minor INTEGER` (paise/cents) + `currency TEXT(3)`. All aggregation is integer `SUM()`. Formatting only at the edge via `Intl.NumberFormat`. Non-negotiable. |
| R2 | **Bottom-nav pressure / IA regression.** | Module-local segmented nav (§6). No change to `BottomNav`. |
| R3 | **Analytics performance at 100k rows.** | All statistics computed in SQL (`SUM`/`GROUP BY`), never in the browser. Covering indexes on `(family_id, spent_on)`, `(family_id, category_id, spent_on)`, `(family_id, merchant_key)`. List endpoint is keyset-paginated. |
| R4 | **Test-harness positional row mapping** (`testEnv.ts` caveat): duplicate result column names collapse. Analytics queries with `SUM(...)` + joins are exactly the risky shape. | Every select uses explicit **aliased** fields. Called out in the test file header. |
| R5 | **drizzle-kit table-recreation bug** on later ALTERs (`CLAUDE.md §6`). | Get the schema right in `0005`; run `validate_migrations.py` on every generate; prefer additive columns afterwards. |
| R6 | **Privacy model divergence.** Documents let owner/admin see *everything*, including others' private docs. Copying that to money is a defensible-but-surprising default. | See §8 "Open decision D1" — needs your call. Whatever we choose gets a comment in the schema, a line in `CLAUDE.md`, and a dedicated authz test. |
| R7 | **PII in logs.** `logger()` logs method+path for `/api/*`. | Never put amounts or merchant names in query strings — filters use IDs and date ranges; free-text search `?q=` already exists for documents and is accepted precedent, but amounts stay in bodies. |
| R8 | **Dependency triangle.** A chart library (recharts → d3) risks the Vite 8 / React 19 pins. | Hand-rolled SVG charts, zero new dependencies (§9). |
| R9 | **Seeding ~60 category rows per family.** | Idempotent, guarded by a unique `(family_id, slug)` index + count check; ~4 KB per family in D1. Trivial. |
| R10 | **Scope creep** — the vision spans 15 phases. | Hard V1 line in §12; everything else is designed-for, not built. |

---

## 8. Proposed module architecture

### Layering

```
                    ┌──────────────────────────────────────────┐
  React pages  ───► │ src/pages/expenses/*  (UI only)          │
                    │ src/components/expenses/*  (Sheet, rows) │
                    │ src/components/charts/*  (pure SVG)      │
                    │ src/lib/money.ts, expenseRange.ts        │
                    └───────────────┬──────────────────────────┘
                                    │ TanStack Query + api()
                    ┌───────────────▼──────────────────────────┐
  Hono routes  ───► │ worker/routes/expenses.ts                │  ← auth, Zod, HTTP only
                    │ worker/routes/expenseCategories.ts       │
                    │ worker/routes/expenseAnalytics.ts        │
                    └───────────────┬──────────────────────────┘
                    ┌───────────────▼──────────────────────────┐
  Services     ───► │ worker/lib/expenses/analytics.ts         │  ← all SQL aggregation
                    │ worker/lib/expenses/defaults.ts          │  ← seed category tree
                    │ worker/lib/expenses/merchant.ts          │  ← normalisation + key
                    │ worker/lib/expenses/ingest.ts            │  ← FUTURE contract (types only in V1)
                    └───────────────┬──────────────────────────┘
                                    ▼  drizzle → D1
```

**Rule: no aggregation logic in a React component, and no SQL in a route handler beyond a simple
CRUD select.** Analytics functions are `(db, scope, range) => typed rows`, unit-testable against
the real-D1 harness and directly reusable by a future insights/NL layer.

### The Transaction ↔ Expense boundary (the important part)

Conceptually separated from day one; **physically** the staging table arrives with the importer,
not before. What V1 commits to:

1. `expenses.source` (`manual | csv_import | bank_sync | api | system`) — never assume manual.
2. `expenses.external_id` + `expenses.external_account` + a **partial unique index on
   `(family_id, source, external_id)`** so deduplication is enforced by the database the moment
   imports exist — no data migration needed later.
3. `expenses.import_batch_id` (nullable text) reserved for the batch table.
4. `expenses.merchant_key` — the normalised merchant handle. This is the **join seam**: future
   `merchant_aliases`/`merchant_rules` key on it, so auto-mapping learns without touching rows.
5. `worker/lib/expenses/ingest.ts` ships in V1 as **types + a documented pipeline contract only**
   (`RawTransaction`, `NormalizedTransaction`, `dedupeKey()`, `ClassificationSuggestion`,
   `ClassificationSource`) with no callers. It costs ~60 lines and locks the shape of Phase 4.

Future pipeline (Phase 4), unchanged by V1 choices:

```
provider → raw_transactions (immutable, rawPayload JSON)
        → dedupe (external_id, then fuzzy date+amount+account)
        → normalize merchant → merchant_key
        → merchant_rules lookup → category suggestion (+ confidence, source)
        → review queue (user confirms/corrects) → writes back a merchant_rule
        → expenses row (source='bank_sync', external_id set) → analytics, unchanged
```

Creating an empty `raw_transactions` table in V1 would be dead weight; the columns and the
`ingest.ts` contract are what make Phase 4 additive. That is the boundary that matters.

### Intelligence seams (no fake AI in V1)

- `parseQuickEntry(text): Partial<ExpenseDraft>` — a *pure, deterministic* parser for
  `"450 KFC"`, `"₹120 coffee"`. Regex + the family's own merchant history. No API, no dependency.
  Ships in V1 because it is genuinely deterministic and testable; the AI variant plugs in behind
  the same signature later, exactly like `categorize.ts` does today.
- `suggestCategory(merchantKey, familyId)` — V1: "what category did *this family* last use for
  this merchant key" (a real, honest signal from real data). Phase 4 adds rules + optional Claude.
- Insights: computed from aggregates only (e.g. "Food is 23% above your 3-month average" is a real
  SQL comparison). Nothing is generated that isn't derived from the user's rows.

---

## 9. Charts: recommendation

**Hand-roll SVG chart components in `src/components/charts/`; add no charting dependency.**

- Needed set is small: donut (category share), horizontal bar (top merchants/categories),
  bar/area (trend over time), sparkline, and later a calendar heatmap. ~300–400 lines total.
- Zero risk to the Vite 8 / React 19 / Cloudflare-plugin pin triangle (`CLAUDE.md §5`); recharts
  pulls d3 sub-packages and its own React peer range.
- Themeable directly from the existing `@theme` CSS tokens, so charts match the app instead of
  looking like a third-party widget.
- Accessible by construction: `role="img"` + `<title>`/`<desc>`, and every chart is paired with the
  same numbers as a real list — emoji/colour is never the only carrier of meaning.
- Bundle: a few KB vs ~90 KB min+gz for recharts, on a mobile-first PWA.

If a genuinely complex visualization later needs a library, that's a scoped, reversible decision.

---

## 10. Proposed database model (migration `0005`)

**V1 tables: 4.** Everything else is designed for, not created.

### `expense_categories` (categories *and* subcategories, self-referencing, max depth 2)

| column | type | notes |
|---|---|---|
| `id` | text PK | UUID |
| `family_id` | text NOT NULL → families | seeded per family |
| `parent_id` | text NULL → expense_categories | NULL = top-level; non-null = subcategory |
| `name` | text NOT NULL | |
| `slug` | text NOT NULL | stable key for seeding/idempotency |
| `emoji` | text NULL | 🍔 |
| `color` | text NULL | token name, not a raw hex, so themes stay coherent |
| `sort_order` | integer NOT NULL default 0 | user-reorderable |
| `is_system` | integer(bool) default 0 | seeded row; may be archived, never hard-deleted |
| `status` | text `active`\|`archived` default `active` | **archive, never delete** — history stays analyzable |
| `created_at` / `updated_at` | integer epoch | |

Indexes: `uq_expcat_family_slug (family_id, slug)`, `idx_expcat_family_parent (family_id, parent_id, sort_order)`.

*Why one table, not `categories` + `subcategories`:* identical fields and identical CRUD; a
self-join covers drill-down; adding depth later (if ever) costs nothing. Depth ≤ 2 is enforced in
app code (a category with a `parent_id` cannot itself be a parent) + a test.

### `expense_payment_methods`

`id`, `family_id`, `name`, `slug`, `kind` (`cash|card|bank|upi|wallet|other`), `emoji`,
`sort_order`, `is_system`, `status`, timestamps. Seeded: 💵 Cash · 💳 Credit Card · 💳 Debit Card ·
📱 UPI · 🏦 Bank Transfer · 📱 Wallet · Other. Unique `(family_id, slug)`.

*Why a table:* "do not hard-code payment methods" — families add "Paytm"/"PhonePe". `kind` keeps
analytics groupable without string-matching names. **Accounts** (e.g. "HDFC Credit Card ••1234")
are a *later* table; the payment method stays the coarse type.

### `expenses` (the core)

| column | type | required | notes |
|---|---|---|---|
| `id` | text PK | ✔ | UUID |
| `family_id` | text → families | ✔ | scope + authz |
| `created_by_user_id` | text → users | ✔ | server-derived, never from client |
| `payer_member_id` | text NULL → family_members | | attribution incl. dependents ("Dad → Medical") |
| `amount_minor` | integer | ✔ | **minor units**, > 0 |
| `currency` | text(3) | ✔ | default from `expense_settings`; ISO-4217 |
| `spent_on` | text `yyyy-mm-dd` | ✔ | the *transaction* date — **not** `created_at` |
| `spent_time` | text `HH:MM` NULL | | optional |
| `category_id` | text → expense_categories | ✔ | top-level (denormalised for fast GROUP BY) |
| `subcategory_id` | text NULL → expense_categories | | must have `parent_id = category_id` — enforced server-side + tested |
| `merchant` | text NULL | | as typed |
| `merchant_key` | text NULL | | normalised: lowercase, punctuation/whitespace-collapsed — the analytics + future-mapping join seam |
| `payment_method_id` | text NULL → expense_payment_methods | | |
| `notes` | text NULL (≤2000) | | |
| `visibility` | text `family`\|`private` default `family` | | personal vs family expense |
| `status` | text `active`\|`trashed` default `active` | | soft delete + undo |
| `trashed_at` | integer NULL | | |
| `source` | text default `manual` | ✔ | `manual\|csv_import\|bank_sync\|api\|system` |
| `external_id` | text NULL | | provider transaction ID |
| `external_account` | text NULL | | provider account handle |
| `import_batch_id` | text NULL | | reserved for the importer |
| `created_at` / `updated_at` | integer epoch | ✔ | |

Indexes:
- `idx_exp_family_date (family_id, spent_on)` — the workhorse for every range query.
- `idx_exp_family_cat_date (family_id, category_id, spent_on)` — category breakdowns.
- `idx_exp_family_merchant (family_id, merchant_key)` — merchant analytics + suggestions.
- `idx_exp_family_status_date (family_id, status, spent_on)` — list/soft-delete filtering.
- `uq_exp_external (family_id, source, external_id)` **partial, WHERE external_id IS NOT NULL** —
  duplicate-import protection that exists before the importer does.

### `expense_settings` (per family)

`family_id` PK → families, `default_currency` (default `INR`, configurable — not hard-coded),
`week_starts_on` (0–6), `month_start_day` (1–28, for salary-cycle budgeting later), `updated_at`.

### Deferred by design (schema-compatible, not created in V1)

`expense_tags` + `expense_tag_links` · `expense_accounts` · `budgets` · `recurring_expenses` ·
`raw_transactions` · `import_batches` · `merchants` + `merchant_aliases` + `merchant_rules`.
Each attaches to the V1 tables by adding a nullable FK column or a new table — no rewrite.

---

## 11. Proposed API surface (V1)

All routes: `requireSession` → `requireFamilyMember(c, familyId)`; Zod on every mutation with the
house error shape; unknown deep paths already yield JSON 404.

```
GET    /api/expense-categories?familyId=            → { categories: [ …, children: [] ] }
POST   /api/expense-categories                      → create category/subcategory (parent_id optional)
PATCH  /api/expense-categories/:id                  → rename / emoji / color / sort_order / status
POST   /api/expense-categories/reorder              → [{id, sortOrder}] batch
POST   /api/expenses/bootstrap                      → idempotent: seed default categories + payment methods + settings

GET    /api/expenses?familyId=&from=&to=&categoryId=&subcategoryId=&paymentMethodId=
                    &merchant=&memberId=&source=&minAmount=&maxAmount=&q=&sort=&cursor=
                                                    → { expenses, nextCursor, hasMore, totalMinor }
POST   /api/expenses                                → create (201)
GET    /api/expenses/:id
PATCH  /api/expenses/:id
DELETE /api/expenses/:id                            → soft delete (status='trashed'), undoable
POST   /api/expenses/:id/restore                    → undo

GET    /api/expenses/suggestions?familyId=          → { recentCategories, frequentMerchants, quickAmounts }
                                                      (derived from this family's real rows)

GET    /api/expenses/analytics/overview?familyId=&from=&to=
       → { totalMinor, count, dailyAverageMinor, largest, previousPeriodTotalMinor, changePct }
GET    /api/expenses/analytics/categories?familyId=&from=&to=[&categoryId=]  ← drill-down
GET    /api/expenses/analytics/trend?familyId=&from=&to=&bucket=day|week|month
GET    /api/expenses/analytics/merchants?familyId=&from=&to=&limit=
GET    /api/expenses/analytics/payment-methods?familyId=&from=&to=

GET    /api/expense-payment-methods?familyId=   / POST / PATCH
```

Notes:
- Every analytics response is **pre-aggregated in SQL**; the browser never receives raw rows to
  compute a total.
- Amounts always cross the wire as `*Minor` integers + `currency`; formatting is a client concern.
- Rate limit writes with the existing `checkRateLimit` (generous — fast entry must not trip it).
- Audit-log create/update/delete via `insertAuditEvent`, matching the documents write path.

---

## 12. Proposed UI architecture & V1 scope

### Screens

| Route | Screen | Content |
|---|---|---|
| `/expenses` | **Overview** | Month header + big total + Δ vs last month; KPI row (daily avg, largest, count); donut = spending by category; area/bar = trend; top merchants; recent expenses; segmented range control (This month / Last month / This year / Custom) |
| `/expenses/list` | **History** | Search + filter sheet + sort; keyset-paginated, grouped by day with day subtotals; row = emoji · merchant/description · category•subcategory · amount |
| `/expenses/analytics` | **Insights** | Drill-down: Category → Subcategory → Merchant → transactions; month-over-month comparison; payment-method split |
| `/expenses/:id` | **Detail / Edit** | All fields editable; delete with undo toast |
| `/expenses/settings` | **Settings** | Categories (reorder/emoji/archive), payment methods, default currency |

### The Add-Expense sheet (the heart)

FAB on every `/expenses/*` screen (and a Dashboard quick action) → **bottom sheet**, not a route
push, so the list keeps its scroll position:

1. Huge numeric amount display + custom keypad (`inputMode="decimal"`; no OS keyboard fight,
   thumb-reachable, currency symbol from settings).
2. Category chip row — recent categories first, then the full emoji grid; picking a category
   reveals its subcategories inline (optional, skippable).
3. Optional row: merchant (autocomplete from this family's frequent merchants) · payment method ·
   date (defaults **Today**, with Yesterday/pick chips) · notes.
4. `Save` — sticky, full-width, thumb-height. Then a toast **"Expense added ✓"** with
   **"Add another"** (keeps the sheet open, amount cleared, category retained) vs auto-dismiss.

Required = amount + category + date(default today). Everything else optional. Target: **₹450 →
Food → Save**, three taps, under five seconds.

### V1 definition of done

✓ fast entry sheet · ✓ categories + subcategories with emoji, data-driven and editable ·
✓ merchant · ✓ date · ✓ amount · ✓ payment method · ✓ notes · ✓ history with search, filters,
sort, keyset pagination · ✓ edit/delete with undo · ✓ monthly overview + MoM comparison ·
✓ category breakdown with drill-down · ✓ spending trend · ✓ top expenses/merchants · ✓ 4 SVG
charts · ✓ mobile-first + responsive desktop · ✓ reuse of existing auth/authz · ✓ D1 persistence
+ migration `0005` · ✓ Zod validation · ✓ house error handling · ✓ skeletons · ✓ empty states ·
✓ analytics service layer · ✓ tests (contract, authz, aggregation, pure libs) · ✓ zero regression
to existing modules (full 270+ suite stays green).

**Explicitly NOT in V1:** tags, accounts, budgets, recurring expenses, CSV import/export, bank
sync, receipts/OCR, AI categorisation, natural-language search.

### Implementation phases (each ends with the full gate: typecheck · lint · test · build ·
`validate_migrations.py` · manual mobile check)

| Phase | Deliverable |
|---|---|
| **A** | Schema + migration `0005` + `bootstrap` seed + `money.ts` + tests |
| **B** | Categories & payment-method APIs + settings screen |
| **C** | Expense CRUD API + list/filter/pagination + full test suite |
| **D** | Add-expense sheet (+ `ui/Sheet.tsx`, `ui/Field.tsx`) + quick suggestions |
| **E** | History screen: search, filters, sort, day grouping, edit/delete/undo |
| **F** | Analytics service + endpoints + aggregation tests |
| **G** | Overview dashboard + SVG charts + drill-down insights + Dashboard entry point |
| **H** | Polish: a11y pass, empty/loading states, desktop layout, screenshots, docs update |
| — | *Ship V1. Then:* tags/accounts → budgets → recurring → CSV → transaction staging → intelligence |

---

## 13. Open decisions I need from you

**D1 — Private expense visibility.** Documents let family **owner/admin see every document**,
including other members' private ones. Copying that rule to money means an admin can see a
member's private spending.
- *My recommendation:* for expenses, **`private` means creator-only, even for owner/admin.**
  Financial privacy expectations differ from document custodianship, and "private" that isn't
  private is the kind of surprise that erodes trust in the whole app. Family-visibility expenses
  (the default) remain fully visible to everyone, so shared-household reporting is unaffected.
- This deliberately diverges from the documents rule, so it gets a schema comment, a line in
  `CLAUDE.md §2`, and a dedicated authz test to stop a future agent "fixing" it for consistency.

**D2 — Default currency.** Proposal: `expense_settings.default_currency` defaults to `INR`,
per-expense `currency` column, `Intl.NumberFormat` formatting, minor-unit exponent by currency
(INR/USD = 2, JPY = 0). No conversion in V1 — mixed-currency totals are reported per currency
rather than silently summed. Confirm INR as the default.

**D3 — Navigation.** Confirm Expenses enters via the Dashboard quick-access grid + a Dashboard
month-spend widget, with a module-local segmented nav, rather than becoming a 6th bottom tab.

**D4 — V1 line.** Confirm tags/budgets/recurring/CSV are out of V1 as proposed above.
