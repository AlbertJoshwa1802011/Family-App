export class ApiError extends Error {
  constructor(
    public status: number,
    /** Machine-readable API error code (e.g. "invite_expired"). */
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Human-friendly messages for API error codes. Anything not listed falls back
 * to a generic sentence — users should never see raw snake_case codes.
 */
const ERROR_MESSAGES: Record<string, string> = {
  validation_error: "Some of the details don't look right — please check and try again.",
  unauthorized: "Your session has expired. Please sign in again.",
  forbidden: "You don't have permission to do that.",
  not_found: "That item doesn't exist or you don't have access to it.",
  rate_limited: "You're doing that a little too fast — give it a moment and try again.",
  csrf_rejected: "That request couldn't be verified. Refresh the page and try again.",
  payload_too_large: "That's too large to send — try something smaller.",
  invite_expired: "This invite has expired — ask for a new one.",
  invite_already_used: "This invite has already been used.",
  invite_email_mismatch:
    "This invite was sent to a different email. Sign in with the invited Google account.",
  module_disabled:
    "That area isn't available for your account in this family.",
  access_denied:
    "This app is invite-only. Request a demo and wait for approval before signing in.",
  access_revoked: "Your access was revoked. Contact your team admin for help.",
  already_reviewed: "That request was already approved or rejected.",
  already_a_member: "You're already a member of this family.",
  invalid_member_ids: "That person isn't part of this family.",
  invalid_document_ids: "That document isn't part of this family.",
  invalid_event_id: "That event isn't part of this family.",
  invalid_parent_id: "That parent task isn't part of this family.",
  invalid_notebook_id: "That folder isn't part of this family.",
  max_task_depth: "That's as deep as subtasks can go — try grouping under a higher task.",
  task_cycle: "A task can't be nested under itself or one of its own subtasks.",
  drive_not_configured:
    "File storage isn't connected yet — ask the family owner to finish Google Drive setup.",
  drive_error: "Google Drive had a hiccup — please try again in a moment.",
  oauth_not_configured: "Sign-in isn't configured on this server yet.",
  cannot_modify_owner: "The family owner's role can't be changed.",
  ai_not_configured:
    "The family assistant isn't set up yet — ask the owner to add a Gemini API key.",
  ai_unavailable: "The assistant had a hiccup — please try again in a moment.",
  location_sharing_disabled:
    "Turn on location sharing before the app can save your travel trail.",
  invalid_range: "That date range isn't valid.",
  range_too_large: "Pick a shorter range — up to 31 days at a time.",
  invalid_week: "That week selection isn't valid.",
  internal_error: "Something went wrong on our side — please try again.",
  email_not_configured:
    "Email isn't connected yet — Connect Gmail in Settings or ask an admin to set RESEND_API_KEY.",
  gmail_api_disabled:
    "Enable Gmail API in Google Cloud, then Connect Gmail in Settings again.",
  gmail_auth_failed:
    "Gmail rejected the send — Connect Gmail in Settings and approve gmail.send.",
  resend_testing_recipients:
    "Resend can only email its account owner in testing mode — Connect Gmail instead.",
  email_send_failed: "Could not send that email — try Connect Gmail in Settings.",
};

export function friendlyMessage(code: string, status: number): string {
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  if (status >= 500) return ERROR_MESSAGES.internal_error;
  return "That didn't work — please try again.";
}

/** Thin fetch wrapper for the same-origin /api backend. */
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  // Spread `options` first so `credentials` / merged `headers` cannot be
  // overwritten by a caller (the previous order dropped Content-Type whenever
  // `options.headers` was passed).
  const res = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    let code = res.statusText;
    let serverMessage: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      if (body?.error) code = body.error;
      if (body?.message) serverMessage = body.message;
    } catch {
      // non-JSON error body — keep statusText as the code
    }
    throw new ApiError(
      res.status,
      code,
      serverMessage ?? friendlyMessage(code, res.status),
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
