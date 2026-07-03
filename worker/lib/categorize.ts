/**
 * Document category suggestion.
 *
 * Two tiers:
 *  1. Keyword heuristics — instant, free, deterministic; always available.
 *  2. Claude — when ANTHROPIC_API_KEY is configured, ambiguous titles are
 *     classified by the model with a structured-output schema so the result
 *     is always one of our known categories. Falls back to heuristics on any
 *     API problem; the endpoint never fails because AI is unavailable.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../types";

export const DOCUMENT_CATEGORIES = [
  "identity",
  "insurance",
  "medical",
  "vehicle",
  "finance",
  "warranty",
  "education",
  "other",
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

const KEYWORD_RULES: [DocumentCategory, RegExp][] = [
  ["identity", /\b(passport|visa|id card|identity|birth certificate|aadhaar|aadhar|pan card|ssn|social security|driver'?s? licen[cs]e|driving licen[cs]e|residence permit|green card|citizenship)\b/i],
  ["insurance", /\b(insurance|policy|premium|coverage|insurer|lic\b|mediclaim)\b/i],
  ["medical", /\b(medical|prescription|vaccine|vaccination|immuni[sz]ation|doctor|hospital|lab report|blood|x-?ray|mri|scan|dental|health record|allergy)\b/i],
  ["vehicle", /\b(car|vehicle|motorcycle|bike|registration|rc book|pollution|puc|emission|mot\b|roadworthy)\b/i],
  ["finance", /\b(bank|tax|invoice|receipt|loan|mortgage|statement|salary|payslip|investment|mutual fund|deed|property|rent agreement|lease)\b/i],
  ["warranty", /\b(warranty|guarantee|appliance|purchase proof|amc\b|service contract)\b/i],
  ["education", /\b(school|college|university|degree|diploma|certificate|transcript|marksheet|report card|admission)\b/i],
];

/** Deterministic keyword classifier; returns null when nothing matches. */
export function suggestCategoryHeuristic(
  title: string,
  fileName?: string,
): DocumentCategory | null {
  const haystack = `${title} ${fileName ?? ""}`;
  for (const [category, pattern] of KEYWORD_RULES) {
    if (pattern.test(haystack)) return category;
  }
  return null;
}

export function isAiCategorizeConfigured(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

/**
 * Classify with Claude using structured outputs (json_schema with an enum),
 * so the response is guaranteed to be one of DOCUMENT_CATEGORIES.
 */
export async function suggestCategoryAI(
  env: Env,
  title: string,
  fileName?: string,
): Promise<DocumentCategory | null> {
  if (!env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 256,
      system:
        "You classify family documents into exactly one category. " +
        "Categories: identity (passports, IDs, licenses), insurance, medical, " +
        "vehicle (registration, emissions), finance (bank, tax, property), " +
        "warranty (product warranties, receipts for appliances), education " +
        "(certificates, school records), other (anything else).",
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              category: { type: "string", enum: [...DOCUMENT_CATEGORIES] },
            },
            required: ["category"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "user",
          content: `Document title: ${JSON.stringify(title)}${
            fileName ? `\nFile name: ${JSON.stringify(fileName)}` : ""
          }`,
        },
      ],
    });

    if (response.stop_reason === "refusal") return null;
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;
    const parsed = JSON.parse(block.text) as { category: string };
    return DOCUMENT_CATEGORIES.includes(parsed.category as DocumentCategory)
      ? (parsed.category as DocumentCategory)
      : null;
  } catch (err) {
    // AI is best-effort — log and fall back to heuristics.
    console.warn("AI categorization failed:", err);
    return null;
  }
}
