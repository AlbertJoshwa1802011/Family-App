/**
 * PINNED PRODUCT DECISION — expense privacy.
 *
 * `visibility: 'private'` on an expense means CREATOR-ONLY. The family owner
 * and admins do NOT see other members' private expenses. This intentionally
 * differs from documents, where owner/admin can see everything.
 *
 * If a future change makes expenses "consistent with documents", these tests
 * fail — that is their entire job. Read worker/lib/expenses/visibility.ts
 * before changing anything here.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { getDb, schema } from "../worker/db/client";
import type { Env } from "../worker/types";
import {
  createTestEnv,
  seedExpense,
  seedExpenseCategory,
  seedFamily,
  seedMember,
  seedUser,
} from "./helpers/testEnv";
import {
  expenseScopeWhere,
  isExpenseHiddenFrom,
} from "../worker/lib/expenses/visibility";

let env: Env;
let sqlite: DatabaseSync;
let familyId: string;
let categoryId: string;

/** owner, admin and two ordinary members of the same family */
let owner: { id: string };
let admin: { id: string };
let member: { id: string };
let other: { id: string };

/** ids of the seeded expenses */
let memberPrivateId: string;
let memberFamilyId: string;
let otherPrivateId: string;

async function visibleIdsFor(userId: string): Promise<string[]> {
  const db = getDb(env);
  const rows = await db
    .select({ id: schema.expenses.id })
    .from(schema.expenses)
    .where(expenseScopeWhere(familyId, userId));
  return rows.map((r) => r.id).sort();
}

beforeEach(() => {
  ({ env, sqlite } = createTestEnv());

  owner = seedUser(sqlite, { name: "Owner" });
  familyId = seedFamily(sqlite, owner.id).id;
  seedMember(sqlite, familyId, owner.id, "owner");

  admin = seedUser(sqlite, { name: "Admin" });
  seedMember(sqlite, familyId, admin.id, "admin");

  member = seedUser(sqlite, { name: "Member" });
  seedMember(sqlite, familyId, member.id, "member");

  other = seedUser(sqlite, { name: "Other" });
  seedMember(sqlite, familyId, other.id, "member");

  categoryId = seedExpenseCategory(sqlite, { familyId, slug: "food" }).id;

  memberPrivateId = seedExpense(sqlite, {
    familyId,
    createdByUserId: member.id,
    categoryId,
    visibility: "private",
    merchant: "Therapist",
  }).id;

  memberFamilyId = seedExpense(sqlite, {
    familyId,
    createdByUserId: member.id,
    categoryId,
    visibility: "family",
    merchant: "Groceries",
  }).id;

  otherPrivateId = seedExpense(sqlite, {
    familyId,
    createdByUserId: other.id,
    categoryId,
    visibility: "private",
    merchant: "Gift shop",
  }).id;
});

describe("isExpenseHiddenFrom", () => {
  it("hides a private expense from everyone but its creator", () => {
    const expense = { visibility: "private", createdByUserId: member.id };

    expect(isExpenseHiddenFrom(expense, member.id)).toBe(false);
    expect(isExpenseHiddenFrom(expense, owner.id)).toBe(true);
    expect(isExpenseHiddenFrom(expense, admin.id)).toBe(true);
    expect(isExpenseHiddenFrom(expense, other.id)).toBe(true);
  });

  it("never hides a family-visible expense from a family member", () => {
    const expense = { visibility: "family", createdByUserId: member.id };

    for (const viewer of [owner, admin, member, other]) {
      expect(isExpenseHiddenFrom(expense, viewer.id)).toBe(false);
    }
  });
});

describe("expenseScopeWhere", () => {
  it("shows a member their own private expense", async () => {
    const visible = await visibleIdsFor(member.id);
    expect(visible).toContain(memberPrivateId);
    expect(visible).toContain(memberFamilyId);
  });

  it("hides another member's private expense from the family OWNER", async () => {
    const visible = await visibleIdsFor(owner.id);
    expect(visible).not.toContain(memberPrivateId);
    expect(visible).not.toContain(otherPrivateId);
    expect(visible).toContain(memberFamilyId);
  });

  it("hides another member's private expense from an ADMIN", async () => {
    const visible = await visibleIdsFor(admin.id);
    expect(visible).not.toContain(memberPrivateId);
    expect(visible).not.toContain(otherPrivateId);
    expect(visible).toContain(memberFamilyId);
  });

  it("hides one member's private expense from another member", async () => {
    const visible = await visibleIdsFor(other.id);
    expect(visible).not.toContain(memberPrivateId);
    expect(visible).toContain(otherPrivateId); // their own
    expect(visible).toContain(memberFamilyId);
  });

  it("takes no role argument — privilege cannot widen expense visibility", () => {
    // Guards the API shape itself: (familyId, userId, opts?) and nothing else.
    // A `role` parameter is exactly how the documents rule would creep in.
    expect(expenseScopeWhere.length).toBeLessThanOrEqual(3);
  });

  it("never leaks another family's expenses", async () => {
    const outsider = seedUser(sqlite, { name: "Outsider" });
    const otherFamily = seedFamily(sqlite, outsider.id, "Other Family").id;
    seedMember(sqlite, otherFamily, outsider.id, "owner");
    const otherCategory = seedExpenseCategory(sqlite, {
      familyId: otherFamily,
      slug: "food",
    }).id;
    const foreignId = seedExpense(sqlite, {
      familyId: otherFamily,
      createdByUserId: outsider.id,
      categoryId: otherCategory,
      visibility: "family",
    }).id;

    const visible = await visibleIdsFor(owner.id);
    expect(visible).not.toContain(foreignId);
  });

  it("excludes trashed expenses by default", async () => {
    const trashedId = seedExpense(sqlite, {
      familyId,
      createdByUserId: owner.id,
      categoryId,
      status: "trashed",
    }).id;

    expect(await visibleIdsFor(owner.id)).not.toContain(trashedId);

    const db = getDb(env);
    const withTrashed = await db
      .select({ id: schema.expenses.id })
      .from(schema.expenses)
      .where(expenseScopeWhere(familyId, owner.id, { includeTrashed: true }));
    expect(withTrashed.map((r) => r.id)).toContain(trashedId);
  });

  it("still hides other members' private expenses when trashed rows are included", async () => {
    const db = getDb(env);
    const rows = await db
      .select({ id: schema.expenses.id })
      .from(schema.expenses)
      .where(expenseScopeWhere(familyId, admin.id, { includeTrashed: true }));

    expect(rows.map((r) => r.id)).not.toContain(memberPrivateId);
  });
});
