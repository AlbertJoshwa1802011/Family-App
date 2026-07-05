/**
 * Tag-to-notify: chat @mentions and document reminders deliver in-app
 * notifications (+ email honoring prefs) to the right people only.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { app } from "../worker/index";
import { findMentions, type MentionableMember } from "../worker/lib/mentions";
import {
  createTestEnv,
  seedActor,
  seedDocument,
  seedFamily,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

let t: TestEnv;
let familyId: string;
let priya: ReturnType<typeof seedActor>;
let ravi: ReturnType<typeof seedActor>;
let sentEmails: { to: string; subject: string }[];

beforeEach(() => {
  t = createTestEnv({ RESEND_API_KEY: "test-key", APP_URL: "https://vault.example" });
  const ownerUser = seedUser(t.sqlite);
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
  priya = seedActor(t.sqlite, familyId, "owner", { name: "Priya Sharma" });
  ravi = seedActor(t.sqlite, familyId, "member", { name: "Ravi Sharma" });

  sentEmails = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      sentEmails.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 200 });
    }),
  );
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

async function notificationsFor(cookie: string) {
  const res = await req("GET", "/api/notifications", cookie);
  return ((await res.json()) as {
    notifications: { type: string; title: string; body: string; link: string }[];
  }).notifications;
}

describe("findMentions (pure)", () => {
  const members: MentionableMember[] = [
    { userId: "u1", name: "Priya Sharma", email: "p@x.com", emailEnabled: true },
    { userId: "u2", name: "Ravi Sharma", email: "r@x.com", emailEnabled: true },
  ];

  it("matches first name, full name, case-insensitive; dedupes", () => {
    expect(findMentions("hey @priya!", members).map((m) => m.userId)).toEqual(["u1"]);
    expect(findMentions("@Priya Sharma and @priya again", members)).toHaveLength(1);
    expect(findMentions("@RAVI check this", members).map((m) => m.userId)).toEqual(["u2"]);
  });

  it("@everyone tags all; no @ tags none", () => {
    expect(findMentions("@everyone dinner at 7", members)).toHaveLength(2);
    expect(findMentions("no tags here priya", members)).toHaveLength(0);
  });
});

describe("chat @mentions", () => {
  it("mentioned member gets a notification + email; sender does not", async () => {
    const res = await req("POST", "/api/chat", priya.cookie, {
      familyId,
      body: "@Ravi please renew the car insurance",
    });
    expect(res.status).toBe(201);

    const raviNotifs = await notificationsFor(ravi.cookie);
    const mention = raviNotifs.find((n) => n.type === "mention");
    expect(mention).toBeTruthy();
    expect(mention!.title).toContain("Priya");
    expect(mention!.link).toBe("/chat");

    expect(await notificationsFor(priya.cookie)).toHaveLength(0);
    expect(sentEmails.map((e) => e.to)).toContain(ravi.email);
  });

  it("plain messages notify no one", async () => {
    await req("POST", "/api/chat", priya.cookie, { familyId, body: "hello all" });
    expect(await notificationsFor(ravi.cookie)).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });
});

describe("document remind", () => {
  it("delivers notification + email with the doc link", async () => {
    const doc = seedDocument(t.sqlite, {
      familyId,
      ownerUserId: priya.userId,
      title: "Car insurance",
      expiryDate: "2026-08-01",
    });

    const res = await req("POST", `/api/documents/${doc.id}/remind`, priya.cookie, {
      userId: ravi.userId,
      note: "Please handle this before Friday",
    });
    expect(res.status).toBe(200);

    const notifs = await notificationsFor(ravi.cookie);
    const reminder = notifs.find((n) => n.type === "reminder");
    expect(reminder).toBeTruthy();
    expect(reminder!.title).toContain("Car insurance");
    expect(reminder!.body).toContain("before Friday");
    expect(reminder!.link).toBe(`/documents/${doc.id}`);
    expect(sentEmails.map((e) => e.to)).toContain(ravi.email);
  });

  it("cannot remind an outsider (400) or nudge a private doc to a non-owner", async () => {
    const doc = seedDocument(t.sqlite, {
      familyId,
      ownerUserId: priya.userId,
      title: "Secret",
      visibility: "private",
    });

    const strangerUser = seedUser(t.sqlite);
    expect(
      (
        await req("POST", `/api/documents/${doc.id}/remind`, priya.cookie, {
          userId: strangerUser.id,
        })
      ).status,
    ).toBe(400);

    // Ravi (plain member) can't even see the doc — 404 for him as sender…
    expect(
      (
        await req("POST", `/api/documents/${doc.id}/remind`, ravi.cookie, {
          userId: priya.userId,
        })
      ).status,
    ).toBe(404);

    // …and Priya can't use remind to leak it to Ravi.
    expect(
      (
        await req("POST", `/api/documents/${doc.id}/remind`, priya.cookie, {
          userId: ravi.userId,
        })
      ).status,
    ).toBe(400);
  });

  it("email respects the recipient's opt-out (notification still delivered)", async () => {
    t.sqlite
      .prepare(
        "INSERT INTO reminder_prefs (user_id, email_enabled, push_enabled, windows_json) VALUES (?, 0, 0, '[30,7,1]')",
      )
      .run(ravi.userId);
    const doc = seedDocument(t.sqlite, {
      familyId,
      ownerUserId: priya.userId,
      title: "Passport",
    });

    await req("POST", `/api/documents/${doc.id}/remind`, priya.cookie, {
      userId: ravi.userId,
    });

    expect((await notificationsFor(ravi.cookie)).some((n) => n.type === "reminder")).toBe(true);
    expect(sentEmails).toHaveLength(0);
  });
});
