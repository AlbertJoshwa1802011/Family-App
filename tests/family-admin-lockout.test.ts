/**
 * Regression: a family must never lose its last active owner/admin through
 * self-demotion or self-removal (PATCH /families/:id/members/:mid).
 *
 * Preserves existing role semantics: owners still cannot be modified by
 * others; admins can still manage non-owners; multi-admin families can
 * demote/remove peers when another privileged member remains.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../worker/index";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedMember,
  seedSession,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

let t: TestEnv;

beforeEach(() => {
  t = createTestEnv();
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

function patchMember(
  familyId: string,
  memberId: string,
  cookie: string,
  body: object,
) {
  return req(
    "PATCH",
    `/api/families/${familyId}/members/${memberId}`,
    cookie,
    body,
  );
}

describe("sole owner cannot lock the family out", () => {
  it("rejects sole owner self-demotion to member (409 last_owner_or_admin)", async () => {
    const ownerUser = seedUser(t.sqlite);
    const { id: familyId } = seedFamily(t.sqlite, ownerUser.id);
    const ownerMember = seedMember(t.sqlite, familyId, ownerUser.id, "owner");
    const cookie = seedSession(t.sqlite, ownerUser.id);

    const res = await patchMember(familyId, ownerMember.id, cookie, {
      role: "member",
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(
      "last_owner_or_admin",
    );

    const members = await req(
      "GET",
      `/api/families/${familyId}/members`,
      cookie,
    );
    const body = (await members.json()) as {
      members: { id: string; role: string; status: string }[];
    };
    const still = body.members.find((m) => m.id === ownerMember.id);
    expect(still?.role).toBe("owner");
    expect(still?.status).toBe("active");
  });

  it("rejects sole owner self-removal (409 last_owner_or_admin)", async () => {
    const ownerUser = seedUser(t.sqlite);
    const { id: familyId } = seedFamily(t.sqlite, ownerUser.id);
    const ownerMember = seedMember(t.sqlite, familyId, ownerUser.id, "owner");
    const cookie = seedSession(t.sqlite, ownerUser.id);

    const res = await patchMember(familyId, ownerMember.id, cookie, {
      status: "removed",
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(
      "last_owner_or_admin",
    );
  });

  it("allows sole owner to demote themselves to admin (still a viable admin)", async () => {
    const ownerUser = seedUser(t.sqlite);
    const { id: familyId } = seedFamily(t.sqlite, ownerUser.id);
    const ownerMember = seedMember(t.sqlite, familyId, ownerUser.id, "owner");
    const cookie = seedSession(t.sqlite, ownerUser.id);

    const res = await patchMember(familyId, ownerMember.id, cookie, {
      role: "admin",
    });
    expect(res.status).toBe(200);
    const { member } = (await res.json()) as { member: { role: string } };
    expect(member.role).toBe("admin");
  });
});

describe("valid role/member transitions continue working", () => {
  it("owner can demote an admin to member", async () => {
    const ownerUser = seedUser(t.sqlite);
    const { id: familyId } = seedFamily(t.sqlite, ownerUser.id);
    const owner = seedActor(t.sqlite, familyId, "owner");
    const admin = seedActor(t.sqlite, familyId, "admin");

    const res = await patchMember(familyId, admin.memberId, owner.cookie, {
      role: "member",
    });
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { member: { role: string } }).member.role,
    ).toBe("member");
  });

  it("owner can remove a member", async () => {
    const ownerUser = seedUser(t.sqlite);
    const { id: familyId } = seedFamily(t.sqlite, ownerUser.id);
    const owner = seedActor(t.sqlite, familyId, "owner");
    const member = seedActor(t.sqlite, familyId, "member");

    const res = await patchMember(familyId, member.memberId, owner.cookie, {
      status: "removed",
    });
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { member: { status: string } }).member.status,
    ).toBe("removed");
  });

  it("admin can promote a member to admin", async () => {
    const ownerUser = seedUser(t.sqlite);
    const { id: familyId } = seedFamily(t.sqlite, ownerUser.id);
    seedActor(t.sqlite, familyId, "owner");
    const admin = seedActor(t.sqlite, familyId, "admin");
    const member = seedActor(t.sqlite, familyId, "member");

    const res = await patchMember(familyId, member.memberId, admin.cookie, {
      role: "admin",
    });
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { member: { role: string } }).member.role,
    ).toBe("admin");
  });

  it("non-owner still cannot modify an owner (cannot_modify_owner)", async () => {
    const ownerUser = seedUser(t.sqlite);
    const { id: familyId } = seedFamily(t.sqlite, ownerUser.id);
    const owner = seedActor(t.sqlite, familyId, "owner");
    const admin = seedActor(t.sqlite, familyId, "admin");

    const res = await patchMember(familyId, owner.memberId, admin.cookie, {
      role: "member",
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe(
      "cannot_modify_owner",
    );
  });
});

describe("multiple owner/admin scenarios", () => {
  it("owner can leave when another admin remains", async () => {
    const ownerUser = seedUser(t.sqlite);
    const { id: familyId } = seedFamily(t.sqlite, ownerUser.id);
    const owner = seedActor(t.sqlite, familyId, "owner");
    seedActor(t.sqlite, familyId, "admin");

    const res = await patchMember(familyId, owner.memberId, owner.cookie, {
      status: "removed",
    });
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { member: { status: string } }).member.status,
    ).toBe("removed");
  });

  it("admin can demote themselves when an owner remains", async () => {
    const ownerUser = seedUser(t.sqlite);
    const { id: familyId } = seedFamily(t.sqlite, ownerUser.id);
    seedActor(t.sqlite, familyId, "owner");
    const admin = seedActor(t.sqlite, familyId, "admin");

    const res = await patchMember(familyId, admin.memberId, admin.cookie, {
      role: "member",
    });
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { member: { role: string } }).member.role,
    ).toBe("member");
  });

  it("rejects sole-admin self-removal when no other owner/admin remains", async () => {
    // Membership role is admin only (e.g. after a prior owner→admin demotion).
    const adminUser = seedUser(t.sqlite);
    const { id: familyId } = seedFamily(t.sqlite, adminUser.id);
    const adminMember = seedMember(t.sqlite, familyId, adminUser.id, "admin");
    const cookie = seedSession(t.sqlite, adminUser.id);
    seedActor(t.sqlite, familyId, "member");

    const res = await patchMember(familyId, adminMember.id, cookie, {
      status: "removed",
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(
      "last_owner_or_admin",
    );
  });

  it("one of two admins can remove the other when an owner remains", async () => {
    const ownerUser = seedUser(t.sqlite);
    const { id: familyId } = seedFamily(t.sqlite, ownerUser.id);
    seedActor(t.sqlite, familyId, "owner");
    const adminA = seedActor(t.sqlite, familyId, "admin");
    const adminB = seedActor(t.sqlite, familyId, "admin");

    const res = await patchMember(familyId, adminB.memberId, adminA.cookie, {
      status: "removed",
    });
    expect(res.status).toBe(200);
  });
});
