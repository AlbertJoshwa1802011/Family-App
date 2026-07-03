/**
 * Rich HTML email templates for Family Vault reports.
 *
 * Design constraints for email HTML (very different from web HTML):
 *  - Table layout + inline styles only (no external CSS, no flexbox).
 *  - Light background: dark-mode-only palettes get force-inverted unreadably
 *    by Gmail/Outlook; a light card on a soft gray canvas survives everywhere.
 *  - System font stack; every user string HTML-escaped.
 *
 * All functions are pure (data in → HTML string out) so tests can pin the
 * structure without any I/O.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const FONT =
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const COLORS = {
  canvas: "#f1f5f9",
  card: "#ffffff",
  ink: "#0f172a",
  muted: "#475569",
  subtle: "#94a3b8",
  line: "#e2e8f0",
  brand: "#4f46e5",
  brandSoft: "#eef2ff",
  danger: "#dc2626",
  dangerSoft: "#fef2f2",
  warning: "#d97706",
  warningSoft: "#fffbeb",
  success: "#16a34a",
  successSoft: "#f0fdf4",
};

/** Shared shell: header with brand, content slot, footer. */
function shell(opts: { preheader: string; content: string; footer?: string }): string {
  const footer =
    opts.footer ??
    "You're receiving this because email reports are enabled in Family Vault. You can change this anytime in Settings → Reminders.";
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${COLORS.canvas};${FONT}">
  <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(opts.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.canvas}">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
        <tr><td style="padding:0 4px 16px">
          <span style="display:inline-block;background:${COLORS.brand};color:#ffffff;font-size:14px;font-weight:700;letter-spacing:.02em;padding:8px 14px;border-radius:10px">🏠 Family Vault</span>
        </td></tr>
        <tr><td style="background:${COLORS.card};border-radius:16px;border:1px solid ${COLORS.line};overflow:hidden">
          ${opts.content}
        </td></tr>
        <tr><td style="padding:16px 8px 0;font-size:12px;line-height:1.5;color:${COLORS.subtle}">
          ${footer}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function button(label: string, url: string): string {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;background:${COLORS.brand};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:10px">${escapeHtml(label)}</a>`;
}

function sectionTitle(emoji: string, title: string): string {
  return `<tr><td style="padding:20px 24px 8px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${COLORS.muted}">${emoji}&nbsp; ${escapeHtml(title)}</td></tr>`;
}

function listRow(opts: {
  title: string;
  meta: string;
  badge?: { label: string; color: string; bg: string };
  last?: boolean;
}): string {
  const border = opts.last ? "" : `border-bottom:1px solid ${COLORS.line};`;
  const badge = opts.badge
    ? `<td align="right" style="padding:12px 24px 12px 8px;${border}white-space:nowrap"><span style="display:inline-block;background:${opts.badge.bg};color:${opts.badge.color};font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px">${escapeHtml(opts.badge.label)}</span></td>`
    : "";
  return `<tr>
    <td style="padding:12px 8px 12px 24px;${border}">
      <div style="font-size:14px;font-weight:600;color:${COLORS.ink}">${escapeHtml(opts.title)}</div>
      <div style="font-size:12px;color:${COLORS.muted};padding-top:2px">${escapeHtml(opts.meta)}</div>
    </td>${badge}
  </tr>`;
}

function emptyRow(text: string): string {
  return `<tr><td style="padding:12px 24px;font-size:13px;color:${COLORS.subtle}">${escapeHtml(text)}</td></tr>`;
}

// ── Reminder email (single document/event) ────────────────────────────────────

export function reminderEmail(opts: {
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  urgency: "danger" | "warning" | "info";
}): string {
  const tone =
    opts.urgency === "danger"
      ? { bar: COLORS.danger, soft: COLORS.dangerSoft, label: "Action needed" }
      : opts.urgency === "warning"
        ? { bar: COLORS.warning, soft: COLORS.warningSoft, label: "Coming up" }
        : { bar: COLORS.brand, soft: COLORS.brandSoft, label: "Reminder" };

  const content = `
    <tr><td style="height:6px;background:${tone.bar};font-size:0">&nbsp;</td></tr>
    <tr><td style="padding:24px 24px 8px">
      <span style="display:inline-block;background:${tone.soft};color:${tone.bar};font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px">${tone.label}</span>
    </td></tr>
    <tr><td style="padding:8px 24px 4px;font-size:20px;font-weight:700;color:${COLORS.ink}">${escapeHtml(opts.heading)}</td></tr>
    <tr><td style="padding:4px 24px 20px;font-size:14px;line-height:1.6;color:${COLORS.muted}">${escapeHtml(opts.body)}</td></tr>
    <tr><td style="padding:0 24px 28px">${button(opts.ctaLabel, opts.ctaUrl)}</td></tr>`;

  return shell({ preheader: opts.body, content });
}

// ── Weekly digest report ──────────────────────────────────────────────────────

export interface DigestData {
  recipientName: string | null;
  familyName: string;
  appUrl: string;
  periodLabel: string; // e.g. "6 – 12 Jul 2026"
  expiring: { title: string; expiryDate: string; daysLeft: number; link: string }[];
  events: { title: string; when: string; location: string | null }[];
  openTasks: { title: string; dueDate: string | null; assignee: string | null }[];
}

export function weeklyDigestEmail(d: DigestData): string {
  const hi = d.recipientName ? `Hi ${d.recipientName.split(" ")[0]},` : "Hi,";

  const expiringRows =
    d.expiring.length === 0
      ? emptyRow("Nothing expiring in the next 30 days. 🎉")
      : d.expiring
          .map((x, i) =>
            listRow({
              title: x.title,
              meta: `Expires ${x.expiryDate}`,
              badge:
                x.daysLeft <= 7
                  ? { label: x.daysLeft <= 0 ? "Expired" : `${x.daysLeft}d left`, color: COLORS.danger, bg: COLORS.dangerSoft }
                  : { label: `${x.daysLeft}d left`, color: COLORS.warning, bg: COLORS.warningSoft },
              last: i === d.expiring.length - 1,
            }),
          )
          .join("");

  const eventRows =
    d.events.length === 0
      ? emptyRow("No events scheduled this week.")
      : d.events
          .map((e, i) =>
            listRow({
              title: e.title,
              meta: e.location ? `${e.when} · ${e.location}` : e.when,
              last: i === d.events.length - 1,
            }),
          )
          .join("");

  const taskRows =
    d.openTasks.length === 0
      ? emptyRow("No open tasks. Enjoy the free time!")
      : d.openTasks
          .map((tk, i) =>
            listRow({
              title: tk.title,
              meta: [
                tk.dueDate ? `Due ${tk.dueDate}` : "No due date",
                tk.assignee ? `· ${tk.assignee}` : "",
              ]
                .join(" ")
                .trim(),
              last: i === d.openTasks.length - 1,
            }),
          )
          .join("");

  const content = `
    <tr><td style="height:6px;background:${COLORS.brand};font-size:0">&nbsp;</td></tr>
    <tr><td style="padding:24px 24px 4px;font-size:20px;font-weight:700;color:${COLORS.ink}">Your family week ahead</td></tr>
    <tr><td style="padding:2px 24px 0;font-size:13px;color:${COLORS.subtle}">${escapeHtml(d.familyName)} · ${escapeHtml(d.periodLabel)}</td></tr>
    <tr><td style="padding:14px 24px 4px;font-size:14px;line-height:1.6;color:${COLORS.muted}">${escapeHtml(hi)} here's everything that needs your family's attention this week.</td></tr>

    ${sectionTitle("⏰", "Expiring soon")}
    <tr><td style="padding:0 0 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${expiringRows}</table></td></tr>

    ${sectionTitle("📅", "This week's events")}
    <tr><td style="padding:0 0 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${eventRows}</table></td></tr>

    ${sectionTitle("✅", "Open tasks")}
    <tr><td style="padding:0 0 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${taskRows}</table></td></tr>

    <tr><td style="padding:12px 24px 28px">${button("Open Family Vault", d.appUrl)}</td></tr>`;

  return shell({
    preheader: `${d.expiring.length} expiring · ${d.events.length} events · ${d.openTasks.length} open tasks`,
    content,
  });
}

// ── Invite email ──────────────────────────────────────────────────────────────

export function inviteEmail(opts: {
  inviterName: string | null;
  familyName: string;
  inviteUrl: string;
}): string {
  const inviter = opts.inviterName ?? "A family member";
  const content = `
    <tr><td style="height:6px;background:${COLORS.brand};font-size:0">&nbsp;</td></tr>
    <tr><td style="padding:24px 24px 4px;font-size:20px;font-weight:700;color:${COLORS.ink}">You're invited to ${escapeHtml(opts.familyName)} 💌</td></tr>
    <tr><td style="padding:8px 24px 20px;font-size:14px;line-height:1.6;color:${COLORS.muted}">
      ${escapeHtml(inviter)} invited you to join their family vault — a private place for
      your family's important documents, reminders, events, and chat.
      Sign in with this email address to accept.
    </td></tr>
    <tr><td style="padding:0 24px 12px">${button("Join the family", opts.inviteUrl)}</td></tr>
    <tr><td style="padding:0 24px 28px;font-size:12px;color:${COLORS.subtle}">This invite only works for this email address and expires in 7 days.</td></tr>`;

  return shell({
    preheader: `${inviter} invited you to ${opts.familyName} on Family Vault`,
    content,
    footer: "If you weren't expecting this invitation you can safely ignore this email.",
  });
}
