/**
 * Family chat: send/list/paginate/soft-delete, strict family isolation.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../worker/index";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

let t: TestEnv;
let familyId: string;
let owner: ReturnType<typeof seedActor>;
let member: ReturnType<typeof seedActor>;

beforeEach(() => {
  t = createTestEnv();
  const ownerUser = seedUser(t.sqlite);
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
  owner = seedActor(t.sqlite, familyId, "owner", { name: "Olive Owner" });
  member = seedActor(t.sqlite, familyId, "member", { name: "Milo Member" });
});

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

async function send(cookie: string, body: string) {
  const res = await req("POST", "/api/chat", cookie, { familyId, body });
  expect(res.status).toBe(201);
  return ((await res.json()) as { message: { id: string } }).message;
}

describe("family chat", () => {
  it("send → list roundtrip with author info, oldest-first", async () => {
    await send(owner.cookie, "Dinner at 7?");
    await send(member.cookie, "I'll be there 🎉");

    const res = await req("GET", `/api/chat?familyId=${familyId}`, member.cookie);
    expect(res.status).toBe(200);
    const { messages, hasMore } = (await res.json()) as {
      messages: { body: string; authorName: string; deleted: boolean }[];
      hasMore: boolean;
    };
    expect(hasMore).toBe(false);
    expect(messages.map((m) => m.body)).toEqual(["Dinner at 7?", "I'll be there 🎉"]);
    expect(messages[0].authorName).toBe("Olive Owner");
    expect(messages[1].deleted).toBe(false);
  });

  it("validation: empty body 400; >4000 chars 400; missing familyId 400", async () => {
    expect((await req("POST", "/api/chat", member.cookie, { familyId, body: "" })).status).toBe(400);
    expect(
      (
        await req("POST", "/api/chat", member.cookie, {
          familyId,
          body: "x".repeat(4001),
        })
      ).status,
    ).toBe(400);
    expect((await req("GET", "/api/chat", member.cookie)).status).toBe(400);
  });

  it("family isolation: outsiders can neither read nor post (404)", async () => {
    await send(owner.cookie, "family secret");

    const strangerUser = seedUser(t.sqlite);
    const otherFamily = seedFamily(t.sqlite, strangerUser.id);
    const stranger = seedActor(t.sqlite, otherFamily.id, "owner");

    expect(
      (await req("GET", `/api/chat?familyId=${familyId}`, stranger.cookie)).status,
    ).toBe(404);
    expect(
      (await req("POST", "/api/chat", stranger.cookie, { familyId, body: "hi" })).status,
    ).toBe(404);
    // And no session at all → 401
    expect((await app.request(`/api/chat?familyId=${familyId}`, {}, t.env)).status).toBe(401);
  });

  it("soft delete: author can delete own; placeholder shown; content never leaks", async () => {
    const msg = await send(member.cookie, "oops wrong chat");

    expect((await req("DELETE", `/api/chat/${msg.id}`, member.cookie)).status).toBe(200);

    const res = await req("GET", `/api/chat?familyId=${familyId}`, owner.cookie);
    const { messages } = (await res.json()) as {
      messages: { id: string; body: string; deleted: boolean }[];
    };
    const deleted = messages.find((m) => m.id === msg.id)!;
    expect(deleted.deleted).toBe(true);
    expect(deleted.body).toBe("");

    // Double delete → 404
    expect((await req("DELETE", `/api/chat/${msg.id}`, member.cookie)).status).toBe(404);
  });

  it("delete authz: member cannot delete others' messages; admin/owner can", async () => {
    const ownerMsg = await send(owner.cookie, "owner says");
    expect((await req("DELETE", `/api/chat/${ownerMsg.id}`, member.cookie)).status).toBe(403);

    const memberMsg = await send(member.cookie, "member says");
    expect((await req("DELETE", `/api/chat/${memberMsg.id}`, owner.cookie)).status).toBe(200);
  });

  it("pagination: pages of 50 with hasMore + before cursor", async () => {
    // Seed 55 messages with strictly increasing timestamps.
    const base = Math.floor(Date.now() / 1000) - 10_000;
    const insert = t.sqlite.prepare(
      "INSERT INTO chat_messages (id, family_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    for (let i = 0; i < 55; i++) {
      insert.run(crypto.randomUUID(), familyId, owner.userId, `msg ${i}`, base + i);
    }

    const page1 = await req("GET", `/api/chat?familyId=${familyId}`, member.cookie);
    const p1 = (await page1.json()) as {
      messages: { body: string; createdAt: number }[];
      hasMore: boolean;
    };
    expect(p1.messages).toHaveLength(50);
    expect(p1.hasMore).toBe(true);
    expect(p1.messages[49].body).toBe("msg 54"); // newest last

    const before = p1.messages[0].createdAt;
    const page2 = await req(
      "GET",
      `/api/chat?familyId=${familyId}&before=${before}`,
      member.cookie,
    );
    const p2 = (await page2.json()) as {
      messages: { body: string }[];
      hasMore: boolean;
    };
    expect(p2.hasMore).toBe(false);
    expect(p2.messages[0].body).toBe("msg 0");
  });

  it("CSRF: cross-origin chat POST is rejected", async () => {
    const res = await app.request(
      "/api/chat",
      {
        method: "POST",
        headers: {
          Cookie: member.cookie,
          "Content-Type": "application/json",
          Origin: "https://evil.example",
        },
        body: JSON.stringify({ familyId, body: "forged" }),
      },
      t.env,
    );
    expect(res.status).toBe(403);
  });
});
