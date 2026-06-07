import type { Env } from "./types";

/**
 * Daily expiry-reminder job (Phase 3 will implement fully).
 *
 * Planned algorithm (RANGE-based, not equality — Cloudflare cron is best-effort):
 *  1. For each user's reminder windows (default [30, 7, 1] from reminder_prefs),
 *     find active documents where `expiry_date <= today + window_days` AND no
 *     reminders_log row exists for (document, recipient, window_days, channel).
 *  2. Insert in-app notifications and (if enabled) send Resend email.
 *  3. Record reminders_log rows (idempotent dedupe so re-runs don't double-send).
 *  4. Throttle email/Drive calls (app-wide token bucket).
 *  5. Health check: ping Drive; on `invalid_grant`, alert the owner (refresh-token SPOF).
 */
export async function runExpiryReminders(_env: Env): Promise<void> {
  // Phase 0 stub — wired to the cron trigger so the schedule path is exercised.
  console.log("[cron] expiry-reminder run (stub) at", new Date().toISOString());
}
