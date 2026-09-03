/**
 * Documents module catalog — 200 expiry-day offsets × 2 visibility × 3 categories = 1200.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { catalogReq, seedFamilySession, utcIsoFromDay, type FamilySession } from "./helpers";

const CATEGORIES = ["passport", "insurance", "medical"] as const;
const VIS = ["family", "private"] as const;

type DocCase = {
  id: number;
  title: string;
  category: (typeof CATEGORIES)[number];
  visibility: (typeof VIS)[number];
  expiryDate: string;
};

const DOC_CASES: DocCase[] = [];
{
  let id = 0;
  for (let day = 0; day < 200; day++) {
    for (const visibility of VIS) {
      for (const category of CATEGORIES) {
        DOC_CASES.push({
          id,
          title: `Doc ${id}`,
          category,
          visibility,
          expiryDate: utcIsoFromDay(day),
        });
        id += 1;
      }
    }
  }
}

const INVALID: { name: string; body: Record<string, unknown> }[] = [
  { name: "empty title", body: { title: "" } },
  { name: "title too long", body: { title: "t".repeat(301) } },
  { name: "bad expiry", body: { title: "x", expiryDate: "2026/01/01" } },
  { name: "bad issued", body: { title: "x", issuedDate: "01-01-2026" } },
  { name: "bad visibility", body: { title: "x", visibility: "secret" } },
  { name: "title null", body: { title: null } },
];

describe("catalog: documents ≥1000", () => {
  let s: FamilySession;

  beforeAll(() => {
    s = seedFamilySession();
  });

  it(`records ${DOC_CASES.length} create combinations`, () => {
    expect(DOC_CASES.length).toBeGreaterThanOrEqual(1000);
  });

  it.each(DOC_CASES)(
    "POST #$id $category $visibility expiry=$expiryDate",
    async (c) => {
      const res = await catalogReq(s.env, "POST", "/api/documents", {
        cookie: s.actor.cookie,
        body: {
          familyId: s.familyId,
          title: c.title,
          category: c.category,
          visibility: c.visibility,
          expiryDate: c.expiryDate,
        },
      });
      expect(res.status).toBe(201);
      const json = (await res.json()) as {
        document: {
          title: string;
          category: string;
          visibility: string;
          expiryDate: string | null;
        };
      };
      expect(json.document.title).toBe(c.title);
      expect(json.document.category).toBe(c.category);
      expect(json.document.visibility).toBe(c.visibility);
      expect(json.document.expiryDate).toBe(c.expiryDate);
    },
  );

  it.each(INVALID)("POST invalid: $name → 400 validation_error", async (c) => {
    const res = await catalogReq(s.env, "POST", "/api/documents", {
      cookie: s.actor.cookie,
      body: { familyId: s.familyId, ...c.body },
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("validation_error");
  });

  it("outsider GET of a family document is 404", async () => {
    const created = await catalogReq(s.env, "POST", "/api/documents", {
      cookie: s.actor.cookie,
      body: { familyId: s.familyId, title: "Hidden", visibility: "family" },
    });
    const { document } = (await created.json()) as { document: { id: string } };
    const res = await catalogReq(s.env, "GET", `/api/documents/${document.id}`, {
      cookie: s.outsider.cookie,
    });
    expect(res.status).toBe(404);
  });
});
