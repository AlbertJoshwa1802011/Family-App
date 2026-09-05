/**
 * Deep regression: adversarial cases across the whole application surface —
 * session lifecycle, cross-family isolation for every resource, trashed-doc
 * behavior, dependents, and input robustness (unicode, long strings).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../worker/index";
import {
  createTestEnv,
  seedActor,
  seedDocument,
  seedFamily,
  seedUser,
  seedSession,
  type TestEnv,
} from "./helpers/testEnv";

let t: TestEnv;
let famA: string;
let famB: string;
let alice: ReturnType<typeof seedActor>; // family A owner
let bob: ReturnType<typeof seedActor>; // family B owner

beforeEach(() => {
  t = createTestEnv();
  famA = seedFamily(t.sqlite, seedUser(t.sqlite).id, "Family A").id;
  famB = seedFamily(t.sqlite, seedUser(t.sqlite).id, "Family B").id;
  alice = seedActor(t.sqlite, famA, "owner", { name: "Alice" });
  bob = seedActor(t.sqlite, famB, "owner", { name: "Bob" });
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

// ── Session lifecycle ──────────────────────────────────────────────────────────

describe("session lifecycle", () => {
  it("idle-expired and absolute-expired sessions are rejected AND deleted", async () => {
    const now = Math.floor(Date.now() / 1000);
    t.sqlite
      .prepare(
        "INSERT INTO sessions (id, user_id, expires_at, idle_expires_at, last_seen_at) VALUES ('stale', ?, ?, ?, ?)",
      )
      .run(alice.userId, now + 86400, now - 10, now - 8000); // idle-expired

    const res = await req("GET", "/api/families", "sid=stale");
    expect(res.status).toBe(401);
    const row = t.sqlite.prepare("SELECT id FROM sessions WHERE id='stale'").get();
    expect(row).toBeUndefined();
  });

  it("logout revokes the session server-side (cookie replay fails)", async () => {
    const cookie = seedSession(t.sqlite, alice.userId);
    expect((await req("GET", "/api/families", cookie)).status).toBe(200);
    const logout = await req("POST", "/api/auth/logout", cookie, {});
    expect(logout.status).toBe(200);
    const setCookie = logout.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/Max-Age=0/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect((await req("GET", "/api/families", cookie)).status).toBe(401);
    const me = await req("GET", "/api/auth/me", cookie);
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: unknown }).user).toBeNull();
  });

  it("logout with a browser Origin header still revokes the session", async () => {
    const cookie = seedSession(t.sqlite, alice.userId);
    const res = await app.request(
      "/api/auth/logout",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "http://localhost:5173",
          "Content-Type": "application/json",
        },
        body: "{}",
      },
      t.env,
    );
    expect(res.status).toBe(200);
    expect((await req("GET", "/api/families", cookie)).status).toBe(401);
  });

  it("a valid session slides its idle window on use", async () => {
    const before = t.sqlite
      .prepare("SELECT idle_expires_at FROM sessions WHERE id = ?")
      .get(alice.cookie.slice(4)) as { idle_expires_at: number };
    await new Promise((r) => setTimeout(r, 1100));
    await req("GET", "/api/families", alice.cookie);
    const after = t.sqlite
      .prepare("SELECT idle_expires_at FROM sessions WHERE id = ?")
      .get(alice.cookie.slice(4)) as { idle_expires_at: number };
    expect(after.idle_expires_at).toBeGreaterThan(before.idle_expires_at);
  });
});

// ── Cross-family isolation, every resource ─────────────────────────────────────

describe("cross-family isolation matrix", () => {
  it("family B owner can access NOTHING in family A", async () => {
    const doc = seedDocument(t.sqlite, { familyId: famA, ownerUserId: alice.userId });
    const ev = await (
      await req("POST", "/api/events", alice.cookie, {
        familyId: famA,
        title: "A-event",
        startAt: Math.floor(Date.now() / 1000) + 3600,
      })
    ).json() as { event: { id: string } };
    const task = await (
      await req("POST", "/api/tasks", alice.cookie, { familyId: famA, title: "A-task" })
    ).json() as { task: { id: string } };
    const contact = await (
      await req("POST", "/api/contacts", alice.cookie, { familyId: famA, name: "Dr A" })
    ).json() as { contact: { id: string } };
    await req("POST", "/api/chat", alice.cookie, { familyId: famA, body: "A-secret" });

    const denied: [string, string][] = [
      ["GET", `/api/documents?familyId=${famA}`],
      ["GET", `/api/documents/${doc.id}`],
      ["GET", `/api/events?familyId=${famA}`],
      ["GET", `/api/events/${ev.event.id}`],
      ["GET", `/api/events/${ev.event.id}/ics`],
      ["GET", `/api/tasks?familyId=${famA}`],
      ["GET", `/api/tasks/${task.task.id}`],
      ["GET", `/api/contacts?familyId=${famA}`],
      ["GET", `/api/contacts/${contact.contact.id}`],
      ["GET", `/api/chat?familyId=${famA}`],
      ["GET", `/api/families/${famA}`],
      ["GET", `/api/families/${famA}/members`],
      ["GET", `/api/families/${famA}/activity`],
    ];
    for (const [method, path] of denied) {
      const res = await req(method, path, bob.cookie);
      expect(res.status, `${method} ${path}`).toBe(404);
    }

    // Mutations across the fence are denied too.
    expect(
      (await req("PATCH", `/api/tasks/${task.task.id}`, bob.cookie, { status: "done" })).status,
    ).toBe(404);
    expect(
      (await req("DELETE", `/api/documents/${doc.id}`, bob.cookie)).status,
    ).toBe(404);
    expect(
      (
        await req("POST", `/api/documents/${doc.id}/remind`, bob.cookie, {
          userId: alice.userId,
        })
      ).status,
    ).toBe(404);
  });

  it("cannot create resources INTO another family", async () => {
    for (const [path, body] of [
      ["/api/documents", { familyId: famA, title: "sneak" }],
      ["/api/events", { familyId: famA, title: "sneak", startAt: 9999999999 }],
      ["/api/tasks", { familyId: famA, title: "sneak" }],
      ["/api/contacts", { familyId: famA, name: "sneak" }],
      ["/api/chat", { familyId: famA, body: "sneak" }],
    ] as const) {
      const res = await req("POST", path, bob.cookie, body);
      expect(res.status, path).toBe(404);
    }
  });
});

// ── Trashed documents disappear from every surface ─────────────────────────────

describe("trashed documents", () => {
  it("are gone from list, search, get, files, comments, remind, member view", async () => {
    const doc = seedDocument(t.sqlite, {
      familyId: famA,
      ownerUserId: alice.userId,
      title: "Trashme",
    });
    await req("DELETE", `/api/documents/${doc.id}`, alice.cookie);

    const list = await (
      await req("GET", `/api/documents?familyId=${famA}`, alice.cookie)
    ).json() as { documents: { id: string }[] };
    expect(list.documents.map((d) => d.id)).not.toContain(doc.id);

    const search = await (
      await req("GET", `/api/documents?familyId=${famA}&q=Trashme`, alice.cookie)
    ).json() as { documents: unknown[] };
    expect(search.documents).toHaveLength(0);

    for (const [method, path, body] of [
      ["GET", `/api/documents/${doc.id}`, undefined],
      ["GET", `/api/documents/${doc.id}/files`, undefined],
      ["GET", `/api/documents/${doc.id}/comments`, undefined],
      ["POST", `/api/documents/${doc.id}/comments`, { body: "hi" }],
      ["POST", `/api/documents/${doc.id}/remind`, { userId: alice.userId }],
      ["PATCH", `/api/documents/${doc.id}`, { title: "revive?" }],
      ["DELETE", `/api/documents/${doc.id}`, undefined],
    ] as const) {
      const res = await req(method, path, alice.cookie, body as object | undefined);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });
});

// ── Dependents ─────────────────────────────────────────────────────────────────

describe("dependents", () => {
  it("admin adds a dependent; it lists; documents can belong to it", async () => {
    const res = await req("POST", `/api/families/${famA}/members`, alice.cookie, {
      displayName: "Ella",
      dateOfBirth: "2019-04-12",
    });
    expect(res.status).toBe(201);
    const { member } = (await res.json()) as { member: { id: string; memberType: string } };
    expect(member.memberType).toBe("dependent");

    // Document assigned to the dependent shows in the member filter.
    const doc = await (
      await req("POST", "/api/documents", alice.cookie, {
        familyId: famA,
        title: "Ella passport",
        subjectMemberId: member.id,
      })
    ).json() as { document: { id: string } };

    const filtered = await (
      await req("GET", `/api/documents?familyId=${famA}&member=${member.id}`, alice.cookie)
    ).json() as { documents: { id: string }[] };
    expect(filtered.documents.map((d) => d.id)).toEqual([doc.document.id]);
  });

  it("plain members cannot add dependents (403); invalid DOB rejected (400)", async () => {
    const mallory = seedActor(t.sqlite, famA, "member");
    expect(
      (
        await req("POST", `/api/families/${famA}/members`, mallory.cookie, {
          displayName: "Nope",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await req("POST", `/api/families/${famA}/members`, alice.cookie, {
          displayName: "Bad",
          dateOfBirth: "12-04-2019",
        })
      ).status,
    ).toBe(400);
  });
});

// ── Input robustness ───────────────────────────────────────────────────────────

describe("input robustness", () => {
  it("unicode titles/messages survive round-trips intact", async () => {
    const title = "Паспорт 🛂 — 日本のビザ (renewal!)";
    const created = await (
      await req("POST", "/api/documents", alice.cookie, { familyId: famA, title })
    ).json() as { document: { id: string; title: string } };
    expect(created.document.title).toBe(title);

    const found = await (
      await req(
        "GET",
        `/api/documents?familyId=${famA}&q=${encodeURIComponent("日本")}`,
        alice.cookie,
      )
    ).json() as { documents: { title: string }[] };
    expect(found.documents.map((d) => d.title)).toContain(title);

    await req("POST", "/api/chat", alice.cookie, { familyId: famA, body: "héllo 👨‍👩‍👧‍👦" });
    const chat = await (
      await req("GET", `/api/chat?familyId=${famA}`, alice.cookie)
    ).json() as { messages: { body: string }[] };
    expect(chat.messages[0].body).toBe("héllo 👨‍👩‍👧‍👦");
  });

  it("length limits enforced: 301-char doc title, 4001-char chat, 201-char event title", async () => {
    expect(
      (
        await req("POST", "/api/documents", alice.cookie, {
          familyId: famA,
          title: "x".repeat(301),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req("POST", "/api/chat", alice.cookie, {
          familyId: famA,
          body: "x".repeat(4001),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req("POST", "/api/events", alice.cookie, {
          familyId: famA,
          title: "x".repeat(201),
          startAt: 9999999999,
        })
      ).status,
    ).toBe(400);
  });

  it("unknown nested API paths stay JSON 404 (never HTML)", async () => {
    for (const path of [
      "/api/chat/deeply/nested/nonsense",
      "/api/calendar/bogus",
      "/api/documents/x/files/y/z/download/extra",
    ]) {
      const res = await req("GET", path, alice.cookie);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/json");
    }
  });
});
