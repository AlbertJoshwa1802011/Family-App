/**
 * Contact search (?q=) — find emergency contacts by name, email, or phone
 * (including digits-only phone queries that ignore formatting).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../worker/index";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

let t: TestEnv;
let familyId: string;
let member: ReturnType<typeof seedActor>;

beforeEach(() => {
  t = createTestEnv();
  const ownerUser = seedUser(t.sqlite);
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
  member = seedActor(t.sqlite, familyId, "member");
});

function req(method: string, path: string, cookie: string, body?: object) {
  return app.request(
    path,
    {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
    t.env,
  );
}

async function createContact(body: {
  name: string;
  phone?: string;
  email?: string;
  relationship?: string;
}) {
  const res = await req("POST", "/api/contacts", member.cookie, {
    familyId,
    ...body,
  });
  expect(res.status).toBe(201);
}

describe("contact search (?q=)", () => {
  beforeEach(async () => {
    await createContact({
      name: "Dr. Rivera",
      relationship: "Pediatrician",
      phone: "+1 555 010 2000",
      email: "rivera@clinic.example",
    });
    await createContact({
      name: "Lincoln Elementary",
      relationship: "School",
      phone: "(212) 555-0199",
      email: "office@lincoln.edu",
    });
    await createContact({
      name: "Aunt Mei",
      phone: "+44 7700 900123",
      email: "mei@family.example",
    });
  });

  async function search(q: string): Promise<string[]> {
    const res = await req(
      "GET",
      `/api/contacts?familyId=${familyId}&q=${encodeURIComponent(q)}`,
      member.cookie,
    );
    expect(res.status).toBe(200);
    const { contacts } = (await res.json()) as { contacts: { name: string }[] };
    return contacts.map((c) => c.name);
  }

  it("finds contacts by (partial, case-insensitive) name", async () => {
    expect(await search("rivera")).toEqual(["Dr. Rivera"]);
    expect(await search("RIVERA")).toEqual(["Dr. Rivera"]);
    expect(await search("lincoln")).toEqual(["Lincoln Elementary"]);
  });

  it("finds contacts by email", async () => {
    expect(await search("clinic.example")).toEqual(["Dr. Rivera"]);
    expect(await search("mei@")).toEqual(["Aunt Mei"]);
  });

  it("finds contacts by phone (formatted and digits-only)", async () => {
    expect(await search("555 010")).toEqual(["Dr. Rivera"]);
    // Digits ignore spaces / punctuation / country code formatting.
    expect(await search("5550102000")).toEqual(["Dr. Rivera"]);
    expect(await search("2125550199")).toEqual(["Lincoln Elementary"]);
    expect(await search("7700900123")).toEqual(["Aunt Mei"]);
  });

  it("returns empty for no matches; wildcards are neutralized", async () => {
    expect(await search("nonexistent")).toEqual([]);
    expect(await search("%")).toEqual([]);
    expect(await search("_")).toEqual([]);
  });

  it("lists all contacts when q is omitted", async () => {
    const res = await req(
      "GET",
      `/api/contacts?familyId=${familyId}`,
      member.cookie,
    );
    expect(res.status).toBe(200);
    const { contacts } = (await res.json()) as { contacts: { name: string }[] };
    expect(contacts.map((c) => c.name).sort()).toEqual([
      "Aunt Mei",
      "Dr. Rivera",
      "Lincoln Elementary",
    ]);
  });
});
