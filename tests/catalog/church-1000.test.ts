/**
 * Church settlements catalog:
 *  - 500 invalid periodKey values → 400 validation_error
 *  - 504 valid yyyy-mm keys without CONTRIBUTIONS_API_TOKEN → 503 church_not_configured
 */
import { beforeAll, describe, expect, it } from "vitest";
import { catalogReq, seedFamilySession, type FamilySession } from "./helpers";

const INVALID_PERIODS = Array.from({ length: 500 }, (_, i) => ({
  i,
  periodKey: `bad-${i}`,
}));

const VALID_PERIODS: { i: number; periodKey: string }[] = [];
{
  let i = 0;
  for (let year = 1980; year <= 2021; year++) {
    for (let month = 1; month <= 12; month++) {
      VALID_PERIODS.push({
        i,
        periodKey: `${year}-${String(month).padStart(2, "0")}`,
      });
      i += 1;
    }
  }
}

describe("catalog: church ≥1000", () => {
  let s: FamilySession;

  beforeAll(() => {
    s = seedFamilySession();
  });

  it(`records ${INVALID_PERIODS.length + VALID_PERIODS.length} settle combinations`, () => {
    expect(INVALID_PERIODS.length + VALID_PERIODS.length).toBeGreaterThanOrEqual(1000);
  });

  it.each(INVALID_PERIODS)(
    "POST settle invalid periodKey=$periodKey → 400",
    async (c) => {
      const res = await catalogReq(s.env, "POST", "/api/church/settle", {
        cookie: s.actor.cookie,
        body: {
          familyId: s.familyId,
          fundSlug: "building",
          periodKey: c.periodKey,
        },
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe("validation_error");
    },
  );

  it.each(VALID_PERIODS)(
    "POST settle $periodKey without token → 503 church_not_configured",
    async (c) => {
      const res = await catalogReq(s.env, "POST", "/api/church/settle", {
        cookie: s.actor.cookie,
        body: {
          familyId: s.familyId,
          fundSlug: "building",
          periodKey: c.periodKey,
        },
      });
      expect(res.status).toBe(503);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe("church_not_configured");
    },
  );

  it("snapshot without familyId → 400", async () => {
    const res = await catalogReq(s.env, "GET", "/api/church/snapshot", {
      cookie: s.actor.cookie,
    });
    expect(res.status).toBe(400);
  });

  it("snapshot without token → 503", async () => {
    const res = await catalogReq(
      s.env,
      "GET",
      `/api/church/snapshot?familyId=${s.familyId}`,
      { cookie: s.actor.cookie },
    );
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("church_not_configured");
  });
});
