# Family Vault — Implementation Plan

A phased plan. Phase 0 is the scaffold (this session). Later phases are sized for incremental,
reviewable PRs. Each phase ends with: code review → security pass → tests → manual verification.

---

## Phase 0 — Scaffold & Foundations  ✅ (this session)

**Goal:** A runnable skeleton that builds, lints, type-checks, and deploys, with the full
project structure and stubbed routes — no real Google/Drive integration yet.

- [x] Repo structure: `src/` (React), `worker/` (Hono), `migrations/`, `docs/`.
- [x] `package.json` with scripts (dev, build, lint, typecheck, test, db:migrate, deploy).
- [x] `wrangler.jsonc` with D1 + KV bindings + cron trigger + static assets.
- [x] `vite.config.ts` with React + `@cloudflare/vite-plugin` + vite-plugin-pwa.
- [x] TypeScript, ESLint, Prettier, Vitest config.
- [x] Tailwind setup; base layout, theme, app shell.
- [x] Hono worker with `/api/health`, stubbed `/api/auth/me`, `scheduled()` stub.
- [x] D1 initial migration (full schema) + Drizzle schema + typed `Env`.
- [x] React shell: router, pages (Login, Dashboard, Documents, Document detail, Family, Settings),
      TanStack Query provider, auth context (mocked), PWA register + update toast.
- [x] PWA manifest + placeholder icons.
- [x] `.dev.vars.example`, `.gitignore`, `README.md` (setup + Google Cloud + Cloudflare steps).
- [x] GitHub Actions CI (typecheck, lint, build, test).
- [x] Seed script / sample data for local dev.

**Acceptance:** `npm install` → `npm run typecheck && npm run lint && npm run build && npm test` all pass.

> Phase 0 also wires **basic observability from day one** (structured Worker logs + an error hook),
> not deferred to hardening.

---

## Phase 0.5 — Drive Auth Spike (de-risk before building UI breadth)

The whole storage model rests on two unproven assumptions; prove them with a throwaway script
**before** Phase 2:

1. **`drive.file` durability across re-consent:** create a folder + file with the owner refresh
   token → revoke consent → re-consent (new refresh token) → confirm the old files are still
   readable/writable. If they are NOT, switch the storage model (Shared Drive, or accept `drive`
   scope + verification) before writing more code.
2. **Token-refresh + single-flight:** confirm refresh-token → access-token exchange, KV caching
   (~55 min TTL), and the single-flight lock under concurrent misses.
3. Confirm multipart (small) + resumable (large) upload and the `alt=media` download proxy stream.

Smallest valuable end-to-end slice (validates the riskiest paths early):
**login → create family → upload one file → see it in the list → download it.**

---

## Phase 1 — Auth & Families

- Real Google OAuth (Auth Code + PKCE), ID-token verification with `jose`.
- Session creation (D1 + cookie), `/auth/me`, logout, route guards.
- Create family (provisions a Drive folder via owner credentials), list families, switch family.
- Family members + roles (owner/admin/member); email invites (Resend) + accept flow.
- Tests: token verify, session lifecycle, membership authz.

## Phase 2 — Documents & Drive Storage

- Owner Drive credential plumbing: refresh-token → access-token cache in KV; helper client.
- Create/edit/list/soft-delete document metadata; categories, tags, subject member, visibility.
- File upload to Drive (multipart small, resumable large) into the family folder.
- Download proxy with authz; thumbnails/preview where possible.
- Search & filters (category, expiry window, person, text); dashboard widgets.
- Tests: upload/download happy + authz-denied paths; Drive client unit tests (mocked fetch).

## Phase 3 — Reminders & Notifications

- `reminder_prefs` per user (channels + windows).
- Daily cron: scan expiring docs, create in-app notifications, send Resend emails, dedupe via `reminders_log`.
- In-app notification center (polling), unread badge, mark-read.
- Email templates (expiring soon, expired, weekly digest).
- Tests: cron windowing logic, dedupe, email sender (mocked).

## Phase 4 — PWA polish & offline

- Workbox runtime caching (SWR for lists), offline fallback page, install prompt UX (incl. iOS instructions).
- Update-available toast; offline indicator; cache document metadata for offline viewing.

## Phase 5 — Hardening & Quality

- Security review (authz matrix, OWASP pass, secrets, CSP, rate limiting, audit log).
- Accessibility pass (a11y), responsive/mobile, loading/empty/error states.
- E2E happy-path tests; performance budget; observability (logs, error tracking).

## Phase 6 — Future (post-MVP)

- WhatsApp reminders (Meta Cloud API, templates).
- Web push notifications (secondary channel).
- Shared Drive / sharding for scale; file versioning UI; OCR + auto-extract expiry dates.
- 2FA, encryption-at-rest envelope for sensitive metadata, GDPR export/delete.

---

## Proposed Family-Sharing Feature Set (for review/iteration)

