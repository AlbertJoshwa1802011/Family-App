/**
 * Per-member module access: invite presets, PATCH, API enforcement, catalog.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../worker/index";
import {
  FAMILY_MODULES,
  hasModule,
  parseModulesJson,
  serializeModules,
} from "../worker/lib/modules";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedSession,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

async function api(
  env: TestEnv,
  method: string,
  path: string,
  cookie?: string,
  body?: unknown,
) {
  return app.request(
    path,
    {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined
          ? {
              "Content-Type": "application/json",
              Origin: "http://localhost:5173",
            }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env.env,
  );
}

describe("modules helpers", () => {
  it("null JSON means all modules; owners always pass", () => {
    expect(parseModulesJson(null)).toEqual([...FAMILY_MODULES]);
    expect(serializeModules([...FAMILY_MODULES])).toBeNull();
    expect(serializeModules(["documents", "chat"])).toBe(
      JSON.stringify(["documents", "chat"]),
    );
    expect(hasModule('["chat"]', "expenses")).toBe(false);
    expect(hasModule('["chat"]', "expenses", "owner")).toBe(true);
  });
});

describe("member module access", () => {
  let t: TestEnv;
  let familyId: string;
  let owner: ReturnType<typeof seedActor>;
  let member: ReturnType<typeof seedActor>;

  beforeEach(() => {
    t = createTestEnv();
    const ownerUser = seedUser(t.sqlite);
    familyId = seedFamily(t.sqlite, ownerUser.id).id;
    owner = seedActor(t.sqlite, familyId, "owner");
    member = seedActor(t.sqlite, familyId, "member", {
      email: "limited@example.com",
    });
  });

  it("GET /families/modules returns the catalog", async () => {
    const res = await api(t, "GET", "/api/families/modules", owner.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      modules: Array<{ id: string; label: string }>;
    };
    expect(body.modules.map((m) => m.id)).toEqual([...FAMILY_MODULES]);
    expect(body.modules[0].label).toBeTruthy();
  });

  it("invite with modules → accept applies them → /auth/me + API enforce", async () => {
    const invite = await api(t, "POST", `/api/families/${familyId}/invites`, owner.cookie, {
      email: "cousin@example.com",
      role: "member",
      modules: ["calendar", "tasks"],
    });
    expect(invite.status).toBe(201);
    const { invite: inv } = (await invite.json()) as {
      invite: { token: string; modules: string[] };
    };
    expect(inv.modules).toEqual(["calendar", "tasks"]);

    const cousin = seedUser(t.sqlite, { email: "cousin@example.com" });
    const cookie = seedSession(t.sqlite, cousin.id);
    const accept = await api(
      t,
      "POST",
      `/api/families/invites/${inv.token}/accept`,
      cookie,
    );
    expect(accept.status).toBe(200);

    const me = await api(t, "GET", "/api/auth/me", cookie);
    const meBody = (await me.json()) as {
      families: Array<{ id: string; modules: string[] }>;
    };
    const fam = meBody.families.find((f) => f.id === familyId)!;
    expect(fam.modules).toEqual(["calendar", "tasks"]);

    // Documents (vault) disabled
    const docs = await api(
      t,
      "GET",
      `/api/documents?familyId=${familyId}`,
      cookie,
    );
    expect(docs.status).toBe(403);
    expect(((await docs.json()) as { error: string }).error).toBe("module_disabled");

    // Calendar allowed
    const events = await api(
      t,
      "GET",
      `/api/events?familyId=${familyId}&from=1700000000&to=1900000000`,
      cookie,
    );
    expect(events.status).toBe(200);

    // Money disabled
    const money = await api(
      t,
      "GET",
      `/api/expenses?familyId=${familyId}`,
      cookie,
    );
    expect(money.status).toBe(403);
  });

  it("admin can PATCH modules for a member; owner modules stay full", async () => {
    const patch = await api(
      t,
      "PATCH",
      `/api/families/${familyId}/members/${member.memberId}`,
      owner.cookie,
      { modules: ["documents", "chat"] },
    );
    expect(patch.status).toBe(200);
    const body = (await patch.json()) as {
      member: { modules: string[] };
    };
    expect(body.member.modules).toEqual(["documents", "chat"]);

    const expenses = await api(
      t,
      "GET",
      `/api/expenses?familyId=${familyId}`,
      member.cookie,
    );
    expect(expenses.status).toBe(403);

    const docs = await api(
      t,
      "GET",
      `/api/documents?familyId=${familyId}`,
      member.cookie,
    );
    expect(docs.status).toBe(200);

    // Restricting the owner is forbidden
    const ownerRow = t.sqlite
      .prepare(
        "SELECT id FROM family_members WHERE family_id = ? AND role = 'owner' LIMIT 1",
      )
      .get(familyId) as { id: string };
    // seedActor created a separate owner membership — find the actor's row
    const ownerMemberId = t.sqlite
      .prepare(
        "SELECT id FROM family_members WHERE family_id = ? AND user_id = ?",
      )
      .get(familyId, owner.userId) as { id: string };
    const deny = await api(
      t,
      "PATCH",
      `/api/families/${familyId}/members/${ownerMemberId.id}`,
      owner.cookie,
      { modules: ["chat"] },
    );
    expect(deny.status).toBe(403);
    void ownerRow;
  });

  it("members list exposes modules; plain member cannot PATCH", async () => {
    const list = await api(t, "GET", `/api/families/${familyId}/members`, owner.cookie);
    expect(list.status).toBe(200);
    const { members } = (await list.json()) as {
      members: Array<{ id: string; modules: string[] }>;
    };
    expect(members[0].modules.length).toBeGreaterThan(0);

    const forbidden = await api(
      t,
      "PATCH",
      `/api/families/${familyId}/members/${owner.memberId}`,
      member.cookie,
      { modules: ["chat"] },
    );
    expect(forbidden.status).toBe(403);
  });

  it("null modules on PATCH restores full access", async () => {
    await api(
      t,
      "PATCH",
      `/api/families/${familyId}/members/${member.memberId}`,
      owner.cookie,
      { modules: ["chat"] },
    );
    const restore = await api(
      t,
      "PATCH",
      `/api/families/${familyId}/members/${member.memberId}`,
      owner.cookie,
      { modules: null },
    );
    expect(restore.status).toBe(200);
    const body = (await restore.json()) as { member: { modules: string[] } };
    expect(body.member.modules).toEqual([...FAMILY_MODULES]);
  });
});
