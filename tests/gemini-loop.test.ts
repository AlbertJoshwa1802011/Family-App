/**
 * Gemini function-calling loop — stubbed fetch, no real API key.
 *
 * Guards the bug where tool results were sent with role "function" (rejected
 * by current Gemini models) instead of role "user" + functionResponse, and
 * covers model fallback when a model id 404s.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL,
  FALLBACK_MODELS,
  friendlyGeminiMessage,
  GeminiError,
  runAssistant,
  toolResultHasClearSummary,
} from "../worker/lib/ai/gemini";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runAssistant Gemini loop", () => {
  it("defaults to gemini-3.6-flash with flash fallbacks", () => {
    expect(DEFAULT_MODEL).toBe("gemini-3.6-flash");
    expect(FALLBACK_MODELS).toContain("gemini-3.5-flash");
    expect(FALLBACK_MODELS).toContain("gemini-flash-latest");
  });

  it("sends functionResponse under role user (not function)", async () => {
    const bodies: Record<string, unknown>[] = [];
    let round = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        round += 1;
        if (round === 1) {
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [
                      {
                        functionCall: {
                          id: "call_1",
                          name: "add_expense",
                          args: { amountMajor: 70, description: "noodles" },
                        },
                        thoughtSignature: "sig-abc-123",
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "Logged ₹70 for noodles." }],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    // No summary on the tool result → second model round still runs (thoughtSignature path).
    const result = await runAssistant({
      apiKey: "test-key",
      systemInstruction: "You are a test assistant.",
      history: [{ role: "user", parts: [{ text: "I spent 70 on noodles" }] }],
      tools: [
        {
          name: "add_expense",
          description: "Record spending",
          parameters: { type: "object", properties: {}, required: [] },
        },
      ],
      execute: async () => ({ ok: true, id: "exp-1" }),
    });

    expect(result.text).toBe("Logged ₹70 for noodles.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("add_expense");
    expect(result.model).toBe(DEFAULT_MODEL);

    expect(bodies).toHaveLength(2);
    const secondContents = bodies[1].contents as {
      role: string;
      parts: {
        functionCall?: { name: string; id?: string };
        functionResponse?: { name: string; id?: string };
        thoughtSignature?: string;
      }[];
    }[];
    const modelToolTurn = secondContents.find((c) => c.parts.some((p) => p.functionCall));
    expect(modelToolTurn?.role).toBe("model");
    expect(modelToolTurn?.parts[0].thoughtSignature).toBe("sig-abc-123");
    expect(modelToolTurn?.parts[0].functionCall).toMatchObject({
      name: "add_expense",
      id: "call_1",
    });

    const toolResultTurn = secondContents.find((c) =>
      c.parts.some((p) => p.functionResponse),
    );
    expect(toolResultTurn?.role).toBe("user");
    expect(toolResultTurn?.role).not.toBe("function");
    expect(toolResultTurn?.parts[0].functionResponse).toMatchObject({
      name: "add_expense",
      id: "call_1",
    });

    const headers = (vi.mocked(fetch).mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers["x-goog-api-key"]).toBe("test-key");
  });

  it("skips the second model call when the tool already returns a clear summary", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: "add_expense",
                      args: { amountMajor: 70, description: "noodles" },
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runAssistant({
      apiKey: "test-key",
      systemInstruction: "sys",
      history: [{ role: "user", parts: [{ text: "spent 70 on noodles" }] }],
      tools: [
        {
          name: "add_expense",
          description: "d",
          parameters: { type: "object", properties: { amountMajor: { type: "number" } } },
        },
      ],
      execute: async () => ({ ok: true, summary: "Logged ₹70 for noodles." }),
    });

    expect(result.text).toBe("Logged ₹70 for noodles.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(":generateContent");
  });

  it("does not treat tool errors as clear summaries", () => {
    expect(toolResultHasClearSummary({ error: "amountMajor must be positive" })).toBe(false);
    expect(toolResultHasClearSummary({ ok: true })).toBe(false);
    expect(toolResultHasClearSummary({ summary: "Logged ₹70." })).toBe(true);
    expect(toolResultHasClearSummary({ message: "Here is your plan." })).toBe(true);
  });

  it("streams token deltas via streamGenerateContent when onToken is set", async () => {
    const tokens: string[] = [];
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":" there."}]},"finishReason":"STOP"}]}\n\n',
    ].join("");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(String(url)).toContain(":streamGenerateContent");
        expect(String(url)).toContain("alt=sse");
        return new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );

    const result = await runAssistant({
      apiKey: "test-key",
      systemInstruction: "sys",
      history: [{ role: "user", parts: [{ text: "hi" }] }],
      tools: [],
      execute: async () => ({}),
      onToken: (t) => tokens.push(t),
    });

    expect(tokens).toEqual(["Hello", " there."]);
    expect(result.text).toBe("Hello there.");
  });

  it("does not forward thought tokens while streaming", async () => {
    const tokens: string[] = [];
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"secret","thought":true}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"Visible"}]}}]}\n\n',
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(sse, { status: 200 })),
    );

    const result = await runAssistant({
      apiKey: "k",
      systemInstruction: "s",
      history: [{ role: "user", parts: [{ text: "hi" }] }],
      tools: [],
      execute: async () => ({}),
      onToken: (t) => tokens.push(t),
    });
    expect(tokens).toEqual(["Visible"]);
    expect(result.text).toBe("Visible");
  });

  it("streams a tool round then skips the follow-up when summary is clear", async () => {
    const tokens: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toContain(":streamGenerateContent");
      const sse =
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"add_expense","args":{"amountMajor":70}}}]}}]}\n\n';
      return new Response(sse, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runAssistant({
      apiKey: "k",
      systemInstruction: "s",
      history: [{ role: "user", parts: [{ text: "spent 70" }] }],
      tools: [
        {
          name: "add_expense",
          description: "d",
          parameters: { type: "object", properties: { amountMajor: { type: "number" } } },
        },
      ],
      execute: async () => ({ summary: "Logged $70 for expense." }),
      onToken: (t) => tokens.push(t),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tokens).toEqual(["Logged $70 for expense."]);
    expect(result.text).toBe("Logged $70 for expense.");
  });

  it("does not skip when any tool result lacks a clear summary", async () => {
    let round = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        round += 1;
        if (round === 1) {
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      { functionCall: { name: "add_expense", args: { amountMajor: 10 } } },
                      { functionCall: { name: "list_recent_expenses", args: {} } },
                    ],
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Added $10. You spent little else." }] } }],
          }),
          { status: 200 },
        );
      }),
    );

    const result = await runAssistant({
      apiKey: "k",
      systemInstruction: "s",
      history: [{ role: "user", parts: [{ text: "add 10 and show recent" }] }],
      tools: [
        {
          name: "add_expense",
          description: "d",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "list_recent_expenses",
          description: "d",
          parameters: { type: "object", properties: {} },
        },
      ],
      execute: async (name) =>
        name === "add_expense"
          ? { summary: "Logged $10." }
          : { currency: "USD", expenses: [] },
    });

    expect(round).toBe(2);
    expect(result.text).toContain("Added $10");
  });

  it("surfaces Gemini stream payload errors as GeminiError", async () => {
    const sse = 'data: {"error":{"message":"API key not valid","status":"INVALID_ARGUMENT"}}\n\n';
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(sse, { status: 200 })),
    );

    await expect(
      runAssistant({
        apiKey: "k",
        systemInstruction: "s",
        history: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [],
        execute: async () => ({}),
        onToken: () => undefined,
      }),
    ).rejects.toMatchObject({ name: "GeminiError", message: /API key/i });
  });

  it("maps missing thought_signature 400s to a clear message", () => {
    expect(
      friendlyGeminiMessage(
        new GeminiError(
          "Function call is missing a thought_signature in functionCall parts.",
          400,
        ),
      ),
    ).toMatch(/thought signature/i);
  });

  it("falls back to the next model when the preferred id 404s", async () => {
    const modelsHit: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const model = decodeURIComponent(String(url).split("/models/")[1]?.split(":")[0] ?? "");
        modelsHit.push(model);
        if (model === "gemini-3.6-flash") {
          return new Response(
            JSON.stringify({
              error: {
                message:
                  "This model models/gemini-3.6-flash is no longer available. Please update your code to use models/gemini-3.5-flash",
              },
            }),
            { status: 404 },
          );
        }
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Hi from fallback." }] } }],
          }),
          { status: 200 },
        );
      }),
    );

    const result = await runAssistant({
      apiKey: "test-key",
      systemInstruction: "sys",
      history: [{ role: "user", parts: [{ text: "hi" }] }],
      tools: [],
      execute: async () => ({}),
    });

    expect(modelsHit[0]).toBe("gemini-3.6-flash");
    expect(modelsHit[1]).toBe("gemini-3.5-flash");
    expect(result.model).toBe("gemini-3.5-flash");
    expect(result.text).toBe("Hi from fallback.");
  });

  it("synthesizes a reply from tool results when the model returns empty text", async () => {
    let round = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        round += 1;
        if (round === 1) {
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        functionCall: {
                          name: "list_recent_expenses",
                          args: {},
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [] } }] }),
          { status: 200 },
        );
      }),
    );

    // Structured data without summary → second round; empty model text → synthesize.
    const result = await runAssistant({
      apiKey: "k",
      systemInstruction: "s",
      history: [{ role: "user", parts: [{ text: "what did I spend?" }] }],
      tools: [
        {
          name: "list_recent_expenses",
          description: "d",
          parameters: { type: "object", properties: {} },
        },
      ],
      execute: async () => ({ currency: "INR", expenses: [] }),
    });
    expect(result.text).toContain("list recent expenses");
    expect(round).toBe(2);
  });

  it("maps GeminiError to a helpful user message", () => {
    expect(friendlyGeminiMessage(new GeminiError("API key not valid", 400))).toMatch(/API key/i);
    expect(friendlyGeminiMessage(new GeminiError("quota exceeded", 429))).toMatch(/rate-limited|quota/i);
  });

  it("throws GeminiError on non-2xx so the route can 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "API_KEY_INVALID" } }), { status: 400 }),
      ),
    );

    await expect(
      runAssistant({
        apiKey: "test-key",
        systemInstruction: "sys",
        history: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [],
        execute: async () => ({}),
      }),
    ).rejects.toMatchObject({ name: "GeminiError", status: 400 });
  });
});
