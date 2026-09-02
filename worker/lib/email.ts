/**
 * Transactional email via Resend.
 *
 * Email is best-effort and strictly optional: if RESEND_API_KEY is not
 * configured (local dev, tests), sendEmail() logs and returns false rather
 * than throwing — the cron must still record in-app notifications and keep
 * running. Callers only record the `email` reminders_log row when this
 * returns true, so a transient send failure is retried on the next run.
 */
import type { Env } from "../types";

const RESEND_API = "https://api.resend.com/emails";

/**
 * From-address for all Family Vault mail.
 *
 * This CANNOT be an arbitrary personal address (a Gmail account, say): Resend
 * only accepts a From on a domain you have verified with them via DNS. Set
 * EMAIL_FROM to an address on your verified domain; the default is a
 * placeholder and will be rejected until that domain is verified.
 */
const DEFAULT_FROM = "Family Vault <reminders@familyvault.app>";

function fromAddress(env: Env): string {
  return env.EMAIL_FROM?.trim() || DEFAULT_FROM;
}

export function isEmailConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY);
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SendEmailResult {
  ok: boolean;
  error?: string;
}

/**
 * Sends one email. Never throws. Cron callers should use `sendEmail` (boolean).
 * Interactive callers (test-email) use `sendEmailResult` so the UI can show why.
 */
export async function sendEmailResult(
  env: Env,
  msg: EmailMessage,
): Promise<SendEmailResult> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email] skipped (no RESEND_API_KEY): to=${msg.to} subject=${msg.subject}`);
    return { ok: false, error: "email_not_configured" };
  }
  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(env),
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        ...(msg.text ? { text: msg.text } : {}),
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      console.error(`[email] Resend ${res.status} for to=${msg.to}: ${detail}`);
      return { ok: false, error: `resend_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error(`[email] send failed for to=${msg.to}:`, err);
    return { ok: false, error: "email_send_failed" };
  }
}

/**
 * Sends one email. Returns true on a 2xx Resend response, false otherwise
 * (including when email is not configured). Never throws.
 */
export async function sendEmail(env: Env, msg: EmailMessage): Promise<boolean> {
  return (await sendEmailResult(env, msg)).ok;
}

/** Minimal, inline-styled HTML wrapper for a reminder email. */
export function reminderEmailHtml(opts: {
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
}): string {
  const { heading, body, ctaLabel, ctaUrl } = opts;
  return `<!doctype html><html><body style="margin:0;background:#0b1120;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#111827;border-radius:16px;overflow:hidden">
    <tr><td style="padding:24px">
      <h1 style="margin:0 0 12px;font-size:18px;color:#f8fafc">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#cbd5e1">${escapeHtml(body)}</p>
      <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:10px">${escapeHtml(ctaLabel)}</a>
    </td></tr>
    <tr><td style="padding:0 24px 24px;font-size:12px;color:#64748b">You're receiving this because reminder emails are enabled in Family Vault. Manage preferences in the app.</td></tr>
  </table>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
