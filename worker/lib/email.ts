/**
 * Transactional email.
 *
 * Transport order (first success wins, never throws):
 *  1. Gmail API as the acting user when `opts.fromUserId` is set and that
 *     user's token includes gmail.send (Settings → Connect Gmail).
 *  2. Resend, when RESEND_API_KEY is set.
 *
 * Enabling Gmail API in Google Cloud Console alone does not send mail —
 * the signed-in user must also grant gmail.send on their OAuth token.
 */
import { eq } from "drizzle-orm";
import type { Env } from "../types";
import { getDb, schema } from "../db/client";
import {
  GOOGLE_SCOPES,
  classifyGoogleApiError,
  clearGoogleAccessTokenCache,
  getGoogleAccessTokenOrNull,
  scopesKey,
  userHasScope,
} from "./googleAuth";

const RESEND_API = "https://api.resend.com/emails";
const GMAIL_SEND =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const FROM = "Family Vault <reminders@familyvault.app>";

export function isEmailConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY);
}

/** True when Resend is configured or the user can send via Gmail. */
export async function canSendEmail(
  env: Env,
  userId?: string,
): Promise<boolean> {
  if (env.RESEND_API_KEY) return true;
  if (!userId) return false;
  if (await userHasScope(env, userId, GOOGLE_SCOPES.gmailSend)) return true;
  // Older sessions may lack a scopes KV entry — still try if a refresh token exists.
  return Boolean(await env.KV.get(`user:refresh_token:${userId}`));
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: string; // base64
    contentType?: string;
  }>;
}

export interface SendEmailResult {
  ok: boolean;
  via: "gmail" | "resend" | "none";
  from?: string;
  error?: string;
}

export interface SendEmailOpts {
  /** Prefer sending as this user's Gmail (requires gmail.send). */
  fromUserId?: string;
}

export function classifyResendError(status: number, body: string): string {
  const text = body.toLowerCase();
  if (
    text.includes("only send testing emails to your own") ||
    text.includes("you can only send testing emails") ||
    text.includes("verify a domain") ||
    (status === 403 && text.includes("testing"))
  ) {
    return "resend_testing_recipients";
  }
  if (status === 403 || status === 422) return "resend_rejected";
  return "resend_send_failed";
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
}): string {
  const subject = encodeUtf8Subject(opts.subject);
  return [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    opts.html,
  ].join("\r\n");
}

async function sendViaGmailApi(
  accessToken: string,
  from: string,
  msg: EmailMessage,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (msg.attachments && msg.attachments.length > 0) {
    return { ok: false, error: "gmail_attachments_unsupported" };
  }
  const raw = toBase64Url(
    buildRfc822({
      from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
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
    const text = await res.text();
    console.error(`[email] Gmail ${res.status}: ${text}`);
    const kind = classifyGoogleApiError(res.status, text);
    if (kind === "api_disabled") return { ok: false, error: "gmail_api_disabled" };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "gmail_auth_failed" };
    }
    return { ok: false, error: "gmail_send_failed" };
  }
  return { ok: true };
}

async function sendViaUserGmail(
  env: Env,
  userId: string,
  msg: EmailMessage,
): Promise<{ ok: true; from: string } | { ok: false; error: string } | null> {
  const scopesKnown = Boolean(await env.KV.get(scopesKey(userId)));
  if (
    scopesKnown &&
    !(await userHasScope(env, userId, GOOGLE_SCOPES.gmailSend))
  ) {
    return null;
  }

  let token = await getGoogleAccessTokenOrNull(env, userId);
  if (!token) return null;

  const user = await getDb(env)
    .select({ email: schema.users.email, name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!user?.email) return null;

  const from = user.name ? `${user.name} <${user.email}>` : user.email;
  let gmail = await sendViaGmailApi(token, from, msg);
  if (!gmail.ok && gmail.error === "gmail_auth_failed") {
    await clearGoogleAccessTokenCache(env, userId);
    token = await getGoogleAccessTokenOrNull(env, userId);
    if (token) gmail = await sendViaGmailApi(token, from, msg);
  }
  if (gmail.ok) return { ok: true, from };
  if (gmail.error === "gmail_attachments_unsupported") return null;
  return { ok: false, error: gmail.error };
}

async function sendViaResend(
  env: Env,
  msg: EmailMessage,
): Promise<{ ok: true } | { ok: false; error: string } | null> {
  if (!env.RESEND_API_KEY) return null;
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
        ...(msg.attachments && msg.attachments.length > 0
          ? {
              attachments: msg.attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
                content_type: a.contentType ?? "application/octet-stream",
              })),
            }
          : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(
        `[email] Resend ${res.status} for to=${msg.to}: ${text.slice(0, 300)}`,
      );
      return { ok: false, error: classifyResendError(res.status, text) };
    }
    return { ok: true };
  } catch (err) {
    console.error(`[email] Resend send failed for to=${msg.to}:`, err);
    return { ok: false, error: "resend_send_failed" };
  }
}

export async function sendEmailDetailed(
  env: Env,
  msg: EmailMessage,
  opts: SendEmailOpts = {},
): Promise<SendEmailResult> {
  let lastError: string | undefined;

  if (opts.fromUserId) {
    const userSend = await sendViaUserGmail(env, opts.fromUserId, msg);
    if (userSend?.ok) return { ok: true, via: "gmail", from: userSend.from };
    if (userSend && !userSend.ok) lastError = userSend.error;
  }

  const resend = await sendViaResend(env, msg);
  if (resend?.ok) return { ok: true, via: "resend", from: FROM };
  if (resend && !resend.ok) lastError = resend.error;

  if (!env.RESEND_API_KEY && !opts.fromUserId) {
    console.log(
      `[email] skipped (no RESEND_API_KEY): to=${msg.to} subject=${msg.subject}`,
    );
  }
  return {
    ok: false,
    via: "none",
    error: lastError ?? "email_send_failed",
  };
}

/**
 * Sends one email. Returns true on success. Never throws.
 * Pass `opts.fromUserId` to try the user's Gmail before Resend.
 */
export async function sendEmail(
  env: Env,
  msg: EmailMessage,
  opts: SendEmailOpts = {},
): Promise<boolean> {
  return (await sendEmailDetailed(env, msg, opts)).ok;
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
