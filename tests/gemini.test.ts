/**
 * Gemini adapter + HTTP assistant path (fetch-stubbed — no real API key).
 *
 * Covers: schema conversion, tool_use ↔ functionCall mapping, provider
 * preference (Gemini over Anthropic), POST /api/assistant happy paths,
 * 502 on Gemini errors, and a multi-turn snack-expense journey.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { app } from "../worker/index";
import { ASSISTANT_TOOLS } from "../worker/lib/assistantTools";
import { assistantProvider, isAssistantConfigured } from "../worker/lib/assistant";
import {
  DEFAULT_GEMINI_MODEL,
  FALLBACK_GEMINI_MODELS,
  GEMINI_GENERATE_URL,
  fromGeminiResponse,
  geminiComplete,
  geminiGenerateUrl,
  geminiModelCandidates,
  toGeminiContents,
  toGeminiFunctionDeclarations,
  type GeminiGenerateResponse,
} from "../worker/lib/gemini";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

function geminiFunctionCall(name: string, args: Record<string, unknown>): GeminiGenerateResponse {
  return {
    candidates: [
      {
        content: {
          role: "model",
          parts: [{ functionCall: { name, args } }],
        },
        finishReason: "STOP",
      },
    ],
  };
}

function geminiText(text: string): GeminiGenerateResponse {
  return {
    candidates: [
      {
        content: { role: "model", parts: [{ text }] },
        finishReason: "STOP",
      },
    ],
  };
}

describe("gemini schema + message conversion", () => {
  it("declares every assistant tool as a Gemini function with OBJECT parameters", () => {
    const decls = toGeminiFunctionDeclarations(ASSISTANT_TOOLS);
    expect(decls.map((d) => d.name).sort()).toEqual(
      ["add_contact", "add_event", "add_expense", "add_task", "complete_task", "create_tasks_from_event", "list_expenses"].sort(),
    );
    const expense = decls.find((d) => d.name === "add_expense")!;
    expect(expense.parameters.type).toBe("OBJECT");
    expect((expense.parameters.properties as { amount: { type: string } }).amount.type).toBe(
      "NUMBER",
    );
    expect(expense.parameters.required).toEqual(["amount"]);
    const category = (
      expense.parameters.properties as { category: { type: string; enum: string[] } }
    ).category;
    expect(category.type).toBe("STRING");
    expect(category.enum).toContain("food");
  });

  it("maps Anthropic tool_use / tool_result onto Gemini functionCall / functionResponse", () => {
    const messages: MessageParam[] = [
      { role: "user", content: "add 100 for snacks" },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "add_expense",
            input: { amount: 100, category: "food", note: "outside snacks" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: JSON.stringify({ ok: true, action: { summary: "Added ₹100" } }),
          },
        ],
      },
    ];
    const contents = toGeminiContents(messages);
    expect(contents[0]).toEqual({ role: "user", parts: [{ text: "add 100 for snacks" }] });
    expect(contents[1].role).toBe("model");
    expect(contents[1].parts[0].functionCall).toEqual({
      name: "add_expense",
      args: { amount: 100, category: "food", note: "outside snacks" },
    });
    expect(contents[2].role).toBe("user");
    expect(contents[2].parts[0].functionResponse?.name).toBe("add_expense");
    expect(contents[2].parts[0].functionResponse?.response).toMatchObject({ ok: true });
  });

  it("fromGeminiResponse turns functionCall into tool_use and text into end_turn", () => {
    const tool = fromGeminiResponse(
      geminiFunctionCall("add_task", { title: "Renew visa", dueDate: "2026-09-12" }),
    );
    expect(tool.stop_reason).toBe("tool_use");
    expect(tool.content[0]).toMatchObject({
      type: "tool_use",
      name: "add_task",
      input: { title: "Renew visa", dueDate: "2026-09-12" },
    });

    const talk = fromGeminiResponse(geminiText("You have 2 open tasks."));
    expect(talk.stop_reason).toBe("end_turn");
    expect(talk.content).toEqual([{ type: "text", text: "You have 2 open tasks." }]);
  });

  it("preserves thoughtSignature on tool_use so the next Gemini turn does not 400", () => {
    const roundTrip = fromGeminiResponse({
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "add_expense",
                  args: { amount: 100, category: "food", note: "snacks" },
                },
                thoughtSignature: "sig_abc123",
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    });
    expect(roundTrip.content[0]).toMatchObject({
      type: "tool_use",
      name: "add_expense",
      thoughtSignature: "sig_abc123",
    });

    const contents = toGeminiContents([
      { role: "user", content: "add 100 for snacks" },
      { role: "assistant", content: roundTrip.content },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: (roundTrip.content[0] as { id: string }).id,
            content: JSON.stringify({ ok: true }),
          },
        ],
      },
    ]);
    expect(contents[1].parts[0].functionCall?.name).toBe("add_expense");
    expect(contents[1].parts[0].thoughtSignature).toBe("sig_abc123");
  });

  it("lists flash model fallbacks with optional preferred override first", () => {
    expect(geminiModelCandidates(null)[0]).toBe(DEFAULT_GEMINI_MODEL);
    expect(geminiModelCandidates("gemini-flash-latest")[0]).toBe("gemini-flash-latest");
    expect(geminiModelCandidates("gemini-flash-latest")).toEqual([
      "gemini-flash-latest",
      ...FALLBACK_GEMINI_MODELS.filter((m) => m !== "gemini-flash-latest"),
    ]);
  });

  it("fromGeminiResponse yields a safe fallback when Gemini returns no candidates", () => {
    const msg = fromGeminiResponse({ promptFeedback: { blockReason: "SAFETY" } });
    expect(msg.stop_reason).toBe("end_turn");
    expect(msg.content[0]).toMatchObject({ type: "text" });
  });
});

describe("assistant provider selection", () => {
  it("prefers Gemini when both keys are set; Anthropic otherwise", () => {
    expect(assistantProvider({} as never)).toBeNull();
    expect(isAssistantConfigured({} as never)).toBe(false);
    expect(assistantProvider({ GEMINI_API_KEY: "g" } as never)).toBe("gemini");
    expect(assistantProvider({ ANTHROPIC_API_KEY: "a" } as never)).toBe("anthropic");
    expect(
      assistantProvider({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" } as never),
    ).toBe("gemini");
    expect(assistantProvider({ GEMINI_API_KEY: "   " } as never)).toBeNull();
  });
});

describe("gemini HTTP (stubbed generateContent)", () => {
  let t: TestEnv;
  let familyId: string;
  let member: ReturnType<typeof seedActor>;
  let owner: ReturnType<typeof seedActor>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let geminiBodies: Record<string, unknown>[];

  beforeEach(() => {
    t = createTestEnv({ GEMINI_API_KEY: "test-gemini-key" });
    const ownerUser = seedUser(t.sqlite);
    familyId = seedFamily(t.sqlite, ownerUser.id).id;
    owner = seedActor(t.sqlite, familyId, "owner", { name: "Olive Owner" });
    member = seedActor(t.sqlite, familyId, "member", { name: "Milo Member" });
    geminiBodies = [];
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(GEMINI_GENERATE_URL);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      geminiBodies.push(body);
      const contents = body.contents as { parts?: { functionResponse?: unknown }[] }[];
      const last = contents[contents.length - 1];
      const isToolResult = last?.parts?.some((p) => p.functionResponse);
      if (!isToolResult) {
        return new Response(
          JSON.stringify(
            geminiFunctionCall("add_expense", {
              amount: 100,
              category: "food",
              note: "outside snacks",
            }),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify(geminiText("Logged ₹100 for outside snacks.")),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  function req(method: string, path: string, cookie: string, body?: object) {
    return app.request(
      path,
      {
        method,
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      },
      t.env,
    );
  }

  it("GET reports configured:true and provider:gemini with only GEMINI_API_KEY", async () => {
    const res = await req("GET", `/api/assistant?familyId=${familyId}`, member.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { configured: boolean; provider: string | null };
    expect(body.configured).toBe(true);
    expect(body.provider).toBe("gemini");
  });

  it("GET reports provider:anthropic when only ANTHROPIC_API_KEY is set", async () => {
    const other = createTestEnv({ ANTHROPIC_API_KEY: "claude-key" });
    const ownerUser = seedUser(other.sqlite);
    const fam = seedFamily(other.sqlite, ownerUser.id).id;
    const actor = seedActor(other.sqlite, fam, "member");
    const res = await app.request(
      `/api/assistant?familyId=${fam}`,
      { headers: { Cookie: actor.cookie } },
      other.env,
    );
    const body = (await res.json()) as { configured: boolean; provider: string | null };
    expect(body.configured).toBe(true);
    expect(body.provider).toBe("anthropic");
  });

  it("POST add-snacks journey: Gemini functionCall → D1 expense → persisted thread", async () => {
    const res = await req("POST", "/api/assistant", member.cookie, {
      familyId,
      message: "add 100 expense for outside snacks",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      reply: string;
      actions: { tool: string; summary: string }[];
    };
    expect(body.actions).toHaveLength(1);
    expect(body.actions[0].tool).toBe("add_expense");
    expect(body.reply).toContain("₹100");

    const headers = fetchMock.mock.calls[0][1] as RequestInit;
    expect((headers.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-gemini-key");
    const decls = (geminiBodies[0].tools as { functionDeclarations: { name: string }[] }[])[0]
      .functionDeclarations;
    expect(decls.map((d) => d.name)).toContain("add_expense");
    expect(JSON.stringify(geminiBodies[0].systemInstruction)).toContain("Family Vault");

    const list = await req("GET", `/api/expenses?familyId=${familyId}`, member.cookie);
    const { totalMinor, expenses } = (await list.json()) as {
      totalMinor: number;
      expenses: { description: string | null }[];
    };
    expect(totalMinor).toBe(10000);
    expect(expenses[0].description).toBe("outside snacks");

    const history = await req("GET", `/api/assistant?familyId=${familyId}`, member.cookie);
    const hist = (await history.json()) as {
      messages: { role: string; body: string }[];
    };
    expect(hist.messages).toHaveLength(2);
    expect(hist.messages[0].role).toBe("user");
    expect(hist.messages[0].body).toContain("snacks");
    expect(hist.messages[1].role).toBe("assistant");
  });

  it("owner cannot see a member's private assistant thread", async () => {
    expect(
      (await req("POST", "/api/assistant", member.cookie, { familyId, message: "secret snacks" }))
        .status,
    ).toBe(201);

    const ownerHist = await req("GET", `/api/assistant?familyId=${familyId}`, owner.cookie);
    const body = (await ownerHist.json()) as { messages: unknown[] };
    expect(body.messages).toEqual([]);
  });

  it("POST returns 502 ai_unavailable when Gemini HTTP fails", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("boom", { status: 500 }));
    const res = await req("POST", "/api/assistant", member.cookie, {
      familyId,
      message: "hello",
    });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe("ai_unavailable");
  });

  it("geminiComplete throws on non-2xx so the route can 502", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("quota", { status: 429 })),
    );
    await expect(
      geminiComplete("k", { system: "s", tools: [], messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/gemini_http_429/);
  });

  it("geminiComplete falls through to the next flash model on 404 NOT_FOUND", async () => {
    vi.unstubAllGlobals();
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        if (String(url).includes("gemini-2.5-flash")) {
          return new Response(JSON.stringify({ error: { message: "models/gemini-2.5-flash is not found" } }), {
            status: 404,
          });
        }
        return new Response(JSON.stringify(geminiText("Recovered on fallback.")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const msg = await geminiComplete("k", {
      system: "s",
      tools: [],
      messages: [{ role: "user", content: "hi" }],
    });
    expect(msg.content[0]).toMatchObject({ type: "text", text: "Recovered on fallback." });
    expect(calls[0]).toBe(geminiGenerateUrl("gemini-2.5-flash"));
    expect(calls[1]).toBe(geminiGenerateUrl("gemini-flash-latest"));
  });
});

describe("gemini text-only HTTP turn", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("answers without writing when Gemini returns plain text", async () => {
    const t = createTestEnv({ GEMINI_API_KEY: "test-gemini-key" });
    const ownerUser = seedUser(t.sqlite);
    const familyId = seedFamily(t.sqlite, ownerUser.id).id;
    const member = seedActor(t.sqlite, familyId, "member");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(geminiText("You have no open tasks.")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const res = await app.request(
      "/api/assistant",
      {
        method: "POST",
        headers: { Cookie: member.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ familyId, message: "any tasks?" }),
      },
      t.env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { reply: string; actions: unknown[] };
    expect(body.reply).toBe("You have no open tasks.");
    expect(body.actions).toEqual([]);
  });
});