Core (MVP, Phases 1–4):
1. Google login; multi-family support; switch active family.
2. Roles: **Owner** (billing/Drive), **Admin** (manage members + all docs), **Member** (own + family-shared docs).
3. Email invites with expiring tokens.
4. Document categories: Passport, ID, Driving License, Insurance, Vehicle, Property, Medical,
   School/Education, Warranty, Financial, Utility/Bills, Travel, Other.
5. Per-document **subject member** ("this passport belongs to child Aanya").
6. Visibility: **family-shared** vs **private** (only uploader + admins).
7. Expiry + issued dates; multi-window reminders (30/7/1 days, configurable).
8. In-app notifications + email reminders.
9. Search/filter; dashboard (upcoming expiries, recently added, storage used).
10. Soft delete (trash) + restore.
11. Audit log (who did what).

Enhancements (proposed, prioritized after review):
- **Keep — data model already implies these:**
  15. **Multiple files / versions** per document (old + renewed) — `current_file_id` + `files.is_current`.
  16. **Tags & smart collections** (e.g. "Vehicle: Honda City" groups RC + insurance + PUC) — `document_tags`.
  12. **Family calendar view** of all expiries.
  20. **Per-member dashboards** ("things expiring for Dad").
  17. **Quick-add via photo** (mobile camera → upload) — high family value, low risk.
- **Defer (post-MVP / scope-creep):**
  13. Emergency info card (key contacts, blood groups, allergies) — separate data domain.
  14. Shared checklists / tasks.
  18. OCR expiry auto-extract (heavy; future).
  19. Weekly digest email — model Resend volume first (3k/mo free cap).
  21. Export/backup (user-facing) — distinct from ops backup (P2 below).
  22. **Guest/read-only share via expiring link — defer; reintroduces public-token + CSRF surface**
      (same hardening as invite tokens; hash tokens, single-use, short expiry).

> **Operational backup (P2, ops not feature):** periodic D1 export + a Drive⇄metadata reconciliation
> job, since the two stores can diverge. Distinct from user-facing export (#21).

---

## Roles, Privileges & Segmentation Roadmap

What exists today and the plan for "many users, different privileges,
enterprise-style segmentation".

### Already implemented (and tested)

- **Tenant isolation by family.** Every resource is family-scoped; every route
  checks active membership before reading or writing. Cross-family references
  (attendees, assignees, linked docs) are rejected. A user can belong to many
  families and switch between them (persisted active-family selector).
- **Three roles**: `owner` (full control, cannot be demoted by others),
  `admin` (sees everything incl. private docs, invites members, manages roles),
  `member` (family-visible data + own private data only).
- **Row-level visibility**: `documents.visibility = family | private`,
  enforced server-side on every read AND write surface; covered by the
  authz-matrix test suite. Private-doc reminders go only to the doc owner.
- **Email-bound, single-use, expiring invites** with role selection.
- **Dependents** (children/elders without accounts) as first-class members.
- **Audit log** written on create/upload/download/delete/role-change,
  surfaced as the family activity feed.

### Next steps, in order of leverage

1. **Per-member document scoping UI** — `documents.subject_member_id` exists;
   add "belongs to" picker in DocumentForm + a member-profile page filtering
   documents by subject. (Schema done; pure UI work.)
2. **Member management UI** — role change + remove member (PATCH endpoint
   exists and is admin-gated; needs frontend on the Family page).
3. **Per-document ACLs** — a `document_shares (document_id, member_id, level)`
   table to grant specific members access to an otherwise-private doc
   ("share my passport with mum only"). Extends `visibilityWhere()` with an
   EXISTS subquery; add matching authz-matrix rows.
4. **Custom roles / permission matrix** — if families need finer grants than
   the 3-role ladder (e.g. "can add but not delete"), introduce a
   `role_permissions` lookup checked by `requireFamilyMember(minPermission)`.
   Keep the 3 built-ins as presets.
5. **Session & device management** — sessions table already stores user-agent;
   add "active sessions" list + revoke ("log out everywhere") in Settings.
6. **Org-level segmentation (true enterprise)** — if this ever serves
   organizations rather than families: add an `orgs` table above families,
   per-org Drive (Shared Drive), per-org admin console, and SSO (Google
   Workspace domain-wide). The family-scoping pattern generalizes directly.

---

## Multi-Agent Execution Strategy (for build phases)

When implementing each phase, dispatch in parallel where independent:
- **Builder agents** — feature slices (e.g. auth, drive client, reminders) on the feature branch.
- **Reviewer agent** — code review each slice (correctness, security, simplicity).
- **Test agent** — write/extend unit + integration tests; run the full suite.
- **Security agent** — authz matrix + OWASP pass per phase.
- **Verifier** — manual flow: build, run locally, exercise the happy path.

Cadence per phase: plan → build → review → fix → test → security → verify → commit/push.
