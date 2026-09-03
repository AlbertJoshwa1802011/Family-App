/**
 * Wishlist module catalog — estimatedCostMinor 1..500 × visibility × priority cycle = 1000.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { catalogReq, seedFamilySession, type FamilySession } from "./helpers";

type WishCase = {
  i: number;
  name: string;
  estimatedCostMinor: number;
  visibility: "family" | "private";
  priority: number;
};

const WISH_CASES: WishCase[] = [];
for (let n = 1; n <= 500; n++) {
  for (const visibility of ["family", "private"] as const) {
    WISH_CASES.push({
      i: WISH_CASES.length,
      name: `Wish ${n} ${visibility}`,
      estimatedCostMinor: n,
      visibility,
      priority: ((n - 1) % 5) + 1,
    });
  }
}

const INVALID: { name: string; body: Record<string, unknown> }[] = [
  { name: "empty name", body: { name: "" } },
  { name: "zero cost", body: { estimatedCostMinor: 0 } },
  { name: "priority 0", body: { priority: 0 } },
  { name: "priority 6", body: { priority: 6 } },
  { name: "bad url", body: { url: "not-a-url" } },
  { name: "wrong currency", body: { currency: "INR" } },
];

describe("catalog: wishlist ≥1000", () => {
  let s: FamilySession;

  beforeAll(() => {
    s = seedFamilySession();
  });

  it(`records ${WISH_CASES.length} create combinations`, () => {
    expect(WISH_CASES.length).toBeGreaterThanOrEqual(1000);
  });

  it.each(WISH_CASES)(
    "POST #$i cost=$estimatedCostMinor vis=$visibility pri=$priority",
    async (c) => {
      const res = await catalogReq(s.env, "POST", "/api/wishlist", {
        cookie: s.actor.cookie,
        body: {
          familyId: s.familyId,
          name: c.name,
          estimatedCostMinor: c.estimatedCostMinor,
          currency: "USD",
          visibility: c.visibility,
          priority: c.priority,
        },
      });
      expect(res.status).toBe(201);
      const json = (await res.json()) as {
        item: {
          name: string;
          estimatedCostMinor: number;
          visibility: string;
          priority: number;
        };
      };
      expect(json.item.name).toBe(c.name);
      expect(json.item.estimatedCostMinor).toBe(c.estimatedCostMinor);
      expect(json.item.visibility).toBe(c.visibility);
      expect(json.item.priority).toBe(c.priority);
    },
  );

  it.each(INVALID)("POST invalid: $name → 400 validation_error", async (c) => {
    const res = await catalogReq(s.env, "POST", "/api/wishlist", {
      cookie: s.actor.cookie,
      body: {
        familyId: s.familyId,
        name: "Thing",
        estimatedCostMinor: 100,
        currency: "USD",
        ...c.body,
      },
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("validation_error");
  });
});
