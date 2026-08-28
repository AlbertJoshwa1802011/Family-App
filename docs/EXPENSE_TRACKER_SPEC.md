# Expense Tracker — Final Architecture & Product Specification

> Status: **proposed, not implemented**. No schema, migration, route, UI, or test code exists yet
> for anything in this document. This is the second-pass, verified architecture review — it
> supersedes and corrects the first investigation pass. Read this before writing a single line
> of expense-tracker code. Pair it with `CLAUDE.md`, `docs/ARCHITECTURE.md`, and `docs/FEATURES.md`
> the same way those documents are paired with each other.

---

## 1. Executive Summary

We are adding a **family financial ledger** to Family Vault: personal and shared expenses,
equal/exact/percentage splitting, derived balances, an append-only settlement history, receipts,
categories, and recurring expenses. Budgets, multi-currency, and debt-simplification are
explicitly deferred (§25).

The single hardest requirement is **financial integrity over years of real use**: balances must
never drift from the facts that produced them, edits must never silently corrupt history, and
duplicate submissions (a flaky mobile network, a double-tap) must never double-count money. Every
design choice below is made in service of that requirement first, and only second in service of
matching existing code conventions — though the two turn out to agree almost everywhere, because
this app's existing conventions (soft-delete, derived-not-cached state, append-only audit log,
role+ownership authorization, 404-not-403 privacy) are already the right instincts for a
financial system.

**Core model in one paragraph:** an expense has exactly one payer and, optionally, a set of
participants who each owe the payer a literal, server-computed `shareMinor` (integer minor
currency units). A settlement is an independent, append-only record of a real money transfer
between two members. A balance between any two members is *never stored* — it is always
`Σ(shares owed) − Σ(settlements paid)`, computed live, so it is definitionally impossible for it
to disagree with the ledger that produced it.

---

## 2. Verified Existing Architecture

This section replaces assumptions from the first-pass report with facts re-checked directly
against the repository. Corrections from the first pass are marked **⟳ corrected**.

