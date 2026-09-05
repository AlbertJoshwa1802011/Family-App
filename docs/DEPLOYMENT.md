# Family Vault — Deployment Guide

Step-by-step path from this repo to a live Cloudflare Workers deployment, plus
the CI/CD and operations checklist. The app is **one Worker**: SPA assets +
`/api/*` + daily cron — a single deploy unit, no CORS.

---

## 1. Prerequisites

- Cloudflare account (Workers Paid recommended for D1 production limits).
- Google Cloud project (OAuth consent screen + Web OAuth client).
- Optional: Resend account for reminder emails.
- `npx wrangler login` once on the deploying machine.

## 2. One-time provisioning

```bash
# 2.1 D1 database — paste the returned id into wrangler.jsonc d1_databases[0].database_id
npx wrangler d1 create family-vault-db

# 2.2 KV namespace — paste the id into wrangler.jsonc kv_namespaces[0].id
npx wrangler kv namespace create KV

# 2.3 Apply migrations to the remote database
npx wrangler d1 migrations apply family-vault-db --remote
```

### 2.4 Google OAuth client
In Google Cloud Console → Credentials → OAuth client (Web application):

- Authorized redirect URI: `https://<your-domain>/api/auth/google/callback`
- Scopes used: `openid email profile` + `https://www.googleapis.com/auth/drive.file`
  (non-sensitive; app-created files only)

### 2.5 Secrets (never in wrangler.jsonc, never committed)

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET      # long random string
npx wrangler secret put RESEND_API_KEY      # optional; email is a no-op without it
npx wrangler secret put ANTHROPIC_API_KEY   # optional; AI category suggestions
                                            # + in-app family assistant
                                            # (heuristics still work without it;
                                            #  /api/assistant returns 503)
```

Local dev equivalents go in `.dev.vars` (gitignored):

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SESSION_SECRET=dev-secret
```

### 2.6 Production vars
In `wrangler.jsonc`, set `vars.APP_URL` to the public origin
(e.g. `https://vault.example.com`). APP_URL drives OAuth redirects **and** the
CSRF allow-list, so it must exactly match the deployed origin.

## 3. Deploy

```bash
npm run typecheck && npm run lint && npm run test   # the gate
npm run build                                        # dist/client + sw.js
npx wrangler deploy                                  # uploads worker + assets + cron
```

The cron trigger (`0 8 * * *` UTC) is registered automatically from
`wrangler.jsonc`. Verify in the dashboard → Workers → family-vault → Triggers.

### 3.1 Post-deploy smoke test

```bash
curl -s https://<domain>/api/health                      # {"ok":true,...}
curl -s https://<domain>/api/nope                        # {"error":"not_found"} (JSON, not HTML!)
curl -s -X POST https://<domain>/api/families \
  -H "Origin: https://evil.example" -d '{}'              # {"error":"csrf_rejected"}
curl -sI https://<domain>/ | grep -i content-security    # CSP from public/_headers
```

Then sign in with Google in a browser, create a family, add a document with an
expiry date, upload a file, and download it.

## 4. CI/CD

`.github/workflows/ci.yml` runs typecheck + lint + tests + migration validation
+ build on every push/PR. To enable auto-deploy, add repo secrets
`CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit + D1:Edit) and
`CLOUDFLARE_ACCOUNT_ID`, then uncomment the deploy job at the bottom of the
workflow — it applies D1 migrations and runs `wrangler deploy` on pushes to the
default branch.

## 5. Operations

| Concern | What to do |
|---|---|
| Logs | `npx wrangler tail` (observability is enabled in wrangler.jsonc) |
| Cron health | Dashboard → Triggers → recent invocations; look for `[cron] reminders done:` lines |
| D1 backups | `npx wrangler d1 export family-vault-db --remote --output backup.sql` (schedule externally) |
| Drive token SPOF | If Drive calls start failing with `invalid_grant`, the family owner must sign in again (re-consent restores the refresh token) |
| Secret rotation | `wrangler secret put` re-deploys with the new value atomically |
| Rollback | `npx wrangler rollback` (previous deployment) |

## 6. Environments

For a staging environment, add a `staging` env block in `wrangler.jsonc` with
its own D1/KV ids and `APP_URL`, then `npx wrangler deploy --env staging`.
Keep the Google OAuth client's redirect list updated for each origin.

## 7. Known pre-launch gaps (tracked in PRODUCTION_READINESS.md)

- The `drive.file` durability spike (create → revoke → re-consent → still
  readable) has not been run against a real Google account yet.
- No E2E browser suite; see TESTING.md §4.
- Purge cron for trashed docs' Drive bytes is not implemented (trash is
  metadata-only today).
