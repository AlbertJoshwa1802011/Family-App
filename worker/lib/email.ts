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

/** From-address for all Family Vault mail. */
const FROM = "Family Vault <reminders@familyvault.app>";

export function isEmailConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY);
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Sends one email. Returns true on a 2xx Resend response, false otherwise
 * (including when email is not configured). Never throws.
 */
export async function sendEmail(env: Env, msg: EmailMessage): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email] skipped (no RESEND_API_KEY): to=${msg.to} subject=${msg.subject}`);
    return false;
  }
  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        ...(msg.text ? { text: msg.text } : {}),
      }),
    });
    if (!res.ok) {
      console.error(`[email] Resend ${res.status} for to=${msg.to}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[email] send failed for to=${msg.to}:`, err);
    return false;
  }
}

export interface ReminderVars {
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  [key: string]: string;
}

/**
 * The built-in (and editable seed) reminder template. Families can override the
 * HTML; the reminder content is injected via {{placeholders}}:
 *   {{heading}} {{body}} {{ctaLabel}} {{ctaUrl}} {{year}}
 */
export const DEFAULT_REMINDER_TEMPLATE = `<!doctype html><html><body style="margin:0;background:#0b1120;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#111827;border-radius:16px;overflow:hidden">
    <tr><td style="padding:24px">
      <h1 style="margin:0 0 12px;font-size:18px;color:#f8fafc">{{heading}}</h1>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#cbd5e1">{{body}}</p>
      <a href="{{ctaUrl}}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:10px">{{ctaLabel}}</a>
    </td></tr>
    <tr><td style="padding:0 24px 24px;font-size:12px;color:#64748b">You're receiving this because reminder emails are enabled in Family Vault. Manage preferences in the app.</td></tr>
  </table>
  </body></html>`;

/**
 * Renders an admin-authored HTML template, substituting {{key}} tokens with the
 * given values. The TEMPLATE is trusted (authored by a family admin); only the
 * VALUES are HTML-escaped to prevent injection via reminder content. Unknown
 * tokens render empty.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    const v = vars[key];
    return v === undefined ? "" : escapeHtml(v);
  });
}

/** Minimal, inline-styled HTML wrapper for a reminder email (built-in default). */
export function reminderEmailHtml(opts: {
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
}): string {
  return renderTemplate(DEFAULT_REMINDER_TEMPLATE, {
    ...opts,
    year: String(new Date().getUTCFullYear()),
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
