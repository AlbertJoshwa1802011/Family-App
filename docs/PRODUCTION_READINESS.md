# Family Vault — Production Readiness

This is an **honest** assessment of how close Family Vault is to being a deployable
production product, plus the stress-test evidence and the remaining work. Read it with
`CLAUDE.md` and `docs/FEATURES.md`.

> **Headline:** the **foundation is production-grade** — request pipeline, schema, security
> posture, validation, tests, and docs are solid and load-tested. But the **backend business
> logic (auth, D1 queries, Google Drive) is still stubbed**, so the app is not yet a
> deployable end-to-end product. The honest path-to-v1 number is in §4.

---

## 1. Stress / Load Test Evidence

Measured in-process against the real Hono pipeline (routing → requestId → logger →
secureHeaders → bodyLimit → Zod → handler → error path), bounded concurrency = 50.
**20,000 requests total, zero errors.** These numbers measure the *request-handling layer*
(no network, no real D1 yet — honest scope).

| Scenario | Throughput | p50 | p95 | p99 | Errors |
|---|---|---|---|---|---|
| GET `/api/health` | 14,800 req/s | 1.7ms | 4.2ms | 10.1ms | 0 |
| Unknown route → 404 | 35,400 req/s | 1.0ms | 1.8ms | 2.3ms | 0 |
| POST valid (Zod pass) → 501 | 16,700 req/s | 2.2ms | 3.9ms | 7.2ms | 0 |
| POST invalid (Zod fail) → 400 | 11,500 req/s | 3.1ms | 6.8ms | 7.2ms | 0 |

What the stress suite (`tests/stress.test.ts`) guarantees going forward:
- No request ever returns **500** under mixed concurrent load.
- Every status stays in the **intended set** (200/400/404/413/501) — no validation
  cross-contamination between concurrent requests.
- Oversized (>1 MiB) bodies are rejected with **413**, never OOM.
- A throughput floor catches any future pathological slowdown in the hot path.

---

## 2. Production Readiness Scorecard

Weighted by how much each dimension matters for a safe, deployable v1.

| Dimension | Weight | Score | Notes |
|---|---:|---:|---|
| Build/dev toolchain | 8% | 100% | Vite 8 + Cloudflare plugin + PWA pinned & working; one-command build |
| Database schema | 10% | 95% | 21 tables, all features modeled, dependents supported, migrations validated |
| Request pipeline & hardening | 10% | 90% | requestId, body limit, secure headers, generic error path, load-tested |
| Input validation (Zod) | 8% | 95% | Every mutation validated; exhaustive boundary tests |
| Frontend completeness | 12% | 85% | All pages built & polished; no live data (waits on backend) |
| Security posture | 12% | 70% | Design complete (PKCE, sessions, CSRF, CSP, private-doc rule); enforcement pending impl |
| **Backend business logic** | **20%** | **8%** | Auth, D1 queries, Drive, cron — all stubs. The big gap. |
| Test coverage | 10% | 65% | Strong contract/stress/unit tests; no auth/D1/component/E2E yet |
| Deployment & ops | 6% | 30% | wrangler config ready; no CF account, secrets, CI/CD, or monitoring wired |
| Documentation/knowledge | 4% | 95% | CLAUDE.md, ARCHITECTURE, FEATURES, this doc — a new agent can continue cleanly |

**Weighted total ≈ 64% foundation quality**, but **path-to-deployable-v1 ≈ 38%** because the
20%-weighted backend logic is at 8% and gates everything user-facing.

---

## 3. Production Checklist

### ✅ Done
- [x] Single-Worker architecture (SPA + API + cron) — no CORS, one deploy unit
- [x] 21-table schema as single source of truth; 4 validated migrations
- [x] Security headers (Hono `/api/*` + `public/_headers` for assets)
- [x] CSP, X-Frame-Options, nosniff
- [x] Zod validation on every mutation with consistent error shape
- [x] Request body size limit (413) + request IDs + non-leaky error handler
- [x] UTC-safe expiry logic; timezone-stable date utilities
- [x] PWA with prompt-update, API-denylisted SW, no PII runtime caching
- [x] 142 tests (contract + boundary + stress) all green
- [x] Knowledge docs so any agent can continue safely

### ⛔ Required before real users (gating)
- [ ] **Google OAuth** (Auth Code + PKCE), ID-token verify (`jose`), real `/auth/me`
- [ ] **Session lifecycle** in D1 (create/rotate/idle+absolute expiry/revoke) + cleanup cron
- [ ] **D1 client** (Drizzle) wired; replace all stub routes with real queries
- [ ] **Family membership authz middleware** on every family-scoped route
- [ ] **Private-document enforcement** in list/get/download (security-critical, §5.1 FEATURES)
- [ ] **Explicit cascade deletes** in app code (D1 FK caveat)
- [ ] **Google Drive** upload/download proxy + owner token refresh (KV cache + single-flight)
- [ ] **Phase 0.5 spike**: validate `drive.file` durability across re-consent
- [ ] **Reminder cron**: range-based query + `reminders_log`/`event_reminders_log` dedupe + Resend
- [ ] **Rate limiting** on auth + upload endpoints (KV or Durable Object token bucket)
- [ ] **CSRF**: Origin/Referer check on mutations + download proxy
- [ ] **Audit-log write path** in document/family mutations

### 🔜 Hardening before scale
- [ ] CI/CD (GitHub Actions: typecheck + lint + test + migration-validate + deploy)
- [ ] Secrets via `wrangler secret put`; `.dev.vars` for local
- [ ] Observability dashboards + alerting (refresh-token SPOF alert)
- [ ] E2E tests (Playwright): create-family → upload → download → reminder
- [ ] Component tests (`@testing-library/react`) for forms/critical flows
- [ ] Accessibility pass (focus, ARIA, contrast)
- [ ] Purge cron for trashed docs + Drive reconciliation
- [ ] Backups / disaster-recovery for D1

---

## 4. The Honest Bottom Line

- **As a foundation/architecture:** production-grade (~64% weighted, with the high-leverage
  pieces — pipeline, schema, security design, tests — at 85–100%).
- **As a deployable product for real families:** ~38%. The entire backend business layer
  (auth → D1 → Drive → reminders) is the remaining ~60% of the journey and is well-specified,
  load-test-ready, and unblocked. The next milestone (Phase 1: auth + sessions + D1 client +
  family CRUD) converts the largest chunk of that gap.

There are **no known architectural blockers** — every remaining item is implementation against
a design that is already documented and tested at its boundaries.
