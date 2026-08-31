/**
 * Gemini REST client (no npm SDK) — generateContent with function calling.
 */

import type { Env } from "../../types";

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | {
      functionResponse: {
        name: string;
        response: Record<string, unknown>;
      };
    };

export type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

export type GeminiFunctionDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type GeminiGenerateResult = {
  candidates?: Array<{
    content?: { role?: string; parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  error?: { message?: string; code?: number };
};

export async function geminiGenerateContent(
  env: Env,
  opts: {
    systemInstruction: string;
    contents: GeminiContent[];
    tools: GeminiFunctionDeclaration[];
  },
): Promise<GeminiGenerateResult> {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error("ai_unavailable");

  const body = {
    system_instruction: {
      parts: [{ text: opts.systemInstruction }],
    },
    contents: opts.contents,
    tools:
      opts.tools.length > 0
        ? [{ function_declarations: opts.tools }]
        : undefined,
  };

  const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as GeminiGenerateResult;
  if (!res.ok) {
    return {
      error: {
        message: json.error?.message ?? `Gemini HTTP ${res.status}`,
        code: res.status,
      },
    };
  }
  return json;
}

export function extractFunctionCalls(
  parts: GeminiPart[] | undefined,
): Array<{ name: string; args: Record<string, unknown> }> {
  if (!parts) return [];
  const out: Array<{ name: string; args: Record<string, unknown> }> = [];
  for (const p of parts) {
    if ("functionCall" in p && p.functionCall) {
      out.push({
        name: p.functionCall.name,
        args: (p.functionCall.args ?? {}) as Record<string, unknown>,
      });
    }
  }
  return out;
}

export function extractText(parts: GeminiPart[] | undefined): string {
  if (!parts) return "";
  return parts
    .filter((p): p is { text: string } => "text" in p && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
    .trim();
}
