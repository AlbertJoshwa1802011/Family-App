/**
 * Transactional email.
 *
 * Transport order (first success wins, never throws):
 *  1. Gmail API via the acting user (`opts.fromUserId`) when they have
 *     granted `gmail.send` (sign out / sign in once after that scope was added).
 *  2. Gmail API via a platform super-admin (cron, public access-request mail).
 *  3. Resend, if `RESEND_API_KEY` is set. `reminders@familyvault.app` is not a
 *     verified Resend domain — testing mode only delivers to the Resend owner.
 *
 * Money Manager restore (#100) dropped the Gmail path and the Settings
 * test-email route; this restores both so invites / PIN reset / reminders send.
 */
import type { Env } from "../types";
import { getDb, schema } from "../db/client";
import { eq } from "drizzle-orm";
import {
  GMAIL_SEND_SCOPE,
  clearGoogleAccessTokenCache,
  getGoogleAccessToken,
  GoogleAuthError,
  userHasScope,
} from "./googleAuth";

const RESEND_API = "https://api.resend.com/emails";
const GMAIL_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const DEFAULT_FROM = "Family Vault <reminders@familyvault.app>";

function fromAddress(env: Env): string {
  return env.EMAIL_FROM?.trim() || DEFAULT_FROM;
}

export function isEmailConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY);
}

export async function canSendEmail(env: Env, userId?: string): Promise<boolean> {
  if (env.RESEND_API_KEY) return true;
  try {
    if (userId && (await env.KV.get(`user:refresh_token:${userId}`))) return true;
    if (await firstMailerUserId(env, userId)) return true;
  } catch {
    return Boolean(env.RESEND_API_KEY);
  }
  return false;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Optional file attachments (e.g. .ics for Apple/Google Calendar). */
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
  fromUserId?: string;
}

function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
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

function wrapBase64(b64: string): string {
  return b64.replace(/(.{76})/g, "$1\r\n").trim();
}

function buildRfc822(from: string, msg: EmailMessage): string {
  const subject = encodeHeaderValue(msg.subject);
  const attachments = msg.attachments ?? [];
  if (attachments.length === 0) {
    const text = msg.text ?? msg.html.replace(/<[^>]+>/g, " ");
    return [
      `From: ${from}`,
      `To: ${msg.to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "",
      msg.html,
      "",
      text,
    ].join("\r\n");
  }

  const boundary = `fv_${crypto.randomUUID().replace(/-/g, "")}`;
  const parts = [
    `From: ${from}`,
    `To: ${msg.to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "",
    msg.html,
  ];
  for (const a of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${a.contentType ?? "application/octet-stream"}; name="${a.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${a.filename}"`,
      "",
      wrapBase64(a.content),
    );
  }
  parts.push(`--${boundary}--`, "");
  return parts.join("\r\n");
}

function classifyGmailError(status: number, body: string): string {
  if (
    status === 403 &&
    /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|Insufficient Permission|insufficient authentication scopes/i.test(
      body,
    )
  ) {
    return "gmail_missing_scope";
  }
  if (status === 401 || status === 403) return "gmail_auth_failed";
  return "gmail_send_failed";
}

function classifyResendError(status: number, body: string): string {
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

async function sendViaGmail(
  accessToken: string,
  from: string,
  msg: EmailMessage,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(GMAIL_SEND, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: toBase64Url(buildRfc822(from, msg)) }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[email] Gmail ${res.status}: ${text.slice(0, 300)}`);
    return { ok: false, error: classifyGmailError(res.status, text) };
  }
  return { ok: true };
}

async function sendViaUserGmail(
  env: Env,
  userId: string,
  msg: EmailMessage,
): Promise<{ ok: true; from: string } | { ok: false; error: string } | null> {
  try {
    const scopesKnown = Boolean(await env.KV.get(`user:google_scopes:${userId}`));
    if (scopesKnown && !(await userHasScope(env, userId, GMAIL_SEND_SCOPE))) {
      return null;
    }

    const user = await getDb(env)
      .select({ email: schema.users.email, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();
    if (!user?.email) return null;

    const from = user.name ? `${user.name} <${user.email}>` : user.email;
    let token = await getGoogleAccessToken(env, userId);
    let gmail = await sendViaGmail(token, from, msg);
    if (!gmail.ok && (gmail.error === "gmail_auth_failed" || gmail.error === "gmail_missing_scope")) {
      await clearGoogleAccessTokenCache(env, userId);
      token = await getGoogleAccessToken(env, userId);
      gmail = await sendViaGmail(token, from, msg);
    }
    if (gmail.ok) return { ok: true, from };
    return { ok: false, error: gmail.error };
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      console.log(`[email] skipped Gmail for user=${userId}: ${err.message}`);
      return null;
    }
    console.error(`[email] Gmail user send failed for to=${msg.to}:`, err);
    return null;
  }
}

async function firstMailerUserId(env: Env, skipUserId?: string): Promise<string | null> {
  try {
    const rows = await getDb(env)
      .select({ userId: schema.appRoleAssignments.userId })
      .from(schema.appRoleAssignments)
      .where(eq(schema.appRoleAssignments.role, "super_admin"));
    const list = Array.isArray(rows) ? rows : [];
    for (const row of list) {
      if (!row.userId || row.userId === skipUserId) continue;
      if (await env.KV.get(`user:refresh_token:${row.userId}`)) return row.userId;
    }
  } catch {
    return null;
  }
  return null;
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
        from: fromAddress(env),
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
      console.error(`[email] Resend ${res.status} for to=${msg.to}: ${text.slice(0, 300)}`);
      return { ok: false, error: classifyResendError(res.status, text) };
    }
    return { ok: true };
  } catch (err) {
    console.error(`[email] Resend send failed for to=${msg.to}:`, err);
    return { ok: false, error: "resend_send_failed" };
  }
}

/**
 * Sends one email. Returns true on success. Never throws.
 * Prefer `sendEmailDetailed` when the caller needs to know which transport won.
 */
export async function sendEmail(
  env: Env,
  msg: EmailMessage,
  opts: SendEmailOpts = {},
): Promise<boolean> {
  const result = await sendEmailDetailed(env, msg, opts);
  return result.ok;
}

export async function sendEmailDetailed(
  env: Env,
  msg: EmailMessage,
  opts: SendEmailOpts = {},
): Promise<SendEmailResult> {
  let lastError: string | undefined;
  const tried = new Set<string>();

  const tryGmailUser = async (userId: string) => {
    if (tried.has(userId)) return null;
    tried.add(userId);
    return sendViaUserGmail(env, userId, msg);
  };

  if (opts.fromUserId) {
    const userSend = await tryGmailUser(opts.fromUserId);
    if (userSend?.ok) return { ok: true, via: "gmail", from: userSend.from };
    if (userSend && !userSend.ok) lastError = userSend.error;
  }

  const platformId = await firstMailerUserId(env, opts.fromUserId);
  if (platformId) {
    const platformSend = await tryGmailUser(platformId);
    if (platformSend?.ok) return { ok: true, via: "gmail", from: platformSend.from };
    if (platformSend && !platformSend.ok) lastError = platformSend.error;
  }

  const resend = await sendViaResend(env, msg);
  if (resend?.ok) return { ok: true, via: "resend", from: fromAddress(env) };
  if (resend && !resend.ok) lastError = resend.error;

  if (!env.RESEND_API_KEY && tried.size === 0) {
    console.log(
      `[email] skipped (no Gmail token, no RESEND_API_KEY): to=${msg.to} subject=${msg.subject}`,
    );
  }
  return { ok: false, via: "none", error: lastError ?? "email_send_failed" };
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
