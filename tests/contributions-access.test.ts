/**
 * Tech / Contribution church funds are platform super-admin only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../worker/index";
import { isSuperAdminOnlyChurchFund } from "../worker/lib/contributions";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedMember,
  seedSession,
  seedUser,
} from "./helpers/testEnv";

const ORIGIN = "http://localhost:5173";

function authed(
  env: ReturnType<typeof createTestEnv>["env"],
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
) {
  return app.request(
    path,
    {
      method,
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: ORIGIN,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

function mockFundsAndPurchases() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/funds")) {
      return new Response(
        JSON.stringify({
          success: true,
          funds: [
            {
              slug: "tech-contributions",
              name: "Tech Fund",
              totalCollected: 38819,
              spentOnProducts: 28999,
              availableBalance: 9820,
              status: "active",
            },
            {
              slug: "contribution-fund",
              name: "Contribution Fund",
              totalCollected: 5000,
              spentOnProducts: 0,
              availableBalance: 5000,
              status: "active",
            },
            {
              slug: "christmas-fund",
              name: "Christmas Fund",
              totalCollected: 23400,
              spentOnProducts: 23400,
              availableBalance: 0,
              status: "active",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/api/purchases")) {
      return new Response(
        JSON.stringify({
          purchases: [
            {
              id: "P1",
              name: "Mic",
              amount: 250,
              date: "2026-08-01",
              fund: "tech-contributions",
              status: "Active",
            },
            {
              id: "P2",
              name: "Tree",
              amount: 100,
              date: "2026-08-02",
              fund: "christmas-fund",
              status: "Active",
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response("nope", { status: 404 });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isSuperAdminOnlyChurchFund", () => {
  it("gates tech and contribution pots, not christmas", () => {
    expect(
      isSuperAdminOnlyChurchFund({
        slug: "tech-contributions",
        name: "Tech Fund",
      }),
    ).toBe(true);
    expect(
      isSuperAdminOnlyChurchFund({
        slug: "contribution-fund",
        name: "Contribution Fund",
      }),
    ).toBe(true);
    expect(
      isSuperAdminOnlyChurchFund({ slug: "tech-fund", name: "Tech fund" }),
    ).toBe(true);
    expect(
      isSuperAdminOnlyChurchFund({
        slug: "christmas-fund",
        name: "Christmas Fund",
      }),
    ).toBe(false);
  });
});

describe("church fund super-admin access", () => {
  it("hides tech/contribution funds from ordinary members", async () => {
    mockFundsAndPurchases();
    const { env, sqlite } = createTestEnv({
      CONTRIBUTIONS_API_URL: "https://church.example",
    });
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");

    const res = await authed(
      env,
      "GET",
      `/api/church/snapshot?familyId=${family.id}`,
      alice.cookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      funds: { slug: string }[];
      purchases: { fund: string }[];
    };
    expect(body.funds.map((f) => f.slug)).toEqual(["christmas-fund"]);
    expect(body.purchases.map((p) => p.fund)).toEqual(["christmas-fund"]);
  });

  it("lets platform super-admin see and settle tech/contribution funds", async () => {
    mockFundsAndPurchases();
    const { env, sqlite } = createTestEnv({
      CONTRIBUTIONS_API_URL: "https://church.example",
    });
    const adminUser = seedUser(sqlite, {
      email: "admin@familyvault.app",
      name: "Super Admin",
    });
    const family = seedFamily(sqlite, adminUser.id);
    seedMember(sqlite, family.id, adminUser.id, "owner");
    sqlite
      .prepare(
        "INSERT INTO platform_admins (user_id, level, granted_by) VALUES (?, 'superadmin', ?)",
      )
      .run(adminUser.id, adminUser.id);
    const cookie = seedSession(sqlite, adminUser.id);

    const snap = await authed(
      env,
      "GET",
      `/api/church/snapshot?familyId=${family.id}`,
      cookie,
    );
    expect(snap.status).toBe(200);
    const body = (await snap.json()) as { funds: { slug: string }[] };
    expect(body.funds.map((f) => f.slug).sort()).toEqual([
      "christmas-fund",
      "contribution-fund",
      "tech-contributions",
    ]);

    const settle = await authed(env, "POST", "/api/church/settle", cookie, {
      familyId: family.id,
      fundSlug: "tech-contributions",
      periodKey: "2026-09",
      dueMinor: 982_000,
      paidMinor: 500_000,
    });
    expect(settle.status).toBe(201);
  });

  it("blocks ordinary members from settling a restricted fund", async () => {
    mockFundsAndPurchases();
    const { env, sqlite } = createTestEnv({
      CONTRIBUTIONS_API_URL: "https://church.example",
    });
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");

    const settle = await authed(env, "POST", "/api/church/settle", alice.cookie, {
      familyId: family.id,
      fundSlug: "tech-contributions",
      periodKey: "2026-09",
      dueMinor: 982_000,
      paidMinor: 500_000,
    });
    expect(settle.status).toBe(404);
    expect(((await settle.json()) as { error: string }).error).toBe("not_found");
  });
});
