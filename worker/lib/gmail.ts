/**
 * Send email via the signed-in user's Gmail (gmail.send scope).
 *
 * Used as a fallback for family invites when Resend is not configured.
 * Best-effort: never throws — callers keep the shareable invite link.
 *
 * Requires the user to have consented to
 * `https://www.googleapis.com/auth/gmail.send` (added at Google login).
 * Existing sessions need one sign-out / sign-in to pick up the new scope.
 */

import type { Env } from "../types";
import type { EmailMessage } from "./email";
import {
  clearGoogleAccessTokenCache,
  getGoogleAccessToken,
  GoogleAuthError,
} from "./googleAuth";

const GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export class GoogleGmailError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly insufficientScope = false,
  ) {
    super(message);
    this.name = "GoogleGmailError";
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Gmail `raw` expects URL-safe base64 without padding. */
function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** RFC 2047 encoded-word when the value isn't plain ASCII. */
function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  const b64 = bytesToBase64(new TextEncoder().encode(value));
  return `=?UTF-8?B?${b64}?=`;
}

function formatAddress(email: string, name?: string | null): string {
  const addr = email.trim();
  const display = name?.trim();
  if (!display) return addr;
  // Quote display name if it has specials; always encode non-ASCII.
  const encoded = encodeHeaderValue(display);
  if (encoded !== display || /[",\\]/.test(display)) {
    return `"${encoded.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}" <${addr}>`;
  }
  return `${encoded} <${addr}>`;
}

/**
 * Build a minimal RFC 2822 message for Gmail users.messages.send.
 * Exported for unit tests.
 */
export function buildGmailRawMessage(opts: {
  fromEmail: string;
  fromName?: string | null;
  to: string;
  subject: string;
  html: string;
  text?: string;
}): string {
  const from = formatAddress(opts.fromEmail, opts.fromName);
  const subject = encodeHeaderValue(opts.subject);
  const boundary = `fv_${crypto.randomUUID().replace(/-/g, "")}`;

  const headers = [
    `From: ${from}`,
    `To: ${opts.to.trim()}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
  ];

  let body: string;
  if (opts.text) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      opts.text,
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      opts.html,
      `--${boundary}--`,
      "",
    ].join("\r\n");
  } else {
    headers.push("Content-Type: text/html; charset=UTF-8");
    headers.push("Content-Transfer-Encoding: 7bit");
    body = opts.html;
  }

  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

function classifyGmailError(status: number, body: string): GoogleGmailError {
  const insufficient =
    status === 403 &&
    (/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|Insufficient Permission/i.test(
      body,
    ) ||
      /Request had insufficient authentication scopes/i.test(body));
  return new GoogleGmailError(
    `Gmail API ${status}: ${body}`,
    status,
    insufficient,
  );
}

async function postGmailSend(
  token: string,
  rawBase64Url: string,
): Promise<void> {
  const res = await fetch(GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: rawBase64Url }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw classifyGmailError(res.status, text);
  }
}

/**
 * Send one email as `fromEmail` using the user's Google refresh token.
 * Returns true on success, false otherwise (missing token/scope, API error).
 * Never throws.
 */
export async function sendEmailViaGmail(
  env: Env,
  opts: {
    userId: string;
    fromEmail: string;
    fromName?: string | null;
    message: EmailMessage;
  },
): Promise<boolean> {
  const { userId, fromEmail, fromName, message } = opts;
  if (!fromEmail.trim() || !message.to.trim()) {
    console.log(`[gmail] skipped (missing from/to)`);
    return false;
  }

  try {
    const raw = buildGmailRawMessage({
      fromEmail,
      fromName,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    const rawB64 = toBase64Url(new TextEncoder().encode(raw));

    try {
      await postGmailSend(await getGoogleAccessToken(env, userId), rawB64);
      return true;
    } catch (e) {
      // Stale cache or scope just granted — clear and retry once.
      if (
        e instanceof GoogleGmailError &&
        (e.statusCode === 401 || e.insufficientScope)
      ) {
        await clearGoogleAccessTokenCache(env, userId);
        await postGmailSend(await getGoogleAccessToken(env, userId), rawB64);
        return true;
      }
      throw e;
    }
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      console.log(
        `[gmail] skipped (no Google auth for user=${userId}): ${err.message}`,
      );
      return false;
    }
    if (err instanceof GoogleGmailError && err.insufficientScope) {
      console.log(
        `[gmail] skipped (missing gmail.send — user must re-consent): user=${userId}`,
      );
      return false;
    }
    console.error(`[gmail] send failed for to=${message.to}:`, err);
    return false;
  }
}
