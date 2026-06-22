import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, gt } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";

export const messageRoutes = new Hono<HonoEnv>();

const MESSAGE_LIMIT = 100;

const sendSchema = z.object({
  familyId: z.string().min(1),
  body: z.string().min(1).max(4000),
});

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

// GET /messages?familyId=:fid&since=:secs — recent messages (ascending), with
// sender profile. `since` (unix seconds) fetches only newer rows for polling.
messageRoutes.get("/", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const sinceRaw = c.req.query("since");
  const since = sinceRaw ? Number(sinceRaw) : null;

  const db = getDb(c.env);
  const conditions = [eq(schema.messages.familyId, familyId)];
  if (since !== null && Number.isFinite(since)) {
    conditions.push(gt(schema.messages.createdAt, since));
  }

  const rows = await db
    .select({
      id: schema.messages.id,
      userId: schema.messages.userId,
      body: schema.messages.body,
      createdAt: schema.messages.createdAt,
      authorName: schema.users.name,
      authorPicture: schema.users.picture,
    })
    .from(schema.messages)
    .leftJoin(schema.users, eq(schema.messages.userId, schema.users.id))
    .where(and(...(conditions as [typeof conditions[0], ...typeof conditions])))
    // Fetch the most recent N, then present oldest→newest for the thread view.
    .orderBy(desc(schema.messages.createdAt))
    .limit(MESSAGE_LIMIT);

  rows.reverse();
  return c.json({ messages: rows });
});

// POST /messages — send a message to the family thread.
messageRoutes.post("/", requireSession, zv(sendSchema), async (c) => {
  const userId = c.get("userId")!;
  const { familyId, body } = c.req.valid("json");

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const id = crypto.randomUUID();

  await db.insert(schema.messages).values({ id, familyId, userId, body });

  const message = await db
    .select({
      id: schema.messages.id,
      userId: schema.messages.userId,
      body: schema.messages.body,
      createdAt: schema.messages.createdAt,
      authorName: schema.users.name,
      authorPicture: schema.users.picture,
    })
    .from(schema.messages)
    .leftJoin(schema.users, eq(schema.messages.userId, schema.users.id))
    .where(eq(schema.messages.id, id))
    .get();

  return c.json({ message }, 201);
});
