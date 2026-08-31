/**
 * Family Vault AI assistant — Gemini tool-calling chat.
 *
 * POST /ai/chat { familyId, message, history? }
 * Requires session + family membership. Rate-limited. 503 without GEMINI_API_KEY.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { checkRateLimit } from "../lib/rateLimit";
import {
  extractFunctionCalls,
  extractText,
  geminiGenerateContent,
  type GeminiContent,
} from "../lib/ai/gemini";
import {
  AI_TOOL_DECLARATIONS,
  SYSTEM_PROMPT,
  executeAiTool,
} from "../lib/ai/tools";

export const aiRoutes = new Hono<HonoEnv>();

const MAX_TOOL_ROUNDS = 3;

const historyItemSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(8000),
});

const chatSchema = z.object({
  familyId: z.string().min(1),
  message: z.string().min(1).max(4000),
  history: z.array(historyItemSchema).max(20).optional(),
});

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "validation_error", issues: result.error.issues },
        400,
      );
    }
  });
}

aiRoutes.post("/chat", requireSession, zv(chatSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  if (!c.env.GEMINI_API_KEY) {
    return c.json({ error: "ai_unavailable" }, 503);
  }

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  const limited = await checkRateLimit(c, `ai-chat:${userId}`, {
    limit: 20,
    windowSecs: 60,
  });
  if (limited) return limited;

  const db = getDb(c.env);
  const family = await db
    .select({ defaultCurrency: schema.families.defaultCurrency })
    .from(schema.families)
    .where(eq(schema.families.id, data.familyId))
    .get();
  if (!family) return c.json({ error: "not_found" }, 404);

  const memberRow = await db
    .select({ id: schema.familyMembers.id })
    .from(schema.familyMembers)
    .where(
      and(
        eq(schema.familyMembers.familyId, data.familyId),
        eq(schema.familyMembers.userId, userId),
        eq(schema.familyMembers.status, "active"),
      ),
    )
    .get();
  if (!memberRow) return c.json({ error: "not_found" }, 404);

  const contents: GeminiContent[] = [];
  for (const h of data.history ?? []) {
    contents.push({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: h.content }],
    });
  }
  contents.push({ role: "user", parts: [{ text: data.message }] });

  const toolCtx = {
    db,
    familyId: data.familyId,
    userId,
    memberId: memberRow.id,
    currency: family.defaultCurrency,
  };

  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let reply = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await geminiGenerateContent(c.env, {
      systemInstruction: SYSTEM_PROMPT,
      contents,
      tools: AI_TOOL_DECLARATIONS,
    });

    if (result.error) {
      console.error("[ai] gemini error:", result.error);
      return c.json({ error: "ai_unavailable" }, 503);
    }

    const parts = result.candidates?.[0]?.content?.parts;
    const calls = extractFunctionCalls(parts);

    if (calls.length === 0) {
      reply = extractText(parts) || "I couldn't generate a reply.";
      break;
    }

    // Append model turn with function calls, then function responses.
    contents.push({
      role: "model",
      parts: calls.map((call) => ({
        functionCall: { name: call.name, args: call.args },
      })),
    });

    const responseParts: GeminiContent["parts"] = [];
    for (const call of calls) {
      toolCalls.push(call);
      const response = await executeAiTool(toolCtx, call.name, call.args);
      responseParts.push({
        functionResponse: { name: call.name, response },
      });
    }
    contents.push({ role: "user", parts: responseParts });

    // Final round: if tools were called on the last allowed round, do one more
    // generate without forcing another tool loop iteration afterward.
    if (round === MAX_TOOL_ROUNDS - 1) {
      const final = await geminiGenerateContent(c.env, {
        systemInstruction: SYSTEM_PROMPT,
        contents,
        tools: AI_TOOL_DECLARATIONS,
      });
      reply =
        extractText(final.candidates?.[0]?.content?.parts) ||
        "Done — I updated your data.";
    }
  }

  if (!reply) {
    reply = "Done — I updated your data.";
  }

  return c.json({
    reply,
    toolCalls: toolCalls.map((t) => ({ name: t.name, args: t.args })),
  });
});
