/**
 * AI chat orchestration: route → service → provider (client.ts).
 *
 * Builds the system prompt + bounded message history, gives the model the
 * read-only tools in tools.ts, and — if the model asks for one — executes it
 * server-side (scoped to the caller's own family) and feeds the result back
 * for a single follow-up turn. Capped at MAX_TOOL_ROUNDS so a confused model
 * can't loop indefinitely or run up API cost.
 */
import type { Env } from "../../types";
import type { Db } from "../../db/client";
import { schema } from "../../db/client";
import { eq } from "drizzle-orm";
import {
  createAIMessage,
  AIProviderError,
  type AIMessage,
  type AIContentBlock,
} from "./client";
import { AI_TOOLS, executeTool, type ToolScope } from "./tools";
import {
  buildSystemPrompt,
  MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_LENGTH,
  MAX_TOOL_ROUNDS,
} from "./prompts";

export { AIProviderError };

export interface ChatHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

const FALLBACK_REPLY =
  "I couldn't put together a response for that — could you try rephrasing?";

function clamp(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

export async function chat(
  env: Env,
  db: Db,
  scope: ToolScope,
  userMessage: string,
  history: ChatHistoryEntry[],
): Promise<string> {
  const family = await db
    .select({ name: schema.families.name })
    .from(schema.families)
    .where(eq(schema.families.id, scope.familyId))
    .get();

  const system = buildSystemPrompt(family?.name ?? "your family");

  const boundedHistory = history
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m): AIMessage => ({ role: m.role, content: clamp(m.content, MAX_MESSAGE_LENGTH) }));

  const messages: AIMessage[] = [
    ...boundedHistory,
    { role: "user", content: clamp(userMessage, MAX_MESSAGE_LENGTH) },
  ];

  let result = await createAIMessage(env, { system, messages, tools: AI_TOOLS });

  let round = 0;
  while (result.toolUses.length > 0 && round < MAX_TOOL_ROUNDS) {
    round += 1;

    const toolResults: Extract<AIContentBlock, { type: "tool_result" }>[] = [];
    for (const use of result.toolUses) {
      const output = await executeTool(scope, use.name, use.input);
      toolResults.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(output),
      });
    }

    messages.push({ role: "assistant", content: result.assistantContent });
    messages.push({ role: "user", content: toolResults });

    // Final round: no tools offered, so the model must answer in text now.
    result = await createAIMessage(env, { system, messages });
  }

  return result.text || FALLBACK_REPLY;
}
