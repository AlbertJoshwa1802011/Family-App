/**
 * End-to-end SUCCESS-PATH integration tests against a real (in-memory SQLite)
 * database running the actual migrations. Every core user flow is recorded
 * here: if "add a document" or "get a reminder" breaks, this file fails.
 *
 * Flows covered:
 *  1. Create family → appears in /families
 *  2. Create document (all fields) → list → get → update → clear fields → trash
 *  3. Record a file version → currentFileId advances, versions increment
 *  4. Events: create with attendees → list in range → cancel → still listed
 *  5. Tasks: create → toggle done → unassign (null clears) → delete
 *  6. Contacts: create → update → delete
 *  7. Invites: create (admin) → accept with matching email → member added;
 *     wrong-email account is rejected
 *  8. Reminder pipeline: seed expiring doc → run cron → in-app notification
 *     exists → dedupe on second run → mark read
 *  9. Reminder prefs: PUT persists and normalizes windows
 */
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../worker/index";
import { runExpiryReminders } from "../worker/cron";
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
  owner = seedActor(t.sqlite, familyId, "owner");
  member = seedActor(t.sqlite, familyId, "member");
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

// ── 1. Family creation ─────────────────────────────────────────────────────────

describe("1. family lifecycle", () => {
  it("creates a family and lists it with the creator as owner", async () => {
    const user = seedUser(t.sqlite);
    const cookie = (await import("./helpers/testEnv")).seedSession(t.sqlite, user.id);

    const create = await req("POST", "/api/families", cookie, { name: "The Halls" });
    expect(create.status).toBe(201);
    const { family } = (await create.json()) as { family: { id: string; name: string } };
    expect(family.name).toBe("The Halls");

    const list = await req("GET", "/api/families", cookie);
    const { families } = (await list.json()) as {
      families: { id: string; role: string }[];
    };
    const mine = families.find((f) => f.id === family.id);
    expect(mine?.role).toBe("owner");
  });
});

// ── 2+3. Documents ─────────────────────────────────────────────────────────────

describe("2. document success path (create → read → update → clear → trash)", () => {
  it("full lifecycle works", async () => {
    // CREATE with every optional field
    const create = await req("POST", "/api/documents", member.cookie, {
      familyId,
      title: "Mum's passport",
      category: "identity",
      description: "Renew at the embassy",
      expiryDate: "2027-03-01",
      issuedDate: "2017-03-01",
      visibility: "family",
      subjectMemberId: member.memberId,
    });
    expect(create.status).toBe(201);
    const { document } = (await create.json()) as {
      document: { id: string; title: string; expiryDate: string };
    };
    expect(document.title).toBe("Mum's passport");
    expect(document.expiryDate).toBe("2027-03-01");

    // LIST includes it
    const list = await req("GET", `/api/documents?familyId=${familyId}`, member.cookie);
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { documents: { id: string }[] };
    expect(listed.documents.map((d) => d.id)).toContain(document.id);

    // UPDATE a field
    const patch = await req("PATCH", `/api/documents/${document.id}`, member.cookie, {
      title: "Mum's passport (renewed)",
    });
    expect(patch.status).toBe(200);

    // CLEAR nullable fields with explicit null
    const clear = await req("PATCH", `/api/documents/${document.id}`, member.cookie, {
      description: null,
      subjectMemberId: null,
    });
    expect(clear.status).toBe(200);
    const cleared = (await clear.json()) as {
      document: { description: string | null; subjectMemberId: string | null };
    };
    expect(cleared.document.description).toBeNull();
    expect(cleared.document.subjectMemberId).toBeNull();

    // TRASH (soft delete) → disappears from list and get
    const del = await req("DELETE", `/api/documents/${document.id}`, member.cookie);
    expect(del.status).toBe(200);
    expect((await req("GET", `/api/documents/${document.id}`, member.cookie)).status).toBe(404);

    // Audit log recorded create + delete
    const activity = await req("GET", `/api/families/${familyId}/activity`, owner.cookie);
    const { activities } = (await activity.json()) as {
      activities: { action: string }[];
    };
    const actions = activities.map((x) => x.action);
    expect(actions).toContain("document_created");
    expect(actions).toContain("document_deleted");
  });

  it("file versions: recording files advances version and currentFileId", async () => {
    const create = await req("POST", "/api/documents", member.cookie, {
      familyId,
      title: "Insurance policy",
    });
    const { document } = (await create.json()) as { document: { id: string } };

    const v1 = await req("POST", `/api/documents/${document.id}/files`, member.cookie, {
      driveFileId: "drive-1",
      fileName: "policy-v1.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1000,
    });
    expect(v1.status).toBe(201);
    const f1 = (await v1.json()) as { file: { id: string; version: number } };
    expect(f1.file.version).toBe(1);

    const v2 = await req("POST", `/api/documents/${document.id}/files`, member.cookie, {
      driveFileId: "drive-2",
      fileName: "policy-v2.pdf",
      mimeType: "application/pdf",
    });
    const f2 = (await v2.json()) as { file: { id: string; version: number } };
    expect(f2.file.version).toBe(2);

    const get = await req("GET", `/api/documents/${document.id}`, member.cookie);
    const { document: doc } = (await get.json()) as {
      document: { currentFileId: string };
    };
    expect(doc.currentFileId).toBe(f2.file.id);
  });
});

