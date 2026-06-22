import { getCookie } from "hono/cookie";
import type { Next } from "hono";
import type { AppContext } from "../types";
import { COOKIE_NAME } from "../lib/session";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function allowedOrigins(c: AppContext): Set<string> {
  const allowed = new Set<string>();
  const appOrigin = originOf(c.env?.APP_URL);
  if (appOrigin) allowed.add(appOrigin);
  try {
    allowed.add(new URL(c.req.url).origin);
  } catch {
    // ignore malformed request URL
  }
  return allowed;
}

/**
 * True when the request carries an Origin/Referer that is NOT our own. Used to
 * guard the download proxy (a GET): top-level navigations from our own pages
 * send a same-origin Referer (and no Origin), so legitimate downloads pass even
 * when Referer is stripped, while a cross-site trigger is rejected.
 */
export function hasForeignOrigin(c: AppContext): boolean {
  const candidate =
    originOf(c.req.header("Origin")) ?? originOf(c.req.header("Referer"));
  return candidate !== null && !allowedOrigins(c).has(candidate);
}

/** Route middleware: reject a request that carries an explicitly foreign origin. */
export async function rejectForeignOrigin(c: AppContext, next: Next) {
  if (hasForeignOrigin(c)) return c.json({ error: "forbidden_origin" }, 403);
  return next();
}

/**
 * CSRF defense for credentialed, state-changing requests.
 *
 * The session cookie is SameSite=Lax, which blocks it from riding cross-site
 * sub-requests but still rides top-level navigations. For unsafe methods we
 * therefore require the Origin (or Referer) to match our own origin.
 *
 * Only enforced when a session cookie is actually present: a request with no
 * cookie carries no ambient authority to forge, and still falls through to the
 * 401 in requireSession. Browsers always send Origin on cross-origin/unsafe
 * requests, so a credentialed mutation with a missing/foreign Origin is rejected.
 *
 * (Downloads are GETs and rely on no-CORS + Content-Disposition: attachment —
 * an attacker can trigger them but cannot read the bytes — so they're exempt.)
 */
export async function requireValidOrigin(c: AppContext, next: Next) {
  if (SAFE_METHODS.has(c.req.method)) return next();
  if (!getCookie(c, COOKIE_NAME)) return next();

  const candidate =
    originOf(c.req.header("Origin")) ?? originOf(c.req.header("Referer"));

  if (!candidate || !allowedOrigins(c).has(candidate)) {
    return c.json({ error: "forbidden_origin" }, 403);
  }
  return next();
}
