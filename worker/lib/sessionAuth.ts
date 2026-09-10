import { getCookie } from "hono/cookie";
import type { AppContext } from "../types";
import { COOKIE_NAME } from "./session";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolve the opaque session id from either:
 * - Cookie `sid` (web PWA), or
 * - `Authorization: Bearer <sessionId>` (Albert iOS companion)
 *
 * Bearer tokens that are not UUID-shaped are ignored (never logged).
 */
export function sessionIdFromRequest(c: AppContext): string | undefined {
  const auth = c.req.header("Authorization");
  if (auth) {
    const match = /^Bearer\s+(\S+)$/i.exec(auth.trim());
    const token = match?.[1];
    if (token && UUID_RE.test(token)) {
      return token;
    }
  }

  const cookie = getCookie(c, COOKIE_NAME);
  return cookie || undefined;
}
