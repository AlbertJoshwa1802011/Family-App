import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { HonoEnv } from "../types";
import { getDb } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { checkRateLimit } from "../lib/rateLimit";
import { chat, AIProviderError } from "../lib/ai/service";
import { MAX_HISTORY_MESSAGES, MAX_MESSAGE_LENGTH } from "../lib/ai/prompts";

export const aiRoutes = new Hono<HonoEnv>();

const historyEntrySchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MAX_MESSAGE_LENGTH),
});

const chatSchema = z.object({
  familyId: z.string().min(1),
  message: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  history: z.array(historyEntrySchema).max(MAX_HISTORY_MESSAGES).optional().default([]),
});

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

// POST /ai/chat — ask the Family App AI Assistant a question, scoped to a family.
aiRoutes.post("/chat", requireSession, zv(chatSchema), async (c) => {
  const userId = c.get("userId")!;
  const { familyId, message, history } = c.req.valid("json");

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: "ai_unavailable" }, 503);
  }

  // AI calls cost real money and hit an external provider — a tighter budget
  // than everyday CRUD endpoints (chat messaging allows 60/min).
  const limited = await checkRateLimit(c, `ai:${userId}`, {
    limit: 20,
    windowSecs: 300,
  });
  if (limited) return limited;

  const db = getDb(c.env);

  try {
    const reply = await chat(
      c.env,
      db,
      { db, familyId, userId, role: membership.role },
      message,
      history,
    );
    return c.json({ reply });
  } catch (err) {
    if (err instanceof AIProviderError) {
      // Never leak provider error details (could include request internals) to the client.
      console.error("AI provider error:", err.message);
      return c.json({ error: "ai_provider_error" }, 502);
    }
    throw err;
  }
});
