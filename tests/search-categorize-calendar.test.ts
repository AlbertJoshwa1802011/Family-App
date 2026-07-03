/**
 * The two product cores requested for v1:
 *  1. Document search by name + category suggestion (heuristic tier; the AI
 *     tier is exercised only when ANTHROPIC_API_KEY is configured and is
 *     always allowed to fall back to heuristics).
 *  2. Calendar integration: per-event .ics download + subscribable feed
 *     (capability URL, private-doc visibility respected, token rotation).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../worker/index";
import { suggestCategoryHeuristic } from "../worker/lib/categorize";
import { buildCalendar } from "../worker/lib/ics";
import {
  createTestEnv,
  seedActor,
  seedDocument,
  seedFamily,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

let t: TestEnv;
let familyId: string;
let owner: ReturnType<typeof seedActor>;
let member: ReturnType<typeof seedActor>;

beforeEach(() => {
  t = createTestEnv();
  const ownerUser = seedUser(t.sqlite);
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
  owner = seedActor(t.sqlite, familyId, "owner");
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

// ── 1. Search by name ──────────────────────────────────────────────────────────

describe("document search (?q=)", () => {
  beforeEach(() => {
    seedDocument(t.sqlite, { familyId, ownerUserId: owner.userId, title: "Mum's passport" });
    seedDocument(t.sqlite, { familyId, ownerUserId: owner.userId, title: "Car insurance policy" });
    seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
      title: "Dad's private will",
      visibility: "private",
    });
  });

  async function search(q: string, cookie: string): Promise<string[]> {
    const res = await req(
      "GET",
      `/api/documents?familyId=${familyId}&q=${encodeURIComponent(q)}`,
      cookie,
    );
    expect(res.status).toBe(200);
    const { documents } = (await res.json()) as { documents: { title: string }[] };
    return documents.map((d) => d.title);
  }

  it("finds documents by (partial, case-insensitive) name", async () => {
    expect(await search("passport", member.cookie)).toEqual(["Mum's passport"]);
    expect(await search("PASSPORT", member.cookie)).toEqual(["Mum's passport"]);
    expect(await search("insur", member.cookie)).toEqual(["Car insurance policy"]);
  });

  it("returns empty for no matches; wildcards are neutralized", async () => {
    expect(await search("nonexistent", member.cookie)).toEqual([]);
    // '%' must not act as match-everything
    expect(await search("%", member.cookie)).toEqual([]);
  });

  it("search NEVER leaks private documents to other members", async () => {
    expect(await search("will", member.cookie)).toEqual([]);
    // ...but the owner of the family sees it
    expect(await search("will", owner.cookie)).toEqual(["Dad's private will"]);
  });
});

// ── 2. Category suggestion ─────────────────────────────────────────────────────

describe("category suggestion", () => {
  it("heuristics classify common family documents", () => {
    const cases: [string, string][] = [
      ["Mum's passport", "identity"],
      ["Driving licence renewal", "identity"],
      ["Car insurance policy 2026", "insurance"],
      ["Vaccination record - Ella", "medical"],
      ["Vehicle registration", "vehicle"],
      ["Bank statement March", "finance"],
      ["Washing machine warranty", "warranty"],
      ["University degree certificate", "education"],
    ];
    for (const [title, expected] of cases) {
      expect(suggestCategoryHeuristic(title), title).toBe(expected);
    }
  });

  it("returns null for ambiguous titles (that's when AI takes over)", () => {
    expect(suggestCategoryHeuristic("Important thing")).toBeNull();
  });

  it("endpoint returns a heuristic suggestion with the right shape", async () => {
    const res = await req("POST", "/api/documents/suggest-category", member.cookie, {
      title: "Home insurance policy",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { category: string; source: string };
    expect(body.category).toBe("insurance");
    expect(body.source).toBe("heuristic");
  });

  it("endpoint degrades gracefully without an AI key (category null, never 5xx)", async () => {
    const res = await req("POST", "/api/documents/suggest-category", member.cookie, {
      title: "zxqw blorptag",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { category: string | null; source: string };
    expect(body.category).toBeNull();
    expect(body.source).toBe("none");
  });

  it("endpoint requires a session (401) and validates input (400)", async () => {
    const noAuth = await app.request(
      "/api/documents/suggest-category",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "x" }),
      },
      t.env,
    );
    expect(noAuth.status).toBe(401);

    const bad = await req("POST", "/api/documents/suggest-category", member.cookie, {
      title: "",
    });
    expect(bad.status).toBe(400);
  });
});

// ── 3. ICS generation (pure) ───────────────────────────────────────────────────

describe("ICS generation", () => {
  it("produces a valid VCALENDAR with escaped text and UTC datetimes", () => {
    const ics = buildCalendar({
      name: "Family Vault",
      nowSecs: 1_780_000_000,
      events: [
        {
          uid: "event-1@family-vault",
          title: "Dinner; with, commas\nand newline",
          startAt: 1_780_000_000,
          endAt: 1_780_003_600,
          allDay: false,
          location: "Grandma's",
        },
      ],
      allDayItems: [
        { uid: "expiry-1@family-vault", title: "Passport expires", date: "2026-09-01" },
      ],
    });

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("SUMMARY:Dinner\\; with\\, commas\\nand newline");
    expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260901");
    // CRLF line endings per RFC 5545
    expect(ics).toContain("\r\n");
  });

  it("marks cancelled events with STATUS:CANCELLED", () => {
    const ics = buildCalendar({
      name: "t",
      events: [
        {
          uid: "e",
          title: "Cancelled thing",
          startAt: 1_780_000_000,
          allDay: false,
          cancelled: true,
        },
      ],
    });
    expect(ics).toContain("STATUS:CANCELLED");
  });
});

// ── 4. Per-event ICS endpoint ──────────────────────────────────────────────────

describe("GET /events/:id/ics", () => {
  it("downloads an event as text/calendar for a member", async () => {
    const create = await req("POST", "/api/events", member.cookie, {
      familyId,
      title: "Dentist",
      startAt: Math.floor(Date.now() / 1000) + 86400,
    });
    const { event } = (await create.json()) as { event: { id: string } };

    const res = await req("GET", `/api/events/${event.id}/ics`, member.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const body = await res.text();
    expect(body).toContain("SUMMARY:Dentist");
  });

  it("is session + membership gated", async () => {
    const create = await req("POST", "/api/events", member.cookie, {
      familyId,
      title: "Private family thing",
      startAt: Math.floor(Date.now() / 1000) + 86400,
    });
    const { event } = (await create.json()) as { event: { id: string } };

    const anon = await app.request(`/api/events/${event.id}/ics`, {}, t.env);
    expect(anon.status).toBe(401);

    const strangerUser = seedUser(t.sqlite);
    const otherFamily = seedFamily(t.sqlite, strangerUser.id);
    const stranger = seedActor(t.sqlite, otherFamily.id, "owner");
    const res = await req("GET", `/api/events/${event.id}/ics`, stranger.cookie);
    expect(res.status).toBe(404);
  });
});

// ── 5. Subscribable feed ───────────────────────────────────────────────────────

describe("calendar feed (capability URL)", () => {
  async function mintFeedUrl(cookie: string): Promise<string> {
    const res = await req("POST", "/api/calendar/feed-token", cookie);
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    return new URL(url).pathname;
  }

  it("feed contains events and doc expiries, without cookies", async () => {
    await req("POST", "/api/events", member.cookie, {
      familyId,
      title: "School play",
      startAt: Math.floor(Date.now() / 1000) + 5 * 86400,
    });
    seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
      title: "Passport",
      expiryDate: "2027-01-15",
    });

    const path = await mintFeedUrl(member.cookie);
    // No Cookie header — calendar apps can't send one.
    const res = await app.request(path, {}, t.env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    const body = await res.text();
    expect(body).toContain("SUMMARY:School play");
    expect(body).toContain("SUMMARY:Passport expires");
  });

  it("feed hides other members' private-doc expiries but shows your own", async () => {
    seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
      title: "Owner secret",
      visibility: "private",
      expiryDate: "2027-02-01",
    });
    seedDocument(t.sqlite, {
      familyId,
      ownerUserId: member.userId,
      title: "Member secret",
      visibility: "private",
      expiryDate: "2027-03-01",
    });

    const memberFeed = await app.request(await mintFeedUrl(member.cookie), {}, t.env);
    const memberBody = await memberFeed.text();
    expect(memberBody).toContain("Member secret");
    expect(memberBody).not.toContain("Owner secret");

    const ownerFeed = await app.request(await mintFeedUrl(owner.cookie), {}, t.env);
    const ownerBody = await ownerFeed.text();
    // Family owner sees everything (role-based)
    expect(ownerBody).toContain("Owner secret");
    expect(ownerBody).toContain("Member secret");
  });

  it("rotating the token invalidates the previous URL", async () => {
    const first = await mintFeedUrl(member.cookie);
    expect((await app.request(first, {}, t.env)).status).toBe(200);

    const second = await mintFeedUrl(member.cookie);
    expect((await app.request(first, {}, t.env)).status).toBe(404);
    expect((await app.request(second, {}, t.env)).status).toBe(200);
  });

  it("garbage tokens 404", async () => {
    expect(
      (await app.request("/api/calendar/feed/not-a-real-token.ics", {}, t.env)).status,
    ).toBe(404);
    expect(
      (await app.request("/api/calendar/feed/whatever", {}, t.env)).status,
    ).toBe(404);
  });
});
