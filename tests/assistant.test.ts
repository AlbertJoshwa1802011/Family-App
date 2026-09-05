/**
 * Family assistant: authz, AI-not-configured, tool execution against D1,
 * visibility-filtered context, mocked Claude tool loop.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { Message } from "@anthropic-ai/sdk/resources/messages";
import { app } from "../worker/index";
import { getDb } from "../worker/db/client";
import { loadFamilySnapshot } from "../worker/lib/assistantContext";
import { executeAssistantTool } from "../worker/lib/assistantTools";
import { runAssistantTurn, type CompleteFn } from "../worker/lib/assistant";
import { TASK_WINDOWS, dueReminderWindow, taskReminderText } from "../worker/lib/reminders";
import { runExpiryReminders } from "../worker/cron";
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

function fakeMessage(content: Message["content"], stopReason: Message["stop_reason"]): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content,
    model: "test",
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as Message;
}

describe("assistant HTTP contract", () => {
  it("401 without session", async () => {
    expect((await app.request("/api/assistant", {}, t.env)).status).toBe(401);
    expect(
      (
        await app.request(
          "/api/assistant",
          { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
          t.env,
        )
      ).status,
    ).toBe(401);
  });

  it("400 without familyId / empty message; 404 for outsiders", async () => {
    expect((await req("GET", "/api/assistant", member.cookie)).status).toBe(400);
    const empty = await req("POST", "/api/assistant", member.cookie, { familyId, message: "" });
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { error: string }).error).toBe("validation_error");

    const strangerUser = seedUser(t.sqlite);
    const other = seedFamily(t.sqlite, strangerUser.id);
    const stranger = seedActor(t.sqlite, other.id, "owner");
    expect(
      (await req("GET", `/api/assistant?familyId=${familyId}`, stranger.cookie)).status,
    ).toBe(404);
    expect(
      (await req("POST", "/api/assistant", stranger.cookie, { familyId, message: "hi" })).status,
    ).toBe(404);
  });

  it("503 ai_not_configured when Gemini and Anthropic keys are both missing", async () => {
    const res = await req("POST", "/api/assistant", member.cookie, {
      familyId,
      message: "add 100 for snacks",
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("ai_not_configured");
  });

  it("GET returns empty history and configured:false without a key", async () => {
    const res = await req("GET", `/api/assistant?familyId=${familyId}`, member.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      messages: unknown[];
      configured: boolean;
      provider: string | null;
    };
    expect(body.messages).toEqual([]);
    expect(body.configured).toBe(false);
    expect(body.provider).toBeNull();
  });
});

describe("assistant tools (no LLM)", () => {
  function ctx(userId = member.userId) {
    return {
      db: getDb(t.env),
      familyId,
      userId,
      role: "member",
      nowMs: Date.UTC(2026, 8, 5),
    };
  }

  it("add_expense records 100 snacks as 10000 cents", async () => {
    const result = await executeAssistantTool(
      "add_expense",
      { amount: 100, category: "food", note: "outside snacks" },
      ctx(),
    );
    expect(result.ok).toBe(true);
    expect(result.action?.summary).toContain("₹100");
    expect(result.action?.summary.toLowerCase()).toContain("snacks");

    const list = await req("GET", `/api/expenses?familyId=${familyId}`, member.cookie);
    const { expenses, total } = (await list.json()) as {
      expenses: { note: string; amount: number }[];
      total: number;
    };
    expect(total).toBe(100);
    expect(expenses[0].note).toBe("outside snacks");
  });

  it("add_task with dueDate and complete_task roundtrip", async () => {
    const added = await executeAssistantTool(
      "add_task",
      { title: "Renew visa", dueDate: "2026-09-12" },
      ctx(),
    );
    expect(added.ok).toBe(true);
    const id = added.action?.id as string;

    const done = await executeAssistantTool("complete_task", { taskId: id }, ctx());
    expect(done.ok).toBe(true);

    const get = await req("GET", `/api/tasks/${id}`, member.cookie);
    const { task } = (await get.json()) as { task: { status: string } };
    expect(task.status).toBe("done");
  });

  it("add_event and add_contact write family-scoped rows", async () => {
    const ev = await executeAssistantTool(
      "add_event",
      { title: "Dentist", date: "2026-09-20", type: "appointment" },
      ctx(),
    );
    expect(ev.ok).toBe(true);
    const contact = await executeAssistantTool(
      "add_contact",
      { name: "Dr Rao", relationship: "Dentist", phone: "+91 99999" },
      ctx(),
    );
    expect(contact.ok).toBe(true);
  });

  it("list_expenses returns family rows and can filter by category", async () => {
    await executeAssistantTool(
      "add_expense",
      { amount: 40, category: "food", note: "chai" },
      ctx(),
    );
    await executeAssistantTool(
      "add_expense",
      { amount: 250, category: "transport", note: "uber" },
      ctx(),
    );
    const all = await executeAssistantTool("list_expenses", {}, ctx());
    expect(all.ok).toBe(true);
    const listed = all.data as { expenses: { note: string; amount: number }[] };
    expect(listed.expenses).toHaveLength(2);

    const food = await executeAssistantTool("list_expenses", { category: "food" }, ctx());
    const foodRows = (food.data as { expenses: { note: string }[] }).expenses;
    expect(foodRows.map((r) => r.note)).toEqual(["chai"]);
  });

  it("rejects unknown tools and invalid expense input", async () => {
    expect((await executeAssistantTool("explode", {}, ctx())).ok).toBe(false);
    expect((await executeAssistantTool("add_expense", { amount: -1 }, ctx())).ok).toBe(false);
    expect((await executeAssistantTool("add_expense", { amount: 0 }, ctx())).ok).toBe(false);
    expect(
      (await executeAssistantTool("add_task", { title: "", dueDate: "tomorrow" }, ctx())).ok,
    ).toBe(false);
  });

  it("add_task rejects an assignee from another family", async () => {
    const otherUser = seedUser(t.sqlite);
    const otherFam = seedFamily(t.sqlite, otherUser.id);
    const other = seedActor(t.sqlite, otherFam.id, "owner");
    const result = await executeAssistantTool(
      "add_task",
      { title: "Spy", assignedToMemberId: other.memberId },
      ctx(),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_member_ids");
  });

  it("complete_task cannot touch another family's task", async () => {
    const otherUser = seedUser(t.sqlite);
    const otherFam = seedFamily(t.sqlite, otherUser.id);
    const other = seedActor(t.sqlite, otherFam.id, "owner");
    const created = await (
      await req("POST", "/api/tasks", other.cookie, { familyId: otherFam.id, title: "secret" })
    ).json() as { task: { id: string } };

    const result = await executeAssistantTool(
      "complete_task",
      { taskId: created.task.id },
      ctx(),
    );
    expect(result.ok).toBe(false);
  });
});

describe("assistant family snapshot visibility", () => {
  it("omits another member's private document from a member snapshot", async () => {
    seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
      title: "Olive private will",
      visibility: "private",
    });
    seedDocument(t.sqlite, {
      familyId,
      ownerUserId: member.userId,
      title: "Family passport",
      visibility: "family",
    });

    const db = getDb(t.env);
    const memberSnap = await loadFamilySnapshot(db, {
      familyId,
      userId: member.userId,
      role: "member",
    });
    expect(memberSnap?.documents.map((d) => d.title)).toEqual(["Family passport"]);

    const ownerSnap = await loadFamilySnapshot(db, {
      familyId,
      userId: owner.userId,
      role: "owner",
    });
    expect(ownerSnap?.documents.map((d) => d.title).sort()).toEqual(
      ["Family passport", "Olive private will"].sort(),
    );
    expect(ownerSnap?.you.email).toBe(owner.email);
    expect(ownerSnap?.family.name).toBe("Test Family");
  });

  it("includes this-month expenses in stats and omits another family's spend", async () => {
    const nowMs = Date.UTC(2026, 8, 5);
    await executeAssistantTool(
      "add_expense",
      { amount: 100, category: "food", note: "snacks", spentOn: "2026-09-05" },
      { db: getDb(t.env), familyId, userId: member.userId, role: "member", nowMs },
    );
    const otherUser = seedUser(t.sqlite);
    const otherFam = seedFamily(t.sqlite, otherUser.id);
    const other = seedActor(t.sqlite, otherFam.id, "owner");
    await executeAssistantTool(
      "add_expense",
      { amount: 999, category: "travel", note: "secret trip", spentOn: "2026-09-05" },
      {
        db: getDb(t.env),
        familyId: otherFam.id,
        userId: other.userId,
        role: "owner",
        nowMs,
      },
    );

    const snap = await loadFamilySnapshot(
      getDb(t.env),
      { familyId, userId: member.userId, role: "member" },
      nowMs,
    );
    expect(snap?.stats.expenseCountThisMonth).toBe(1);
    expect(snap?.stats.expenseTotalThisMonth).toBe(100);
    expect(snap?.recentExpenses.map((e) => e.note)).toEqual(["snacks"]);
  });

  it("GET history is private per user even in the same family", async () => {
    t.sqlite
      .prepare(
        `INSERT INTO assistant_messages (id, family_id, user_id, role, body, created_at)
         VALUES (?, ?, ?, 'user', 'milo private', unixepoch())`,
      )
      .run(crypto.randomUUID(), familyId, member.userId);

    const mine = await req("GET", `/api/assistant?familyId=${familyId}`, member.cookie);
    const mineBody = (await mine.json()) as { messages: { body: string }[] };
    expect(mineBody.messages.map((m) => m.body)).toEqual(["milo private"]);

    const theirs = await req("GET", `/api/assistant?familyId=${familyId}`, owner.cookie);
    const theirsBody = (await theirs.json()) as { messages: { body: string }[] };
    expect(theirsBody.messages).toEqual([]);
  });
});

describe("assistant Claude loop (injected complete)", () => {
  it("runs add_expense when the model calls the tool, then returns the closing text", async () => {
    let round = 0;
    const complete: CompleteFn = async ({ messages }) => {
      round++;
      const last = messages[messages.length - 1];
      const isToolResult =
        Array.isArray(last.content) &&
        last.content.some((b) => typeof b === "object" && b !== null && "type" in b && b.type === "tool_result");
      if (!isToolResult) {
        return fakeMessage(
          [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "add_expense",
              input: { amount: 100, category: "food", note: "outside snacks" },
            },
          ],
          "tool_use",
        );
      }
      return fakeMessage(
        [{ type: "text", text: "Logged ₹100 for outside snacks. Want a running total?" }],
        "end_turn",
      );
    };

    const turn = await runAssistantTurn({
      env: t.env,
      db: getDb(t.env),
      familyId,
      userId: member.userId,
      role: "member",
      message: "add 100 expense for outside snacks",
      complete,
    });

    expect(round).toBe(2);
    expect(turn.actions).toHaveLength(1);
    expect(turn.actions[0].tool).toBe("add_expense");
    expect(turn.reply).toContain("₹100");

    const list = await req("GET", `/api/expenses?familyId=${familyId}`, member.cookie);
    const { total } = (await list.json()) as { total: number };
    expect(total).toBe(100);
  });

  it("answers without tools when the model just talks", async () => {
    const complete: CompleteFn = async () =>
      fakeMessage([{ type: "text", text: "You have no open tasks." }], "end_turn");

    const turn = await runAssistantTurn({
      env: t.env,
      db: getDb(t.env),
      familyId,
      userId: member.userId,
      role: "member",
      message: "any tasks?",
      complete,
    });
    expect(turn.actions).toEqual([]);
    expect(turn.reply).toBe("You have no open tasks.");
  });

  it("runs two tools in one round (expense + task) then confirms", async () => {
    let round = 0;
    const complete: CompleteFn = async ({ messages }) => {
      round++;
      const last = messages[messages.length - 1];
      const isToolResult =
        Array.isArray(last.content) &&
        last.content.some(
          (b) => typeof b === "object" && b !== null && "type" in b && b.type === "tool_result",
        );
      if (!isToolResult) {
        return fakeMessage(
          [
            {
              type: "tool_use",
              id: "toolu_e",
              name: "add_expense",
              input: { amount: 80, category: "groceries", note: "milk" },
            },
            {
              type: "tool_use",
              id: "toolu_t",
              name: "add_task",
              input: { title: "Buy more milk", dueDate: "2026-09-12" },
            },
          ],
          "tool_use",
        );
      }
      return fakeMessage(
        [{ type: "text", text: "Logged ₹80 for milk and added a reminder to restock." }],
        "end_turn",
      );
    };

    const turn = await runAssistantTurn({
      env: t.env,
      db: getDb(t.env),
      familyId,
      userId: member.userId,
      role: "member",
      message: "spent 80 on milk, remind me to buy more",
      complete,
    });

    expect(round).toBe(2);
    expect(turn.actions.map((a) => a.tool).sort()).toEqual(["add_expense", "add_task"]);
    expect(turn.reply).toContain("₹80");

    const tasks = await req("GET", `/api/tasks?familyId=${familyId}`, member.cookie);
    const taskBody = (await tasks.json()) as { tasks: { title: string }[] };
    expect(taskBody.tasks.some((tk) => tk.title === "Buy more milk")).toBe(true);
  });
});

describe("task due-date reminders", () => {
  it("phrases overdue / today / upcoming", () => {
    expect(taskReminderText("Visa", -2).title).toContain("Overdue");
    expect(taskReminderText("Visa", 0).title).toContain("today");
    expect(taskReminderText("Visa", 2).body).toContain("2 days");
    expect(dueReminderWindow(5, TASK_WINDOWS)).toBe(7);
    expect(dueReminderWindow(2, TASK_WINDOWS)).toBe(2);
    expect(dueReminderWindow(1, TASK_WINDOWS)).toBe(1);
    expect(dueReminderWindow(7, TASK_WINDOWS)).toBe(7);
    expect(dueReminderWindow(10, TASK_WINDOWS)).toBeNull();
    expect(TASK_WINDOWS).toEqual([7, 2, 1]);
  });

  it("cron notifies at the 7-day window for an unassigned task", async () => {
    const due = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
    expect(
      (
        await req("POST", "/api/tasks", member.cookie, {
          familyId,
          title: "Passport photos",
          dueDate: due,
        })
      ).status,
    ).toBe(201);

    await runExpiryReminders(t.env);
    const mine = await req("GET", "/api/notifications", member.cookie);
    const mineBody = (await mine.json()) as { notifications: { type: string; title: string }[] };
    expect(mineBody.notifications.some((n) => n.title.toLowerCase().includes("passport"))).toBe(
      true,
    );
  });

  it("cron notifies the family for an unassigned task due in 2 days, then dedupes", async () => {
    const due = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
    const create = await req("POST", "/api/tasks", member.cookie, {
      familyId,
      title: "Pick up prescriptions",
      dueDate: due,
    });
    expect(create.status).toBe(201);

    await runExpiryReminders(t.env);

    const mine = await req("GET", "/api/notifications", member.cookie);
    const mineBody = (await mine.json()) as {
      notifications: { type: string; title: string }[];
    };
    const hit = mineBody.notifications.find((n) => n.type === "task");
    expect(hit).toBeTruthy();
    expect(hit!.title.toLowerCase()).toContain("prescriptions");

    await runExpiryReminders(t.env);
    const again = await req("GET", "/api/notifications", member.cookie);
    const againBody = (await again.json()) as { notifications: { type: string }[] };
    expect(againBody.notifications.filter((n) => n.type === "task")).toHaveLength(
      mineBody.notifications.filter((n) => n.type === "task").length,
    );
  });

  it("assigned task reminds only the assignee", async () => {
    const due = new Date(Date.now() + 1 * 86400_000).toISOString().slice(0, 10);
    await req("POST", "/api/tasks", owner.cookie, {
      familyId,
      title: "Only Milo",
      dueDate: due,
      assignedToMemberId: member.memberId,
    });

    await runExpiryReminders(t.env);

    const mine = await req("GET", "/api/notifications", member.cookie);
    const mineBody = (await mine.json()) as { notifications: { title: string }[] };
    expect(mineBody.notifications.some((n) => n.title.includes("Only Milo"))).toBe(true);

    const theirs = await req("GET", "/api/notifications", owner.cookie);
    const theirsBody = (await theirs.json()) as { notifications: { title: string }[] };
    expect(theirsBody.notifications.some((n) => n.title.includes("Only Milo"))).toBe(false);
  });
});
