# Plan Review Notes

Record of plan-reviewer iterations and how each finding was resolved. (Reviewer agents critique;
findings are folded back into RESEARCH/ARCHITECTURE/PLAN.)

---

## Iteration 1 — findings & resolutions

| # | Pri | Finding | Resolution |
|---|-----|---------|------------|
| 1 | P0 | Single owner refresh token = SPOF, no recovery | Added cron Drive health-check + `invalid_grant` owner alert + documented re-consent route (ARCH Auth & Cron) |
| 2 | P0 | `drive.file` "reuse forever" assumption unproven | Added **Phase 0.5 spike** to empirically verify durability across re-consent before building UI (PLAN) |
| 3 | P0 | Token-refresh race on KV miss | Single-flight lock + documented KV eventual-consistency caveat (ARCH Auth) |
| 4 | P0 | CSRF on download proxy / mutations (Lax sent on GET) | Origin/Referer check (or double-submit) on mutations + downloads; `Content-Disposition: attachment` + `nosniff`, non-embeddable (ARCH Auth) |
| 5 | P0 | All families' PII in one personal Drive (trust/legal) | Added **Trust/Privacy** section: in-product disclosure; Shared Drive + envelope encryption promoted to P1 roadmap (ARCH) |
| 6 | P0 | Drive deletion undefined on doc delete | Trash = metadata only; **purge cron** deletes Drive bytes; `files.status`/`deleted_at` (ARCH Data Model + Lifecycle) |
| 7 | P1 | Data model gaps | `invites.token_hash` (hashed, single-use, email-bound); `document_tags` join table; `current_file_id`/`is_current`; `notifications.family_id`; added indexes (ARCH) |
| 8 | P1 | Session lifecycle underspecified | D1 as single source of truth; rotate on login; idle+absolute expiry; cleanup cron; log-out-everywhere (ARCH) |
| 9 | P1 | Cron "exactly N days" fragile | Switched to **range-based** (`<= today+window`) + dedupe (ARCH Cron) |
| 10 | P1 | 750GB/day + 3 writes/s are app-wide | App-wide throttle/queue w/ backoff (ARCH Drive Throughput) |
| 11 | P2 | No observability/backups in MVP | Basic logs/error hook in Phase 0; ops reconciliation/export as P2 (PLAN) |
| 12 | P2 | Phase 0 slightly too big; need earliest e2e slice | Added Phase 0.5 spike + named smallest valuable slice (PLAN) |
| 13 | P2 | Scope-creep in feature list | Re-sorted features into Keep vs Defer (PLAN) |
| 14 | P2 | Resend free cap vs digest volume | Flagged: model volume before enabling digest (PLAN) |

---

## Iteration 2 — findings & resolutions (build-focused)

Iteration-1 fixes confirmed correct (SPOF, spike, CSRF, trust, purge, range-cron, sessions).
New/incomplete items, applied to the scaffold:

| # | Pri | Finding | Resolution |
|---|-----|---------|------------|
| 2-1 | P0 | `assets.directory` in source `wrangler.jsonc` conflicts with `@cloudflare/vite-plugin` (plugin generates it; path only exists post-build) | Drop `assets.directory` from source config; keep `binding` + `not_found_handling`. Plugin owns client build dir |
| 2-2 | P0 | PWA SW + Cloudflare assets interaction unresolved (SW scope, globPatterns, navigateFallback vs SPA fallback fight) | `generateSW` + `registerType:'prompt'`; `navigateFallbackDenylist` excludes `/api/*`; acceptance check that `/sw.js` is served |
| 2-3 | P0 | `run_worker_first: ["/api/*"]` was dropped; SPA fallback can return `index.html` 200 for unknown `/api/*` | Re-add `run_worker_first`; add test that `/api/<unknown>` → JSON 404, not HTML |
| 2-4 | P1 | Migrations vs Drizzle schema duplication (drift trap) | **Decision: Drizzle schema is source of truth; SQL migrations generated via `drizzle-kit`.** Documented in ARCH/PLAN |
| 2-5 | P1 | FK / ON DELETE unspecified; D1 needs FKs enabled | Define cascades: `family→*` CASCADE; `documents.subject_member_id→family_members` SET NULL; `document_tags`/`files` CASCADE. Enable FKs in migration |
| 2-6 | P1 | Invite bound to email, but identity is Google `sub` (email mismatch case) | Note in Phase 1 accept logic: match by email, warn on mismatch |
| 2-7 | P1 | Single-flight lock "best-effort" could be over-engineered into a DO | Clarify: correctness comes from Google allowing reuse of unexpired access token; KV best-effort lock is enough — no Durable Object |
| 2-8 | P2 | Cron `0 8 * * *` is UTC; family-local time varies | Document as known limitation; store tz later |
| 2-9 | P2 | No version pins; vite+PWA+Workbox triangle is version-sensitive | Pin exact versions in `package.json`; prefer scaffolding from the official generator for a known-good base |
