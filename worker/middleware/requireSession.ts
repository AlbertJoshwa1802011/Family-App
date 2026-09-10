import type { Next } from "hono";
import type { AppContext } from "../types";
import { getDb } from "../db/client";
import { validateSession } from "../lib/session";
import { sessionIdFromRequest } from "../lib/sessionAuth";

/**
 * Middleware that validates the session (cookie `sid` or Bearer token)
 * and sets c.var.userId. Returns 401 if no valid session is found.
 */
export async function requireSession(c: AppContext, next: Next) {
  const sessionId = sessionIdFromRequest(c);
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
