/**
 * Church / collection funds — contribution, spend, settle, activity.
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { createTestEnv, seedActor, seedFamily, seedUser } from "./helpers/testEnv";
import type { Env } from "../worker/types";

const ORIGIN = "http://localhost:5173";

function post(env: Env, path: string, cookie: string, body: unknown) {
  return app.request(
    path,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: ORIGIN,
      },
      body: JSON.stringify(body),
    },
    env,
  );
}

function get(env: Env, path: string, cookie: string) {
  return app.request(path, { headers: { Cookie: cookie } }, env);
}

function setup() {
  const { env, sqlite } = createTestEnv();
  const ownerUser = seedUser(sqlite);
  const family = seedFamily(sqlite, ownerUser.id);
  const alice = seedActor(sqlite, family.id, "member", { name: "Alice" });
  return { env, familyId: family.id, alice };
}

describe("funds", () => {
  it("creates a fund, records contribution + spend, settles, and logs activity", async () => {
    const { env, familyId, alice } = setup();

    const created = await post(env, "/api/funds", alice.cookie, {
      familyId,
      name: "Church offering",
    });
    expect(created.status).toBe(201);
    const fundBody = (await created.json()) as {
      fund: {
        id: string;
        name: string;
        currency: string;
        balances: { remainingMinor: number };
      };
    };
    expect(fundBody.fund.name).toBe("Church offering");
    expect(fundBody.fund.currency).toBe("USD");
    const fundId = fundBody.fund.id;

    const contrib = await post(env, `/api/funds/${fundId}/contributions`, alice.cookie, {
      payerName: "Ravi",
      amountMinor: 5000,
      externalRef: "rzp_test_1",
      // Mid-September 2026 so the periodKey settle snapshot includes it.
      paidAt: Math.floor(Date.UTC(2026, 8, 15) / 1000),
    });
    expect(contrib.status).toBe(201);

    const spend = await post(env, `/api/funds/${fundId}/spends`, alice.cookie, {
      amountMinor: 1200,
      spendDate: "2026-09-10",
      merchant: "Supplies",
    });
    expect(spend.status).toBe(201);

    const detail = (await (await get(env, `/api/funds/${fundId}`, alice.cookie)).json()) as {
      fund: {
        balances: {
          contributionsMinor: number;
          spendsMinor: number;
          remainingMinor: number;
        };
      };
    };
    expect(detail.fund.balances.contributionsMinor).toBe(5000);
    expect(detail.fund.balances.spendsMinor).toBe(1200);
    expect(detail.fund.balances.remainingMinor).toBe(3800);

    const settle = await post(env, `/api/funds/${fundId}/settle`, alice.cookie, {
      periodKey: "2026-09",
      note: "Bank reconciled",
    });
    expect(settle.status).toBe(201);
    const settleBody = (await settle.json()) as {
      settlement: {
        periodKey: string;
        contributionsMinor: number;
        spendsMinor: number;
        remainingMinor: number;
      };
    };
    expect(settleBody.settlement.periodKey).toBe("2026-09");
    expect(settleBody.settlement.contributionsMinor).toBe(5000);
    expect(settleBody.settlement.spendsMinor).toBe(1200);
    expect(settleBody.settlement.remainingMinor).toBe(3800);

    const dup = await post(env, `/api/funds/${fundId}/settle`, alice.cookie, {
      periodKey: "2026-09",
    });
    expect(dup.status).toBe(409);

    const activity = (await (
      await get(env, `/api/funds/${fundId}/activity`, alice.cookie)
    ).json()) as { activity: { action: string }[] };
    const actions = activity.activity.map((a) => a.action);
    expect(actions).toContain("fund_created");
    expect(actions).toContain("contribution_added");
    expect(actions).toContain("spend_added");
    expect(actions).toContain("settled");
  });

  it("requires a session", async () => {
    const res = await app.request("/api/funds?familyId=f-1");
    expect(res.status).toBe(401);
  });
});
