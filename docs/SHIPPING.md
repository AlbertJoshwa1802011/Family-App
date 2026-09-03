# Family Vault — Shipping Standard

> **Purpose.** This is the playbook for getting a change from idea → production **without the
> iteration churn** that burned a prior project. The rule: *front-load the gates*. Every
> ambiguity, edge case, and acceptance criterion is decided **before** code is written, not
> discovered in review round 4. If a step here feels slow, that is the point — it is cheaper
> than a re-open.
>
> Pair with: `CLAUDE.md` (build rules), `ARCHITECTURE.md` (the why), `PRODUCTION_READINESS.md`
> (the prod scorecard), `UI_UX_AUDIT.md` (UI standards).

---

## 0. One change = one phase = one PR = one deploy

Never bundle phases. A PR that touches the vault crypto **and** the responsive shell **and** a
new module is unreviewable and un-rollback-able. Each phase from `PLAN.md` ships as its own
branch → PR → deploy → prod-verify cycle. Small, additive, reversible. The 14-task roadmap is
explicitly sequenced so each phase is independently shippable.

---

## 1. Before writing code — the spec gate

Do not open an editor until these are written down (in the PR description or an issue):

- [ ] **Scope sentence.** One sentence: what this change does and does *not* do.
- [ ] **Acceptance criteria.** Bullet list of observable behaviors that must be true when done.
      A reviewer checks these, not vibes.
- [ ] **Edge cases enumerated.** Empty state, max length, wrong type, unauthorized actor,
      concurrent edit, offline, slow network, missing optional binding (R2/Resend absent).
- [ ] **Security/privacy impact.** New PII? New visibility surface? New auth boundary? If yes,
      name the test that proves it (see §4).
- [ ] **Irreversibility check.** Does this touch a one-way door (schema shape, crypto scheme,
      key hierarchy, token format)? If yes, it must match a locked decision in `ARCHITECTURE.md`
      (D1–D12). If it contradicts one, **stop and escalate** — do not migrate silently.

---

## 2. Definition of done — the green gate (every change)

From `CLAUDE.md §1`. All must pass locally before push:

```bash
npm run typecheck && npm run lint && npm run test && npm run build
# same thing:
npm run gate
```

If the schema changed, also:

```bash
npm run db:generate
python3 scripts/validate_migrations.py    # catches the INSERT...SELECT recreation gotcha
```

**A pre-existing red test is still a red gate.** If a test was already failing (e.g. the IST
timezone case), it must be fixed or explicitly quarantined with a tracked task — never waved
through as "not mine." A green suite is the contract.

---

## 3. Schema & migration safety (one-way door)

- Edit `worker/db/schema.ts` only; never hand-write migrations (the one exception: fixing a
  drizzle-kit codegen bug in a *just-generated, never-applied* migration — `CLAUDE.md §6`).
- After `db:generate`, **read the generated SQL**. Confirm:
  - [ ] No unexpected `DROP TABLE` / table-recreation (`__new_*` + `INSERT...SELECT`). Additive
        `ADD COLUMN` and `CREATE TABLE`/`CREATE INDEX` are safe; recreations on a populated table
        risk data loss and the new-column INSERT gotcha.
  - [ ] New columns are nullable or have defaults (so existing rows survive).
  - [ ] Indexes exist for every new hot query path (audit feeds, blind-tag lookups).
- Prod apply is **separate from deploy** and runs first: `wrangler d1 migrations apply
  family-vault-db --remote`. Verify pending list with `... migrations list --remote` beforehand.

---

## 4. Security review gate

A change that adds a route, a field, or a key path does not pass until:

- [ ] Every `/api/*` mutation validates input with Zod (exact `validation_error` shape).
- [ ] Family-scoped routes check membership **before** any read/write.
- [ ] Private-visibility filter applied server-side (`visibility='family' OR owner=me OR
      role IN (owner,admin)`) — never trust the client. Dedicated authz-matrix test required.
- [ ] **Vault invariant:** the Worker stores only opaque ciphertext/wrapped blobs + blind tags.
      No server decrypt path, ever. A test greps a dumped row for any plaintext secret and
      asserts it is absent.
