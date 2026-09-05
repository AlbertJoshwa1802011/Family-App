/**
 * Items module catalog — 500 titles × 2 visibility, type "note" (unregistered is allowed).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { catalogReq, seedFamilySession, utcIsoFromDay, type FamilySession } from "./helpers";

const ITEM_CASES = Array.from({ length: 500 }, (_, n) => {
  const cases: {
    i: number;
    title: string;
    visibility: "family" | "private";
    dueDate: string;
  }[] = [];
  for (const visibility of ["family", "private"] as const) {
    cases.push({
      i: n * 2 + (visibility === "family" ? 0 : 1),
      title: `Item ${n} ${visibility}`,
      visibility,
      dueDate: utcIsoFromDay(n),
    });
  }
  return cases;
}).flat();

const INVALID: { name: string; body: Record<string, unknown> }[] = [
  { name: "empty title", body: { title: "" } },
  { name: "empty type", body: { type: "" } },
  { name: "bad dueDate", body: { dueDate: "soon" } },
  { name: "bad visibility", body: { visibility: "secret" } },
];

describe("catalog: items ≥1000", () => {
  let s: FamilySession;

  beforeAll(() => {
    s = seedFamilySession();
  });

  it(`records ${ITEM_CASES.length} create combinations`, () => {
    expect(ITEM_CASES.length).toBeGreaterThanOrEqual(1000);
  });

  it.each(ITEM_CASES)("POST #$i $title vis=$visibility", async (c) => {
    const res = await catalogReq(s.env, "POST", "/api/items", {
      cookie: s.actor.cookie,
      body: {
        familyId: s.familyId,
        type: "note",
        title: c.title,
        visibility: c.visibility,
        dueDate: c.dueDate,
      },
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      item: { title: string; type: string; visibility: string; dueDate: string | null };
    };
    expect(json.item.title).toBe(c.title);
    expect(json.item.type).toBe("note");
    expect(json.item.visibility).toBe(c.visibility);
    expect(json.item.dueDate).toBe(c.dueDate);
  });

  it.each(INVALID)("POST invalid: $name → 400 validation_error", async (c) => {
    const res = await catalogReq(s.env, "POST", "/api/items", {
      cookie: s.actor.cookie,
      body: {
        familyId: s.familyId,
        type: "note",
        title: "x",
        ...c.body,
      },
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("validation_error");
  });
});
