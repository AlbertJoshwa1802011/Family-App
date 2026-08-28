/**
 * E0 — financial-actor eligibility seam (no expense routes yet).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../worker/db/client";
import {
  isEligibleFinancialMember,
  toFinancialActorRef,
  resolveFinancialActors,
  memberInFamily,
} from "../worker/lib/expenses/financialActors";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedMember,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

let t: TestEnv;
let familyId: string;

beforeEach(() => {
  t = createTestEnv();
  const ownerUser = seedUser(t.sqlite);
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
});

describe("isEligibleFinancialMember / toFinancialActorRef (pure)", () => {
  it("accepts active user members in the family", () => {
    const row = {
      id: "m1",
      familyId,
      memberType: "user",
      status: "active",
    };
    expect(isEligibleFinancialMember(row, familyId)).toBe(true);
    expect(toFinancialActorRef(row, familyId)).toEqual({
      kind: "member",
      memberId: "m1",
    });
  });

  it("rejects dependents, removed members, and cross-family rows", () => {
    expect(
      isEligibleFinancialMember(
        { id: "d", familyId, memberType: "dependent", status: "active" },
        familyId,
      ),
    ).toBe(false);
    expect(
      isEligibleFinancialMember(
        { id: "u", familyId, memberType: "user", status: "removed" },
        familyId,
      ),
    ).toBe(false);
    expect(
      isEligibleFinancialMember(
        { id: "u", familyId: "other", memberType: "user", status: "active" },
        familyId,
      ),
    ).toBe(false);
  });
});

describe("resolveFinancialActors (D1 harness)", () => {
  it("resolves active user members", async () => {
    const db = getDb(t.env);
    const a = seedActor(t.sqlite, familyId, "member");
    const b = seedActor(t.sqlite, familyId, "admin");

    const res = await resolveFinancialActors(db, familyId, [
      a.memberId,
      b.memberId,
    ]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.actors).toEqual([
        { kind: "member", memberId: a.memberId },
        { kind: "member", memberId: b.memberId },
      ]);
    }
  });

  it("rejects dependents as financial actors", async () => {
    const db = getDb(t.env);
    const depId = crypto.randomUUID();
    t.sqlite
      .prepare(
        `INSERT INTO family_members (id, family_id, user_id, member_type, display_name, role, status)
         VALUES (?, ?, NULL, 'dependent', 'Emma', 'member', 'active')`,
      )
      .run(depId, familyId);

    const res = await resolveFinancialActors(db, familyId, [depId]);
    expect(res).toEqual({
      ok: false,
      error: "not_financial_actor",
      memberId: depId,
    });
  });

  it("rejects removed user members", async () => {
    const db = getDb(t.env);
    const user = seedUser(t.sqlite);
    const member = seedMember(t.sqlite, familyId, user.id, "member");
    t.sqlite
      .prepare(`UPDATE family_members SET status = 'removed' WHERE id = ?`)
      .run(member.id);

    const res = await resolveFinancialActors(db, familyId, [member.id]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("not_financial_actor");
  });

  it("rejects unknown / cross-family ids", async () => {
    const db = getDb(t.env);
    const otherOwner = seedUser(t.sqlite);
    const otherFam = seedFamily(t.sqlite, otherOwner.id).id;
    const stranger = seedActor(t.sqlite, otherFam, "member");

    const res = await resolveFinancialActors(db, familyId, [stranger.memberId]);
    // Row exists but wrong family → not_financial_actor (familyId mismatch)
    expect(res.ok).toBe(false);
  });

  it("rejects duplicates", async () => {
    const db = getDb(t.env);
    const a = seedActor(t.sqlite, familyId, "member");
    const res = await resolveFinancialActors(db, familyId, [
      a.memberId,
      a.memberId,
    ]);
    expect(res).toEqual({ ok: false, error: "duplicate_member_ids" });
  });
});

describe("memberInFamily (subject attribution)", () => {
  it("allows dependents as non-financial subjects", async () => {
    const db = getDb(t.env);
    const depId = crypto.randomUUID();
    t.sqlite
      .prepare(
        `INSERT INTO family_members (id, family_id, user_id, member_type, display_name, role, status)
         VALUES (?, ?, NULL, 'dependent', 'Emma', 'member', 'active')`,
      )
      .run(depId, familyId);

    expect(await memberInFamily(db, familyId, depId)).toBe(true);
    // Still not a financial actor
    const fin = await resolveFinancialActors(db, familyId, [depId]);
    expect(fin.ok).toBe(false);
  });
});
