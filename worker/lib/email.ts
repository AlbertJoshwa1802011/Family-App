/**
 * Transactional email.
 *
 * Transport order (first success wins, never throws):
 *  1. Gmail API via the shared storage account (albertjoshrock101@gmail.com
 *     after reconnecting Admin → Storage with gmail.send).
 *  2. Gmail API via the acting user's refresh token (if they granted gmail.send).
 *  3. Resend, if RESEND_API_KEY is set. From-address must be a verified domain
 *     — a personal Gmail address is NOT accepted by Resend.
 */
import type { Env } from "../types";
import { getDb, schema } from "../db/client";
import { eq } from "drizzle-orm";
import { STORAGE_ACCOUNT_ID, getStorageAccessToken } from "./drive";
import { GOOGLE_SCOPES, getUserGoogleAccessToken, userHasScope } from "./google";

const RESEND_API = "https://api.resend.com/emails";
const GMAIL_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const DEFAULT_FROM = "Family Vault <reminders@familyvault.app>";
export const REMINDER_SUBJECT_PREFIX = "[Family Vault reminder]";

function fromAddress(env: Env): string {
  return env.EMAIL_FROM?.trim() || DEFAULT_FROM;
}

export function isEmailConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY);
}

export async function canSendEmail(env: Env, userId?: string): Promise<boolean> {
  if (env.RESEND_API_KEY) return true;
  if (await env.KV.get("storage:refresh_token")) return true;
  if (userId && (await userHasScope(env, userId, GOOGLE_SCOPES.gmailSend))) {
    return true;
  }
  return false;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SendEmailResult {
  ok: boolean;
  via: "gmail" | "resend" | "none";
  from?: string;
  error?: string;
}

function reminderSubject(subject: string): string {
  if (subject.startsWith(REMINDER_SUBJECT_PREFIX)) return subject;
  return `${REMINDER_SUBJECT_PREFIX} ${subject}`;
}

function encodeUtf8Subject(subject: string): string {
  const bytes = new TextEncoder().encode(subject);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(bin)}?=`;
}

function toBase64Url(raw: string): string {
  const bytes = new TextEncoder().encode(raw);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildRfc822(opts: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
}): string {
  const subject = encodeUtf8Subject(opts.subject);
  const text = opts.text ?? opts.html.replace(/<[^>]+>/g, " ");
  return [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    opts.html,
    "",
    text,
  ].join("\r\n");
}

async function sendViaGmail(
  accessToken: string,
  from: string,
  msg: EmailMessage,
): Promise<boolean> {
  const raw = toBase64Url(
    buildRfc822({
      from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  );
  const res = await fetch(GMAIL_SEND, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    console.error(`[email] Gmail ${res.status}: ${await res.text()}`);
    return false;
  }
  return true;
}

async function storageSender(
  env: Env,
): Promise<{ token: string; from: string } | null> {
  try {
    const token = await getStorageAccessToken(env);
    const row = await getDb(env)
      .select({ email: schema.storageAccounts.email })
      .from(schema.storageAccounts)
      .where(eq(schema.storageAccounts.id, STORAGE_ACCOUNT_ID))
      .get();
    const email = row?.email?.trim();
    if (!email) return null;
    return { token, from: `Family Vault <${email}>` };
  } catch {
    return null;
  }
}

async function sendViaResend(env: Env, msg: EmailMessage): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
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
      console.error(`[email] Resend ${res.status} for to=${msg.to}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[email] Resend send failed for to=${msg.to}:`, err);
    return false;
  }
}

/**
 * Sends one email. Returns true on success. Never throws.
 * Prefer `sendEmailDetailed` when the caller needs to know which transport won.
 */
export async function sendEmail(
  env: Env,
  msg: EmailMessage,
  opts: { fromUserId?: string } = {},
): Promise<boolean> {
  const result = await sendEmailDetailed(env, msg, opts);
  return result.ok;
}

export async function sendEmailDetailed(
  env: Env,
  msg: EmailMessage,
  opts: { fromUserId?: string } = {},
): Promise<SendEmailResult> {
  const payload = { ...msg, subject: reminderSubject(msg.subject) };

  const storage = await storageSender(env);
  if (storage) {
    const ok = await sendViaGmail(storage.token, storage.from, payload);
    if (ok) return { ok: true, via: "gmail", from: storage.from };
  }

  if (opts.fromUserId) {
    const token = await getUserGoogleAccessToken(env, opts.fromUserId);
    if (token && (await userHasScope(env, opts.fromUserId, GOOGLE_SCOPES.gmailSend))) {
      const user = await getDb(env)
        .select({ email: schema.users.email, name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, opts.fromUserId))
        .get();
      if (user?.email) {
        const from = user.name
          ? `${user.name} <${user.email}>`
          : user.email;
        const ok = await sendViaGmail(token, from, payload);
        if (ok) return { ok: true, via: "gmail", from };
      }
    }
  }

  if (await sendViaResend(env, payload)) {
    return { ok: true, via: "resend", from: fromAddress(env) };
  }

  if (!env.RESEND_API_KEY && !storage) {
    console.log(
      `[email] skipped (no Gmail token, no RESEND_API_KEY): to=${payload.to} subject=${payload.subject}`,
    );
  }
  return { ok: false, via: "none", error: "email_send_failed" };
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
