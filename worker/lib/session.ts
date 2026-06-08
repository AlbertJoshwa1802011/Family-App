import { eq, lt, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { schema } from "../db/client";

export const SESSION_ABSOLUTE_SECS = 30 * 24 * 3600; // 30 days
export const SESSION_IDLE_SECS = 2 * 3600;           // 2 hours
export const COOKIE_NAME = "sid";

function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

export async function createSession(
  db: Db,
  userId: string,
  userAgent?: string,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = nowSecs();
  await db.insert(schema.sessions).values({
    id,
    userId,
    expiresAt: now + SESSION_ABSOLUTE_SECS,
    idleExpiresAt: now + SESSION_IDLE_SECS,
    lastSeenAt: now,
    userAgent,
  });
  return id;
}

/**
 * Validates a session, sliding the idle window on success.
 * Deletes expired sessions on access. Returns null if invalid.
 */
export async function validateSession(
  db: Db,
  sessionId: string,
): Promise<{ userId: string } | null> {
  const now = nowSecs();

  const session = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .get();

  if (!session) return null;

  if (session.expiresAt < now || session.idleExpiresAt < now) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
    return null;
  }

  // Slide idle window on every authenticated request
  await db
    .update(schema.sessions)
    .set({ idleExpiresAt: now + SESSION_IDLE_SECS, lastSeenAt: now })
    .where(eq(schema.sessions.id, sessionId));

  return { userId: session.userId };
}

export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
}

/** Purge expired sessions — called from the cleanup cron. */
export async function purgeExpiredSessions(db: Db): Promise<void> {
  const now = nowSecs();
  await db
    .delete(schema.sessions)
    .where(
      or(lt(schema.sessions.expiresAt, now), lt(schema.sessions.idleExpiresAt, now)),
    );
}
