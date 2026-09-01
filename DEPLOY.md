# Deploying Family Vault

Family Vault is a single Cloudflare Worker (SPA + Hono API + cron). Production
deploys are **automated**: merge to `main` → GitHub Actions builds, migrates the
production D1, and deploys. You should rarely need to deploy by hand.

---

## 1. One-time setup

### a. Cloudflare resources (already provisioned)
- D1 database `family-vault-db` → `database_id` in `wrangler.jsonc`
- KV namespace `KV` → `id` in `wrangler.jsonc`
- R2 bucket `family-vault-files` → binding `FILES` in `wrangler.jsonc` (primary document file store)

To recreate from scratch:
```bash
npx wrangler d1 create family-vault-db        # paste database_id into wrangler.jsonc
npx wrangler kv namespace create KV           # paste id into wrangler.jsonc
npx wrangler r2 bucket create family-vault-files   # required before first deploy if not auto-created
```

Document uploads use R2 when the `FILES` binding is present. Without the bucket,
`POST /api/documents/:id/files/upload` returns `r2_not_configured` (503) — the app
still runs; Google Drive connect remains optional/legacy (configure from a laptop).

### b. GitHub Actions secrets (enables the auto-deploy pipeline)
Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Where to get it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | dash.cloudflare.com → **My Profile → API Tokens → Create Token** → use the **"Edit Cloudflare Workers"** template (covers Workers Scripts, D1, KV) |
| `CLOUDFLARE_ACCOUNT_ID` | dash.cloudflare.com → Workers & Pages → right sidebar "Account ID" |

These let GitHub's runners deploy on your behalf. They are **not** the app's
runtime secrets — see (c).

### c. Cloudflare Worker runtime secrets (the app's secrets)
Set once with `wrangler secret put <NAME>` (never committed, never in CI):
```bash
npx wrangler secret put SESSION_SECRET                # long random string
npx wrangler secret put GOOGLE_CLIENT_ID              # Google Cloud OAuth client
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_OWNER_REFRESH_TOKEN    # owner Google account, drive.file scope
npx wrangler secret put RESEND_API_KEY                # optional; emails no-op without it
```

### d. Google Cloud (one-time, browser)
1. Enable **Google Drive API**.
2. **OAuth consent screen** (External): scopes `openid email profile` + `drive.file`
   → **Publish to Production** (Testing mode expires refresh tokens after 7 days).
3. Create a **Web OAuth client**. Redirect URI: `https://<APP_URL>/api/auth/google/callback`.
4. Obtain the owner account's long-lived refresh token (offline-consent flow) →
   store as `GOOGLE_OWNER_REFRESH_TOKEN` (step c).

### e. Set `APP_URL`
After the first deploy you'll know the live URL (e.g.
`https://family-vault.<subdomain>.workers.dev`). Set `vars.APP_URL` in
`wrangler.jsonc` to that URL and add the matching redirect URI in Google Cloud.

---

## 2. Normal deploys (automated)
1. Open a PR into `main`.
2. CI runs typecheck/lint/test/build on the PR.
3. Merge → `.github/workflows/deploy.yml` runs the gate again, applies D1
   migrations to production, and deploys the Worker.

Trigger a deploy manually anytime: Actions tab → **Deploy (production)** → **Run workflow**.

## 3. Manual deploy (fallback)
```bash
npm run db:migrate:remote   # apply migrations
npm run deploy              # build + wrangler deploy
```

---

## 4. Letting Claude Code (web) self-drive deploys
Claude's web environment is network-locked and **cannot reach Cloudflare**, so it
cannot run `wrangler` directly. The intended automation path needs no Cloudflare
access from Claude at all: **Claude prepares the code/pipeline → you merge to
`main` → GitHub Actions (which *can* reach Cloudflare) deploys.** The only manual,
unavoidable human step is the Google owner-consent in (d) — a browser action on
your Google account.
