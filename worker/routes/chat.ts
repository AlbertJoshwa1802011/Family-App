import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { checkRateLimit } from "../lib/rateLimit";
import { findMentions, loadMentionableMembers, notifyMember } from "../lib/mentions";

export const chatRoutes = new Hono<HonoEnv>();

const PAGE_SIZE = 50;

const sendMessageSchema = z.object({
  familyId: z.string().min(1),
  body: z.string().min(1).max(4000),
});

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

// GET /chat?familyId=:id&before=:unix — newest page of messages (paginate back
// with `before`). Returned oldest→newest within the page for direct rendering.
chatRoutes.get("/", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const beforeParam = c.req.query("before");
  const before = beforeParam ? parseInt(beforeParam, 10) : NaN;

  const conditions = [eq(schema.chatMessages.familyId, familyId)];
  if (Number.isFinite(before)) {
    conditions.push(lt(schema.chatMessages.createdAt, before));
  }

  const db = getDb(c.env);
  const rows = await db
    .select({
      id: schema.chatMessages.id,
      userId: schema.chatMessages.userId,
      body: schema.chatMessages.body,
      createdAt: schema.chatMessages.createdAt,
      deletedAt: schema.chatMessages.deletedAt,
      authorName: schema.users.name,
      authorEmail: schema.users.email,
      authorPicture: schema.users.picture,
    })
    .from(schema.chatMessages)
    .leftJoin(schema.users, eq(schema.chatMessages.userId, schema.users.id))
    .where(and(...(conditions as [typeof conditions[0], ...typeof conditions])))
    // rowid tiebreaker: messages in the same second keep insertion order.
    // (qualified — the users join has its own rowid)
    .orderBy(desc(schema.chatMessages.createdAt), desc(sql`"chat_messages".rowid`))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE).reverse();

  // Soft-deleted messages keep their slot but never leak their content.
  const messages = page.map((m) =>
    m.deletedAt !== null
      ? { ...m, body: "", deleted: true }
      : { ...m, deleted: false },
  );

  return c.json({ messages, hasMore });
});

// POST /chat — send a message to the family conversation.
chatRoutes.post("/", requireSession, zv(sendMessageSchema), async (c) => {
  const userId = c.get("userId")!;
  const { familyId, body } = c.req.valid("json");

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  // Generous anti-spam guard; normal chatting never hits it.
  const limited = await checkRateLimit(c, `chat:${userId}`, {
    limit: 60,
    windowSecs: 60,
  });
  if (limited) return limited;

  const db = getDb(c.env);
  const messageId = crypto.randomUUID();
  const trimmed = body.trim();

  await db.insert(schema.chatMessages).values({
    id: messageId,
    familyId,
    userId,
    body: trimmed,
  });

  // @mentions → in-app notification (+email per prefs) for tagged members.
  if (trimmed.includes("@")) {
    const members = await loadMentionableMembers(db, familyId);
    const sender = members.find((m) => m.userId === userId);
    const senderName = sender?.name?.split(" ")[0] ?? "Someone";
    const mentioned = findMentions(trimmed, members).filter(
      (m) => m.userId !== userId,
    );
    const excerpt = trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
    for (const recipient of mentioned) {
      await notifyMember(c.env, db, {
        recipient,
        familyId,
        type: "mention",
        title: `${senderName} mentioned you in family chat`,
        body: excerpt,
        link: "/chat",
      });
    }
  }

  const message = await db
    .select({
      id: schema.chatMessages.id,
      userId: schema.chatMessages.userId,
      body: schema.chatMessages.body,
      createdAt: schema.chatMessages.createdAt,
      authorName: schema.users.name,
      authorEmail: schema.users.email,
      authorPicture: schema.users.picture,
    })
    .from(schema.chatMessages)
    .leftJoin(schema.users, eq(schema.chatMessages.userId, schema.users.id))
    .where(eq(schema.chatMessages.id, messageId))
    .get();

  return c.json({ message: { ...message, deleted: false } }, 201);
});

// DELETE /chat/:id — soft-delete (author, or family admin/owner).
chatRoutes.delete("/:id", requireSession, async (c) => {
  const { id } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const message = await db
    .select()
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.id, id))
    .get();

  if (!message || message.deletedAt !== null) {
    return c.json({ error: "not_found" }, 404);
  }

  const membership = await requireFamilyMember(c, message.familyId);
  if (membership instanceof Response) return membership;

  if (message.userId !== userId && membership.role === "member") {
    return c.json({ error: "forbidden" }, 403);
  }

  await db
    .update(schema.chatMessages)
    .set({ deletedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.chatMessages.id, id));

  return c.json({ ok: true });
});
