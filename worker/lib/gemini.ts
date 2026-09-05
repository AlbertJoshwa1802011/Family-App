/**
 * Gemini REST adapter for the family assistant.
 *
 * Maps our Anthropic-shaped tool loop (Message / MessageParam / tool_use)
 * onto Google's generateContent function-calling protocol so runAssistantTurn
 * stays provider-agnostic. No SDK — just fetch — so tests can stub the HTTP
 * call and so we don't add another runtime dependency.
 *
 * Model: gemini-2.5-flash. Swap GEMINI_MODEL if Google retires the id.
 */
import type { Message, MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type Anthropic from "@anthropic-ai/sdk";

export const GEMINI_MODEL = "gemini-2.5-flash";
export const GEMINI_GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const MAX_TOKENS = 1024;

const TYPE_MAP: Record<string, string> = {
  object: "OBJECT",
  string: "STRING",
  number: "NUMBER",
  integer: "INTEGER",
  boolean: "BOOLEAN",
  array: "ARRAY",
};

interface GeminiPart {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface GeminiGenerateResponse {
  candidates?: {
    content?: { role?: string; parts?: GeminiPart[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof schema.type === "string") {
    const mapped = TYPE_MAP[schema.type.toLowerCase()];
    if (mapped) out.type = mapped;
  }
  if (typeof schema.description === "string") out.description = schema.description;
  if (Array.isArray(schema.enum)) out.enum = schema.enum;
  if (schema.properties && typeof schema.properties === "object") {
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      schema.properties as Record<string, unknown>,
    )) {
      if (value && typeof value === "object") {
        props[key] = toGeminiSchema(value as Record<string, unknown>);
      }
    }
    out.properties = props;
  }
  if (Array.isArray(schema.required)) out.required = schema.required;
  if (schema.items && typeof schema.items === "object") {
    out.items = toGeminiSchema(schema.items as Record<string, unknown>);
  }
  return out;
}

export function toGeminiFunctionDeclarations(
  tools: Anthropic.Tool[],
): { name: string; description: string; parameters: Record<string, unknown> }[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    parameters: toGeminiSchema(tool.input_schema as Record<string, unknown>),
  }));
}

function toolUseNameById(messages: MessageParam[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        block.type === "tool_use" &&
        "id" in block &&
        "name" in block
      ) {
        map.set(String(block.id), String(block.name));
      }
    }
  }
  return map;
}

function parseToolResultPayload(content: unknown): Record<string, unknown> {
  if (typeof content === "string") {
    try {
      const parsed: unknown = JSON.parse(content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return { result: parsed };
    } catch {
      return { result: content };
    }
  }
  if (content && typeof content === "object" && !Array.isArray(content)) {
    return content as Record<string, unknown>;
  }
  return { result: content ?? null };
}

export function toGeminiContents(messages: MessageParam[]): GeminiContent[] {
  const names = toolUseNameById(messages);
  const contents: GeminiContent[] = [];

  for (const msg of messages) {
    const role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
    const parts: GeminiPart[] = [];

    if (typeof msg.content === "string") {
      if (msg.content.length > 0) parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === "string") {
          parts.push({ text: block });
          continue;
        }
        if (!block || typeof block !== "object" || !("type" in block)) continue;
        if (block.type === "text" && "text" in block) {
          parts.push({ text: String(block.text) });
        } else if (block.type === "tool_use" && "name" in block) {
          const args =
            "input" in block && block.input && typeof block.input === "object"
              ? (block.input as Record<string, unknown>)
              : {};
          parts.push({ functionCall: { name: String(block.name), args } });
        } else if (block.type === "tool_result" && "tool_use_id" in block) {
          const name = names.get(String(block.tool_use_id)) ?? "unknown";
          const payload = parseToolResultPayload(
            "content" in block ? block.content : undefined,
          );
          if ("is_error" in block && block.is_error) payload.is_error = true;
          parts.push({ functionResponse: { name, response: payload } });
        }
      }
    }

    if (parts.length === 0) parts.push({ text: "" });
    contents.push({ role, parts });
  }

  return contents;
}

function fakeMessage(content: Message["content"], stopReason: Message["stop_reason"]): Message {
  return {
    id: "msg_gemini",
    type: "message",
    role: "assistant",
    content,
    model: GEMINI_MODEL,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as Message;
}

export function fromGeminiResponse(json: GeminiGenerateResponse): Message {
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const blocks: Message["content"] = [];
  let callIndex = 0;

  for (const part of parts) {
    if (part.thought) continue;
    if (part.functionCall?.name) {
      callIndex += 1;
      blocks.push({
        type: "tool_use",
        id: `call_${callIndex}_${part.functionCall.name}`,
        name: part.functionCall.name,
        input: part.functionCall.args ?? {},
      } as Message["content"][number]);
    } else if (typeof part.text === "string" && part.text.length > 0) {
      blocks.push({ type: "text", text: part.text } as Message["content"][number]);
    }
  }

  if (blocks.length === 0) {
    const blocked = json.promptFeedback?.blockReason;
    return fakeMessage(
      [
        {
          type: "text",
          text: blocked
            ? "I couldn't respond to that."
            : "I wasn't able to finish that. Please try again.",
        } as Message["content"][number],
      ],
      "end_turn",
    );
  }

  const usedTool = blocks.some((b) => b.type === "tool_use");
  return fakeMessage(blocks, usedTool ? "tool_use" : "end_turn");
}

export async function geminiComplete(
  apiKey: string,
  args: {
    system: string;
    tools: Anthropic.Tool[];
    messages: MessageParam[];
  },
): Promise<Message> {
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: args.system }] },
    contents: toGeminiContents(args.messages),
    generationConfig: { maxOutputTokens: MAX_TOKENS, temperature: 0.3 },
  };
  if (args.tools.length > 0) {
    body.tools = [{ functionDeclarations: toGeminiFunctionDeclarations(args.tools) }];
    body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
  }

  const res = await fetch(GEMINI_GENERATE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`gemini_http_${res.status}:${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as GeminiGenerateResponse;
  if (json.error?.message) {
    throw new Error(`gemini_error:${json.error.message}`);
  }
  return fromGeminiResponse(json);
}