| Area | Verified fact | Source |
|---|---|---|
| Auth/session | Cookie session → `requireSession` sets `c.var.userId`; no session = 401. | `worker/middleware/requireSession.ts` |
| Family membership | `requireFamilyMember(c, familyId, minRole?)` checks `family_members.status='active'` for the caller; non-member → **404** (not 403, existence not revealed); under-ranked → 403. Role rank: `owner:3 > admin:2 > member:1`. | `worker/middleware/requireMember.ts` |
| Member removal | Removing a member is **`status='removed'`, the row is never deleted.** `requireFamilyMember`, `loadMentionableMembers`, and `/families/me/members` all filter `status='active'`, so a removed member instantly loses all access to every resource, everywhere — but their historical FK references (documents, events, tasks) remain valid because the row still exists. **⟳ corrected**: the first pass didn't verify this; it matters enormously for the balance engine (§8, §16). |
| Family deletion | **No `DELETE /families/:id` route exists anywhere in the codebase.** Family deletion is presently impossible via the API. **⟳ corrected**: the first pass implicitly assumed a delete-family path existed and needed cascade handling; it does not exist today, so that edge case is currently only a *future* obligation, not a present one (still documented in §16 for completeness). |
| D1 transactions | **`drizzle-orm/d1`'s `db.batch()` is never used anywhere in `worker/`.** Every existing multi-statement write (e.g. creating an event + its attendees + its linked documents) is a sequence of independently-awaited statements, not an atomic transaction. **⟳ corrected**: the first pass didn't check this. It matters because expense-participant writes are the one place in this feature where a partial write is a real financial-integrity risk (see §13, §14). |
| Private visibility | `documents.visibility='private'` is hidden from other plain members but **visible to the document's owner AND to owner/admin roles** (`isDocHiddenFrom()`), always returning 404 (not 403) when hidden. Proven by `tests/authz-matrix.test.ts` across the full member × owner × admin × non-member matrix. | `worker/routes/documents.ts`, `tests/authz-matrix.test.ts` |
| Cross-family guards | `worker/lib/familyScope.ts` (`allMembersInFamily`, `allDocumentsInFamily`, `eventInFamily`) — every client-supplied ID that becomes a FK is checked against the caller's `familyId` before being written. No exceptions found anywhere in the route files. | `worker/lib/familyScope.ts` |
| CSRF | `csrfProtect` (global, on all `/api/*` mutations) and `csrfProtectGet` (explicit, on the document-download GET) both check `Origin`/`Referer` against the deployment's origin; requests with neither header (non-browser clients) are allowed through, since they can't carry ambient cookies. | `worker/middleware/csrf.ts` |
| Rate limiting | `checkRateLimit()` — KV fixed-window, **fails open if KV is absent** (e.g. unit tests). Applied selectively (uploads, invites, reminders, chat), not globally. | `worker/lib/rateLimit.ts` |
| Audit log | `insertAuditEvent()` writes to one generic `audit_log` table (`familyId, actorUserId, action, targetType, targetId, meta` as JSON) from every meaningful mutation across every resource. No per-resource audit tables exist. | `worker/lib/audit.ts` |
| Tags | `tags` (family-scoped, `unique(familyId,name)`) + `document_tags` join. The `tags` table itself has no document-specific columns — it is already generic and safely reusable by a new `expense_tags` join. | `worker/db/schema.ts` |
| File storage | Two-step Drive pattern: `POST .../upload-url` (resumable URL, client uploads directly, Worker never buffers bytes) → `POST .../files` (records metadata) → `GET .../files/:fid/download` (streaming proxy, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `csrfProtectGet`). `files.documentId` is `NOT NULL`, so `files` cannot be reused directly for receipts. | `worker/lib/drive.ts`, `worker/routes/documents.ts` |
| Cron / dedupe | `scheduled()` fans out to `runExpiryReminders`, `runWeeklyDigest`, `purgeExpiredSessions` via `ctx.waitUntil`. All are **range-based, never exact-date-equality**, because "Cloudflare cron is best-effort" (verbatim comment in `worker/cron.ts`). Dedupe is a `unique(subjectId, userId, windowDays, channel)`-style constraint + `onConflictDoNothing()` + checking `res.meta.changes > 0`, used identically in three places: `reminders_log`, `event_reminders_log`, `digest_log`. This is the single most battle-tested idiom in the codebase and is reused verbatim for recurring-expense dedupe (§12) and creation idempotency (§11). | `worker/cron.ts`, `worker/db/schema.ts` |
| Notifications/email | `createNotification()` (in-app) + `notifyMember()` (in-app + Resend email, honoring per-user `reminder_prefs.emailEnabled`) + `emailTemplates.reminderEmail()` (light-palette, table-based HTML). Fully reusable as-is for settlement/recurring-expense notifications. | `worker/lib/notify.ts`, `worker/lib/mentions.ts` |
| Currency / locale / timezone | **No concept of currency, locale, or per-family timezone exists anywhere in the codebase.** The only timezone handling is a hardcoded `timeZone: "UTC"` in `digest.ts`'s display formatting, and the documented `Date.UTC()` discipline in `src/lib/expiry.ts`. This is genuinely new territory for this app (§9, §12). | grep across `worker/`, `src/` |
| Zod validation | Shared `zv()` helper per route file; `.partial()` must be called on the base `ZodObject` **before** `.refine()` (refine returns `ZodEffects`, which has no `.partial()` — documented gotcha in `CLAUDE.md` §6). Cross-field refinement (e.g. `endAt >= startAt`) is an established pattern (`eventBaseSchema`). | `worker/routes/events.ts`, `CLAUDE.md` |
| Soft delete / restore | Every resource (documents, events, tasks) is soft-deleted via `status='trashed'` + `trashedAt`. **⟳ corrected**: the first pass implied a restore path might exist by convention — it does not. **No resource in the codebase has an "undo delete" / restore endpoint.** This is a genuinely new capability if we choose to add it for expenses (§9). |
| Members list | `GET /families/:id/members` returns **all** members regardless of status (no `status` filter in that query) — removed members are still visible in the family roster UI. `GET /families/me/members` (used by pickers) filters to `status='active'` only. Both patterns are directly reusable: expense balance/settlement history should follow the first (show removed members' history), new-expense participant pickers should follow the second (only active members selectable). | `worker/routes/families.ts` |
| Testing harness | `tests/helpers/testEnv.ts` runs the **real migrations** against `node:sqlite` wrapped in a D1-compatible adapter — genuine integration tests, not mocks. `seedActor()`/`seedFamily()`/`seedDocument()` are the extension points; adding `seedExpense`/`seedCategory`/`seedSettlement` follows the same shape. | `tests/helpers/testEnv.ts` |

---

## 3. Final Product Scope

**In scope (V1, phases E0–E6):** personal expenses, shared expenses with equal/exact/percentage
splits, categories (with one level of subcategory), receipts, tags, search/filter, derived
balances, append-only settlements with reversal, recurring expenses, a dashboard widget, a
reports screen, notifications for recurring-generation and (optionally) outstanding balances.

**Explicitly out of scope for V1** — see §25 for the full list and reasoning. Headline items:
budgets, multi-currency/FX, debt simplification ("minimum cash flow"), smart duplicate-expense
detection, family deletion cascade (no such route exists to need it yet), a generic
Idempotency-Key HTTP mechanism.

---

## 4. Final Financial / Domain Model

Two axes, deliberately kept **orthogonal in the schema** — the same idiom `events.type` vs
`events.status` already uses in this codebase (documented as a hard-won pattern in `CLAUDE.md`
§3) — but constrained by one business rule where they interact (see the note after the table):

| Axis | Values | Meaning |
|---|---|---|
| `splitType` | `none \| equal \| exact \| percentage` | Whether this expense creates obligations, and how they were computed. `none` = personal, no `expense_participants` rows. |
| `visibility` | `family \| private` | Who else can see the expense. |

**Interaction rule:** `splitType != 'none'` forces `visibility = 'family'` server-side, regardless
of client input. You cannot hide a debt from the person who owes it, or from the family that can
already see the resulting balance movement. `splitType = 'none'` allows either visibility, client's
choice, default `private` (see §10 for the reasoning).

### 4.1 Precise definitions

**Expense** — an immutable-by-default record of one real-world spend event: an amount, in the
family's one currency, paid by exactly one family member, on one date. It is either **personal**
(`splitType='none'`, no obligations) or **shared** (`splitType != 'none'`, creates obligations from
participants to the payer).

**Payment ("paid by")** — `expenses.paidByMemberId` identifies the sole creditor: the member whose
money left their pocket (or whose card was charged). Restricted to `memberType='user'` members —
**dependents cannot be payers** (they have no money, no account, no way to be repaid).

**Participant** — a row in `expense_participants` for a shared expense: a `memberId` and the
literal `shareMinor` they owe the payer. Restricted to `memberType='user'` — **dependents cannot be
participants either**, for the same reason (see §4.3, this is a deliberate correction from the
first-pass report).

**Share** — `shareMinor`, an integer ≥ 1 in minor currency units. Once written, it is the
authoritative, literal truth — **no reader ever re-derives it from `splitType`.** The split
algorithm only matters at write time (§5); every downstream consumer (balance engine, reports,
UI) just sums stored `shareMinor` values and never branches on how they were computed. This is
the single most important simplifying invariant in the whole design.

**Settlement** — an independent, append-only record: member A transferred `amountMinor` to member
B, on `settledAt`, for a reason (`note`), recorded by `recordedByUserId`. **A settlement is not
"mark this expense paid."** It is a general payment between two people, exactly like a real-world
Venmo/cash handoff — it has no required link to any specific expense, because that's how families
actually settle up (one lump sum covering several expenses at once, not one payment per expense).

**Balance between A and B** — never stored. Always:

```
netExpense(A,B)    = Σ shareMinor where A is a participant of an expense paid by B
                    − Σ shareMinor where B is a participant of an expense paid by A

netSettlement(A,B)  = Σ amountMinor of settlements A→B
                    − Σ amountMinor of settlements B→A

netBalance(A,B) = netExpense(A,B) − netSettlement(A,B)

  netBalance(A,B) > 0  →  "A owes B netBalance(A,B)"
  netBalance(A,B) < 0  →  "B owes A |netBalance(A,B)|"
  netBalance(A,B) = 0  →  settled
```

A participant row for the payer's own share (e.g. Albert pays and is also a participant)
contributes **zero** to any pairwise balance by construction — it never appears in either sum
above, because the sums only ever compare *a participant who is not the payer* against *the
payer*. No special-casing is needed anywhere in code; it falls out of the formula.

### 4.2 Financial-actor eligibility (centralized)

**Architecture-review correction:** every write path that accepts a payer, participant, or
settlement counterparty MUST go through one shared helper (proposed:
`worker/lib/expenses/financialActors.ts`, name TBD at implementation) rather than re-stating
eligibility inline. The helper is the single source of truth for:

- `memberType === 'user'` (dependents never qualify — see §4.3)
- `status === 'active'` for *new* obligations (removed members cannot be selected on create/update)
- membership belongs to the expense's `familyId` (cross-family IDs rejected)
- optional future extension point for non-human actors (see §4.4 common-pool seam)

Balance *reads* may still reference removed members when a non-zero obligation remains (§7.2) —
that is a display/aggregation concern, not a write-eligibility concern, and stays outside this
helper's "can act on a new financial write" contract.

### 4.3 Why dependents are excluded from `paidByMemberId` and `expense_participants`

This is a genuine, non-obvious design correction over the first-pass report, worth stating
explicitly because it's exactly the kind of thing that would force a painful redesign later if
gotten wrong now.

A dependent (child, elderly relative with no Google account — `memberType='dependent'`,
`userId=null`) cannot log in, cannot see a balance, and cannot record a settlement. If a dependent
were allowed to "owe" money in the ledger, that debt could never be settled *by* them — only a
parent could act on their behalf, which is really just the parent's own debt wearing the child's
name. Modeling it that way invites exactly the kind of "who actually pays this" ambiguity a
financial ledger must never have.

**Resolution:** dependents keep a place in expense tracking, but through a *different, non-financial*
field: `expenses.subjectMemberId` (nullable, any `memberType`, mirrors `documents.subjectMemberId`
exactly). It answers "who/what was this expense *for*" for tagging and reporting (e.g. "$4,200
spent on Emma this year") — with **zero effect on `paidByMemberId`, `expense_participants`, or any
balance calculation.** This cleanly separates *attribution* (anyone, including dependents) from
*financial obligation* (only real, authenticate-able users).

### 4.4 Future family / common-pool seam (not implemented)

**Architecture-review correction:** V1 expenses are always paid by a real person-member. A later
"family pool / common fund" capability (shared float that can pay and be reimbursed) is a plausible
enterprise-finance extension, but **must not be bolted on by overloading `paidByMemberId` with
magic sentinel values**.

Architectural seam, reserved only:

- Financial-actor eligibility (§4.2) is the extension point — a future actor kind (e.g. a
  pool/ledger entity scoped to the family) would be admitted there, not by special-casing routes.
- Do **not** invent pool tables, pool balances, or pool UI in E0–E6.
- Do **not** store `"family"` / null / synthetic member rows as payers in V1.
- When/if a pool ships, it gets its own explicit schema + actor type; historical person-paid
  expenses remain person-paid.

This seam exists so later work does not force a rewrite of split/balance math — it does **not**
authorize building the pool now.

---

## 5. Split (Money) Model

All money is an **integer in minor currency units** (e.g. paise, cents) — never a float, never
transmitted or stored as a decimal. A pure module, `worker/lib/money.ts` (mirroring the existing
pure-function idiom of `lib/expiry.ts`/`lib/reminders.ts`), owns every split calculation and is
the only place this math is allowed to happen. **The server never trusts client-computed shares**
for `equal` or `percentage` splits; it recomputes them itself. For `exact`, the client's numbers
*are* the product (a family typed specific numbers on purpose), and the server only validates —
never silently "fixes" — their sum.

**Invariant, enforced on every create and every update:**
`Σ(expense_participants.shareMinor) === expenses.amountMinor`, exactly, always.

### 5.1 Deterministic remainder distribution (shared by `equal` and `percentage`)

```
base      = floor(total / count)               // equal
raw[i]    = floor(total × bp[i] / 10000)        // percentage, per participant
remainder = total − Σ(base or raw[i])
```

The remainder (always `0 ≤ remainder < count`) is distributed **one minor unit at a time, to
participants sorted by `memberId` ascending, starting from the first.** This is deterministic and
reproducible (the same participant set always produces the same distribution, regardless of the
order the client sent them in, and is stable across retries). *Which* participant absorbs the odd
cent is an implementation detail with no product meaning; the invariant that matters is the sum.
(A "rotate who eats the rounding across expenses" fairness scheme is a plausible V2 refinement,
explicitly not needed for V1 — see §25.)

### 5.2 Worked examples (all amounts in ₹, minor unit = paise)

| Scenario | Total (paise) | Participants | Computation | Result (paise) | Result (₹) | Sum check |
|---|---|---|---|---|---|---|
| ₹100 / 3, equal | 10000 | 3 | base=3333, rem=1 | [3334, 3333, 3333] | 33.34 / 33.33 / 33.33 | 10000 ✓ |
| ₹101 / 3, equal | 10100 | 3 | base=3366, rem=2 | [3367, 3367, 3366] | 33.67 / 33.67 / 33.66 | 10100 ✓ |
| ₹1 / 3, equal | 100 | 3 | base=33, rem=1 | [34, 33, 33] | 0.34 / 0.33 / 0.33 | 100 ✓ |
| ₹10.01 / 3, equal | 1001 | 3 | base=333, rem=2 | [334, 334, 333] | 3.34 / 3.34 / 3.33 | 1001 ✓ |
| ₹1, 33.33/33.33/33.34% | 100 | 3 | raw floors=[33,33,33], rem=1 | [34, 33, 33] | 0.34 / 0.33 / 0.33 | 100 ✓ |
| 100% to one participant | 10000 | 1 | bp=[10000] | [10000] | 100.00 | 10000 ✓ |
| ₹1,000 / 10, equal | 100000 | 10 | base=10000, rem=0 | ten × 10000 | ten × 100.00 | 100000 ✓ |

`percentage` split reduces to the **same remainder-distribution primitive** as `equal`, after
converting basis points to per-participant floors — one function in `lib/money.ts`, two callers.
`exact` bypasses the primitive entirely: the client-sent `shareMinor` values are validated to sum
to the total and stored as-is, or rejected with `validation_error` naming the mismatch (e.g.
`"Shares sum to 9800, expected 10000"`) — no auto-correction.

**Percentage input validation:** basis points (`sharePercentBp`, integer 0–10000 per participant)
must sum to **exactly** 10000. `33% + 33% + 33% = 99%` is rejected, not silently normalized to
100% — a family that mistyped a percentage should be told, not guessed at.

**Minimum participants for a shared split:** `splitType != 'none'` requires **≥ 2 distinct
`memberType='user'` participants.** A "shared" expense with a single participant is really a
personal expense (`splitType='none'`) and is rejected with `validation_error`, steering the client
to the correct representation instead of allowing two different data shapes to mean the same
thing (see Case C, §6).

---

## 6. Payer vs. Participant — Worked Cases

Using the balance formula from §4.1, `amountMinor` in paise for concreteness.

**Case A** — Albert pays ₹1,000. Participants: Albert ₹400, John ₹300, Mary ₹300.
`expense_participants`: (Albert,400), (John,300), (Mary,300); `paidByMemberId=Albert`.
- Albert's own row → excluded from any pairwise sum (payer's own share, informational only).
- John owes Albert ₹300. Mary owes Albert ₹300. **Total outstanding: ₹600** — consistent, since
  Albert's own ₹400 share was never anyone else's debt.

**Case B** — Albert pays ₹1,000. Participants: John ₹500, Mary ₹500 (Albert not a participant —
he fronted the whole amount for others, e.g. a group gift he isn't part of).
- John owes Albert ₹500. Mary owes Albert ₹500. **Total outstanding: ₹1,000** = the full amount,
  correctly, since Albert has zero personal share.

**Case C** — Albert pays ₹1,000. Only Albert participates.
- **Rejected at validation** (§5.2): a shared split needs ≥ 2 participants. The client must submit
  this as `splitType='none'` (personal) instead. There is exactly one data shape for "only the
  payer is involved," not two.

**Case D** — John pays ₹1,000. Albert and Mary participate (not John).
- Albert owes John his share. Mary owes John her share. Structurally identical to Case B with
  roles relabeled — confirms the formula is payer-agnostic, a useful consistency check.

---

## 7. Balance Engine

**One canonical model: net, per member-pair, always derived, never stored.**

### 7.1 Opposing debts

> Albert owes John ₹1,000 (from one expense). John owes Albert ₹400 (from a different expense).
> Does the UI show ₹1,000 and ₹400 as two obligations, or one net ₹600?

**One net obligation: "Albert owes John ₹600."** Reasons:

1. The formula in §4.1 (`netExpense(A,B) = Σ(A's shares in B-paid expenses) − Σ(B's shares in
   A-paid expenses)`) is a *single subtraction* — it never produces two separate gross numbers in
   the first place. Presenting "two obligations" would require artificially preserving figures the
   formula doesn't compute, purely for display, creating a second code path that could drift from
   the real one.
2. Nobody ever "settles" ₹1,000 independently of the ₹400 in real life — you pay the net
   difference once. A two-obligation UI would be actively misleading about what action is needed.
3. **There must be exactly one source of truth.** The engine is one pure function/query per pair
   that returns one signed integer; there is never a second computation that the UI has to
   reconcile against the first.

The gross components remain fully visible on demand — every expense and settlement that
contributed to the ₹600 net is listed (with dates and amounts) on the pair's balance-detail
screen, so "why is it ₹600" is always answerable by drilling in. Only the *headline number* is
net.

### 7.2 Implementation shape

`GET /families/:id/balances` computes pairwise `netBalance` values via one SQL aggregation per
direction (or one query with a `CASE` on `paidByMemberId` vs `memberId`) plus one aggregation over
`settlements`. This is read-only, has no side effects, and is safe to call as often as the UI needs
(no caching layer, no staleness risk — see §9 for why this matters after edits).

**Removed members (architecture-review correction):** the balance board is **not** limited to
currently-active members. Any `memberType='user'` member — including `status='removed'` — who
still has a **non-zero** net obligation with another member MUST appear on the board until that
obligation is settled (or nets to zero). Dropping removed members from the pair set would silently
erase real debts the moment someone left. New expenses/settlements still refuse removed members as
actors at write time; only *historical* non-zero obligations keep them visible on the board.
Pairs whose net is exactly zero may omit removed members from the default UI list.

---

## 8. Currency Policy

**Adopted: one currency per family, no FX, no cross-currency balances — confirmed as the right
V1 choice.**

- `families.defaultCurrency` (new column, `text NOT NULL default 'USD'`, ISO 4217, settable by
  owner/admin). **Genuinely new concept** — verified nothing like it exists in the app today (§2).
- Every `expenses.currency` / `settlements.currency` **stores its own copy** of the currency at
  write time — it is *not* a live FK/lookup to `families.defaultCurrency`. This is deliberate, not
  denormalization-for-convenience: if a family ever changes `defaultCurrency` later, old records
  must keep the currency they were *actually* recorded in. Re-interpreting a historical $50
  grocery run as ₹50 the moment the family setting changes would be a silent, severe financial
  corruption bug — exactly the failure mode this column exists to prevent.
- New expenses/settlements are validated to use the family's **current** `defaultCurrency` — you
  cannot record a new expense in a stale currency.
- **Changing `families.defaultCurrency` is blocked while any unsettled shared expense exists**
  (any pair with `netBalance != 0`). This avoids ever having to reconcile a mixed-currency ledger,
  which is explicitly out of scope. A family that truly needs to change currency mid-life must
  settle up first — a rare, deliberate, one-time action, not a routine one.
- No conversion, no exchange rates, no cross-currency arithmetic anywhere in the balance engine.

---

## 9. Privacy Model

Reconsidered from first principles, not copy-pasted from the document-privacy pattern, per the
explicit instruction not to assume "private = visible to admin."

| Question | Answer | Reasoning |
|---|---|---|
| Who sees a **personal** expense? | Its creator, plus **owner/admin** (same as `isDocHiddenFrom`) | See discussion below — a deliberate, flagged decision. |
| Who sees a **shared** expense? | **Every active family member**, not just its participants | Shared money is collective family business; a sibling not on a particular split should still be able to audit that "Dad paid ₹2,000 for the school trip, split between the two kids." |
| Who sees **balances**? | Every active family member sees the full pairwise balance board | Balances are 100% derived from already family-visible shared expenses + settlements — hiding the derived number while showing its inputs would be security theater, not privacy. |
| Who sees **settlement history**? | Every active family member | Same reasoning as balances; settlements are inherently a two-party-but-family-relevant fact, consistent with the existing "Recent activity" feed philosophy. |
| Who sees a **receipt**? | Inherits its parent expense's visibility, exactly as document files inherit `documents.visibility` today | Direct reuse of an already-proven pattern. |
| What can **owner/admin** access? | Everything (personal expenses included) | Consistency choice — see below. |
| What can a **removed member** access? | Nothing, immediately | `requireFamilyMember` already filters `status='active'`; a removed member 404s on every family-scoped route the instant they're removed — no new mechanism needed, confirmed by re-reading `requireMember.ts` (§2). Their historical rows remain correctly attributed in the data (the `family_members` row isn't deleted), but they personally cannot view any of it once removed. |

**On personal-expense visibility specifically** — this needed a real decision, not an assumption,
so here is the reasoning both ways:

- *Argument for admin-blind personal expenses* (diverging from documents): money is a more
  sensitive category than document custody; there's no "emergency access" need analogous to
  finding a passport while someone is unreachable; giving admins blanket visibility into every
  member's discretionary spending is a surveillance capability nobody explicitly asked for.
- *Argument for reusing the existing `isDocHiddenFrom` model* (owner/admin bypass): this app's
  entire premise is a family vault under adult household oversight; the task's own instructions
  prioritize "reuse the existing authorization system" and "existing conventions over generic
  conventions"; a second, untested privacy tier that behaves differently from the one already
  proven in `tests/authz-matrix.test.ts` is *more* risk, not less, for a first release; and — a
  genuinely financial concern — if admin/owner truly cannot see any "personal" expense, a member
  could mark shared-household spending as "personal" specifically to dodge oversight, which is a
  worse failure mode for a household ledger than an admin occasionally seeing a private purchase.

**Decision (recommended, please confirm):** reuse the existing model — owner/admin bypass
personal-expense privacy exactly like `isDocHiddenFrom`, always 404 (not 403) for anyone else.
If the family later wants stricter "not even admin can see this" personal privacy, that should be
an explicit, opt-in family setting, not the V1 default — flagged in §25 as a possible future
toggle, not built now.

---

## 10. Permission Model

Layered exactly like every other resource: `requireSession` → `requireFamilyMember(familyId,
minRole)` → resource-specific ownership check. No new authorization primitive is introduced;
only new *policy* decisions on top of the existing primitives.

| Operation | Minimum role | Extra ownership check |
|---|---|---|
| Create expense (personal or shared) | `member` | — |
| Edit a **personal** expense | `member` | Creator only (+ owner/admin, per §9) |
| Edit a **shared** expense | `member` | Any participant, the payer, or admin+ — deliberately broader than personal, because a shared record is everyone's to correct (see §11) |
| Delete/trash an expense | `member` | Payer/creator or admin+ **only** — narrower than edit, because deletion is destructive to shared history (mirrors `documents.ts`'s exact `ownerUserId !== userId && role === 'member' → forbidden` pattern) |
| Restore a trashed expense | `member` | Same as delete: payer/creator or admin+ |
| Create/manage categories | `admin` | — (shared taxonomy, same gate as invites/role-changes) |
| Archive a category | `admin` | Blocked if any active expense still references it *only insofar as archiving hides it from new pickers* — existing references are never invalidated |
| Record a settlement | `member` | Any active member may record a settlement between **any two** other active members (household-transparency principle from the visibility table above — a parent often needs to record "I watched Albert hand John cash") |
| Reverse a settlement | `member` | Either counterparty, the original recorder, or admin+ |
| Create/manage a recurring template | `member` | Creator or admin+ to edit/pause; any member to view |
| View expenses/balances/settlements | `member` | Subject to the visibility rules in §9 |

---

## 11. Expense Lifecycle & Editing Rules

**Governing principle, stated once and applied everywhere below:** the balance engine is fully
derived (§7), so editing or deleting an expense automatically and correctly updates every
downstream balance — there is no separate reconciliation step and no risk of a stale cached
number. This is a *feature*, not a risk to be defended against with edit-locks.

**Hard rule: there is no `expenses.settled` boolean, ever.** Settlement status is a property of a
*member-pair balance*, computed live, never of an individual expense. Adding a per-expense
"settled" flag would create a second source of truth that can drift from the derived balance —
exactly the bug class this whole design exists to prevent.

### 11.1 The dangerous case, worked through

> Expense = ₹10,000, equal split, Albert paid: Albert ₹5,000 / John ₹5,000. John already settled
> ₹5,000 to Albert. Then someone edits the expense's amount to ₹8,000.

Before the edit: `netExpense(John,Albert) = 5000`, `netSettlement(John,Albert) = 5000`,
`netBalance = 0` — settled.

After the edit (new equal split: Albert ₹4,000 / John ₹4,000): `netExpense(John,Albert) = 4000`,
`netSettlement` unchanged at `5000`, `netBalance = 4000 − 5000 = −1000` — **John has now overpaid
Albert by ₹1,000; the balance flips direction.**

This is mathematically correct — the underlying fact changed, so the truth changed. It is *not*
corruption. It could, however, surprise a family that thought this was "done." The response is
**transparency, not a lock**:

- **No edit-lock tied to settlement history.** Rejected as an anti-pattern: tying an edit
  restriction to "any settlement has ever touched this pair" would, over years of real use,
  eventually make expenses between any two people who've ever settled up permanently uneditable —
  strictly worse than a self-correcting derived balance.
- Every `expense_updated` audit entry (reusing the existing generic `audit_log`, no new table)
  captures **old and new amount, payer, and participants** in `meta`, so "why did my balance
  change" is always answerable from the family's existing Activity feed — no new UI mechanism
  needed.
- The Balances screen is always live (§7), so the corrected number is simply what's shown the next
  time anyone opens it — no separate "recompute" step exists to forget to run.

### 11.2 Field-by-field editing rules

| Field changed | Effect | Notes |
|---|---|---|
| **Amount** | Shares recomputed per the stored `splitType`. `equal`: server recomputes evenly (client input ignored, same as create). `percentage`: server recomputes from the same stored basis points against the new total (scale-invariant — **no client resubmission required**, a nice property worth highlighting). `exact`: the old shares almost certainly no longer sum to the new total — the client **must** resubmit new exact shares; omitting them is a `validation_error`. | |
| **Payer** | Allowed. New payer re-validated via the centralized financial-actor helper (§4.2). This changes who is owed money — significant enough that the audit `meta` always explicitly notes old→new payer, beyond the generic diff. | |
| **Participants / shares** | Replace-all-then-reinsert `expense_participants` for this expense — **directly mirrors the existing `events.ts` "replace attendees if provided" idiom** on `PATCH /events/:id`, a proven, already-shipped pattern. Same validation as create (cross-family guard, ≥2 participants, sum invariant, no dependents). | |
| **Category** | No financial effect. Freely editable by the same authz as any other field. | |
| **Date** | No effect on balances. Affects which recurring-period / monthly-report bucket it lands in. No constraint on past-dating (logging last week's expense today is normal). | |
| **Trashed** (soft delete) | `status='trashed'` — its `expense_participants` rows are excluded from the balance query the instant this flips (balance queries always filter `expenses.status != 'trashed'`). Same self-correcting, non-blocking philosophy as editing — no "can't delete a settled expense" restriction, for the identical anti-pattern reasoning as §11.1. Authorization is narrower than editing: payer/creator or admin+ only (§10). | |
| **Restored** | **New capability, not reused from elsewhere** — verified that no resource in this codebase has a restore/undo-delete endpoint today (§2). Justified here specifically because an accidental expense deletion silently moves everyone's balance, and a financial ledger should have a documented undo path where a stale document does not. `POST /expenses/:id/restore`, payer/creator or admin+, within a grace window (recommend 30 days, matching nothing in particular but a sane default) after which the trash becomes permanent. Flagged as optional for the very first ship (E1) if minimizing new surface area matters more than the safety net — see Phase acceptance criteria. | |

---

## 12. Recurrence Model

**Not a cron-insert loop.** A template (`recurring_expenses`) plus a range-based, dedupe-safe
generator, following the exact idiom `runExpiryReminders` already uses (§2) — the highest-
confidence part of this whole design, because it's a direct, verified, production-proven
precedent, not a novel mechanism.

### 12.1 Cadences

| Cadence | Fields | Next-occurrence rule |
|---|---|---|
| `weekly` | `dayOfWeek` (0–6) | Next date matching `dayOfWeek`, ≥ 7 days after the **last generated occurrence** (not "after today" — see missed-cron below). |
| `monthly` | `dayOfMonth` (1–31) | `min(dayOfMonth, daysInMonth(targetYear, targetMonth))` — see the 31st-of-the-month walkthrough below. |
| `custom_days` | `intervalDays` | `lastGeneratedDate + intervalDays`. |

### 12.2 Monthly-on-the-31st, deliberately resolved

> Jan 31 → Feb ? → Mar 31 → Apr ?

**Decision: clamp to the last day of the shorter month; the anchor `dayOfMonth` is never
permanently altered.**

```
Jan 31  → Feb 28 (or 29, leap year)   [clamped: Feb has no 31st]
        → Mar 31                     [anchor recomputed fresh — NOT "Mar 1" or "Mar 3"]
        → Apr 30                     [clamped again]
        → May 31
```

Rejected alternatives, with reasons: **skip the short month entirely** (would silently miss a
whole month's rent — much worse than clamping); **roll to the 1st of the next month** (permanently
drifts the anchor day after the first short month, so "the 31st" quietly becomes "the 1st" forever
— wrong). Clamping is also the convention real-world billing systems (credit cards, subscriptions)
already use, so it matches user expectations.

### 12.3 Missed and duplicate cron execution

- **Missed** (cron didn't fire for N days): the scan is `WHERE active=true AND nextRunDate <=
  today` (range, not equality — same principle as `runExpiryReminders`). On recovery, the template
  generates **exactly one** occurrence — the single currently-due `periodKey` — then fast-forwards
  `nextRunDate` to the next future period. **Decision: it does not backfill every missed period**
  even if the cron was down for months. Rationale: silently batch-generating several months of
  rent on recovery is more likely to double-count against manual entries a family already made to
  cover the gap than to be a welcome catch-up. A family that notices a real gap can add a one-off
  expense by hand. (Rejected alternative — backfill every missed period — noted here explicitly
  because it's a defensible-but-riskier choice, not an obviously wrong one.)
- **Duplicate** (two concurrent cron invocations for the same due period): prevented by a
  `unique(recurringExpenseId, periodKey)` constraint on `recurring_expense_log` +
  `onConflictDoNothing()` + checking `res.meta.changes > 0` — **byte-for-byte the same idiom** as
  `reminders_log`/`event_reminders_log`/`digest_log`. Not a new pattern; a direct reuse.

### 12.4 Pause / resume / end date

- `active` boolean toggle. Pausing does **not** touch `nextRunDate` — resuming later is handled by
  the exact same "missed cron" code path above (generate the one currently-due period, fast-
  forward), so pause/resume needs zero special-case logic of its own. A nice unification.
- `endDate` (nullable): scan condition adds `nextRunDate <= endDate OR endDate IS NULL`. Once the
  computed `nextRunDate` would exceed `endDate`, the generator sets `active=false` automatically
  (and logs it) so the scan doesn't keep re-checking a permanently-expired template forever.

### 12.5 Editing future occurrences vs. historical ones

**Generated expenses become fully normal `expenses` rows** the moment they're created —
`expenses.recurringExpenseId` is read-only *provenance* (for filtering "show me all rent
expenses"), never a live binding. Editing the template only changes future generations; editing a
past-generated expense is a completely ordinary expense edit under §11's rules, with zero special
interaction with its originating template. Both required properties from the task — "generated
expenses become normal expenses" and "historical expenses don't unexpectedly change when the
template changes" — are structurally guaranteed by this, not just promised by convention.

### 12.6 A participant leaves the family between template creation and firing

The recurring template stores its split as `splitTemplateJson` (§13.1). At generation time, every
`memberId` in the template is re-validated as still `status='active'`. **Decision:** if a
participant is no longer active, that participant is dropped and the split is recomputed over the
remaining active participants (via the normal §5 algorithm), with a warning written to
`audit_log`. Refusing to generate the whole recurring expense because one former participant left
would be a worse outcome for a household that depends on rent/subscriptions being tracked
reliably — but see §16 for the case where this drops everyone.

### 12.7 Time zone

No family/user timezone concept exists anywhere in the app (§2) — recurrence date math follows the
identical `Date.UTC()` discipline `expiry.ts`/`cron.ts` already use, for the identical reason
(`CLAUDE.md`'s documented historical off-by-one bug). Since these are date-only values with no
time-of-day component, this is a non-issue in practice, worth stating explicitly rather than
silently assumed.

---

## 13. Category Model

`expense_categories`: family-scoped custom categories plus a shared, seeded set of built-in
categories (`familyId = NULL`). One level of subcategory via `parentCategoryId` self-reference.

- **Built-in categories cannot be archived in V1.** Per-family suppression of a global category
  would require a `hidden_global_categories(familyId, categoryId)` override table purely to
  support a minor preference — unnecessary sophistication for a first release. If real user demand
  emerges, that table is a small, additive, backward-compatible follow-up (deferred, §25).
- **Custom (family-owned) categories can be archived**, never hard-deleted while referenced by any
  expense (existing or historical) — archiving only removes it from the picker for *new*
  expenses; past assignments are untouched.
- Category management is `admin+` only (§10), matching the existing gate on invites/role-changes.

---

## 14. Receipt / Storage Model

**New `expense_receipts` table, deliberately not a reuse of `files`.** `files.documentId` is
`NOT NULL` (verified, §2) — retrofitting it to be polymorphic would mean altering an existing,
production-applied table, which is exactly the kind of risky migration `CLAUDE.md`'s golden rules
warn against. `expense_receipts` instead **mirrors `files`'s shape** and reuses the *same Drive
helper functions* (`createResumableUploadUrl`, `downloadDriveFile` from `worker/lib/drive.ts`) —
zero new storage infrastructure, only a new metadata table, exactly the same two-step upload
pattern, exactly the same streaming download proxy with `Content-Disposition: attachment` +
`nosniff` + `csrfProtectGet`, and exactly the same visibility inheritance (a receipt is only as
visible as its parent expense).

---

## 15. Database Schema Proposal

No existing table is altered except one additive nullable-safe column on `families`. Every new
table is additive. All new tables use `crypto.randomUUID()` text PKs and the app's existing
`(unixepoch())` default for instants, matching every existing table.

```ts
// worker/db/schema.ts — additive changes only

families:
  + defaultCurrency: text NOT NULL default 'USD'   // ISO 4217; admin/owner settable

expense_categories
  id                text PK
  familyId          text NULL   → families.id, cascade      // NULL = global built-in
  parentCategoryId  text NULL   → expense_categories.id      // one level of subcategory
  name              text NOT NULL
  icon              text NULL
  color             text NULL
  archived          bool NOT NULL default false
  archivedAt        integer NULL
  createdAt         integer NOT NULL default now
  UNIQUE(familyId, parentCategoryId, name)
  INDEX(familyId, archived)

expenses
  id                  text PK
  familyId            text NOT NULL → families.id, cascade
  paidByMemberId      text NOT NULL → family_members.id      // memberType='user' enforced in app code
  subjectMemberId     text NULL    → family_members.id, set null   // any memberType; tagging only, §4.3
  categoryId          text NULL    → expense_categories.id, set null
  amountMinor         integer NOT NULL     // > 0
  currency            text NOT NULL        // = families.defaultCurrency at write time, §8
  expenseDate         text NOT NULL        // ISO yyyy-mm-dd
  merchant            text NULL
  description         text NULL
  paymentMethod       text NULL            // free text, mirrors documents.category's precedent
  splitType           text NOT NULL enum(none|equal|exact|percentage) default 'none'
  visibility          text NOT NULL enum(family|private) default 'private'   // see §9 interaction rule
  recurringExpenseId  text NULL → recurring_expenses.id, set null    // provenance only, §12.5
  status              text NOT NULL enum(active|trashed) default 'active'
  trashedAt           integer NULL
  createdByUserId     text NOT NULL → users.id, cascade
  clientRequestId     text NULL            // idempotency, §17
  createdAt           integer NOT NULL default now
  updatedAt           integer NOT NULL default now
  UNIQUE(familyId, createdByUserId, clientRequestId)   // NULLs distinct in SQLite — same trick as uq_family_user
  INDEX(familyId, expenseDate)
  INDEX(familyId, status)
  INDEX(paidByMemberId)
  INDEX(categoryId)

expense_participants
  expenseId        text NOT NULL → expenses.id, cascade
  memberId         text NOT NULL → family_members.id           // memberType='user' enforced in app code
  shareMinor       integer NOT NULL     // > 0, authoritative (§4.1)
  sharePercentBp   integer NULL         // 0–10000, display-only fidelity for splitType='percentage', NEVER authoritative
  PRIMARY KEY(expenseId, memberId)
  INDEX(memberId)

expense_tags
  expenseId  text NOT NULL → expenses.id, cascade
  tagId      text NOT NULL → tags.id, cascade      // reuses the EXISTING tags table, verified generic
  PRIMARY KEY(expenseId, tagId)
  INDEX(tagId)

expense_receipts                          // mirrors `files`, does not reuse it — §14
  id           text PK
  expenseId    text NOT NULL → expenses.id, cascade
  driveFileId  text NOT NULL
  fileName     text NOT NULL
  mimeType     text NOT NULL
  sizeBytes    integer NOT NULL default 0
  status       text NOT NULL enum(active|deleted) default 'active'
  deletedAt    integer NULL
  createdAt    integer NOT NULL default now
  INDEX(expenseId, status)

settlements                                // append-only ledger, §11 — deliberately NO status/delete
  id                     text PK
  familyId               text NOT NULL → families.id, cascade
  fromMemberId           text NOT NULL → family_members.id     // memberType='user' enforced in app code
  toMemberId             text NOT NULL → family_members.id     // memberType='user'; != fromMemberId
  amountMinor            integer NOT NULL     // > 0, always positive — no sign games, §11
  currency               text NOT NULL
  settledAt              integer NOT NULL     // when the real transfer happened (user-set, can be past-dated)
  note                   text NULL
  reversesSettlementId   text NULL → settlements.id      // set only on a reversal row, §11
  recordedByUserId       text NOT NULL → users.id, cascade
  clientRequestId        text NULL
  createdAt              integer NOT NULL default now    // when entered into the app
  UNIQUE(familyId, recordedByUserId, clientRequestId)
  INDEX(familyId, fromMemberId)
  INDEX(familyId, toMemberId)
  INDEX(reversesSettlementId)

recurring_expenses
  id                  text PK
  familyId            text NOT NULL → families.id, cascade
  paidByMemberId      text NOT NULL → family_members.id
  categoryId          text NULL → expense_categories.id, set null
  amountMinor         integer NOT NULL
  currency            text NOT NULL
  merchant            text NULL
  description         text NULL
  paymentMethod       text NULL
  splitTemplateJson   text NOT NULL default '{"splitType":"none","participants":[]}'   // §13.1 below
  cadence             text NOT NULL enum(weekly|monthly|custom_days)
  dayOfWeek           integer NULL     // 0–6, weekly only
  dayOfMonth          integer NULL     // 1–31, monthly only, clamped per-month (§12.2)
  intervalDays         integer NULL     // custom_days only
  startDate           text NOT NULL    // ISO yyyy-mm-dd
  endDate              text NULL
  nextRunDate         text NOT NULL    // ISO yyyy-mm-dd, advanced by the generator
  active              bool NOT NULL default true
  createdByUserId     text NOT NULL → users.id, cascade
  createdAt           integer NOT NULL default now
  updatedAt           integer NOT NULL default now
  INDEX(familyId, active, nextRunDate)

recurring_expense_log                     // dedupe, byte-for-byte the digest_log/reminders_log idiom
  id                    text PK
  recurringExpenseId    text NOT NULL → recurring_expenses.id, cascade
  periodKey             text NOT NULL     // "2026-08" monthly / "2026-W33" weekly / "2026-08-14" custom_days
  generatedExpenseId    text NOT NULL → expenses.id, cascade
  createdAt             integer NOT NULL default now
  UNIQUE(recurringExpenseId, periodKey)
```

### 15.1 Why `splitTemplateJson` is JSON, not a `recurring_expense_participants` table

Deliberately re-examined, not defaulted to either extreme:

- **In favor of JSON:** the template's participant list is *only ever read whole* (to seed a
  fresh `expense_participants` set at generation time) and *never filtered, joined, or aggregated*
  in SQL on its own — unlike real `expense_participants`, which powers balance math and therefore
  must be relational. There is a **direct, verified precedent** in this exact codebase for this
  reasoning: `reminder_prefs.windowsJson` already stores a small, always-read-whole, never-SQL-
  queried array for precisely this reason.
- **Against JSON:** loses DB-level FK integrity on the embedded `memberId`s, and is less
  consistent with "everything else is relational."
- **Decision: JSON**, on the strength of the direct precedent, with the explicit mitigation that
  every `memberId` inside it is **re-validated as an active family member at generation time**,
  never trusted as still-valid just because it was valid when the template was created (§12.6).

### 15.2 FK behavior notes (corrected from the first pass)

`expenses.paidByMemberId` / `expense_participants.memberId` / `settlements.fromMemberId` /
`settlements.toMemberId` all reference `family_members.id` with **no `onDelete` cascade or
set-null** — deliberately, because `family_members` rows are verified to be immortal in this app
(removal is a status flip, never a delete, §2). A share or a settlement must never be allowed to
float without a debtor/creditor, so unlike `tasks.assignedToMemberId` (which tolerates
`onDelete:'set null'` because a task can survive an unassigned state), these FKs have nothing to
handle — the row they point to is never actually removed.

`familyId` deletion cascades are specified per `CLAUDE.md`'s golden rule (explicit app-level
multi-statement deletes, D1 FK cascades are advisory) **as a future obligation only** — no
`DELETE /families/:id` route exists today (§2), so there is nothing to wire this into yet.

---

## 16. API Proposal

Domain operations first, then their route mapping — every operation states input, validation,
authorization, transaction boundary, idempotency, audit event, and error cases.

### 16.1 Domain operations

**RecordExpense**
- *Input:* `familyId, paidByMemberId, categoryId?, subjectMemberId?, amountMinor, currency, expenseDate, merchant?, description?, paymentMethod?, splitType, participants[] (shape depends on splitType), tagIds[], clientRequestId?`
- *Validation:* amount > 0; `currency` = family's current `defaultCurrency`; `expenseDate` well-formed; splitType-specific participant rules (§5); `paidByMemberId`/participants validated **only** via the centralized financial-actor helper (§4.2); `categoryId` (if given) belongs to `familyId` (or is a global built-in) and is not archived; `tagIds` belong to `familyId`.
- *Authorization:* `requireSession` + `requireFamilyMember(familyId, 'member')`.
- *Transaction boundary:* the expense row + its `expense_participants` + `expense_tags` inserts must be atomic. **This is the one deliberate, isolated place this feature introduces `db.batch()`** — a genuinely new pattern for this codebase (verified zero prior usage, §2) — scoped *only* to expense-participant and settlement writes, not adopted as a blanket new convention. Justification: a partial write here (expense committed, participants failed) silently corrupts a balance in a way that's far harder to detect and repair than a partially-created event/task, which has no derived financial math riding on its sub-rows. **Local workerd/Miniflare D1 batch atomicity was empirically verified in E-1** (see §21.1); remote hosted D1 was not reachable in that environment.
- *Idempotency:* `clientRequestId` unique-constraint + `onConflictDoNothing` on the **expense row only** (§17). **On conflict/retry: return the existing expense (200) and do NOT re-batch participant/tag inserts.** Blindly re-running dependent inserts on retry is forbidden (architecture-review correction) — it would either violate the composite PK, create duplicate side effects, or race with a partial prior attempt.
- *Audit:* `expense_created` (only when a new row is actually inserted).
- *Errors:* 400 `validation_error` (including share-sum mismatch, insufficient participants, dependent-as-participant); 404 family/category/tag not found or cross-family; 403 under-ranked.

**UpdateExpense** — same validation shape as create, partial; amount/payer/participant handling per §11.2; audit `expense_updated` with before/after `meta`.
- *Participant replacement:* when participants change, **delete-all + insert-new for that expense's `expense_participants` MUST run inside a single `db.batch()`** (architecture-review correction). Non-atomic replace (delete then insert across separate awaits) can leave an expense with zero participants mid-failure and corrupt balances. Tags follow the same batch when replaced.

**TrashExpense / RestoreExpense** — per §11.2; authorization per §10.

**RecordSettlement**
- *Input:* `familyId, fromMemberId, toMemberId, amountMinor, currency, settledAt, note?, clientRequestId?`
- *Validation:* amount > 0; `currency` = family's currency; both members active `memberType='user'`; `fromMemberId != toMemberId`.
- *Authorization:* any active member of the family (§10) — not restricted to the two parties.
- *Transaction boundary:* single-row insert; `db.batch()` not needed (no sub-rows).
- *Idempotency:* `clientRequestId`.
- *Audit:* `settlement_recorded`.

**ReverseSettlement**
- *Input:* `settlementId, note (required)`.
- *Validation:* the target settlement must not already have a reversal (no existing row with `reversesSettlementId = this id`) → 409 if it does.
- *Authorization:* either counterparty, the original `recordedByUserId`, or admin+.
- *Effect:* internally calls **RecordSettlement** with `from`/`to` swapped and `reversesSettlementId` set — reuses the same operation rather than inventing a second write path.
- *Audit:* `settlement_reversed`.

**GetBalances(familyId)** — read-only, always live, no side effects, no caching (§7.2).

**CreateRecurringTemplate / UpdateRecurringTemplate / Pause / Resume** — per §12; template edits never touch already-generated expenses (§12.5).

**(cron-only) GenerateDueOccurrences** — the `scheduled()` handler's new fan-out target, same shape as `runExpiryReminders`.

**ManageCategory** (create / archive) — admin+ only (§10, §13).

### 16.2 Route mapping

New files: `worker/routes/expenses.ts`, `worker/routes/expenseCategories.ts`,
`worker/routes/settlements.ts`, `worker/routes/recurringExpenses.ts`, registered in
`worker/index.ts` exactly like every existing resource.

| Method | Path | Notes |
|---|---|---|
| GET | `/expenses?familyId&from&to&categoryId&member&tag&scope&q&minAmount&maxAmount` | visibility-filtered (mirrors `visibilityWhere`), search on merchant/description with the existing wildcard-sanitized `LIKE` pattern |
| POST | `/expenses` | RecordExpense |
| GET/PATCH | `/expenses/:id` | visibility-gated 404-not-403; PATCH = UpdateExpense |
| DELETE | `/expenses/:id` | TrashExpense |
| POST | `/expenses/:id/restore` | RestoreExpense (§11.2 — may ship in E1.5 rather than E1) |
| POST/GET | `/expenses/:id/receipts/upload-url`, `/expenses/:id/receipts` | Drive two-step pattern, identical shape to `documents.ts` |
| GET | `/expenses/:id/receipts/:rid/download` | `csrfProtectGet` + streaming proxy |
| GET | `/expenses/categories?familyId` | built-in + family custom, excludes archived by default |
| POST/PATCH | `/expenses/categories`, `/expenses/categories/:id` | admin+ |
| POST | `/expenses/categories/:id/archive` | admin+; custom categories only (§13) |
| GET | `/families/:id/balances` | GetBalances |
| GET/POST | `/settlements?familyId` | list ledger / RecordSettlement |
| POST | `/settlements/:id/reverse` | ReverseSettlement — **no `DELETE /settlements/:id` route exists at all**, by design (§11) |
| GET/POST | `/recurring-expenses?familyId` | list / CreateRecurringTemplate |
| GET/PATCH | `/recurring-expenses/:id` | detail / UpdateRecurringTemplate |
| POST | `/recurring-expenses/:id/pause`, `/resume` | §12.4 |
| GET | `/expenses/reports?familyId&month` | monthly/category/member aggregates |

All mutation routes get the existing global `csrfProtect` automatically; the two new GET routes
that touch file bytes (`receipts/:rid/download`) explicitly add `csrfProtectGet`, matching the
document download route exactly.

---

## 17. Idempotency

**Verified: no idempotency mechanism exists anywhere in the current codebase** — no
`Idempotency-Key` header, no dedupe on `POST /documents`, `POST /events`, or `POST /tasks` (§2).
Introducing one for money-moving operations is new, and it is designed to be **consistent with
the codebase's own dedupe idiom**, not a generic bolt-on HTTP middleware the app has no precedent
for.

**Mechanism:** an optional, client-generated `clientRequestId` (UUID, generated once per
form-submission attempt, resent unchanged on retry) on `expenses` and `settlements`, with
`unique(familyId, createdByUserId/recordedByUserId, clientRequestId)`. On insert conflict
(`onConflictDoNothing()` + checking `res.meta.changes > 0` — the exact `recordReminderOnce()`
idiom from `cron.ts`), the server returns the **existing** row with 200 instead of creating a
duplicate. Omitting `clientRequestId` is fully backward-compatible — it just means no dedupe
protection for that call, identical to how every other `POST` in the app already behaves.

**Retry / dependent-insert rule (architecture-review correction):** idempotent expense creation
must **not** blindly batch dependent inserts (`expense_participants`, `expense_tags`) on retry.
Correct shapes:

1. **Preferred:** attempt to insert the expense row alone (with `onConflictDoNothing`). If
   `changes === 0`, load and return the existing expense — stop. If inserted, then `db.batch()`
   the dependent participant/tag inserts (and only those).
2. **Alternative acceptable:** a single `db.batch()` of expense + dependents is allowed only when
   a conflict on the expense row is detected *before* dependents run and causes the **entire**
   batch to roll back (so no orphan dependents and no second insert attempt). On the retry path
   that finds an existing `clientRequestId`, return the existing graph without issuing another
   dependent-insert batch.

What is forbidden: "always batch expense + participants + tags on every request, including
retries," which can double-apply dependents or fight the composite PK when the parent already
exists from a prior attempt.

**Covered surfaces:** expense creation, settlement creation (the two genuinely dangerous
double-submit paths — a duplicated ₹500 expense or a duplicated settlement both silently corrupt
the ledger) and recurring-expense generation (already solved by `recurring_expense_log`'s unique
constraint, §12.3 — the highest-confidence part of the whole idempotency design because it's a
direct, already-shipped precedent).

**Explicitly not covered:** two genuinely separate submissions of the same logical expense (a
user manually re-enters an expense they forgot they'd already logged) — the app cannot and should
not try to distinguish this from two real expenses without real product judgment (fuzzy
same-amount/date/merchant matching). This is a deliberate V1 non-goal (§25), not an oversight.

---

## 18. Security Model

Every boundary below is enforced **server-side**; nothing is trusted from the client beyond what
Zod validates as well-formed input.

| Threat | Enforcement |
|---|---|
| IDOR on an expense/settlement/category ID | Every route re-derives `familyId` from the fetched row, then calls `requireFamilyMember` — never trusts a client-supplied `familyId` alone to authorize access to a specific resource ID (matches every existing route's pattern exactly). |
| Cross-family references (payer, participants, category, tags, subjectMemberId) | New guard functions in the style of `worker/lib/familyScope.ts` (`allMembersInFamily` reused as-is for participants/payer; new `allCategoriesInFamily`, `allTagsInFamily` following its exact shape) — checked before every write. |
| Private-expense leakage | `isExpenseHiddenFrom()`, a direct structural copy of `isDocHiddenFrom()`, applied to every list/get/receipt/report query touching an expense — 404, never 403 (§9). |
| Balance/settlement leakage | Not applicable by design — both are family-visible by the deliberate decision in §9, so there is no narrower boundary to enforce beyond "is an active member of this family." |
| Receipt leakage | Inherits the parent expense's visibility check before any Drive proxy call is made — same enforcement point as document downloads. |
| Settlement manipulation | Amounts always positive (§11 — no sign games to get wrong); reversal is a *new* row, never a mutation of history, so there is no "edit a settlement" surface to attack at all. |
| Participant manipulation | `expense_participants` writes always re-derive the sum invariant server-side (§5) — a client cannot submit shares that don't add up, regardless of `splitType`. |
| Category/recurring-template ownership | Both are `familyId`-scoped and admin+-gated for mutation (§10, §13) — same shape as invite/role-change gating. |
| Unauthorized admin operations | `requireFamilyMember(familyId, 'admin')`, the same primitive already used for invites and role changes — no new primitive introduced. |
| CSRF | Inherited automatically from the global `/api/*` middleware; explicitly re-applied (`csrfProtectGet`) on the one new safe-method route that touches file bytes. |
| Rate limiting | New `checkRateLimit` calls on receipt-upload-url (mirrors the existing 30/min document-upload limit) and settlement creation (a generous 60/hour abuse guard — money-adjacent but low natural volume). |
| Audit bypass | Every mutation in this feature calls `insertAuditEvent()` — no expense-tracker mutation is exempt, matching the blanket convention already enforced across every other resource. |

---

## 19. Testing Strategy

Prioritized by financial risk, not by feature checklist, per the task's explicit ranking. Real D1
integration tests (`tests/helpers/testEnv.ts`) for persistence/authorization, pure unit tests for
deterministic math, contract tests for route-shape, exactly the three existing test layers this
codebase already uses — no new testing infrastructure needed.

1. **Money/split calculations** — pure unit tests for `worker/lib/money.ts`, covering every row in
   the §5.2 table plus adversarial inputs: 1 participant (should be rejected upstream, but the
   pure function itself should never divide by zero or produce a negative share), very large
   amounts (overflow safety of `integer` in SQLite, which is 64-bit — confirm no realistic family
   expense approaches `2^63`), a single-minor-unit total split among many participants (some
   participants legitimately get `0` before the remainder pass — must never happen after it, since
   `shareMinor > 0` is required; if participants outnumber `total`, this must be rejected, not
   silently produce zero-shares — **new edge case surfaced in this pass**, added to §21).
2. **Split invariant property tests** — `Σ(shareMinor) === amountMinor` re-checked across many
   randomized `(total, participantCount)` pairs for `equal` and `(total, bp[])` pairs for
   `percentage`, not just the hand-picked table above.
3. **Balance calculations** — multi-expense, multi-member scenarios in real D1, with hand-computed
   expected `netBalance` values; explicit test of the "opposing debts net to one number" case from
   §7.1; explicit test of Cases A–D from §6.
4. **Settlement calculations** — partial vs. full settlement; reversal producing an exact-opposite
   net effect; a reversal-of-a-reversal correctly rejected (409, §16.1).
5. **Editing after settlement** — the exact ₹10,000/₹5,000/₹8,000 walkthrough from §11.1, scripted
   as a test asserting the balance flips exactly as computed.
6. **Privacy / family isolation** — extend `tests/authz-matrix.test.ts` with the expense
   dimension: personal expense hidden from a plain member, visible to owner/admin (per §9's
   decision); shared expense visible to a non-participant family member; cross-family ID rejection
   for payer/participant/category/tag.
7. **Recurrence deduplication** — cron run twice for the same due period produces exactly one
   expense (unique-constraint proof, mirrors `tests/reminders.test.ts`); a missed-cron scenario
   (simulate `nextRunDate` far in the past) produces exactly one generated occurrence, not a
   backfilled batch (§12.3); a monthly-31st template correctly clamps across Feb/Apr/Jun/Sep/Nov;
   editing a template after generation leaves past-generated expenses untouched.
8. **Idempotency** — duplicate `POST /expenses` and `POST /settlements` with the same
   `clientRequestId` return the same row, not a second one; omitted `clientRequestId` behaves
   exactly as today (no dedupe, no error).
9. **Contract tests** — 401/404/security-headers/content-type for every new route, in the exact
   style of `tests/events.test.ts`.

---

## 20. Edge Cases

Every case from the task's adversarial list, resolved (not merely listed), plus additional cases
surfaced during this pass.

| Case | Resolution |
|---|---|
| Zero amount | Rejected at validation (`amountMinor` must be `> 0`) for expenses and settlements alike. |
| Negative amount | Rejected — `amountMinor`/`shareMinor` are unsigned by schema convention; direction is always expressed via separate `from`/`to` or `paidBy`/`participant` fields, never via sign (§11). |
| Very large amount | SQLite `integer` is 64-bit; no realistic family expense approaches the limit. Validation still caps at a sane upper bound (e.g. `amountMinor < 10^13`, ~$100B) purely to catch fat-finger/overflow-adjacent input errors, not because the type needs it. |
| One-cent amount | Handled correctly by the remainder algorithm (§5.2, the ₹1/3 row) — every participant still gets `≥ 1` minor unit as long as `participantCount ≤ total`. |
| **New: participants outnumber total minor units** | E.g. splitting 2 paise across 3 people — impossible to give everyone `≥ 1`. Rejected at validation with a specific `validation_error` ("too many participants for this amount") rather than silently producing a zero-share participant, which would violate the `shareMinor > 0` invariant. |
| Uneven / 3-way / 10+ participant split | Covered by §5.1's deterministic remainder algorithm, which scales to any participant count. |
| Percentage rounding | Covered by §5.1–5.2; percentages must sum to exactly 10000bp or the request is rejected, never silently normalized. |
| Participant removed from family | Family-member rows are never deleted (§2) — historical `expense_participants` rows stay valid and correctly attributed forever; the removed member simply loses all access (§9). **Balance board retains any pair with a non-zero net involving them** (§7.2). |
| Payer removed | Same as above — historical `paidByMemberId` stays valid. New expenses cannot select a removed member as payer (centralized financial-actor helper at write time, §4.2). |
| Category archived | Archiving only affects the picker for *new* expenses; existing `categoryId` references are untouched (§13). |
| Category changed | Freely allowed, no financial effect (§11.2). |
| Expense trashed | Excluded from balance calculations the instant `status='trashed'` flips (§11.2). |
| Expense restored | New capability (§11.2); reinstates the expense and, by the derived model, automatically reinstates its contribution to balances — no separate "un-trash the balance" step needed. |
| Expense edited after settlement | Fully worked through in §11.1 — balance self-corrects, no lock, transparency via audit log. |
| Expense deleted after settlement | Same self-correcting behavior as an edit; trashing an expense that a settlement was based on can leave a balance non-zero in either direction — correct and expected, not an error state. |
| Settlement duplicated | Prevented by `clientRequestId` idempotency (§17) for the retry case; two genuinely separate manual entries are not auto-deduped (§17, explicit non-goal) — a family can always reverse one (§11). |
| Settlement reversed | First-class operation (§11, §16.1); reversal-of-a-reversal is rejected (409). |
| Recurring expense duplicated | Prevented structurally by `recurring_expense_log`'s unique constraint (§12.3). |
| Cron runs late | Range-based scan generates exactly the one currently-due period, no backfill (§12.3). |
| Cron runs twice | No duplicate, same unique-constraint mechanism (§12.3). |
| Two users edit the same expense simultaneously | D1/SQLite serializes individual writes; the *last write wins* at the row level (no optimistic-concurrency/version column proposed — matches every other resource in this codebase, none of which has one either). The audit log preserves both intents as separate `expense_updated` entries even though only the final state persists, so "what happened" is always reconstructable even if it wasn't preventable. |
| Two users settle simultaneously | Both settlements are independent append-only rows — no conflict is possible by construction; if this results in an accidental double-payment, the fix is a reversal (§11), not a merge/lock. |
| Request retried (network flake) | Covered by `clientRequestId` idempotency (§17). |
| Family deleted | **No such route exists today** (§2) — not a present risk. If ever added, `CLAUDE.md`'s explicit-multi-statement-cascade rule applies to every new table here exactly as it would to any other. |
| Member leaves family | Covered under "participant removed" above — historical data intact, access revoked immediately. |
| **New: all participants of a recurring template become inactive** | §12.6's per-generation re-validation could, in the worst case, leave zero active participants for a shared template. **Decision:** if fewer than 2 active `memberType='user'` participants remain for a `splitType != 'none'` template, skip generation for that period, log a warning to `audit_log`, and leave `active=true` (do not auto-pause) — a human should notice and either fix the template's participants or pause it deliberately, rather than the system silently stopping a bill reminder that's still relevant to the payer. |
| **New: `defaultCurrency` change requested while balances are non-zero** | Blocked per §8, with a clear error naming the unsettled pairs. |
| **New: exact-split shares include a participant twice** | Rejected — `expense_participants` has a composite PK `(expenseId, memberId)`; a client submitting the same `memberId` twice in one request is caught by application-level de-duplication before the insert, returning `validation_error` rather than a confusing DB constraint violation. |

---

## 21. Risks

| Risk | Mitigation |
|---|---|
| Float/precision bugs in money math | Integer minor units everywhere; one pure `lib/money.ts` module owns all split arithmetic; property-based unit tests (§19.2). |
| Split/rounding producing mismatched totals | Server never trusts client-computed shares for `equal`/`percentage`; hard invariant check + rejection for `exact`; the too-many-participants edge case explicitly guarded (§20). |
| `db.batch()` being a genuinely new pattern in this codebase | Scoped narrowly to expense/settlement writes only, with explicit rationale (§16.1) — not adopted as a blanket new convention that could confuse future contributors about which write style to use where. Local workerd atomicity verified in E-1 (§21.1). |
| Idempotent retry double-applying participants | §17 forbids re-batching dependents on `clientRequestId` conflict; create path inserts expense first (or relies on full-batch rollback), then dependents only on a fresh insert. |
| Removed-member debts vanishing from the board | §7.2 requires non-zero obligations involving removed members to remain visible until settled. |
| Recurring-expense cron double- or under-generating | Unique `(recurringExpenseId, periodKey)` constraint — a direct, already-shipped precedent (`digest_log`), the highest-confidence piece of this whole design. |
| Personal-expense privacy leaking via balances/reports | Balances/reports structurally exclude `splitType='none'` rows (they never create `expense_participants` rows in the first place) — not a filter that could be forgotten, but a structural impossibility. |
| Scope creep (budgets, debt-simplification, multi-currency, pool, income) | Explicitly deferred with reasoning in §24 — not implicitly implied anywhere else in this document. |
| New tables regressing the 21-table/4-migration baseline | Purely additive migration; one nullable-safe new column on `families`; `validate_migrations.py` + the `db-migration` skill catch structural mistakes before they ship. |
| Settlement correction ambiguity | Resolved decisively: append-only + linked reversal rows, no edit, no delete, no negative amounts (§11). |
| Personal-expense visibility decision (§9) is a genuine judgment call | Flagged explicitly for product sign-off rather than silently assumed — see the callout in §9. |
| Recurring template participant drift (§12.6, §20) | Explicit degrade-gracefully rule with an audit trail, rather than either silently failing or silently over-including stale members. |
| Family left without owner/admin | E-1 closes self-demotion/self-removal lockout on `PATCH /families/:id/members/:mid` (`last_owner_or_admin`). Ownership *transfer* (promote-to-owner) is still absent — see residual note in §21.1. |

### 21.1 E-1 foundation verification notes

**Owner/admin lockout (implemented in E-1, application code — not expense tables):**
`PATCH /families/:id/members/:mid` rejects any role/status change that would leave the family
with zero active members in `{owner, admin}` (`409 last_owner_or_admin`). Existing semantics
preserved: non-owners still cannot modify an owner (`cannot_modify_owner`); multi-admin
families can still demote/remove peers when another privileged member remains.

**Residual (out of E-1 scope, reported not expanded):** there is still no API to *promote* a
member to `owner` (invite/update Zod only allow `admin|member`). A sole owner may demote
themselves to `admin` (still a viable admin under the lockout rule), after which the family has
no `role='owner'` membership until a future ownership-transfer feature exists.
`families.ownerUserId` is a separate field and is not rewritten by member-role PATCH today.

**D1 `batch()` atomicity — what was tested (E-1):**

| Item | Detail |
|---|---|
| What was tested | `env.DB.batch([INSERT ok, INSERT ok, INSERT NOT NULL fail])` then `SELECT` remaining rows |
| Where | Local **Miniflare / workerd D1** via `scripts/verify_d1_batch_atomicity.mjs` (same local D1 engine used by `wrangler d1 --local`). Also confirmed `wrangler d1 execute --local` works in this environment. |
| Proven | On statement failure, the batch throws and **no partial earlier writes remain** (`remainingRows: []`). `drizzle-orm/d1`'s `db.batch()` delegates to `this.client.batch(...)`, so app-level `db.batch()` rides the same primitive. |
| Explicitly NOT proven | **Remote Cloudflare-hosted D1** (no `CLOUDFLARE_API_TOKEN` / real `database_id` in this agent environment — `wrangler d1 execute --remote` refused). |
| Must not be confused with | `tests/helpers/testEnv.ts` `batch()` — a sequential `for` loop over `node:sqlite` with **no transaction**. A deliberate contrast probe showed partial rows remaining after a mid-sequence failure. **Integration tests using that adapter do not prove D1 atomicity.** |
| Environment required for remote proof | Cloudflare account token + real D1 database binding; run an equivalent Worker/`wrangler` probe against `--remote` (or production-like) D1 and assert the same rollback property. |

No general transaction abstraction was introduced — only this verification script and the
documented constraint that future expense participant writes use scoped `db.batch()`.

---

## 22. Final Implementation Phases

Each phase is independently testable and deployable — no giant feature branch. **E-1 hardens
membership + proves D1 batch assumptions before any financial schema lands. E0 then establishes
the financial foundation before any UI CRUD exists**, per the explicit instruction not to rush
into screens first.

### E-1 — Foundation reliability (prerequisite; no Expense Tracker code)
- **Goal:** close family owner/admin lockout; empirically verify D1/workerd `batch()` atomicity (or document gaps honestly); fold architecture-review corrections into this specification.
- **Main changes:** lockout guard on `PATCH /families/:id/members/:mid`; `scripts/verify_d1_batch_atomicity.mjs`; documentation updates in this file only. **No expense tables, routes, UI, or money math.**
- **Tests:** focused regression suite for sole-owner lockout, valid transitions, multi-admin cases; existing authz suites remain green.
- **Dependencies:** none.
- **Acceptance criteria:** sole privileged member cannot demote/remove themselves into an admin-less family; D1 batch findings documented per §21.1; gate green; **STOP for explicit approval before E0.**

### E0 — Financial domain foundation
- **Goal:** the money/split/balance math exists, is proven correct, and is fully unit-tested — with zero UI, zero routes, zero user-facing surface yet.
- **Main changes:** `worker/lib/money.ts` (equal/exact/percentage split calculators + the §5.1 remainder-distribution primitive); centralized financial-actor helper stub/module per §4.2 (eligibility only — no expense CRUD yet if preferred, or introduced with schema); the new schema tables from §15 + migration + `validate_migrations.py`; no routes registered yet (schema exists, unreachable via API). Common-pool seam documented only (§4.4) — **not implemented**.
- **Tests:** the full §19.1–19.2 suite (pure unit + property tests) against `lib/money.ts` in isolation. This is the phase where "±1 cent" bugs get caught, before any real data can be created through the API.
- **Dependencies:** E-1 approved.
- **Acceptance criteria:** every row of the §5.2 worked-examples table passes as a test case; the `Σshares === total` property test passes across ≥1,000 randomized inputs for `equal` and `percentage`; migration validates cleanly; `typecheck`/`lint`/`build` green (nothing to run for `test` beyond the new pure-function suite, since no routes exist yet).

### E1 — Personal expenses
- **Goal:** a family member can log, view, edit, trash, and (optionally) restore a personal expense with a category.
- **Main changes:** `worker/routes/expenses.ts` (CRUD, `splitType='none'` only), `worker/routes/expenseCategories.ts` (seeded built-ins + family custom + archive); `isExpenseHiddenFrom()`; frontend `Expenses` list + `ExpenseForm` + `ExpenseDetail` built from the existing `ui/` kit; a "This month" widget on `Dashboard.tsx`.
- **Tests:** contract tests (401/404/headers, mirroring `tests/events.test.ts`); integration CRUD + `isExpenseHiddenFrom` visibility (owner/admin bypass per §9); category archive blocked while referenced.
- **Dependencies:** E0.
- **Acceptance criteria:** a member can add/edit/trash a personal expense; it's invisible to a plain other member but visible to owner/admin and the creator; a `family`-visibility personal expense is visible to everyone; categories archive without breaking existing references; full `gate` skill (typecheck/lint/test/build + migration validation) green.

### E2 — Shared expenses & splits
- **Goal:** expenses can be split equal/exact/percentage across ≥2 active user-members.
- **Main changes:** `expense_participants` writes wired into create/update (with the scoped `db.batch()` from §16.1); split UI on `ExpenseForm`; participant breakdown on `ExpenseDetail`; the ≥2-participant and cross-family guards from §5/§18.
- **Tests:** Cases A–D from §6, scripted exactly; the too-many-participants and duplicate-participant edge cases from §20; extended authz matrix for shared-expense edit/delete authorization (§10).
- **Dependencies:** E1.
- **Acceptance criteria:** all three split types produce `Σshares === amountMinor` in every test case including the adversarial ones; a non-payer participant can see and edit a shared expense; delete stays restricted to payer/creator/admin+.

### E3 — Balances & settlements
- **Goal:** the family can see who owes whom and record real settlements, including reversal.
- **Main changes:** `GET /families/:id/balances` (§7.2), `worker/routes/settlements.ts` (record + reverse, `clientRequestId`), Balances + Settle-up screens, Dashboard "Outstanding balance" chip.
- **Tests:** the §11.1 edit-after-settlement walkthrough scripted verbatim; the §7.1 opposing-debts-net-to-one-number case; reversal correctness and reversal-of-reversal rejection; idempotent double-submit of a settlement.
- **Dependencies:** E2.
- **Acceptance criteria:** `netBalance` always equals `Σshares − Σsettlements` exactly across a scripted multi-expense, multi-settlement, mid-sequence-edit scenario; no code path ever computes or caches a balance outside the single `GetBalances` implementation.

### E4 — Receipts, tags, search/filter
- **Goal:** attach receipts, tag expenses, find things fast.
- **Main changes:** `expense_receipts` + Drive two-step routes (mirrors `documents.ts`); `expense_tags` join reusing `tags`; `GET /expenses` query params (date range, category, member, tag, scope, amount, text search).
- **Tests:** upload/record/download contract + visibility gating (a private expense's receipt unreachable by direct URL even with a valid file ID); search wildcard-sanitization test copied from `documents.ts`'s pattern; tag reuse doesn't leak between documents and expenses.
- **Dependencies:** E1 (E2/E3 not required — could ship in parallel with either).
- **Acceptance criteria:** a receipt on a private expense is unreachable by any non-owner, non-admin account; search/filter combinations return correct, family-scoped, visibility-filtered results.

### E5 — Recurring expenses
- **Goal:** auto-generate expenses on a schedule (rent, subscriptions), safely.
- **Main changes:** `recurring_expenses` + `recurring_expense_log`; `worker/lib/recurringExpenses.ts` (`runRecurringExpenses(env)`, mirroring `cron.ts`'s structure), wired into `scheduled()`; CRUD + pause/resume routes; Recurring-expenses screen.
- **Tests:** the full §12 suite — monthly-31st clamping across every affected month; single-generation-per-period under simulated missed and duplicate cron runs; template edits leaving past generations untouched; the §12.6/§20 participant-drift and all-participants-inactive cases.
- **Dependencies:** E1–E2 (generated expenses can be personal or shared).
- **Acceptance criteria:** a monthly template generates exactly one expense per calendar month even under repeated/concurrent/delayed cron invocation; deactivating stops future generation without touching history; a 31st-of-the-month template correctly clamps through Feb/Apr/Jun/Sep/Nov for at least one full simulated year in tests.

### E6 — Reports & notifications
- **Goal:** give the family a trustworthy financial picture and proactive, non-annoying nudges.
- **Main changes:** `GET /expenses/reports` (monthly/category/member aggregates); Reports page (trend, category/member breakdown); reuse `notify`/email infra (§2) for recurring-generation confirmations and (if desired) outstanding-balance nudges, gated by existing `reminder_prefs`.
- **Tests:** report aggregation correctness against seeded multi-month data; notification dedupe if periodic (reuse the log-table idiom).
- **Dependencies:** E1–E5.
- **Acceptance criteria:** monthly totals and category/member breakdowns match hand-computed values for a seeded dataset; notifications respect existing per-user email/push preferences and are never sent twice for the same fact.

---

## 23. Acceptance Criteria Summary

Every phase above carries its own acceptance criteria; the feature as a whole is not "done" until
all of E0–E6 are green under the project's existing `gate` skill (typecheck, lint, test, build,
migration validation) **and** every edge case in §20 has a corresponding passing test, not just a
documented resolution.

---

## 24. Explicit List of Things We Are Intentionally NOT Building Yet

| Not building now | Why |
|---|---|
| **Budgets** (per-category/monthly, threshold alerts) | Additive on top of a *working, trusted* ledger; needs real months of aggregation data to validate against; shipping it before balances are proven in production risks compounding two unverified systems at once. |
| **Income / salary tracking** | Out of V1 expense-ledger scope; would introduce earn-side flows, pay cycles, and different privacy expectations before the spend/split model is proven. Explicitly deferred by architecture review. |
| **Family contributions** (members funding a shared pot) | Depends on a pool/common-fund concept; only an architectural seam is reserved (§4.4) — no contribution UX or schema in E0–E6. |
| **Savings goals** | Separate product surface from shared-expense balances; deferred until the core ledger is trusted. |
| **Family / common pool (implemented)** | Seam only (§4.4). No pool tables, balances, or payer sentinels in V1. |
| **Multi-currency / FX conversion** | The task's own stated preference; §8 confirms single-currency-per-family is sufficient and safer for V1; introducing conversion multiplies the ways the ledger can silently become wrong. |
| **Debt simplification** ("minimum cash flow" / "who should pay whom to settle everyone at once") | Changes *who* the UI tells someone to pay in a way that can surprise users if introduced before the plain pairwise model is trusted; safer as a later, opt-in view once §7's model has a track record. |
| **Smart duplicate-expense detection** (fuzzy same-amount/date/merchant matching) | Explicitly scoped out in §17 — requires real product judgment about false positives that hasn't been made yet; the idempotency mechanism already prevents the *mechanical* duplicate case (retries), which is the actual risk this feature needs to close for V1. |
| **Per-family "not even admin can see personal expenses" privacy toggle** | Noted as a plausible future refinement in §9's decision callout; not needed if the recommended default (reuse `isDocHiddenFrom`) is accepted. |
| **`hidden_global_categories` override table** (per-family suppression of a built-in category) | Deferred per §13 — a small, additive follow-up if real demand appears; not worth the schema surface for a first release. |
| **Generic HTTP `Idempotency-Key` middleware** | The app has no precedent for this pattern anywhere; §17's `clientRequestId`-on-the-row approach solves the same problem using an idiom the codebase already trusts, without adding new cross-cutting middleware. |
| **Family-deletion cascade for expense tables** | No `DELETE /families/:id` route exists at all today (§2) — nothing to cascade into yet; flagged as a future obligation under `CLAUDE.md`'s existing golden rule if that capability is ever added. |
| **Optimistic-concurrency / row versioning on expenses** | No other resource in this codebase has it either (§20, "two users edit simultaneously"); last-write-wins plus a complete audit trail is the existing convention, and this feature doesn't introduce a new consistency model unilaterally. |
| **Rotating "who eats the rounding cent" fairness scheme** | Noted as a plausible V2 refinement in §5.1; the deterministic-but-arbitrary V1 rule already satisfies the only invariant that actually matters (the sum). |
| **Ownership transfer / promote-to-owner API** | E-1 prevents admin-less lockout but does not add promote-to-owner; tracked as residual in §21.1. |

---

## 25. Self-Review

Answering the task's own challenge questions directly, as a final check before handing this off.

- **What could force a redesign in six months?** Most likely candidate: the personal-expense
  privacy decision in §9, if the family's real usage reveals the "admin sees everything" default
  is wrong for them. It's flagged, not buried, specifically so it can be revisited without
  touching the schema (it's a query-time policy, not a stored fact — cheap to change later).
- **What financial rule is still ambiguous?** None of the core money/split/balance rules — those
  are pinned down with worked examples. The one deliberately-left-open policy question is §9's
  privacy default, which is explicitly marked as needing confirmation rather than silently
  resolved.
- **What happens if two users perform conflicting operations?** Covered in §20 — last-write-wins
  at the row level (matching every other resource in the app), full audit trail of both intents,
  no new concurrency model invented.
- **What happens if the mobile client retries a request?** `clientRequestId` idempotency (§17) —
  the retry returns the original row, never a duplicate.
- **What happens after a settlement and then an expense edit?** Fully worked through in §11.1 —
  the balance self-corrects because it's derived, never cached; nothing is corrupted, only
  updated, and the audit log always explains why.
- **Can one family member ever see another family's financial data?** No new mechanism is
  introduced that bypasses `requireFamilyMember` or the cross-family guards in `familyScope.ts` —
  every new table's writes are checked against the caller's `familyId` before being persisted
  (§18), the same way every existing resource already works.
- **Can a balance become mathematically inconsistent?** Not by construction — there is exactly one
  formula (§7), computed live, with no cached/stored counterpart that could drift from it.
- **Can a recurring expense be generated twice?** No — `unique(recurringExpenseId, periodKey)`
  makes it structurally impossible, using a mechanism already proven in production three times
  over (§12.3).
- **Can a deleted/archived object leave orphaned financial data?** Trashing an expense removes its
  contribution to balances without deleting any row (nothing to orphan); archiving a category
  never invalidates existing references (§13); family-member "removal" never deletes the row that
  financial data points to (§2, §15.2) — there is no deletion path anywhere in this feature that
  removes a row another row still points to.
- **Are we building something the existing Family App doesn't need?** Every new piece of
  infrastructure was checked against what already exists first (§2), and reused wherever
  possible: Drive upload/download, notifications/email, the `tags` table, the audit log, the
  reminder-dedupe idiom, the cross-family guard pattern, the private-visibility pattern, the
  replace-attendees-on-update idiom. The only genuinely new mechanisms introduced are the ones
  this domain cannot avoid needing — money math, the balance formula, append-only settlements,
  the recurrence calendar rules, and a narrowly-scoped `db.batch()` for participant-write
  atomicity — each justified individually above rather than assumed.

---

**STOP.** E-1 foundation reliability (lockout fix + D1 batch verification + this specification
update) is the current deliverable boundary. No expense schema, migration, route, UI, money
math, balances, settlements, receipts, or reports have been implemented as part of E-1. Do not
proceed to E0 until explicitly approved.
