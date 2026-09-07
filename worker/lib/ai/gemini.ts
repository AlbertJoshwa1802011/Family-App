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

/**
 * Prefer Flash models that support function calling. Order matters: we fall
 * through when Google returns 404 NOT_FOUND for a retired model id.
 * Override the first pick with env GEMINI_MODEL.
 */
export const DEFAULT_MODEL = "gemini-2.5-flash";
export const FALLBACK_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash-001",
] as const;

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
  /** Gemini only accepts user | model. Function replies go as user + functionResponse. */
  role: "user" | "model";
  parts: unknown[];
}

interface GeminiCandidatePart {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: GeminiCandidatePart[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

/** Normalize tool schemas — Gemini rejects empty `properties: {}` on some models. */
export function normalizeToolDeclarations(
  tools: FunctionDeclaration[],
): FunctionDeclaration[] {
  return tools.map((tool) => {
    const props = tool.parameters?.properties ?? {};
    const hasProps = Object.keys(props).length > 0;
    return {
      ...tool,
      parameters: {
        type: "object",
        ...(hasProps ? { properties: props } : { properties: {} }),
        ...(tool.parameters.required?.length ? { required: tool.parameters.required } : {}),
      },
    };
  });
}

function modelCandidates(preferred?: string): string[] {
  const first = preferred?.trim();
  const list = first ? [first, ...FALLBACK_MODELS] : [...FALLBACK_MODELS];
  return [...new Set(list)];
}

function isRetriableModelError(err: GeminiError): boolean {
  if (err.status === 404) return true;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("not found") ||
    msg.includes("is not found") ||
    msg.includes("no longer available") ||
    msg.includes("not supported")
  );
}

/** Map Gemini errors to a short user-facing sentence (never includes the key). */
export function friendlyGeminiMessage(err: GeminiError): string {
  const msg = err.message.toLowerCase();
  if (
    err.status === 400 &&
    (msg.includes("api key") || msg.includes("api_key") || msg.includes("key"))
  ) {
    return "Gemini rejected the API key. Create a fresh key at aistudio.google.com/apikey and run: npx wrangler secret put GEMINI_API_KEY --name fam";
  }
  if (err.status === 401 || err.status === 403) {
    return "Gemini blocked this API key. Check that Generative Language API is enabled for the key, then try a new unrestricted key.";
  }
  if (err.status === 429) {
    return "Gemini rate-limited us — wait a minute and try again.";
  }
  if (err.status === 404 || msg.includes("not found")) {
    return "Gemini model not available for this key. Set GEMINI_MODEL to gemini-2.0-flash and redeploy, or create a new AI Studio key.";
  }
  if (msg.includes("billing") || msg.includes("quota")) {
    return "Gemini quota exceeded for this API key.";
  }
  return "The assistant is unavailable right now. Try again in a moment.";
}

async function callGemini(
  apiKey: string,
  model: string,
  body: unknown,
): Promise<GeminiResponse> {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) {
    throw new GeminiError(
      json.error?.message ?? `Gemini returned ${res.status}`,
      res.status,
      json.error?.status,
    );
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
  model: string;
}

function summarizeToolCalls(toolCalls: ToolCallRecord[]): string {
  const bits = toolCalls.map((t) => {
    const r = t.result as { summary?: string; message?: string; ok?: boolean } | null;
    if (r && typeof r === "object") {
      if (typeof r.summary === "string" && r.summary.trim()) return r.summary;
      if (typeof r.message === "string" && r.message.trim()) return r.message;
    }
    return `Ran ${t.name.replace(/_/g, " ")}`;
  });
  return bits.join(" ") || "Done.";
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
  const maxRounds = args.maxRounds ?? 5;
  const contents: GeminiContent[] = [...args.history];
  const toolCalls: ToolCallRecord[] = [];
  const tools = normalizeToolDeclarations(args.tools);
  const models = modelCandidates(args.model);
  let activeModel = models[0];
  let modelIndex = 0;

  async function generate(body: unknown): Promise<GeminiResponse> {
    for (;;) {
      try {
        return await callGemini(args.apiKey, activeModel, body);
      } catch (err) {
        if (
          err instanceof GeminiError &&
          isRetriableModelError(err) &&
          modelIndex < models.length - 1
        ) {
          modelIndex += 1;
          activeModel = models[modelIndex];
          console.warn(`[assistant] model fallback → ${activeModel}: ${err.message}`);
          continue;
        }
        throw err;
      }
    }
  }

  for (let round = 0; round < maxRounds; round++) {
    const requestBody: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: args.systemInstruction }] },
      contents,
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
    };
    if (tools.length > 0) {
      requestBody.tools = [{ functionDeclarations: tools }];
      requestBody.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
    }

    const json = await generate(requestBody);

    if (json.promptFeedback?.blockReason) {
      throw new GeminiError(
        `Blocked by Gemini (${json.promptFeedback.blockReason})`,
        400,
        "blocked",
      );
    }

    const parts = (json.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought);
    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall!);

    if (calls.length === 0) {
      const text = parts
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      return {
        text: text || (toolCalls.length > 0 ? summarizeToolCalls(toolCalls) : "Done."),
        toolCalls,
        model: activeModel,
      };
    }

    // Echo the model's call back into the transcript, then answer it.
    contents.push({
      role: "model",
      parts: calls.map((c) => ({
        functionCall: {
          name: c.name,
          args: c.args ?? {},
          ...(c.id ? { id: c.id } : {}),
        },
      })),
    });

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
      const responsePayload =
        result && typeof result === "object" && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : { result };
      responseParts.push({
        functionResponse: {
          name: call.name,
          ...(call.id ? { id: call.id } : {}),
          response: responsePayload,
        },
      });
    }
    // IMPORTANT: functionResponse parts must use role "user", not "function".
    contents.push({ role: "user", parts: responseParts });
  }

  return {
    text:
      toolCalls.length > 0
        ? summarizeToolCalls(toolCalls)
        : "I wasn't able to finish that — try rephrasing, or add it manually.",
    toolCalls,
    model: activeModel,
  };
}

/** Cheap auth check used by /assistant/status?probe=1 — lists models, never logs the key. */
export async function probeGeminiKey(apiKey: string): Promise<{
  ok: boolean;
  status: number;
  message?: string;
}> {
  try {
    const res = await fetch(`${API_BASE}?pageSize=1`, {
      headers: { "x-goog-api-key": apiKey },
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as GeminiResponse;
      const err = new GeminiError(json.error?.message ?? `HTTP ${res.status}`, res.status);
      return { ok: false, status: res.status, message: friendlyGeminiMessage(err) };
    }
    return { ok: true, status: 200 };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      message: err instanceof Error ? err.message : "probe_failed",
    };
  }
}
