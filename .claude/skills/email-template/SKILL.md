---
name: email-template
description: Create or modify Family Vault's HTML emails (reminders, invites, weekly digest) and notification delivery. Use when changing email content/design, adding a new notification type, or touching the digest/cron email paths.
---

# HTML emails & notifications

## Where things live

| Piece | File |
|---|---|
| Template system (pure HTML builders) | `worker/lib/emailTemplates.ts` |
| Send transport (Resend, no-op without key) | `worker/lib/email.ts` |
| Weekly digest (Monday cron, dedupe) | `worker/lib/digest.ts` |
| Tag/mention/remind delivery | `worker/lib/mentions.ts` (`notifyMember`) |
| In-app notification insert | `worker/lib/notify.ts` |
| Expiry/event reminder cron | `worker/cron.ts` |

## Email-HTML rules (email clients are NOT browsers)

1. **Tables + inline styles only.** No flexbox/grid, no external CSS, no
   `<link>`, no remote images, no JS.
2. **Light palette on a soft-gray canvas.** Dark-only designs get force
   inverted unreadably by Gmail/Outlook dark mode. Colors live in the
   `COLORS` const — reuse them.
3. **Escape EVERY user string** with `escapeHtml()` — titles, names, notes.
4. Reuse the building blocks: `shell()` (brand header/footer + preheader),
   `button()`, `sectionTitle()`, `listRow()`, `emptyRow()`.
5. Templates are pure (data → string) so tests can pin structure. Add a case
   in `tests/email-digest.test.ts` for every new template: assert escaping,
   key content, `role="presentation"` tables, and no `src=`/`<link`.

## Adding a notification type end-to-end

1. Deliver via `notifyMember(env, db, { recipient, familyId, type, title, body, link })`
   — writes the in-app notification AND emails if the recipient has email on.
   Recipients come from `loadMentionableMembers(db, familyId)` (active
   user-members + email prefs).
2. Frontend: map the new `type` to an icon in `typeIcon()`
   (`src/pages/Notifications.tsx`). The Activity tab badge picks it up
   automatically (unread count polling in `BottomNav`).
3. Respect prefs: email only when `recipient.emailEnabled`; in-app always.

## Digest specifics

- Runs from the daily cron; Monday-UTC gate + per-(user, ISO-week) claim in
  `digest_log` (`claimDigestSlot`) makes reruns safe.
- Per-recipient privacy: private docs filtered unless recipient is the doc
  owner or family owner/admin — keep this for any new digest section.
- Empty weeks are skipped on purpose (no-news emails train unsubscribes).
- Testing: stub `fetch`, pass `RESEND_API_KEY: "test-key"` + a fixed Monday
  `nowMs` (see `tests/email-digest.test.ts` for the pattern).

## Send transport contract

`sendEmail()` returns `false` (never throws) when unconfigured or failed —
callers that record "sent" state (e.g. `reminders_log` email rows) must only
record on `true`, so failures retry next run.
