/**
 * S8 — Assigning work to another family member.
 *
 * The same failure as event invitations: a task could be assigned to someone
 * who was never told, and only learned about it if a due-date reminder happened
 * to fire. Assigning work is scheduling too.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { seedCast, request, notificationsFor, notificationsOfType, type Cast } from "./helpers/family";

let c: Cast;
beforeEach(() => {
  c = seedCast();
});

async function createTask(cookie: string, body: Record<string, unknown> = {}) {
  const res = await request(c.t, "POST", "/api/tasks", cookie, {
    familyId: c.familyId,
    title: "Pay the school fees",
    ...body,
  });
  if (res.status !== 201) {
    throw new Error(`task create failed: ${res.status} ${await res.text()}`);
  }
  const { task } = (await res.json()) as { task: { id: string } };
  return task;
}

describe("S8.1 assignment on create", () => {
  it("notifies the assignee", async () => {
    await createTask(c.dad.cookie, { assignedToMemberId: c.teen.memberId });
    const n = await notificationsOfType(c.t, c.teen.cookie, "task_assigned");
    expect(n).toHaveLength(1);
    expect(n[0].title).toContain("Pay the school fees");
    expect(n[0].title).toContain("Dad");
  });

  it("includes the due date when there is one", async () => {
    await createTask(c.dad.cookie, {
      assignedToMemberId: c.teen.memberId,
      dueDate: "2026-10-01",
    });
    const [n] = await notificationsOfType(c.t, c.teen.cookie, "task_assigned");
    expect(n.body).toContain("2026-10-01");
  });

  it("does not notify anyone for an unassigned task", async () => {
    await createTask(c.dad.cookie);
    expect(await notificationsFor(c.t, c.teen.cookie)).toHaveLength(0);
    expect(await notificationsFor(c.t, c.mum.cookie)).toHaveLength(0);
  });

  it("does not notify you for a task you assign to yourself", async () => {
    await createTask(c.dad.cookie, { assignedToMemberId: c.dad.memberId });
    expect(await notificationsFor(c.t, c.dad.cookie)).toHaveLength(0);
  });

  it("does not notify a dependent — they have no account", async () => {
    const res = await request(c.t, "POST", "/api/tasks", c.dad.cookie, {
      familyId: c.familyId,
      title: "Timmy: tidy your room",
      assignedToMemberId: c.timmy.id,
    });
    expect(res.status).toBe(201);
  });

  it("rejects an assignee from another family", async () => {
    const res = await request(c.t, "POST", "/api/tasks", c.dad.cookie, {
      familyId: c.familyId,
      title: "Cross-family",
      assignedToMemberId: c.stranger.memberId,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_member_ids" });
  });
});

describe("S8.2 reassignment", () => {
  it("notifies the new assignee", async () => {
    const task = await createTask(c.dad.cookie, { assignedToMemberId: c.teen.memberId });
    await request(c.t, "PATCH", `/api/tasks/${task.id}`, c.dad.cookie, {
      assignedToMemberId: c.mum.memberId,
    });
    expect(await notificationsOfType(c.t, c.mum.cookie, "task_assigned")).toHaveLength(1);
  });

  it("tells the previous assignee it is no longer theirs", async () => {
    const task = await createTask(c.dad.cookie, { assignedToMemberId: c.teen.memberId });
    await request(c.t, "PATCH", `/api/tasks/${task.id}`, c.dad.cookie, {
      assignedToMemberId: c.mum.memberId,
    });
    expect(await notificationsOfType(c.t, c.teen.cookie, "task_unassigned")).toHaveLength(1);
  });

  it("assigning a previously unassigned task notifies only the new owner", async () => {
    const task = await createTask(c.dad.cookie);
    await request(c.t, "PATCH", `/api/tasks/${task.id}`, c.dad.cookie, {
      assignedToMemberId: c.teen.memberId,
    });
    expect(await notificationsOfType(c.t, c.teen.cookie, "task_assigned")).toHaveLength(1);
    expect(await notificationsOfType(c.t, c.mum.cookie, "task_unassigned")).toHaveLength(0);
  });

  it("clearing the assignee tells the person who had it", async () => {
    const task = await createTask(c.dad.cookie, { assignedToMemberId: c.teen.memberId });
    await request(c.t, "PATCH", `/api/tasks/${task.id}`, c.dad.cookie, {
      assignedToMemberId: null,
    });
    expect(await notificationsOfType(c.t, c.teen.cookie, "task_unassigned")).toHaveLength(1);
  });

  it("re-saving the SAME assignee notifies nobody again", async () => {
    const task = await createTask(c.dad.cookie, { assignedToMemberId: c.teen.memberId });
    await request(c.t, "PATCH", `/api/tasks/${task.id}`, c.dad.cookie, {
      assignedToMemberId: c.teen.memberId,
      title: "Pay the school fees (updated)",
    });
    expect(await notificationsOfType(c.t, c.teen.cookie, "task_assigned")).toHaveLength(1);
  });

  it("an edit that does not touch the assignee notifies nobody", async () => {
    const task = await createTask(c.dad.cookie, { assignedToMemberId: c.teen.memberId });
    await request(c.t, "PATCH", `/api/tasks/${task.id}`, c.dad.cookie, {
      title: "Renamed",
    });
    expect(await notificationsOfType(c.t, c.teen.cookie, "task_assigned")).toHaveLength(1);
  });

  it("the assignee reassigning to themselves is not self-notified", async () => {
    const task = await createTask(c.dad.cookie);
    await request(c.t, "PATCH", `/api/tasks/${task.id}`, c.teen.cookie, {
      assignedToMemberId: c.teen.memberId,
    });
    expect(await notificationsFor(c.t, c.teen.cookie)).toHaveLength(0);
  });
});
