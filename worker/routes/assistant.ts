import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { checkRateLimit } from "../lib/rateLimit";
import {
  assistantProvider,
  isAssistantConfigured,
  loadAssistantHistory,
  runAssistantTurn,
} from "../lib/assistant";

export const assistantRoutes = new Hono<HonoEnv>();

const chatSchema = z.object({
  familyId: z.string().min(1),
  message: z.string().min(1).max(2000),
});

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

// GET /assistant?familyId= — this user's private thread with the assistant.
assistantRoutes.get("/", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const userId = c.get("userId")!;
  const db = getDb(c.env);
  const messages = await loadAssistantHistory(db, familyId, userId);
  return c.json({
    messages,
    configured: isAssistantConfigured(c.env),
    provider: assistantProvider(c.env),
  });
});

// POST /assistant — send a message; runs tools against this family.
assistantRoutes.post("/", requireSession, zv(chatSchema), async (c) => {
  const userId = c.get("userId")!;
  const { familyId, message } = c.req.valid("json");

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  if (!isAssistantConfigured(c.env)) {
    return c.json({ error: "ai_not_configured" }, 503);
  }

  const limited = await checkRateLimit(c, `assistant:${userId}`, {
    limit: 20,
    windowSecs: 600,
  });
  if (limited) return limited;

  const db = getDb(c.env);
  const trimmed = message.trim();

  let turn: Awaited<ReturnType<typeof runAssistantTurn>>;
  try {
    turn = await runAssistantTurn({
      env: c.env,
      db,
      familyId,
      userId,
      role: membership.role,
      message: trimmed,
    });
  } catch (err) {
    console.error("[assistant] turn failed:", err);
    return c.json({ error: "ai_unavailable" }, 502);
  }

  const now = Math.floor(Date.now() / 1000);
  const userMsgId = crypto.randomUUID();
  const assistantMsgId = crypto.randomUUID();

  await db.insert(schema.assistantMessages).values([
    {
      id: userMsgId,
      familyId,
      userId,
      role: "user",
      body: trimmed,
      createdAt: now,
    },
    {
      id: assistantMsgId,
      familyId,
      userId,
      role: "assistant",
      body: turn.reply,
      actionsJson: turn.actions.length > 0 ? JSON.stringify(turn.actions) : null,
      createdAt: now + 1,
    },
  ]);

  return c.json(
    {
      reply: turn.reply,
      actions: turn.actions,
      message: {
        id: assistantMsgId,
        role: "assistant" as const,
        body: turn.reply,
        createdAt: now + 1,
        actions: turn.actions,
      },
    },
    201,
  );
});
