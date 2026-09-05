# Ops: Google Cloud, Worker secrets, uploads, email, church

These are **not** code deploys. You apply them in Google Cloud Console and
Cloudflare. Live app: `https://fam.connect-cloud.workers.dev`.

Confirm the exact redirect URIs the Worker will send:

```bash
curl -s https://fam.connect-cloud.workers.dev/api/health
```

Use the `oauth.loginCallback` and `oauth.storageCallback` values below. They
must match **character-for-character** (https, no trailing slash on the origin).

## 1. Fix `redirect_uri_mismatch` (storage / sign-in)

Google Cloud Console → APIs & Services → **Credentials** → your OAuth 2.0
**Web client**.

**Authorized JavaScript origins**

- `https://fam.connect-cloud.workers.dev`

**Authorized redirect URIs** (add both)

- `https://fam.connect-cloud.workers.dev/api/auth/google/callback`
- `https://fam.connect-cloud.workers.dev/api/admin/storage/connect/callback`

Wait 5–15 minutes, then Admin → Storage → Connect again, signed in as
`Albertjoshrock101@gmail.com` (the Drive + Gmail send account).

If you use a custom domain later, add that origin and both `/api/.../callback`
paths for it too, and set Worker var `APP_URL` to that origin.

## 2. Document upload still failing after sign-in

Sign-in only proves who you are. Files go to **Google Drive** until R2 is
enabled (the R2 block in `wrangler.jsonc` is still commented out).

1. Finish §1 so storage connect works.
2. As a **platform admin**, open Settings → Storage (or `/admin/storage`) and
   connect Drive with `drive.file` + `gmail.send`.
3. Then upload on a document. If you are not a platform admin, ask one to
   connect storage — members cannot complete that OAuth.

Optional later: enable R2 — see **§7**. Uploads try R2 first, then fall back to Drive.

## 3. Test email: “Reconnect Google Drive storage or set RESEND_API_KEY”

Pick **one** path (Gmail is enough for the family Gmail):

**Path A — Gmail send (same as storage connect)**

1. Complete §1–§2.
2. In Google Cloud, enable **Gmail API** (APIs & Services → Library → Gmail API → Enable).
3. Reconnect Admin → Storage so the refresh token includes `gmail.send`.
4. Settings → Send test mail.

**Path B — Resend**

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_FROM
```

`EMAIL_FROM` must be a domain you verified in Resend (not a personal
`@gmail.com` From address).

## 4. Church `church_not_configured`

The contributions site
(https://light-of-jesus-ministry-contributions.pages.dev) already holds live
totals. This app only **reads** them.

```bash
npx wrangler secret put CONTRIBUTIONS_API_TOKEN
```

Paste the **same** value as that site’s `ADMIN_API_TOKEN`. Then reload Money →
Funds.

## 5. Google Contacts `google_sync_failed` / “unsecured app”

1. Google Cloud Console → **APIs & Services → Library** → search **People API** → **Enable**.
2. OAuth consent screen → add scope `https://www.googleapis.com/auth/contacts` (restricted).
3. In the app: Settings → Google Contacts (or Contacts → Connect), accept Contacts permission, then Contacts → Sync.
4. The “This app hasn’t been verified” / unsecured-app screen is **expected**
   until you publish. For a family app: click Advanced → Go to Family Vault
   (unsafe) during testing.

**To publish / verify (required for Contacts long-term):**

- Google Cloud → OAuth consent screen → **Publish app** (External).
- `contacts` is a **restricted** scope. After testing with <100 users, submit
  [app verification](https://support.google.com/cloud/answer/9110914) with a
  privacy policy URL and a demo video of Contacts sync.
- Also enable **Google Calendar API**, **Gmail API**, and **Drive API** if not already.

Until verification, Google can revoke Contacts access. Login + Drive
(`drive.file`) can stay on the testing screen.

## 6. Google Calendar sync not writing to the phone

Calendar write uses the **Google Calendar API** (`calendar.events` on login).
The ICS subscribe URL is a backup and can take hours to refresh in Google Calendar.

1. Google Cloud Console → **APIs & Services → Library** → search **Google Calendar API** → **Enable**.
2. In the app: Settings → Google Calendar → **Connect** (or open an event → Reconnect).
3. Open the event → **Sync to Google Calendar**. Existing events do not backfill until you tap Sync (or edit and save).
4. If the banner says the API is disabled, you skipped step 1. Reconnect will not help until the API is enabled.

## 7. Enable Cloudflare R2 (document files)

R2 is **not** something the Worker can turn on by itself. The `r2_buckets` block in
`wrangler.jsonc` stays commented until the account + bucket exist; uncommenting
too early makes production deploys fail.

**In the Cloudflare dashboard**

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Open **R2 Object Storage** in the left sidebar (or search “R2”).
3. If you see **Enable R2**, click it. Cloudflare will ask for a **payment method**.
   R2 still has a free tier after that; the card is required to activate the product.
4. Click **Create bucket**.
   - Name: `family-vault-files` (must match `wrangler.jsonc`).
   - Location: leave default unless you care about region.
5. Confirm the bucket appears on the R2 overview.

**On a laptop with Wrangler** (alternative to step 4)

```bash
npx wrangler login
npx wrangler r2 bucket create family-vault-files
npx wrangler r2 bucket list
```

**Then in this repo**

1. Uncomment the `r2_buckets` block in `wrangler.jsonc` (`binding: "FILES"`,
   `bucket_name: "family-vault-files"`).
2. Merge to `main` (or `npx wrangler deploy`). GitHub Actions deploy binds `FILES`.
3. Reload Admin → Storage. The checklist should show **Cloudflare R2: Bound**.
4. Upload a document. Bytes go to R2 first; Drive remains the fallback if R2 is down.

Admin → Storage also shows whether Drive/Gmail and Resend are configured.

## 8. Face ID `invalid_client_data`

Use the PWA at **exactly** `https://fam.connect-cloud.workers.dev` (not a
preview URL). Then Money → Set up Face ID. Forgot PIN: “Email a reset code”
goes to the **Google address you signed in with**.

PIN reset email needs §3 (Gmail or Resend) working.

## 9. “Google hasn’t verified this app” / uncertified on every login

Two separate things cause that screen.

**A. The app was forcing a full consent screen on every sign-in** (fixed in
code). After this deploy, **Continue with Google** only asks you to pick an
account. Calendar / Contacts / Gmail still show consent when you tap Connect
in Settings — that is expected.

**B. The OAuth consent screen is still in Testing, or you request restricted
scopes.** Google Cloud Console → **APIs & Services → OAuth consent screen**:

1. User type: **External**.
2. Fill App name, user support email, developer contact, and a privacy policy
   URL (a public page is enough for a family app).
3. Scopes for everyday login: `openid`, `email`, `profile`, and
   `drive.file` (non-sensitive). Do **not** add `calendar.events`, `gmail.send`,
   or `contacts` as default login scopes.
4. Click **Publish app** → **Confirm**.

After publish, login with only those non-sensitive scopes should **not** show
the uncertified warning.

Connecting **Calendar** (sensitive) or **Contacts / Gmail** (restricted) will
still show “unverified” until you complete
[Google app verification](https://support.google.com/cloud/answer/9110914).
That is a one-time Connect flow, not every login. For a family-only app you can
tap Advanced → Continue during those Connect steps.

