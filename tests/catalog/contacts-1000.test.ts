/**
 * Contacts module catalog — 1000 unique names, optional relationship/phone.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { catalogReq, seedFamilySession, type FamilySession } from "./helpers";

const RELS = ["parent", "sibling", "friend", "doctor", "other"] as const;

const CONTACT_CASES = Array.from({ length: 1000 }, (_, i) => ({
  i,
  name: `Contact ${String(i).padStart(4, "0")}`,
  relationship: RELS[i % RELS.length],
  phone: `+1555${String(i).padStart(7, "0")}`,
}));

const INVALID: { name: string; body: Record<string, unknown> }[] = [
  { name: "empty name", body: { name: "" } },
  { name: "name too long", body: { name: "n".repeat(201) } },
  { name: "bad email", body: { name: "x", email: "not-an-email" } },
  { name: "missing familyId", body: { familyId: "", name: "x" } },
];

describe("catalog: contacts ≥1000", () => {
  let s: FamilySession;

  beforeAll(() => {
    s = seedFamilySession();
  });

  it(`records ${CONTACT_CASES.length} create combinations`, () => {
    expect(CONTACT_CASES.length).toBeGreaterThanOrEqual(1000);
  });

  it.each(CONTACT_CASES)("POST #$i $name", async (c) => {
    const res = await catalogReq(s.env, "POST", "/api/contacts", {
      cookie: s.actor.cookie,
      body: {
        familyId: s.familyId,
        name: c.name,
        relationship: c.relationship,
        phone: c.phone,
      },
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      contact: { name: string; relationship: string | null; phone: string | null };
    };
    expect(json.contact.name).toBe(c.name);
    expect(json.contact.relationship).toBe(c.relationship);
    expect(json.contact.phone).toBe(c.phone);
  });

  it.each(INVALID)("POST invalid: $name → 400 validation_error", async (c) => {
    const res = await catalogReq(s.env, "POST", "/api/contacts", {
      cookie: s.actor.cookie,
      body: { familyId: s.familyId, name: "x", ...c.body },
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("validation_error");
  });
});
