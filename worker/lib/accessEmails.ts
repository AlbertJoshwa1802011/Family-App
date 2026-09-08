/**
 * Closed-signup email HTML (demo request + approve/reject).
 * Table layout + inline styles only — email-client safe.
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
};

function shell(opts: { preheader: string; content: string; footer?: string }): string {
  const footer =
    opts.footer ??
    "You're receiving this because you're listed as a Family Vault access admin.";
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${COLORS.canvas};${FONT}">
  <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(opts.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.canvas}">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
        <tr><td style="padding:0 4px 16px">
          <span style="display:inline-block;background:${COLORS.brand};color:#ffffff;font-size:14px;font-weight:700;letter-spacing:.02em;padding:8px 14px;border-radius:10px">Family Vault</span>
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

export function demoRequestNotifyEmail(opts: {
  name: string;
  email: string;
  company: string | null;
  message: string | null;
  approveUrl: string;
  rejectUrl: string;
  adminUrl: string;
}): string {
  const companyRow = opts.company
    ? `<tr><td style="padding:4px 24px;font-size:14px;color:${COLORS.muted}"><strong style="color:${COLORS.ink}">Company:</strong> ${escapeHtml(opts.company)}</td></tr>`
    : "";
  const messageRow = opts.message
    ? `<tr><td style="padding:12px 24px 8px;font-size:14px;line-height:1.6;color:${COLORS.muted}">${escapeHtml(opts.message)}</td></tr>`
    : "";

  const content = `
    <tr><td style="height:6px;background:${COLORS.brand};font-size:0">&nbsp;</td></tr>
    <tr><td style="padding:24px 24px 4px;font-size:20px;font-weight:700;color:${COLORS.ink}">New access request</td></tr>
    <tr><td style="padding:8px 24px 12px;font-size:14px;line-height:1.6;color:${COLORS.muted}">
      Someone asked for access to Family Vault. Approve them to let them sign in with Google,
      or reject if it isn't a fit.
    </td></tr>
    <tr><td style="padding:4px 24px;font-size:14px;color:${COLORS.muted}"><strong style="color:${COLORS.ink}">Name:</strong> ${escapeHtml(opts.name)}</td></tr>
    <tr><td style="padding:4px 24px;font-size:14px;color:${COLORS.muted}"><strong style="color:${COLORS.ink}">Email:</strong> ${escapeHtml(opts.email)}</td></tr>
    ${companyRow}
    ${messageRow}
    <tr><td style="padding:16px 24px 8px">${button("Approve access", opts.approveUrl)}</td></tr>
    <tr><td style="padding:0 24px 8px">${button("Reject", opts.rejectUrl)}</td></tr>
    <tr><td style="padding:8px 24px 8px;font-size:12px;line-height:1.6;color:${COLORS.subtle};word-break:break-all">
      If the button doesn't open, use this link:<br>
      <a href="${escapeHtml(opts.approveUrl)}" style="color:${COLORS.brand}">${escapeHtml(opts.approveUrl)}</a>
    </td></tr>
    <tr><td style="padding:8px 24px 28px;font-size:12px;color:${COLORS.subtle}">
      Or review in the app: <a href="${escapeHtml(opts.adminUrl)}" style="color:${COLORS.brand}">Open admin</a>
    </td></tr>`;

  return shell({
    preheader: `Access request from ${opts.name} (${opts.email})`,
    content,
  });
}

export function demoRequestReceivedEmail(opts: {
  name: string;
  appUrl: string;
}): string {
  const content = `
    <tr><td style="height:6px;background:${COLORS.brand};font-size:0">&nbsp;</td></tr>
    <tr><td style="padding:24px 24px 4px;font-size:20px;font-weight:700;color:${COLORS.ink}">We got your request</td></tr>
    <tr><td style="padding:8px 24px 20px;font-size:14px;line-height:1.6;color:${COLORS.muted}">
      Thanks${opts.name ? `, ${escapeHtml(opts.name)}` : ""} — a Family Vault admin will review your
      request shortly. You'll get another email when you're approved to sign in.
    </td></tr>
    <tr><td style="padding:0 24px 28px">${button("Visit Family Vault", opts.appUrl)}</td></tr>`;

  return shell({
    preheader: "Your Family Vault access request was received",
    content,
    footer: "If you didn't request this, you can ignore this email.",
  });
}

export function accessApprovedEmail(opts: {
  name: string | null;
  loginUrl: string;
}): string {
  const greet = opts.name ? `Hi ${escapeHtml(opts.name)},` : "Hi,";
  const content = `
    <tr><td style="height:6px;background:${COLORS.brand};font-size:0">&nbsp;</td></tr>
    <tr><td style="padding:24px 24px 4px;font-size:20px;font-weight:700;color:${COLORS.ink}">You're in — sign in to Family Vault</td></tr>
    <tr><td style="padding:8px 24px 20px;font-size:14px;line-height:1.6;color:${COLORS.muted}">
      ${greet} your access was approved. Sign in with the same Google account you used in
      your request to get started with your family.
    </td></tr>
    <tr><td style="padding:0 24px 28px">${button("Sign in with Google", opts.loginUrl)}</td></tr>`;

  return shell({
    preheader: "Your Family Vault access was approved",
    content,
    footer: "If you weren't expecting this, contact the person who invited you.",
  });
}

/** Browser landing page after an email approve/reject click — no JS, no SPA. */
export function accessReviewResultHtml(opts: {
  kind: "approved" | "rejected" | "already" | "error";
  title: string;
  message: string;
  adminUrl: string;
  loginUrl: string;
}): string {
  const tone =
    opts.kind === "approved"
      ? "#34d399"
      : opts.kind === "rejected" || opts.kind === "error"
        ? "#f87171"
        : "#818cf8";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;min-height:100dvh;display:grid;place-items:center;background:#070b14;color:#e2e8f0;font-family:system-ui,sans-serif;padding:24px">
  <div style="max-width:28rem;text-align:center">
    <div style="margin:0 auto;width:4.5rem;height:4.5rem;border-radius:1.5rem;background:#312e81;display:grid;place-items:center">
      <span style="font-size:1.75rem;color:${tone}">●</span>
    </div>
    <h1 style="margin:24px 0 12px;font-size:1.5rem">${escapeHtml(opts.title)}</h1>
    <p style="margin:0;line-height:1.6;color:#94a3b8">${escapeHtml(opts.message)}</p>
    <p style="margin:32px 0 0">
      <a href="${escapeHtml(opts.adminUrl)}" style="display:inline-block;background:#fff;color:#0f172a;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">Open app access</a>
    </p>
    <p style="margin:16px 0 0">
      <a href="${escapeHtml(opts.loginUrl)}" style="color:#94a3b8;font-size:12px">Back to login</a>
    </p>
  </div>
</body>
</html>`;
}

export function accessRejectedEmail(opts: { name: string | null }): string {
  const greet = opts.name ? `Hi ${escapeHtml(opts.name)},` : "Hi,";
  const content = `
    <tr><td style="height:6px;background:${COLORS.brand};font-size:0">&nbsp;</td></tr>
    <tr><td style="padding:24px 24px 4px;font-size:20px;font-weight:700;color:${COLORS.ink}">Access request update</td></tr>
    <tr><td style="padding:8px 24px 28px;font-size:14px;line-height:1.6;color:${COLORS.muted}">
      ${greet} we aren't able to approve access right now. If you think this is a mistake,
      reply to the person who manages your family's Family Vault.
    </td></tr>`;

  return shell({
    preheader: "Update on your Family Vault access request",
    content,
    footer: "If you weren't expecting this, you can ignore this email.",
  });
}
