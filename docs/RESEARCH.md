# Family Vault — Research Findings (2026)

Consolidated findings from three parallel research tracks. These drive the architecture and plan.

---

## 1. Cloudflare Stack

**Decision: Single Worker + Hono + Static Assets + `@cloudflare/vite-plugin` + D1. Do NOT use Pages Functions.**

Why:
- Cloudflare now steers new projects to **Workers + static assets** (free static serving, full SPA support, custom domains). Pages Functions are treated as legacy.
- **Only Workers get Cron Triggers** — and we need a daily cron for expiry reminders. This alone settles the decision.
- One deployable unit serving both the SPA and the `/api/*` routes = **same-origin, no CORS**, simpler auth cookies.

Key facts:
- Scaffold: `npm create cloudflare@latest -- --framework=react`.
- D1 migrations: `wrangler d1 migrations create`, `... apply --local`, `... apply --remote`. Failed migrations auto-rollback.
- Dev: `@cloudflare/vite-plugin` (GA Apr 2025) runs the Worker in the real `workerd` runtime with Vite HMR — bindings (D1/KV) behave like prod locally. Use `vite` for dev, `vite build` + `wrangler deploy` to ship.
- Cron: add a `scheduled(event, env, ctx)` handler alongside `fetch` in the same Worker; `triggers.crons` in `wrangler.jsonc`. Test with `wrangler dev --test-scheduled` → hit `/__scheduled`.
- Secrets: `.dev.vars` (gitignored) locally; `wrangler secret put` in prod. CI via `cloudflare/wrangler-action` with `CLOUDFLARE_API_TOKEN` + account id as GH secrets.
- SPA fallback: `assets.not_found_handling: "single-page-application"`. Force API first with `run_worker_first: ["/api/*"]` if paths collide.
- Cookies: `HttpOnly; Secure; SameSite=Lax` (or `Strict` for sensitive actions). Sessions are DIY — store in D1 or KV.

Example `wrangler.jsonc` (corrected per review iter-2 — when using `@cloudflare/vite-plugin`,
do NOT set `assets.directory` in the source config; the plugin injects it at build time. Add
`run_worker_first` so `/api/*` routes to the Worker before the SPA fallback can swallow them):
```jsonc
{
  "name": "family-vault",
  "main": "worker/index.ts",
  "compatibility_date": "2026-05-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "family-vault-db", "database_id": "<UUID>", "migrations_dir": "migrations" }
  ],
  "kv_namespaces": [{ "binding": "KV", "id": "<UUID>" }],
  "triggers": { "crons": ["0 8 * * *"] }
}
```

---

## 2. Google OAuth + Drive Storage

**Identity flow:** Authorization Code + PKCE, scopes `openid email profile`. Verify the Google ID token (JWT, RS256) in the Worker using **`jose`** (`createRemoteJWKSet` against `https://www.googleapis.com/oauth2/v3/certs`); validate `iss`, `aud` (= our client id), `exp`. `payload.sub` is the stable user id.

**Storage architecture (key decision):** Decouple user identity from storage. All family documents live in the **OWNER's Google Drive (5TB)**, accessed server-side via the **owner's long-lived refresh token** stored as a Worker secret. Users log in with their own Google accounts for identity only.
- Obtain the owner refresh token once via consent with `access_type=offline&prompt=consent`.
- **Use `drive.file` scope** (non-sensitive — app only sees files it created). Since all vault files are app-created, this suffices and **avoids Google's restricted-scope verification + annual security assessment** that `drive` scope triggers.
- Cache the owner access token (valid ~1h) in **KV** with `expirationTtl: 3300`. Refresh on miss via `POST https://oauth2.googleapis.com/token` (`grant_type=refresh_token`).

**Upload:** multipart (`uploadType=multipart`) for small files (<5MB) in one request; **resumable** (256KB chunks) for large files. One Drive folder per family (`mimeType: application/vnd.google-apps.folder`); store folder id in D1; set `parents: [familyFolderId]` per upload.

**Download:** No S3-style presigned URLs in Drive. **Proxy through the Worker** — `GET .../files/{id}?alt=media` with owner bearer token, stream the body back. Enforce family/role authz before every download. Set `Content-Disposition` + strict `Content-Type`. Never expose tokens to the client.

**Google Cloud Console setup:** enable Drive API; OAuth consent screen (External) with scopes `openid email profile drive.file`; Web OAuth client with exact redirect URIs; **publish to production** (Testing mode expires refresh tokens after 7 days). Non-sensitive scopes → no restricted verification needed.

**Limits/gotchas:** 20k req/100s per project; **sustained writes ≤ 3 req/s per account** (queue/throttle bulk); 750 GB/day upload cap; 5TB max file; backoff w/ jitter on 403/429/5xx. Single owner account is the throughput bottleneck at scale (mitigate later with a Shared Drive).

Token verify example:
```js
import { jwtVerify, createRemoteJWKSet } from 'jose';
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const { payload } = await jwtVerify(idToken, JWKS, {
  issuer: 'https://accounts.google.com', audience: env.GOOGLE_CLIENT_ID,
});
```

---

## 3. PWA + Reminders + Notifications

**PWA (vite-plugin-pwa + Workbox):**
- `registerType: 'prompt'` (NOT autoUpdate — avoids clobbering in-progress uploads/forms). Show "New version — Reload" toast via `virtual:pwa-register`.
- Manifest: `name`, `short_name`, `start_url`, `display: standalone`, theme/background colors, icons **192 + 512 + 512-maskable**. HTTPS required (Cloudflare provides).
- Caching: precache app shell; runtime `StaleWhileRevalidate` for `GET /api/documents` (list/metadata); `CacheFirst` (capped) for thumbnails; **never cache** auth, mutations, or file downloads.
- iOS: no auto install prompt (show manual "Add to Home Screen"); push only works after Home-Screen install (iOS 16.4+) and can silently drop — re-subscribe on open. **Treat email as the reliable primary reminder channel; web push secondary.**

**Expiry reminders (sound architecture):** store `expiry_date`; daily Cron Worker queries D1 for docs in reminder windows (e.g. 30/7/1 days); inserts in-app `notifications` rows + sends email. Add a `reminders_log` / `reminder_sent_at` dedupe so re-runs don't double-send.

**Email from Workers (2026):** MailChannels free Workers tier is **dead** (ended Aug 2024). **Use Resend** — 3,000 emails/mo free, modern API, simplest DX. Verify sending domain + SPF/DKIM. (Postmark best deliverability but 100/mo free; SES cheapest at scale but heavy setup.)
```ts
await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: 'reminders@yourdomain.com', to: user.email,
    subject: `Document expiring soon: ${doc.title}`, html: `<p>${doc.title} expires on ${doc.expiry_date}.</p>` }),
});
```

**In-app notifications:** D1 table `notifications(id, user_id, type, title, body, read, created_at)`, index `(user_id, read, created_at)`. **Polling** (on load + every ~60s + on focus) — simplest; skip SSE/WebSockets.

**WhatsApp (future):** Meta WhatsApp Business Cloud API — dedicated number, Meta Business account, pre-approved Utility templates. Feasible later; not in v1.
