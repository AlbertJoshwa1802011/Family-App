import { getCookie } from "hono/cookie";
import type { Next } from "hono";
import type { AppContext } from "../types";
import { getDb } from "../db/client";
import { validateSession, COOKIE_NAME } from "../lib/session";

/**
 * Middleware that validates the session cookie and sets c.var.userId.
 * Returns 401 if no valid session is found.
 * Must be applied before any handler that requires authentication.
 */
export async function requireSession(c: AppContext, next: Next) {
  const sessionId = getCookie(c, COOKIE_NAME);
  if (!sessionId) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const db = getDb(c.env);
  const result = await validateSession(db, sessionId);
  if (!result) {
    return c.json({ error: "unauthorized" }, 401);
  }

  c.set("userId", result.userId);
  await next();
}
