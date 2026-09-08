/**
 * Transactional email.
 *
 * Transport order (first success wins, never throws):
 *  1. Gmail API via the shared storage account (Admin → Storage with gmail.send).
 *     This is what reaches every family member — Resend testing mode cannot.
 *  2. Gmail API via the acting user's refresh token (if they granted gmail.send).
 *  3. Resend, if RESEND_API_KEY is set. Without a verified domain Resend only
 *     delivers to the Resend account owner — other recipients fail with
 *     `resend_testing_recipients`.
 */
import type { Env } from "../types";
import { getDb, schema } from "../db/client";
import { eq } from "drizzle-orm";
import { STORAGE_ACCOUNT_ID, getStorageAccessToken } from "./drive";
import {
  GOOGLE_SCOPES,
  classifyGoogleApiError,
  clearUserGoogleAccessCache,
  getUserGoogleAccessToken,
  scopesKey,
  userHasScope,
} from "./google";

const RESEND_API = "https://api.resend.com/emails";
const GMAIL_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const STORAGE_ACCESS_KEY = "storage:access_token";
const STORAGE_SCOPES_KEY = "storage:scopes";
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

export interface SendEmailOpts {
  fromUserId?: string;
  /** Prefix "[Family Vault reminder]". Default true — cron/reminders. Invites pass false. */
  reminder?: boolean;
}

/** Classify Resend error bodies so callers can explain testing-mode limits. */
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

function storageHasGmailScope(scopeString: string | null): boolean {
  if (!scopeString) return true; // unknown → try; Google will 403 if missing
  return (
    scopeString.includes(GOOGLE_SCOPES.gmailSend) ||
    scopeString.includes("gmail.send")
  );
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
): Promise<{ ok: true } | { ok: false; error: string }> {
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

async function sendViaStorageGmail(
  env: Env,
  payload: EmailMessage,
): Promise<{ ok: true; from: string } | { ok: false; error: string } | null> {
  const scopes = await env.KV.get(STORAGE_SCOPES_KEY);
  if (scopes && !storageHasGmailScope(scopes)) {
    console.error("[email] storage account missing gmail.send — skipping to next transport");
    return null;
  }

  const storage = await storageSender(env);
  if (!storage) return null;

  let gmail = await sendViaGmail(storage.token, storage.from, payload);
  // Stale access token (minted before gmail.send) survives reconnect in KV —
  // drop it once and retry with a freshly refreshed token.
  if (!gmail.ok && gmail.error === "gmail_auth_failed") {
    await env.KV.delete(STORAGE_ACCESS_KEY);
    const again = await storageSender(env);
    if (again) {
      gmail = await sendViaGmail(again.token, again.from, payload);
      if (gmail.ok) return { ok: true, from: again.from };
    }
  }
  if (gmail.ok) return { ok: true, from: storage.from };
  return { ok: false, error: gmail.error };
}

async function sendViaUserGmail(
  env: Env,
  userId: string,
  payload: EmailMessage,
): Promise<{ ok: true; from: string } | { ok: false; error: string } | null> {
  const scopesKnown = Boolean(await env.KV.get(scopesKey(userId)));
  if (scopesKnown && !(await userHasScope(env, userId, GOOGLE_SCOPES.gmailSend))) {
    return null;
  }

  let token = await getUserGoogleAccessToken(env, userId);
  if (!token) return null;

  const user = await getDb(env)
    .select({ email: schema.users.email, name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!user?.email) return null;

  const from = user.name ? `${user.name} <${user.email}>` : user.email;
  let gmail = await sendViaGmail(token, from, payload);
  if (!gmail.ok && gmail.error === "gmail_auth_failed") {
    await clearUserGoogleAccessCache(env, userId);
    token = await getUserGoogleAccessToken(env, userId);
    if (token) {
      gmail = await sendViaGmail(token, from, payload);
    }
  }
  if (gmail.ok) return { ok: true, from };
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
        from: fromAddress(env),
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        ...(msg.text ? { text: msg.text } : {}),
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
  const payload = {
    ...msg,
    subject: opts.reminder === false ? msg.subject : reminderSubject(msg.subject),
  };
  let lastError: string | undefined;

  const storage = await sendViaStorageGmail(env, payload);
  if (storage?.ok) return { ok: true, via: "gmail", from: storage.from };
  if (storage && !storage.ok) lastError = storage.error;

  if (opts.fromUserId) {
    const userSend = await sendViaUserGmail(env, opts.fromUserId, payload);
    if (userSend?.ok) return { ok: true, via: "gmail", from: userSend.from };
    if (userSend && !userSend.ok) lastError = userSend.error;
  }

  const resend = await sendViaResend(env, payload);
  if (resend?.ok) return { ok: true, via: "resend", from: fromAddress(env) };
  if (resend && !resend.ok) lastError = resend.error;

  if (!env.RESEND_API_KEY && !storage) {
    console.log(
      `[email] skipped (no Gmail token, no RESEND_API_KEY): to=${payload.to} subject=${payload.subject}`,
    );
  }
  return {
    ok: false,
    via: "none",
    error: lastError ?? "email_send_failed",
  };
}

/** Alias for interactive callers (test-email, event notify diagnostics). */
export async function sendEmailResult(
  env: Env,
  msg: EmailMessage,
  opts: SendEmailOpts = {},
): Promise<SendEmailResult> {
  return sendEmailDetailed(env, msg, opts);
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
