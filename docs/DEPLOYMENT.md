
## 5. Reminders, email and the scheduler

Reminders are driven entirely by the Worker's **Cron Trigger**
(`wrangler.jsonc` → `triggers.crons`, currently `0 8 * * *` = 08:00 UTC daily).
Cloudflare invokes `scheduled()` on that schedule whether or not anybody has
opened the site, so a commitment configured months ago still emails on time.
The daily run does three things:

1. `runExpiryReminders` — document expiries and upcoming events.
2. `runCommitmentReminders` — materialises upcoming commitment due dates,
   emails/notifies inside each commitment's lead time, and auto-logs the
   expense for commitments marked "record automatically".
3. `purgeExpiredSessions` — session cleanup.

### Delivery address

Each member chooses where their reminders go, in **Money settings → Reminder
emails**. Blank means "use the Google address I sign in with". The value is
stored in `reminder_prefs.reminder_email`.

To set it for a user directly:

```bash
npx wrangler d1 execute family-vault-db --remote --command \
  "UPDATE reminder_prefs SET reminder_email='someone@example.com' WHERE user_id='<USER_ID>'"
```

(If the user has never opened notification settings there may be no row yet —
saving once in the UI creates it.)

### Sender address — important

`EMAIL_FROM` **must be an address on a domain verified with Resend**. Email
providers do not let you send *from* an arbitrary personal mailbox, so the
signed-in Google address cannot be used as the sender; it is only ever the
recipient. Until a domain is verified and `EMAIL_FROM` points at it, `sendEmail`
will be rejected by Resend and reminders will not arrive.

```bash
npx wrangler secret put RESEND_API_KEY
# EMAIL_FROM can be a var in wrangler.jsonc or a secret
```

Without `RESEND_API_KEY` the mailer is a no-op: in-app notifications are still
written, but no email is sent.

## 6. The AI assistant

The assistant is off unless `GEMINI_API_KEY` is set:

```bash
npx wrangler secret put GEMINI_API_KEY
# optional: GEMINI_MODEL, defaults to gemini-2.0-flash
```

`GET /api/assistant/status` reports whether it is configured, and the UI hides
the assistant button when it is not, so the feature never advertises itself
before it can work.

Security note: the model never touches the database. It emits a tool name and
arguments; the Worker executes that tool under the **signed-in user's** identity
and family membership, applying the same visibility rules as the REST API. A
crafted prompt therefore cannot read another member's private records.
