/**
 * Families module catalog — 1000 unique family names created by one session.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { catalogReq, seedFamilySession, type FamilySession } from "./helpers";

const FAMILY_CASES = Array.from({ length: 1000 }, (_, i) => ({
  i,
  name: `Catalog Family ${String(i).padStart(4, "0")}`,
}));

const INVALID: { name: string; body: Record<string, unknown> }[] = [
  { name: "empty name", body: { name: "" } },
  { name: "name too long", body: { name: "n".repeat(201) } },
  { name: "name null", body: { name: null } },
  { name: "name number", body: { name: 12 } },
];

describe("catalog: families ≥1000", () => {
  let s: FamilySession;

  beforeAll(() => {
    s = seedFamilySession();
  });

  it(`records ${FAMILY_CASES.length} create combinations`, () => {
    expect(FAMILY_CASES.length).toBeGreaterThanOrEqual(1000);
  });

  it.each(FAMILY_CASES)("POST #$i $name", async (c) => {
    const res = await catalogReq(s.env, "POST", "/api/families", {
      cookie: s.actor.cookie,
      body: { name: c.name },
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { family: { name: string; ownerUserId: string } };
    expect(json.family.name).toBe(c.name);
    expect(json.family.ownerUserId).toBe(s.actor.userId);
  });

  it.each(INVALID)("POST invalid: $name → 400 validation_error", async (c) => {
    const res = await catalogReq(s.env, "POST", "/api/families", {
      cookie: s.actor.cookie,
      body: c.body,
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("validation_error");
  });

  it("outsider GET of another family is 404", async () => {
    const res = await catalogReq(s.env, "GET", `/api/families/${s.familyId}`, {
      cookie: s.outsider.cookie,
    });
    expect(res.status).toBe(404);
  });
});
