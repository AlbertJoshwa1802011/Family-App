/**
 * Minimal Gemini client with function calling.
 *
 * Only what this app needs: one multi-turn loop where the model may call our
 * tools, we execute them, and feed results back until it produces prose.
 *
 * The model NEVER touches the database directly and never sees an HTTP
 * endpoint. It emits a tool name plus arguments; the caller executes that tool
 * server-side under the signed-in user's identity. That is what stops a crafted
 * prompt from reading another member's private books.
 */

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.0-flash";

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface GeminiContent {
  role: "user" | "model" | "function";
  parts: unknown[];
}

interface GeminiCandidatePart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiCandidatePart[] } }[];
  error?: { message?: string };
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

async function callGemini(
  apiKey: string,
  model: string,
  body: unknown,
): Promise<GeminiResponse> {
  const res = await fetch(
    `${API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  const json = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) {
    // Never surface the key or raw upstream payload to the client.
    throw new GeminiError(json.error?.message ?? `Gemini returned ${res.status}`, res.status);
  }
  return json;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface RunResult {
  text: string;
  toolCalls: ToolCallRecord[];
}

/**
 * Run one assistant turn.
 *
 * `execute` runs a named tool and returns a JSON-serialisable result. It is the
 * only path from the model to application state, so it must apply the caller's
 * own authorization — this function deliberately knows nothing about users.
 *
 * `maxRounds` bounds the tool loop so a confused model can't spin forever.
 */
export async function runAssistant(args: {
  apiKey: string;
  model?: string;
  systemInstruction: string;
  history: GeminiContent[];
  tools: FunctionDeclaration[];
  execute: (name: string, toolArgs: Record<string, unknown>) => Promise<unknown>;
  maxRounds?: number;
}): Promise<RunResult> {
  const model = args.model || DEFAULT_MODEL;
  const maxRounds = args.maxRounds ?? 5;
  const contents: GeminiContent[] = [...args.history];
  const toolCalls: ToolCallRecord[] = [];

  for (let round = 0; round < maxRounds; round++) {
    const json = await callGemini(args.apiKey, model, {
      systemInstruction: { parts: [{ text: args.systemInstruction }] },
      contents,
      tools: [{ functionDeclarations: args.tools }],
    });

    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall!);

    if (calls.length === 0) {
      const text = parts
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      return { text, toolCalls };
    }

    // Echo the model's call back into the transcript, then answer it.
    contents.push({ role: "model", parts: calls.map((c) => ({ functionCall: c })) });

    const responseParts: unknown[] = [];
    for (const call of calls) {
      let result: unknown;
      try {
        result = await args.execute(call.name, call.args ?? {});
      } catch (err) {
        // Hand the failure back to the model so it can explain or retry,
        // rather than collapsing the whole turn.
        result = { error: err instanceof Error ? err.message : "tool failed" };
      }
      toolCalls.push({ name: call.name, args: call.args ?? {}, result });
      responseParts.push({
        functionResponse: { name: call.name, response: { result } },
      });
    }
    contents.push({ role: "function", parts: responseParts });
  }

  return {
    text: "I wasn't able to finish that — try rephrasing, or add it manually.",
    toolCalls,
  };
}

export { DEFAULT_MODEL };
