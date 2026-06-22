/**
 * Tests for occasion reminder logic (nextOccurrenceIso, occasionReminderText)
 * and the /api/occasions route contract (401 without session, 404 on deep
 * paths, JSON content-type, security headers). Mirrors events.test.ts.
 *
 * "Today" is pinned to 2026-06-09 (UTC midnight).
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import {
  nextOccurrenceIso,
  occasionReminderText,
} from "../worker/lib/reminders";

const TODAY = Date.UTC(2026, 5, 9); // 2026-06-09 00:00 UTC

describe("nextOccurrenceIso", () => {
  it("returns this year's date when it's still upcoming", () => {
    expect(nextOccurrenceIso("1990-08-12", TODAY)).toBe("2026-08-12");
  });

  it("returns this year's date when it is today", () => {
    expect(nextOccurrenceIso("1980-06-09", TODAY)).toBe("2026-06-09");
  });

  it("rolls over to next year once the date has passed", () => {
    expect(nextOccurrenceIso("1990-03-01", TODAY)).toBe("2027-03-01");
  });

  it("clamps Feb-29 to Feb-28 in a non-leap year", () => {
    // From 1 Jan 2027 the next occurrence is later in 2027, a non-leap year,
    // so Feb-29 clamps to Feb-28.
    expect(nextOccurrenceIso("2000-02-29", Date.UTC(2027, 0, 1))).toBe(
      "2027-02-28",
    );
  });

  it("returns null for malformed input", () => {
    expect(nextOccurrenceIso("not-a-date", TODAY)).toBeNull();
  });
});

describe("occasionReminderText", () => {
  it("uses a cake for birthdays and counts down", () => {
    const t = occasionReminderText("Dad", "birthday", 3);
    expect(t.title).toContain("🎂");
    expect(t.title).toContain("3 days");
  });

  it("says today at zero days", () => {
    const t = occasionReminderText("Anniversary", "anniversary", 0);
    expect(t.title).toContain("today");
    expect(t.title).toContain("💍");
  });

  it("says tomorrow at one day", () => {
    const t = occasionReminderText("Trip", "custom", 1);
    expect(t.title).toContain("tomorrow");
  });
});

describe("/api/occasions: 401 without session", () => {
  const routes = [
    { method: "GET", path: "/api/occasions?familyId=fam-1" },
    { method: "POST", path: "/api/occasions" },
    { method: "GET", path: "/api/occasions/occ-1" },
    { method: "PATCH", path: "/api/occasions/occ-1" },
    { method: "DELETE", path: "/api/occasions/occ-1" },
  ];
  for (const { method, path } of routes) {
    it(`${method} ${path} → 401`, async () => {
      const res = await app.request(path, { method });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("unauthorized");
    });
  }
});

describe("/api/occasions: routing + headers", () => {
  it("deep path → 404 not_found", async () => {
    const res = await app.request("/api/occasions/x/y/z");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("returns JSON + nosniff on a 401", async () => {
    const res = await app.request("/api/occasions/occ-1");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