// ── 4. Events ──────────────────────────────────────────────────────────────────

describe("3. event success path", () => {
  it("create with attendees → range list → cancel keeps it visible", async () => {
    const start = Math.floor(Date.now() / 1000) + 7 * 86400;
    const create = await req("POST", "/api/events", member.cookie, {
      familyId,
      title: "Grandpa's 80th",
      type: "gathering",
      startAt: start,
      endAt: start + 3600,
      attendeeMemberIds: [owner.memberId, member.memberId],
    });
    expect(create.status).toBe(201);
    const { event } = (await create.json()) as { event: { id: string } };

    // Attendees persisted
    const detail = await req("GET", `/api/events/${event.id}`, owner.cookie);
    const det = (await detail.json()) as { attendees: unknown[] };
    expect(det.attendees).toHaveLength(2);

    // Range list finds it
    const from = start - 86400;
    const to = start + 86400;
    const list = await req(
      "GET",
      `/api/events?familyId=${familyId}&from=${from}&to=${to}`,
      member.cookie,
    );
    const { events } = (await list.json()) as { events: { id: string }[] };
    expect(events.map((e) => e.id)).toContain(event.id);

    // Cancel: stays listed with cancelled status (never conflate type/status)
    expect((await req("POST", `/api/events/${event.id}/cancel`, member.cookie)).status).toBe(200);
    const list2 = await req(
      "GET",
      `/api/events?familyId=${familyId}&from=${from}&to=${to}`,
      member.cookie,
    );
    const after = (await list2.json()) as { events: { id: string; status: string }[] };
    const cancelled = after.events.find((e) => e.id === event.id);
    expect(cancelled?.status).toBe("cancelled");
  });

  it("rejects attendees from another family", async () => {
    const strangerUser = seedUser(t.sqlite);
    const otherFamily = seedFamily(t.sqlite, strangerUser.id);
    const stranger = seedActor(t.sqlite, otherFamily.id, "owner");

    const res = await req("POST", "/api/events", member.cookie, {
      familyId,
      title: "Sneaky",
      startAt: Math.floor(Date.now() / 1000) + 3600,
      attendeeMemberIds: [stranger.memberId],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_member_ids");
  });
});

// ── 5. Tasks ───────────────────────────────────────────────────────────────────

describe("4. task success path", () => {
  it("create → toggle done → unassign via null → delete", async () => {
    const create = await req("POST", "/api/tasks", member.cookie, {
      familyId,
      title: "Renew car insurance",
      dueDate: "2026-08-01",
      assignedToMemberId: owner.memberId,
    });
    expect(create.status).toBe(201);
    const { task } = (await create.json()) as {
      task: { id: string; assignedToMemberId: string };
    };
    expect(task.assignedToMemberId).toBe(owner.memberId);

    // Toggle done
    const done = await req("PATCH", `/api/tasks/${task.id}`, member.cookie, {
      status: "done",
    });
    expect(done.status).toBe(200);
    expect(((await done.json()) as { task: { status: string } }).task.status).toBe("done");

    // Unassign: explicit null must clear the assignee
    const unassign = await req("PATCH", `/api/tasks/${task.id}`, member.cookie, {
      assignedToMemberId: null,
    });
    const un = (await unassign.json()) as { task: { assignedToMemberId: string | null } };
    expect(un.task.assignedToMemberId).toBeNull();

    // Delete
    expect((await req("DELETE", `/api/tasks/${task.id}`, member.cookie)).status).toBe(200);
    expect((await req("GET", `/api/tasks/${task.id}`, member.cookie)).status).toBe(404);
  });

  it("rejects an assignee from another family", async () => {
    const strangerUser = seedUser(t.sqlite);
    const otherFamily = seedFamily(t.sqlite, strangerUser.id);
    const stranger = seedActor(t.sqlite, otherFamily.id, "member");

    const res = await req("POST", "/api/tasks", member.cookie, {
      familyId,
      title: "Bad assignment",
      assignedToMemberId: stranger.memberId,
    });
    expect(res.status).toBe(400);
  });
});

// ── 6. Contacts ────────────────────────────────────────────────────────────────

describe("5. contact success path", () => {
  it("create → update → delete", async () => {
    const create = await req("POST", "/api/contacts", member.cookie, {
      familyId,
      name: "Dr. Rivera",
      relationship: "Pediatrician",
      phone: "+1 (555) 010-2000",
      email: "rivera@clinic.example",
    });
    expect(create.status).toBe(201);
    const { contact } = (await create.json()) as { contact: { id: string } };

    const patch = await req("PATCH", `/api/contacts/${contact.id}`, member.cookie, {
      phone: "+1 (555) 010-9999",
    });
    expect(patch.status).toBe(200);
    const updated = (await patch.json()) as { contact: { phone: string } };
    expect(updated.contact.phone).toBe("+1 (555) 010-9999");

    expect((await req("DELETE", `/api/contacts/${contact.id}`, member.cookie)).status).toBe(200);
    const list = await req("GET", `/api/contacts?familyId=${familyId}`, member.cookie);
    const { contacts } = (await list.json()) as { contacts: { id: string }[] };
    expect(contacts.map((x) => x.id)).not.toContain(contact.id);
  });
});

// ── 7. Invites ─────────────────────────────────────────────────────────────────

describe("6. invite flow (email-bound)", () => {
  it("admin invites → matching-email user accepts → becomes member", async () => {
    const invite = await req("POST", `/api/families/${familyId}/invites`, owner.cookie, {
      email: "cousin@example.com",
      role: "member",
    });
    expect(invite.status).toBe(201);
    const { invite: inv } = (await invite.json()) as { invite: { token: string } };
    expect(inv.token).toBeTruthy();

    // Right email → accepted
    const cousin = seedUser(t.sqlite, { email: "cousin@example.com" });
    const { seedSession } = await import("./helpers/testEnv");
    const cousinCookie = seedSession(t.sqlite, cousin.id);
    const accept = await req(
      "POST",
      `/api/families/invites/${inv.token}/accept`,
      cousinCookie,
    );
    expect(accept.status).toBe(200);

    // Now a member: can list documents
    const list = await req("GET", `/api/documents?familyId=${familyId}`, cousinCookie);
    expect(list.status).toBe(200);

    // Token is single-use
    const again = await req(
      "POST",
      `/api/families/invites/${inv.token}/accept`,
      cousinCookie,
    );
    expect(again.status).toBe(409);
  });

  it("a different account cannot use someone else's invite token", async () => {
    const invite = await req("POST", `/api/families/${familyId}/invites`, owner.cookie, {
      email: "intended@example.com",
      role: "member",
    });
    const { invite: inv } = (await invite.json()) as { invite: { token: string } };

    const interloper = seedUser(t.sqlite, { email: "interloper@example.com" });
    const { seedSession } = await import("./helpers/testEnv");
    const cookie = seedSession(t.sqlite, interloper.id);

    const res = await req("POST", `/api/families/invites/${inv.token}/accept`, cookie);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invite_email_mismatch");
  });

  it("member role cannot create invites (403)", async () => {
    const res = await req("POST", `/api/families/${familyId}/invites`, member.cookie, {
      email: "nope@example.com",
    });
    expect(res.status).toBe(403);
  });
});

// ── 8. Reminder pipeline (the "basic reminder" success case) ───────────────────

describe("7. reminder pipeline end-to-end", () => {
  it("expiring document → cron run → in-app notification → dedupe → mark read", async () => {
    // Document expiring in 5 days (within the default 30/7/1 windows: 7d window due)
    const expiry = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
    const create = await req("POST", "/api/documents", member.cookie, {
      familyId,
      title: "Visa",
      expiryDate: expiry,
    });
    expect(create.status).toBe(201);

    await runExpiryReminders(t.env);

    // Both active family members got an in-app notification
    const notifs = await req("GET", "/api/notifications", member.cookie);
    expect(notifs.status).toBe(200);
    const body = (await notifs.json()) as {
      notifications: { id: string; type: string; title: string; read: boolean }[];
      unreadCount: number;
    };
    expect(body.unreadCount).toBeGreaterThan(0);
    const reminder = body.notifications.find((n) => n.type === "expiry");
    expect(reminder).toBeTruthy();
    expect(reminder!.title.toLowerCase()).toContain("visa");

    // Second cron run must NOT duplicate (reminders_log dedupe)
    await runExpiryReminders(t.env);
    const notifs2 = await req("GET", "/api/notifications", member.cookie);
    const body2 = (await notifs2.json()) as { notifications: unknown[] };
    expect(body2.notifications.length).toBe(body.notifications.length);

    // Mark read
    const read = await req(
      "POST",
      `/api/notifications/${reminder!.id}/read`,
      member.cookie,
    );
    expect(read.status).toBe(200);
    const after = await req("GET", "/api/notifications?unreadOnly=1", member.cookie);
    const unread = (await after.json()) as { notifications: { id: string }[] };
    expect(unread.notifications.map((n) => n.id)).not.toContain(reminder!.id);
  });

  it("private doc reminders go only to the doc owner", async () => {
    const expiry = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
    await req("POST", "/api/documents", member.cookie, {
      familyId,
      title: "Secret contract",
      expiryDate: expiry,
      visibility: "private",
    });

    await runExpiryReminders(t.env);

    const mine = await req("GET", "/api/notifications", member.cookie);
    const mineBody = (await mine.json()) as { notifications: { title: string }[] };
    expect(mineBody.notifications.some((n) => n.title.toLowerCase().includes("secret"))).toBe(true);

    const theirs = await req("GET", "/api/notifications", owner.cookie);
    const theirsBody = (await theirs.json()) as { notifications: { title: string }[] };
    expect(theirsBody.notifications.some((n) => n.title.toLowerCase().includes("secret"))).toBe(false);
  });
});

// ── 9. Reminder prefs ──────────────────────────────────────────────────────────

describe("8. reminder preferences", () => {
  it("PUT persists and normalizes windows; GET returns them", async () => {
    const put = await req("PUT", "/api/notifications/prefs", member.cookie, {
      emailEnabled: false,
      windows: [14, 3, 14], // duplicate must be normalized away
    });
    expect(put.status).toBe(200);

    const get = await req("GET", "/api/notifications/prefs", member.cookie);
    const { prefs } = (await get.json()) as {
      prefs: { emailEnabled: boolean; windows: number[] };
    };
    expect(prefs.emailEnabled).toBe(false);
    expect(prefs.windows).toEqual([14, 3]);
  });
});
