/**
 * DELETE /expenses/:id and POST /expenses/:id/restore.
 *
 * Soft delete only (status='trashed' + trashedAt), matching documents.ts.
 * A deleted expense disappears from lists but stays visibility-protected and
 * restorable — never a second deletion mechanism, never a hard delete.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { app } from "../worker/index";
import type { Env } from "../worker/types";
import {
  createTestEnv,
  seedActor,
  seedExpense,
  seedExpenseCategory,
  seedFamily,
  seedSession,
  seedUser,
} from "./helpers/testEnv";

let env: Env;
let sqlite: DatabaseSync;
let familyId: string;
let owner: { userId: string; memberId: string; cookie: string };
let admin: { userId: string; memberId: string; cookie: string };
let member: { userId: string; memberId: string; cookie: string };
let other: { userId: string; memberId: string; cookie: string };
let categoryId: string;

function req(path: string, init: RequestInit = {}, cookie?: string) {
  return app.request(
    `http://localhost/api${path}`,
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(init.headers ?? {}),
      },
    },
    env,
  );
}

function del(id: string, cookie: string) {
  return req(`/expenses/${id}`, { method: "DELETE" }, cookie);
}

function restore(id: string, cookie: string) {
  return req(`/expenses/${id}/restore`, { method: "POST" }, cookie);
}

function seedOwnExpense(actor: { userId: string }, extra: Record<string, unknown> = {}) {
  return seedExpense(sqlite, {
    familyId,
    createdByUserId: actor.userId,
    categoryId,
    ...extra,
  }).id;
}

function rowStatus(id: string): string {
  return (sqlite.prepare("SELECT status FROM expenses WHERE id = ?").get(id) as { status: string })
    .status;
}

beforeEach(() => {
  ({ env, sqlite } = createTestEnv());
  const ownerUser = seedUser(sqlite);
  familyId = seedFamily(sqlite, ownerUser.id).id;
  owner = seedActor(sqlite, familyId, "owner");
  admin = seedActor(sqlite, familyId, "admin");
  member = seedActor(sqlite, familyId, "member");
  other = seedActor(sqlite, familyId, "member");
  categoryId = seedExpenseCategory(sqlite, { familyId, slug: "food" }).id;
});

describe("DELETE /expenses/:id", () => {
  it("soft-deletes: status becomes trashed, row still exists", async () => {
    const id = seedOwnExpense(member);
    const res = await del(id, member.cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(rowStatus(id)).toBe("trashed");

    const row = sqlite
      .prepare("SELECT trashed_at FROM expenses WHERE id = ?")
      .get(id) as { trashed_at: number | null };
    expect(row.trashed_at).not.toBeNull();
  });

  it("disappears from the list after delete", async () => {
    const id = seedOwnExpense(member);
    await del(id, member.cookie);

    const res = await req(`/expenses?familyId=${familyId}`, {}, member.cookie);
    const body = (await res.json()) as { expenses: { id: string }[] };
    expect(body.expenses.map((e) => e.id)).not.toContain(id);
  });

  it("lets the creator delete their own expense", async () => {
    const id = seedOwnExpense(member);
    expect((await del(id, member.cookie)).status).toBe(200);
  });

  it("lets an admin delete a family-visible expense created by someone else", async () => {
    const id = seedOwnExpense(member);
    expect((await del(id, admin.cookie)).status).toBe(200);
  });

  it("lets the owner delete a family-visible expense created by someone else", async () => {
    const id = seedOwnExpense(member);
    expect((await del(id, owner.cookie)).status).toBe(200);
  });

  it("forbids an ordinary member from deleting someone else's expense", async () => {
    const id = seedOwnExpense(member);
    const res = await del(id, other.cookie);
    expect(res.status).toBe(403);
    expect(rowStatus(id)).toBe("active"); // untouched
  });

  it("requires a session", async () => {
    const id = seedOwnExpense(member);
    const res = await req(`/expenses/${id}`, { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("404s for a non-member", async () => {
    const id = seedOwnExpense(member);
    const stranger = seedUser(sqlite);
    const res = await del(id, seedSession(sqlite, stranger.id));
    expect(res.status).toBe(404);
  });

  it("404s for an unknown id", async () => {
    expect((await del("does-not-exist", member.cookie)).status).toBe(404);
  });

  it("404s (not 403) deleting another member's private expense — even for the owner", async () => {
    const id = seedOwnExpense(member, { visibility: "private" });
    expect((await del(id, other.cookie)).status).toBe(404);
    expect((await del(id, owner.cookie)).status).toBe(404);
    expect((await del(id, admin.cookie)).status).toBe(404);
    expect(rowStatus(id)).toBe("active");
  });

  it("lets the creator delete their own private expense", async () => {
    const id = seedOwnExpense(member, { visibility: "private" });
    expect((await del(id, member.cookie)).status).toBe(200);
  });

  it("already-deleted behaviour: a second DELETE 404s cleanly", async () => {
    const id = seedOwnExpense(member);
    expect((await del(id, member.cookie)).status).toBe(200);

    const second = await del(id, member.cookie);
    expect(second.status).toBe(404);
    expect(await second.json()).toEqual({ error: "not_found" });
  });

  it("a trashed expense cannot be edited via PATCH", async () => {
    const id = seedOwnExpense(member);
    await del(id, member.cookie);

    const res = await req(
      `/expenses/${id}`,
      { method: "PATCH", body: JSON.stringify({ notes: "x" }) },
      member.cookie,
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /expenses/:id/restore", () => {
  it("restores a trashed expense back to active", async () => {
    const id = seedOwnExpense(member);
    await del(id, member.cookie);

    const res = await restore(id, member.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { expense: { status: string } };
    expect(body.expense.status).toBe("active");
    expect(rowStatus(id)).toBe("active");
  });

  it("clears trashedAt on restore", async () => {
    const id = seedOwnExpense(member);
    await del(id, member.cookie);
    await restore(id, member.cookie);

    const row = sqlite
      .prepare("SELECT trashed_at FROM expenses WHERE id = ?")
      .get(id) as { trashed_at: number | null };
    expect(row.trashed_at).toBeNull();
  });

  it("reappears in the list after restore", async () => {
    const id = seedOwnExpense(member);
    await del(id, member.cookie);
    await restore(id, member.cookie);

    const res = await req(`/expenses?familyId=${familyId}`, {}, member.cookie);
    const body = (await res.json()) as { expenses: { id: string }[] };
    expect(body.expenses.map((e) => e.id)).toContain(id);
  });

  it("rejects restoring an expense that isn't trashed", async () => {
    const id = seedOwnExpense(member);
    const res = await restore(id, member.cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not_trashed" });
  });

  it("lets an admin restore a family-visible expense someone else deleted", async () => {
    const id = seedOwnExpense(member);
    await del(id, member.cookie);
    expect((await restore(id, admin.cookie)).status).toBe(200);
  });

  it("forbids an ordinary member from restoring someone else's expense", async () => {
    const id = seedOwnExpense(member);
    await del(id, member.cookie);
    const res = await restore(id, other.cookie);
    expect(res.status).toBe(403);
  });

  it("404s (not 403) restoring another member's private expense — even for the owner", async () => {
    const id = seedOwnExpense(member, { visibility: "private" });
    await del(id, member.cookie);

    expect((await restore(id, other.cookie)).status).toBe(404);
    expect((await restore(id, owner.cookie)).status).toBe(404);
  });

  it("lets the creator restore their own private expense", async () => {
    const id = seedOwnExpense(member, { visibility: "private" });
    await del(id, member.cookie);
    expect((await restore(id, member.cookie)).status).toBe(200);
  });

  it("requires a session", async () => {
    const id = seedOwnExpense(member);
    await del(id, member.cookie);
    const res = await req(`/expenses/${id}/restore`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("404s for a non-member", async () => {
    const id = seedOwnExpense(member);
    await del(id, member.cookie);
    const stranger = seedUser(sqlite);
    const res = await restore(id, seedSession(sqlite, stranger.id));
    expect(res.status).toBe(404);
  });

  it("404s for an unknown id", async () => {
    expect((await restore("does-not-exist", member.cookie)).status).toBe(404);
  });
});
