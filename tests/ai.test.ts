/**
 * AI Assistant: auth/authz gates, validation, provider-error handling, rate
 * limiting, and tool-call authorization scoping.
 *
 * The Anthropic SDK is mocked (see vi.hoisted below) so these tests never hit
 * the network — they exercise the route → service → tool orchestration and
 * the exact request/response shapes the model receives and returns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

import { app } from "../worker/index";
import { getDb } from "../worker/db/client";
import { executeTool } from "../worker/lib/ai/tools";
import {
  createTestEnv,
  seedActor,
  seedDocument,
  seedFamily,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

function textResponse(text: string) {
  return { content: [{ type: "text", text }], stop_reason: "end_turn" };
}

function toolUseResponse(name: string, input: Record<string, unknown> = {}) {
  return {
    content: [{ type: "tool_use", id: "toolu_1", name, input }],
    stop_reason: "tool_use",
  };
}

function req(path: string, cookie: string, body: object, env: TestEnv["env"]) {
  return app.request(
    path,
    {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

let t: TestEnv;
let familyId: string;
let member: ReturnType<typeof seedActor>;

beforeEach(() => {
  mockCreate.mockReset();
  t = createTestEnv({ ANTHROPIC_API_KEY: "test-key" });
  const ownerUser = seedUser(t.sqlite);
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
  member = seedActor(t.sqlite, familyId, "member", { name: "Milo Member" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/ai/chat — auth & authorization", () => {
  it("401s without a session", async () => {
    const res = await app.request(
      "/api/ai/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyId, message: "hi" }),
      },
      t.env,
    );
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: string }).toEqual({ error: "unauthorized" });
  });

  it("404s for a family the caller doesn't belong to", async () => {
    const strangerFamily = seedFamily(t.sqlite, seedUser(t.sqlite).id).id;
    mockCreate.mockResolvedValueOnce(textResponse("hi"));
    const res = await req("/api/ai/chat", member.cookie, { familyId: strangerFamily, message: "hi" }, t.env);
    expect(res.status).toBe(404);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/chat — validation", () => {
  it("400s on empty message, missing familyId, and oversized history", async () => {
    expect((await req("/api/ai/chat", member.cookie, { familyId, message: "" }, t.env)).status).toBe(400);
    expect((await req("/api/ai/chat", member.cookie, { message: "hi" }, t.env)).status).toBe(400);
    expect(
      (
        await req(
          "/api/ai/chat",
          member.cookie,
          { familyId, message: "hi", history: Array.from({ length: 21 }, () => ({ role: "user", content: "x" })) },
          t.env,
        )
      ).status,
    ).toBe(400);
    const badRole = await req(
      "/api/ai/chat",
      member.cookie,
      { familyId, message: "hi", history: [{ role: "system", content: "x" }] },
      t.env,
    );
    expect(badRole.status).toBe(400);
    const body = (await badRole.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });
});

describe("POST /api/ai/chat — provider availability & errors", () => {
  it("503 ai_unavailable when ANTHROPIC_API_KEY isn't configured", async () => {
    const noKeyEnv = createTestEnv(); // default: no ANTHROPIC_API_KEY
    const ownerUser = seedUser(noKeyEnv.sqlite);
    const fam = seedFamily(noKeyEnv.sqlite, ownerUser.id).id;
    const actor = seedActor(noKeyEnv.sqlite, fam, "member");

    const res = await req("/api/ai/chat", actor.cookie, { familyId: fam, message: "hi" }, noKeyEnv.env);
    expect(res.status).toBe(503);
    expect((await res.json()) as { error: string }).toEqual({ error: "ai_unavailable" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("200s with the model's reply on a normal text turn", async () => {
    mockCreate.mockResolvedValueOnce(textResponse("You're all caught up!"));
    const res = await req("/api/ai/chat", member.cookie, { familyId, message: "What's up?" }, t.env);
    expect(res.status).toBe(200);
    expect((await res.json()) as { reply: string }).toEqual({ reply: "You're all caught up!" });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("executes a requested tool and feeds the result back for a final answer", async () => {
    mockCreate
      .mockResolvedValueOnce(toolUseResponse("get_open_tasks"))
      .mockResolvedValueOnce(textResponse("You have no open tasks."));

    const res = await req("/api/ai/chat", member.cookie, { familyId, message: "What do I still need to do?" }, t.env);
    expect(res.status).toBe(200);
    expect((await res.json()) as { reply: string }).toEqual({ reply: "You have no open tasks." });
    expect(mockCreate).toHaveBeenCalledTimes(2);

    // Second call must carry the tool_result derived from the real DB query,
    // not just an echo of the model's own tool_use request.
    const secondCallArgs = mockCreate.mock.calls[1][0] as {
      messages: { role: string; content: unknown }[];
    };
    const lastMessage = secondCallArgs.messages.at(-1);
    expect(lastMessage?.role).toBe("user");
    const toolResultBlock = (lastMessage?.content as { type: string; content: string }[])[0];
    expect(toolResultBlock.type).toBe("tool_result");
    expect(JSON.parse(toolResultBlock.content)).toHaveProperty("tasks");
  });

  it("502 ai_provider_error on a provider failure, without leaking the internal error", async () => {
    mockCreate.mockRejectedValueOnce(new Error("upstream exploded: sk-secret-lookalike"));
    const res = await req("/api/ai/chat", member.cookie, { familyId, message: "hi" }, t.env);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "ai_provider_error" });
    expect(JSON.stringify(body)).not.toContain("upstream exploded");
  });
});

describe("POST /api/ai/chat — rate limiting", () => {
  it("429s after 20 requests in the window, with Retry-After", async () => {
    mockCreate.mockResolvedValue(textResponse("ok"));
    for (let i = 0; i < 20; i++) {
      const res = await req("/api/ai/chat", member.cookie, { familyId, message: `msg ${i}` }, t.env);
      expect(res.status).toBe(200);
    }
    const limited = await req("/api/ai/chat", member.cookie, { familyId, message: "one more" }, t.env);
    expect(limited.status).toBe(429);
    expect((await limited.json()) as { error: string }).toEqual(
      expect.objectContaining({ error: "rate_limited" }),
    );
    expect(limited.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("AI tools — authorization scoping (get_expiring_documents)", () => {
  it("never returns another member's private document", async () => {
    const db = getDb(t.env);
    const owner = seedActor(t.sqlite, familyId, "owner");
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

    seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
      title: "Owner's private passport",
      visibility: "private",
      expiryDate: soon,
    });
    seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
      title: "Shared car insurance",
      visibility: "family",
      expiryDate: soon,
    });

    const asMember = (await executeTool(
      { db, familyId, userId: member.userId, role: "member" },
      "get_expiring_documents",
      {},
    )) as { documents: { title: string }[] };
    const titles = asMember.documents.map((d) => d.title);
    expect(titles).toContain("Shared car insurance");
    expect(titles).not.toContain("Owner's private passport");

    const asOwner = (await executeTool(
      { db, familyId, userId: owner.userId, role: "owner" },
      "get_expiring_documents",
      {},
    )) as { documents: { title: string }[] };
    expect(asOwner.documents.map((d) => d.title)).toContain("Owner's private passport");
  });

  it("an unknown tool name returns an error payload instead of throwing", async () => {
    const db = getDb(t.env);
    const result = await executeTool(
      { db, familyId, userId: member.userId, role: "member" },
      "delete_everything",
      {},
    );
    expect(result).toEqual({ error: "unknown tool: delete_everything" });
  });
});
