import type { Next } from "hono";
import type { AppContext } from "../types";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Returns true when the request's browser-attested source (Origin, falling back
 * to Referer) matches this deployment. Session cookies are SameSite=Lax, which
 * still rides on top-level cross-site GET navigations and offers no protection
 * on older browsers — so state-changing routes and the download proxy verify
 * the source explicitly (see CLAUDE.md §8 / ARCHITECTURE Auth).
 *
 * Requests with neither header (curl, server-to-server, tests) are allowed:
 * browsers always attach Origin to cross-site non-GET requests and a Referer
 * to link/form navigations, so a missing header means a non-browser client,
 * which cannot be CSRF'd (it doesn't hold ambient cookies).
 */
export function verifyRequestOrigin(c: AppContext): boolean {
  const allowed = new Set<string>([new URL(c.req.url).origin]);
  const appUrl = c.env?.APP_URL;
  if (appUrl) {
    try {
      allowed.add(new URL(appUrl).origin);
    } catch {
      // Malformed APP_URL var — fall back to the request's own origin only.
    }
  }

  const origin = c.req.header("origin");
  if (origin) return allowed.has(origin);

  const referer = c.req.header("referer");
  if (referer) {
    try {
      return allowed.has(new URL(referer).origin);
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * CSRF middleware for /api/*: rejects state-changing requests (and any route
 * it is applied to directly, e.g. the download proxy GET) whose Origin/Referer
 * points at a foreign site. Runs before session validation so a forged request
 * is refused without touching D1.
 */
export async function csrfProtect(c: AppContext, next: Next) {
  if (!SAFE_METHODS.has(c.req.method.toUpperCase()) && !verifyRequestOrigin(c)) {
    return c.json({ error: "csrf_rejected" }, 403);
  }
  await next();
}

/** Same check for explicitly-protected safe-method routes (download proxy). */
export async function csrfProtectGet(c: AppContext, next: Next) {
  if (!verifyRequestOrigin(c)) {
    return c.json({ error: "csrf_rejected" }, 403);
  }
  await next();
}
