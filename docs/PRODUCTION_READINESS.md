# Family Vault — Production Readiness

Honest assessment of where the product stands. Read with `CLAUDE.md` and
`docs/FEATURES.md`. History note: the original Phase-0 assessment (request
pipeline load-tested at 14.8k req/s, zero errors across 20k mixed requests —
see `tests/stress.test.ts`) still holds; everything below reflects the shipped
product on top of that foundation.

> **Headline: live in production.** Auth, documents + Drive, reminders, chat,
> calendar integration, email reports, and the security hardening layer are
> implemented, tested (270+ tests), and deployed. Remaining work is polish and
> scale-hardening, not core functionality.

---

## 1. Scorecard

| Dimension | Score | Notes |
|---|---:|---|
| Build/dev toolchain | 100% | Pinned vite/CF-plugin/PWA triangle; one-command dev incl. seeded multi-user sessions (`npm run dev:seed`) + screenshot tooling |
| Database schema | 95% | 23 tables, 5 validated migrations; dependents, chat, digest dedupe modeled |
| Backend business logic | 90% | Auth (PKCE), sessions, families/invites, documents+Drive proxy, events/tasks/contacts, chat+mentions, reminders+digest cron — all real D1. Drive `drive.file` durability spike still unproven |
| Security posture | 90% | CSRF Origin/Referer, KV rate limits, private-doc enforcement on every surface (authz-matrix-tested), cross-family guards, email-bound invites, session lifecycle + purge. Remaining: Drive-token SPOF alerting, purge cron for trashed Drive bytes |
| Frontend completeness | 90% | All flows wired to live data; Instagram-style nav, activity badge, chat UI; verified via live multi-user run + mobile screenshots |
| Test coverage | 85% | Contract + real-D1 integration + authz matrix + CSRF/rate-limit + deep regression + stress. Missing: component tests, browser E2E in CI |
| Deployment & ops | 75% | Merge-to-deploy pipeline live; CI gate incl. migration validation; runbook (`docs/DEPLOYMENT.md`). Migrations are a manual post-merge step; no alerting/dashboards yet |
| Documentation/knowledge | 95% | CLAUDE.md + docs/* + `.claude/skills/` — a new agent can onboard from the repo alone |

---

## 2. Production checklist

### ✅ Done (shipped + tested)
- [x] Google OAuth (Auth Code + PKCE), jose ID-token verify, real sessions in D1 (rotate/idle/absolute/purge/logout-revoke)
- [x] Family CRUD + email-bound single-use invites (+ HTML invite email) + roles + dependents
- [x] Documents: CRUD, Drive resumable upload + streaming download proxy, versions, comments, search, AI category suggestion, per-member assignment
- [x] Private-document enforcement on every read AND write surface (authz-matrix suite)
- [x] CSRF Origin/Referer on all mutations + download proxy; KV rate limits on auth/invite/upload/chat/suggest/remind
- [x] Cross-family reference guards on every client-supplied ID
- [x] Reminder cron (range-based, per-window dedupe, email retry-safe) + notification center + prefs
- [x] Family chat with @mentions → notification + email
- [x] Tag-to-remind on documents
- [x] Calendar: per-event ICS + rotatable capability-URL feed
- [x] Weekly digest email (Monday, deduped, privacy-filtered, empty-week skip)
- [x] Human-friendly API error copy end-to-end
- [x] CI: typecheck + lint + migration validation + tests + build

### 🔜 Hardening before scale (priority order)
- [ ] **Drive `drive.file` durability spike** — create → revoke → re-consent → still readable (unproven assumption; CLAUDE.md §8)
- [ ] Automate `db:migrate:remote` in the deploy pipeline (currently manual post-merge)
- [ ] Observability: error alerting + refresh-token `invalid_grant` owner alert
- [ ] Purge cron: permanently delete Drive bytes for long-trashed documents
- [ ] Browser E2E (Playwright) in CI — local tooling already exists (`npm run dev:screenshots`, `.claude/skills/live-test`)
- [ ] Component tests for forms (@testing-library/react is installed)
- [ ] Accessibility pass (focus traps, ARIA on custom pickers, contrast audit)
- [ ] D1 scheduled backups/export
- [ ] Resend volume model before enabling digest for many families (3k/mo free cap)

### 🗺️ Product roadmap
See `docs/PLAN.md` — per-document ACL shares, custom roles, session/device
management UI, org tier; plus Phase 4 (offline/biometric/FTS) and Phase 6
(push notifications, OCR, Shared Drive).

---

## 3. Bottom line

The product is deployable and deployed: a family can sign in with Google,
store and find documents, get reminded before expiries (in-app + email +
calendar app), chat and tag each other, and manage members including children.
The riskiest open item is operational, not functional: the Drive refresh-token
SPOF and the unproven `drive.file` durability assumption — run that spike
before onboarding families at scale.