- [ ] Sensitive actions write an `audit_log` row (`severity: security` where applicable).
- [ ] Non-admin hitting `/api/admin/*` gets **404, not 403** (namespace non-disclosure).
- [ ] No secret/token reaches the browser; no `/api/*` response is runtime-cached by the SW.

---

## 5. UI/UX acceptance gate (do not skip — this is where churn lives)

A screen is not "done" when it renders. It is done when all of these hold. Verify with the
`mcp__Claude_Preview__*` tools (resize + screenshot) at three widths.

- [ ] **States:** loading skeleton, empty state, error state, and populated state all designed
      and present. No raw spinner-only screens; no "flash of empty" before data.
- [ ] **Responsive:** correct at `sm` (≈360px phone), `md` (tablet), `lg+` (desktop). Nav morphs
      (tabs → rail → sidebar). **No horizontal body scroll at any width.** Wide content
      (tables, code, diagrams) scrolls inside its own container.
- [ ] **Theme:** legible and correct contrast in **both** dark and light (`data-theme`).
- [ ] **Simple/Elder mode:** usable at `data-density="elder"` — type scale up, AAA contrast,
      ≥56px tap targets, clutter hidden via the `elder:` variant. Composition with theme ×
      breakpoint must not break layout.
- [ ] **Accessibility:** keyboard reachable, visible focus ring, `aria-live` for async results,
      labels on icon-only buttons, AA contrast minimum, honors `prefers-reduced-motion`. Passes
      at 200% browser zoom.
- [ ] **Tap targets** ≥44px (≥56px in elder). Safe-area insets respected on phone.
- [ ] **Reuse** `src/components/ui/*` primitives; do not hand-roll markup that already exists.
- [ ] **Voice parity (when applicable):** every spoken response also shown as a caption; a secret
      is never auto-spoken — confirm-before-speak, on-device TTS only, re-masked + audited after.

---

## 6. Deploy runbook (production)

Preconditions: §2 green, §3–§5 gates passed, change merged to `main` (or deploying the reviewed
branch knowingly). `wrangler whoami` authenticated.

```bash
# 1. Apply pending migrations to the REMOTE D1 first (additive only; review the pending list).
npx wrangler d1 migrations list  family-vault-db --remote
npx wrangler d1 migrations apply family-vault-db --remote

# 2. Build + deploy the Worker (serves SPA + /api).
npm run deploy        # = npm run build && wrangler deploy

# 3. Verify in production (see §7) BEFORE declaring success.
```

Order matters: **migrate before deploy** so new code never queries a column that does not yet
exist on prod. All migrations must be backward-compatible with the *currently-deployed* code for
this ordering to be safe (it is, when additive).

---

## 7. Production verification (the change is not "done" until this passes)

- [ ] `GET /api/health` → `{ ok: true }`.
- [ ] An auth-gated route without a session → `401 unauthorized` (proves middleware live).
- [ ] An unknown `/api/*` path → `404 not_found` JSON (not the SPA `index.html`).
- [ ] The new feature's happy path exercised against prod (smoke), and one edge case.
- [ ] Security headers present on `/api/*` and static assets (CSP, nosniff).
- [ ] No errors in `wrangler tail` during the smoke test.
- [ ] For UI changes: load the prod URL at phone + desktop width; confirm §5 holds live.

Record the deployed version id and the prod URL in the PR.

---

## 8. Rollback

- **Worker code:** `wrangler rollback` (or redeploy the previous git tag). Worker rollback is
  near-instant and is why each deploy must be a small, isolated change.
- **Schema:** there is no automatic down-migration. Additive changes are forward-safe and need no
  rollback. **Never** ship a destructive migration without a tested, written restore path and an
  explicit backup taken first.
- If a deploy breaks prod: roll back the Worker first (restore service), *then* diagnose. Do not
  debug forward on a broken prod.

---

## 9. After shipping

- [ ] Update `CLAUDE.md §11` (current state) and the relevant `docs/*` if behavior/architecture
      changed. Stale docs are how the next agent relives a solved problem.
- [ ] Add any new hard-won gotcha to `CLAUDE.md §6`.
- [ ] Capture durable understanding (root cause, decision, gotcha) to `~/Albert-memory/` per the
      capture gate — not transient detail.
- [ ] Close or update the roadmap task.
