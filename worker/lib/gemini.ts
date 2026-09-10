/**
 * Gemini REST adapter for the family assistant.
 *
 * Maps our Anthropic-shaped tool loop (Message / MessageParam / tool_use)
 * onto Google's generateContent function-calling protocol so runAssistantTurn
 * stays provider-agnostic. No SDK — just fetch — so tests can stub the HTTP
 * call and so we don't add another runtime dependency.
 *
 * Model pick: prefer GEMINI_MODEL, then fall through Flash ids when Google
 * returns 404 NOT_FOUND for a retired model. Preserve thoughtSignature on
 * functionCall parts — Gemini 2.5/3 reject the next turn without it (hello
 * works; "add 100 for snacks" 400s → ai_unavailable hiccup).
 */
import type { Message, MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type Anthropic from "@anthropic-ai/sdk";

/** First pick when GEMINI_MODEL is unset. */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/**
 * Fall-through order when the preferred id is retired / unavailable for the key.
 * Keep flash-class models that support function calling.
 */
export const FALLBACK_GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash",
] as const;

export const GEMINI_MODEL = DEFAULT_GEMINI_MODEL;
export const GEMINI_GENERATE_URL = geminiGenerateUrl(DEFAULT_GEMINI_MODEL);

/** Thinking + visible tokens share maxOutputTokens on 2.5 Flash — keep headroom. */
const MAX_TOKENS = 4096;

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
  /** Encrypted reasoning; must be echoed on tool-call turns or Gemini 400s. */
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
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
  error?: { message?: string; status?: string };
}

/** Content block that may carry a Gemini thought signature through our tool loop. */
type SignedBlock = Message["content"][number] & { thoughtSignature?: string };

export function geminiGenerateUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

export function geminiModelCandidates(preferred?: string | null): string[] {
  const first = preferred?.trim();
  const list = first ? [first, ...FALLBACK_GEMINI_MODELS] : [...FALLBACK_GEMINI_MODELS];
  return [...new Set(list)];
}

function isRetriableModelError(status: number, body: string): boolean {
  if (status === 404) return true;
  const msg = body.toLowerCase();
  return (
    msg.includes("not found") ||
    msg.includes("is not found") ||
    msg.includes("no longer available") ||
    msg.includes("not supported for")
  );
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

function signatureOf(block: object): string | undefined {
  if (
    "thoughtSignature" in block &&
    typeof (block as { thoughtSignature?: unknown }).thoughtSignature === "string"
  ) {
    const sig = (block as { thoughtSignature: string }).thoughtSignature;
    return sig.length > 0 ? sig : undefined;
  }
  return undefined;
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
        const sig = signatureOf(block);
        if (block.type === "text" && "text" in block) {
          parts.push({
            text: String(block.text),
            ...(sig ? { thoughtSignature: sig } : {}),
          });
        } else if (block.type === "tool_use" && "name" in block) {
          const args =
            "input" in block && block.input && typeof block.input === "object"
              ? (block.input as Record<string, unknown>)
              : {};
          parts.push({
            functionCall: { name: String(block.name), args },
            ...(sig ? { thoughtSignature: sig } : {}),
          });
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
    model: DEFAULT_GEMINI_MODEL,
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
    const sig =
      typeof part.thoughtSignature === "string" && part.thoughtSignature.length > 0
        ? part.thoughtSignature
        : undefined;
    if (part.functionCall?.name) {
      callIndex += 1;
      const block = {
        type: "tool_use" as const,
        id: `call_${callIndex}_${part.functionCall.name}`,
        name: part.functionCall.name,
        input: part.functionCall.args ?? {},
        ...(sig ? { thoughtSignature: sig } : {}),
      };
      blocks.push(block as SignedBlock);
    } else if (typeof part.text === "string" && part.text.length > 0) {
      const block = {
        type: "text" as const,
        text: part.text,
        ...(sig ? { thoughtSignature: sig } : {}),
      };
      blocks.push(block as SignedBlock);
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

function buildGeminiBody(args: {
  system: string;
  tools: Anthropic.Tool[];
  messages: MessageParam[];
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: args.system }] },
    contents: toGeminiContents(args.messages),
    // Thinking tokens share this budget on 2.5 Flash — leave headroom so
    // tool calls / replies aren't truncated into empty candidates.
    generationConfig: { maxOutputTokens: MAX_TOKENS, temperature: 0.3 },
  };
  if (args.tools.length > 0) {
    body.tools = [{ functionDeclarations: toGeminiFunctionDeclarations(args.tools) }];
    body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
  }
  return body;
}

export async function geminiComplete(
  apiKey: string,
  args: {
    system: string;
    tools: Anthropic.Tool[];
    messages: MessageParam[];
  },
  preferredModel?: string | null,
): Promise<Message> {
  const body = buildGeminiBody(args);
  const models = geminiModelCandidates(preferredModel);
  let lastError: Error | null = null;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const res = await fetch(geminiGenerateUrl(model), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`gemini_http_${res.status}:${text.slice(0, 200)}`);
      lastError = err;
      if (isRetriableModelError(res.status, text) && i < models.length - 1) {
        console.warn(`[assistant] Gemini model fallback → ${models[i + 1]}: ${err.message}`);
        continue;
      }
      throw err;
    }

    const json = (await res.json()) as GeminiGenerateResponse;
    if (json.error?.message) {
      const err = new Error(`gemini_error:${json.error.message}`);
      lastError = err;
      if (isRetriableModelError(0, json.error.message) && i < models.length - 1) {
        console.warn(`[assistant] Gemini model fallback → ${models[i + 1]}: ${err.message}`);
        continue;
      }
      throw err;
    }
    const message = fromGeminiResponse(json);
    // Stamp the model that actually answered (tests assert on DEFAULT; runtime
    // may have fallen through).
    (message as { model: string }).model = model;
    return message;
  }

  throw lastError ?? new Error("gemini_unavailable");
}
