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

Optional later: enable R2 in the Cloudflare dashboard, uncomment `r2_buckets`
in `wrangler.jsonc`, `npx wrangler r2 bucket create family-vault-files`.

## 3. Test email: “Reconnect Google Drive storage or set RESEND_API_KEY”

Pick **one** path (Gmail is enough for the family Gmail):

**Path A — Gmail send (same as storage connect)**

1. Complete §1–§2.
2. In Google Cloud, enable **Gmail API**.
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

1. Google Cloud → enable **People API**.
2. In the app: Settings → Connect Google Contacts (`connect=contacts`), accept
   Contacts permission, then Contacts → Sync.
3. The “This app hasn’t been verified” / unsecured-app screen is **expected**
   until you publish. For a family app: click Advanced → Go to Family Vault
   (unsafe) during testing.

**To publish / verify (required for Contacts long-term):**

- Google Cloud → OAuth consent screen → **Publish app** (External).
- `contacts` is a **restricted** scope. After testing with <100 users, submit
  [app verification](https://support.google.com/cloud/answer/9110914) with a
  privacy policy URL and a demo video of Contacts sync.
- Also enable **Google Calendar API** and **Drive API** if not already.

Until verification, Google can revoke Contacts access. Login + Drive
(`drive.file`) can stay on the testing screen.

## 6. Face ID `invalid_client_data`

Use the PWA at **exactly** `https://fam.connect-cloud.workers.dev` (not a
preview URL). Then Money → Set up Face ID. Forgot PIN: “Email a reset code”
goes to the **Google address you signed in with**.

PIN reset email needs §3 (Gmail or Resend) working.
