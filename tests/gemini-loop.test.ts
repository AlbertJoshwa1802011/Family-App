/**
 * Gemini function-calling loop — stubbed fetch, no real API key.
 *
 * Guards the bug where tool results were sent with role "function" (rejected
 * by current Gemini models) instead of role "user" + functionResponse.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL, runAssistant } from "../worker/lib/ai/gemini";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runAssistant Gemini loop", () => {
  it("defaults to gemini-2.5-flash", () => {
    expect(DEFAULT_MODEL).toBe("gemini-2.5-flash");
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
      execute: async () => ({ ok: true, amountMajor: 70 }),
    });

    expect(result.text).toBe("Logged ₹70 for noodles.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("add_expense");

    // Second generateContent call must include the tool result as a user turn.
    expect(bodies).toHaveLength(2);
    const secondContents = bodies[1].contents as {
      role: string;
      parts: { functionResponse?: { name: string; id?: string } }[];
    }[];
    const toolResultTurn = secondContents.find((c) =>
      c.parts.some((p) => p.functionResponse),
    );
    expect(toolResultTurn?.role).toBe("user");
    expect(toolResultTurn?.role).not.toBe("function");
    expect(toolResultTurn?.parts[0].functionResponse).toMatchObject({
      name: "add_expense",
      id: "call_1",
    });
  });

  it("returns plain text when the model does not call a tool", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            candidates: [
              { content: { role: "model", parts: [{ text: "You can spend ₹200 today." }] } },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const result = await runAssistant({
      apiKey: "test-key",
      systemInstruction: "sys",
      history: [{ role: "user", parts: [{ text: "how much left?" }] }],
      tools: [],
      execute: async () => ({}),
    });
    expect(result.text).toBe("You can spend ₹200 today.");
    expect(result.toolCalls).toEqual([]);
  });

  it("throws GeminiError on non-2xx so the route can 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 })),
    );

    await expect(
      runAssistant({
        apiKey: "test-key",
        systemInstruction: "sys",
        history: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [],
        execute: async () => ({}),
      }),
    ).rejects.toMatchObject({ name: "GeminiError", status: 429 });
  });
});
