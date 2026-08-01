/**
 * Thin Anthropic client wrapper — the only file in the app allowed to import
 * `@anthropic-ai/sdk` for chat. Isolating the SDK call here (mirroring
 * `worker/lib/categorize.ts`) means swapping providers later only touches
 * this one function; `service.ts` and the route only ever see the
 * provider-agnostic types below.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../../types";

export const AI_MODEL = "claude-opus-4-8";

export interface AIToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type AIContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface AIMessage {
  role: "user" | "assistant";
  content: string | AIContentBlock[];
}

export interface AIToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AIChatResult {
  /** Concatenated text blocks from the response, "" if the model only called tools. */
  text: string;
  toolUses: AIToolUse[];
  stopReason: string | null;
  /** Assistant turn content, provider-agnostic — echo back as history to continue a tool-use round. */
  assistantContent: AIContentBlock[];
}

export class AIProviderError extends Error {}

/**
 * Single call to the model. Callers handle the tool-use round trip by passing
 * the prior assistant turn + tool results back in as history.
 */
export async function createAIMessage(
  env: Env,
  opts: {
    system: string;
    messages: AIMessage[];
    tools?: AIToolDef[];
    maxTokens?: number;
  },
): Promise<AIChatResult> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new AIProviderError("ANTHROPIC_API_KEY not configured");
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  let response;
  try {
    response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      // Structurally identical to Anthropic.Messages.MessageParam[]; kept as our
      // own type above so callers never need the SDK's types.
      messages: opts.messages as unknown as Anthropic.Messages.MessageParam[],
      tools: opts.tools,
    });
  } catch (err) {
    throw new AIProviderError(err instanceof Error ? err.message : "AI provider request failed");
  }

  const assistantContent: AIContentBlock[] = response.content.map((b) => {
    if (b.type === "text") return { type: "text", text: b.text };
    if (b.type === "tool_use") {
      return {
        type: "tool_use",
        id: b.id,
        name: b.name,
        input: (b.input ?? {}) as Record<string, unknown>,
      };
    }
    return { type: "text", text: "" };
  });

  const toolUses: AIToolUse[] = assistantContent
    .filter((b): b is Extract<AIContentBlock, { type: "tool_use" }> => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));

  return {
    text: assistantContent
      .filter((b): b is Extract<AIContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim(),
    toolUses,
    stopReason: response.stop_reason,
    assistantContent,
  };
}
