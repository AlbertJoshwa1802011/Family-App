/**
 * Church fund settlements: live "with you" figure, recipients (Mom), exact
 * settle time, handover to church, legacy rows, authz + restricted funds.
 *
 * The contributions site is mocked at `fetch`; everything else runs against
 * the real migrations via the node:sqlite D1 adapter.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { app } from "../worker/index";
import { computeChurchLedger } from "../worker/lib/churchLedger";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

const UPSTREAM = "https://contrib.test";

interface UpstreamFund {
  slug: string;
  name: string;
  totalCollected: number;
  spentOnProducts: number;
}

let upstreamFunds: UpstreamFund[];
let t: TestEnv;
let familyId: string;
let owner: ReturnType<typeof seedActor>;
let member: ReturnType<typeof seedActor>;
let outsider: ReturnType<typeof seedActor>;
let momId: string;

function req(method: string, path: string, cookie: string, body?: object) {
  return app.request(
    path,
    {
      method,
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: body ? JSON.stringify(body) : undefined,
    },
    t.env,
  );
}

async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface Snapshot {
  fetchedAt: number;
  totals: {
    collectedMinor: number;
    settledMinor: number;
    withYouMinor: number;
    withRecipientsMinor: number;
    givenToChurchMinor: number;
  };
  funds: {
    slug: string;
    collectedMinor: number;
    settledMinor: number;
    withYouMinor: number;
    overSettledMinor: number;
    outstandingMinor: number;
  }[];
  holders: {
    recipientId: string | null;
    name: string;
    holdingMinor: number;
    handedOverMinor: number;
    receivedMinor: number;
    byFund: { fundSlug: string; holdingMinor: number }[];
  }[];
  recipients: { id: string; name: string }[];
  settlements: {
    id: string;
    fundSlug: string;
    fundName: string;
    paidMinor: number;
    settledAt: number;
    recipientId: string | null;
    recipientName: string | null;
    handedOverAt: number | null;
    settledByName: string | null;
  }[];
}

async function snapshot(cookie = owner.cookie): Promise<Snapshot> {
  const res = await req("GET", `/api/church/snapshot?familyId=${familyId}`, cookie);
  expect(res.status).toBe(200);
  return json<Snapshot>(res);
}

function fund(s: Snapshot, slug: string) {
  return s.funds.find((f) => f.slug === slug)!;
}

function holder(s: Snapshot, recipientId: string | null) {
  return s.holders.find((h) => h.recipientId === recipientId);
}

async function settle(body: Record<string, unknown>, cookie = owner.cookie) {
  return req("POST", "/api/church/settle", cookie, { familyId, ...body });
}

beforeEach(async () => {
  upstreamFunds = [
    { slug: "christmas-2k26", name: "Christmas 2k26", totalCollected: 2500, spentOnProducts: 0 },
    { slug: "tech-contributions", name: "Tech Fund", totalCollected: 3000, spentOnProducts: 400 },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(`${UPSTREAM}/api/funds`)) {
        return new Response(JSON.stringify({ funds: upstreamFunds }), { status: 200 });
      }
      if (url.startsWith(`${UPSTREAM}/api/purchases`)) {
        return new Response(JSON.stringify({ purchases: [] }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    }),
  );

  t = createTestEnv({
    CONTRIBUTIONS_API_URL: UPSTREAM,
    SUPER_ADMIN_EMAILS: "albert@example.com",
  });
  const ownerUser = seedUser(t.sqlite);
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
  owner = seedActor(t.sqlite, familyId, "owner", { name: "Albert", email: "albert@example.com" });
  member = seedActor(t.sqlite, familyId, "member", { name: "Milo Member" });
  const otherFamily = seedFamily(t.sqlite, seedUser(t.sqlite).id).id;
  outsider = seedActor(t.sqlite, otherFamily, "owner", { name: "Oz Outsider" });

  const mom = await req("POST", "/api/settlements/destinations", owner.cookie, {
    familyId,
    name: "Mom",
    kind: "person",
  });
  expect(mom.status).toBe(201);
  momId = (await json<{ destination: { id: string } }>(mom)).destination.id;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("computeChurchLedger", () => {
  const funds = [
    { slug: "xmas", name: "Christmas", collectedMinor: 250_000 },
    { slug: "tech", name: "Tech", collectedMinor: 300_000 },
  ];
  const recipients = [
    { id: "mom", name: "Mom", archivedAt: null },
    { id: "dad", name: "Dad", archivedAt: null },
  ];

  it("with-you is collected minus everything paid out, per fund", () => {
    const l = computeChurchLedger(
      funds,
      [
        { id: "a", fundSlug: "xmas", paidMinor: 250_000, settledAt: 10, recipientId: "mom", handedOverAt: null },
        { id: "b", fundSlug: "tech", paidMinor: 200_000, settledAt: 20, recipientId: "mom", handedOverAt: null },
      ],
      recipients,
    );
    expect(l.funds.get("xmas")!.withYouMinor).toBe(0);
    expect(l.funds.get("tech")!.withYouMinor).toBe(100_000);
    expect(l.funds.get("tech")!.lastSettledAt).toBe(20);
    const mom = l.holders.find((h) => h.recipientId === "mom")!;
    expect(mom.holdingMinor).toBe(450_000);
    expect(mom.byFund.map((f) => f.fundSlug)).toEqual(["xmas", "tech"]);
    expect(l.totals).toEqual({
      collectedMinor: 550_000,
      settledMinor: 450_000,
      withYouMinor: 100_000,
      withRecipientsMinor: 450_000,
      givenToChurchMinor: 0,
    });
  });

  it("handed-over money leaves the holder and counts as given to church", () => {
    const l = computeChurchLedger(
      funds,
      [
        { id: "a", fundSlug: "xmas", paidMinor: 100_000, settledAt: 10, recipientId: "mom", handedOverAt: 50 },
        { id: "b", fundSlug: "xmas", paidMinor: 50_000, settledAt: 20, recipientId: "mom", handedOverAt: null },
      ],
      recipients,
    );
    const mom = l.holders.find((h) => h.recipientId === "mom")!;
    expect(mom).toMatchObject({ receivedMinor: 150_000, holdingMinor: 50_000, handedOverMinor: 100_000, openCount: 1 });
    expect(l.totals.givenToChurchMinor).toBe(100_000);
    // Handing over does not change what is with you.
    expect(l.funds.get("xmas")!.withYouMinor).toBe(100_000);
  });

  it("flags over-settlement instead of going negative", () => {
    const l = computeChurchLedger(
      funds,
      [{ id: "a", fundSlug: "xmas", paidMinor: 300_000, settledAt: 1, recipientId: "mom", handedOverAt: null }],
      recipients,
    );
    expect(l.funds.get("xmas")).toMatchObject({ withYouMinor: 0, overSettledMinor: 50_000 });
  });

  it("lists every active recipient (even at ₹0) and puts the legacy bucket last", () => {
    const l = computeChurchLedger(
      funds,
      [{ id: "a", fundSlug: "xmas", paidMinor: 1, settledAt: 1, recipientId: null, handedOverAt: null }],
      [...recipients, { id: "old", name: "Old", archivedAt: 5 }],
    );
    expect(l.holders.map((h) => h.recipientId)).toEqual(["dad", "mom", null]);
    expect(l.holders.at(-1)!.name).toBe("Recipient not set");
  });
});

describe("GET /church/snapshot — live figures", () => {
  it("regression: a legacy carry-forward row no longer freezes ₹1,000 pending", async () => {
    // Old flow: due auto-filled ₹3,500, paid ₹2,500 → carry ₹1,000 stuck forever.
    t.sqlite
      .prepare(
        `INSERT INTO church_settlements (id, family_id, fund_slug, period_key, collected_minor, spent_minor,
          due_minor, paid_minor, remaining_minor, settled_at, settled_by_user_id)
         VALUES ('legacy', ?, 'christmas-2k26', '2026-10', 250000, 0, 350000, 250000, 100000, 1790000000, ?)`,
      )
      .run(familyId, owner.userId);

    const s = await snapshot();
    expect(fund(s, "christmas-2k26")).toMatchObject({
      collectedMinor: 250_000,
      settledMinor: 250_000,
      withYouMinor: 0,
      outstandingMinor: 0,
    });
    // Legacy row is surfaced for assignment rather than silently dropped.
    expect(holder(s, null)).toMatchObject({ holdingMinor: 250_000, name: "Recipient not set" });
  });

  it("picks up new website payments without any new settlement", async () => {
    expect((await settle({ fundSlug: "christmas-2k26", paidMinor: 250_000, recipientId: momId })).status).toBe(201);
    expect(fund(await snapshot(), "christmas-2k26").withYouMinor).toBe(0);

    upstreamFunds[0].totalCollected = 2_800; // someone paid ₹300 on the site
    const s = await snapshot();
    expect(fund(s, "christmas-2k26").withYouMinor).toBe(30_000);
    expect(s.totals.withYouMinor).toBe(30_000 + 300_000);
  });

  it("does not subtract church purchases from what you hold", async () => {
    // Tech: ₹3,000 collected, ₹400 purchases — you still hold the full ₹3,000.
    expect(fund(await snapshot(), "tech-contributions").withYouMinor).toBe(300_000);
  });

  it("shows Mom holding the sum across funds (the ₹4,500 case)", async () => {
    await settle({ fundSlug: "christmas-2k26", paidMinor: 250_000, recipientId: momId });
    await settle({ fundSlug: "tech-contributions", paidMinor: 200_000, recipientId: momId });
    const s = await snapshot();
    const mom = holder(s, momId)!;
    expect(mom.name).toBe("Mom");
    expect(mom.holdingMinor).toBe(450_000);
    expect(s.totals.withRecipientsMinor).toBe(450_000);
    expect(fund(s, "tech-contributions").withYouMinor).toBe(100_000);
    expect(s.recipients.map((r) => r.name)).toEqual(["Mom"]);
    expect(typeof s.fetchedAt).toBe("number");
  });

  it("hides restricted funds from plain members, including from holder totals", async () => {
    await settle({ fundSlug: "christmas-2k26", paidMinor: 250_000, recipientId: momId });
    await settle({ fundSlug: "tech-contributions", paidMinor: 200_000, recipientId: momId });
    const s = await snapshot(member.cookie);
    expect(s.funds.map((f) => f.slug)).toEqual(["christmas-2k26"]);
    expect(s.settlements.every((x) => x.fundSlug === "christmas-2k26")).toBe(true);
    expect(holder(s, momId)!.holdingMinor).toBe(250_000);
    expect(s.totals.collectedMinor).toBe(250_000);
  });

  it("hides the family from outsiders (404, not 403)", async () => {
    const res = await req("GET", `/api/church/snapshot?familyId=${familyId}`, outsider.cookie);
    expect(res.status).toBe(404);
  });
});

describe("POST /church/settle", () => {
  it("records the exact settled time and recipient", async () => {
    const at = 1_793_000_123;
    const res = await settle({
      fundSlug: "christmas-2k26",
      paidMinor: 100_000,
      recipientId: momId,
      settledAt: at,
      note: "  cash at home  ",
    });
    expect(res.status).toBe(201);
    const body = await json<{
      settlement: { settledAt: number; recipientId: string; note: string; dueMinor: number };
      withYouBeforeMinor: number;
      withYouAfterMinor: number;
    }>(res);
    expect(body.settlement).toMatchObject({ settledAt: at, recipientId: momId, note: "cash at home", dueMinor: 250_000 });
    expect(body.withYouBeforeMinor).toBe(250_000);
    expect(body.withYouAfterMinor).toBe(150_000);

    const row = (await snapshot()).settlements[0];
    expect(row).toMatchObject({
      settledAt: at,
      recipientName: "Mom",
      fundName: "Christmas 2k26",
      settledByName: "Albert",
      handedOverAt: null,
    });
  });

  it("defaults settledAt to now", async () => {
    const before = Math.floor(Date.now() / 1000);
    await settle({ fundSlug: "christmas-2k26", paidMinor: 1_000, recipientId: momId });
    const at = (await snapshot()).settlements[0].settledAt;
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(before + 5);
  });

  it("accepts and ignores legacy dueMinor / periodKey", async () => {
    const res = await settle({
      fundSlug: "christmas-2k26",
      paidMinor: 1_000,
      recipientId: momId,
      dueMinor: 999_999,
      periodKey: "2020-01",
    });
    expect(res.status).toBe(201);
    const { settlement } = await json<{ settlement: { dueMinor: number; periodKey: string } }>(res);
    expect(settlement.dueMinor).toBe(250_000);
    expect(settlement.periodKey).not.toBe("2020-01");
  });

  it.each([
    ["missing recipient", { fundSlug: "christmas-2k26", paidMinor: 100 }],
    ["zero amount", { fundSlug: "christmas-2k26", paidMinor: 0, recipientId: "x" }],
    ["fractional paise", { fundSlug: "christmas-2k26", paidMinor: 1.5, recipientId: "x" }],
    ["future time", { fundSlug: "christmas-2k26", paidMinor: 100, recipientId: "x", settledAt: Math.floor(Date.now() / 1000) + 3_600 }],
    ["ancient time", { fundSlug: "christmas-2k26", paidMinor: 100, recipientId: "x", settledAt: 1_000 }],
  ])("400 validation_error: %s", async (_label, body) => {
    const res = await settle(body);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("validation_error");
  });

  it("rejects a recipient from another family", async () => {
    const theirs = await req("POST", "/api/settlements/destinations", outsider.cookie, {
      familyId: (await json<{ families: { id: string }[] }>(
        await req("GET", "/api/families", outsider.cookie),
      )).families[0].id,
      name: "Their Mom",
    });
    const theirId = (await json<{ destination: { id: string } }>(theirs)).destination.id;
    const res = await settle({ fundSlug: "christmas-2k26", paidMinor: 100, recipientId: theirId });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("invalid_recipient_id");
  });

  it("rejects an archived recipient", async () => {
    await req("PATCH", `/api/settlements/destinations/${momId}`, owner.cookie, { archived: true });
    const res = await settle({ fundSlug: "christmas-2k26", paidMinor: 100, recipientId: momId });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("recipient_archived");
  });

  it("404s a restricted fund for a plain member", async () => {
    const res = await settle({ fundSlug: "tech-contributions", paidMinor: 100, recipientId: momId }, member.cookie);
    expect(res.status).toBe(404);
  });
});

describe("PATCH / DELETE /church/settlements/:id", () => {
  async function createOne(cookie = owner.cookie) {
    const res = await settle({ fundSlug: "christmas-2k26", paidMinor: 50_000, recipientId: momId, settledAt: 1_793_000_000 }, cookie);
    expect(res.status).toBe(201);
    return (await json<{ settlement: { id: string } }>(res)).settlement.id;
  }

  it("assigns a recipient + exact time to a legacy row", async () => {
    t.sqlite
      .prepare(
        `INSERT INTO church_settlements (id, family_id, fund_slug, period_key, collected_minor, spent_minor,
          due_minor, paid_minor, remaining_minor, settled_at, settled_by_user_id)
         VALUES ('legacy', ?, 'christmas-2k26', '2026-10', 250000, 0, 250000, 250000, 0, 1790000000, ?)`,
      )
      .run(familyId, owner.userId);
    const res = await req("PATCH", "/api/church/settlements/legacy", owner.cookie, {
      recipientId: momId,
      settledAt: 1_791_000_000,
    });
    expect(res.status).toBe(200);
    const s = await snapshot();
    expect(holder(s, null)).toBeUndefined();
    expect(holder(s, momId)!.holdingMinor).toBe(250_000);
    expect(s.settlements[0]).toMatchObject({ settledAt: 1_791_000_000, recipientName: "Mom" });
  });

  it("marks handed over and can undo it", async () => {
    const id = await createOne();
    let res = await req("PATCH", `/api/church/settlements/${id}`, owner.cookie, { handedOver: true });
    expect(res.status).toBe(200);
    let s = await snapshot();
    expect(holder(s, momId)).toMatchObject({ holdingMinor: 0, handedOverMinor: 50_000 });
    expect(s.settlements[0].handedOverAt).not.toBeNull();

    res = await req("PATCH", `/api/church/settlements/${id}`, owner.cookie, { handedOver: false });
    expect(res.status).toBe(200);
    s = await snapshot();
    expect(holder(s, momId)!.holdingMinor).toBe(50_000);
  });

  it("validates the merged state: handed over before settled → 400", async () => {
    const id = await createOne();
    const res = await req("PATCH", `/api/church/settlements/${id}`, owner.cookie, { handedOverAt: 1_792_000_000 });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("validation_error");
  });

  it("a member cannot edit or delete someone else's settlement", async () => {
    const id = await createOne();
    expect((await req("PATCH", `/api/church/settlements/${id}`, member.cookie, { paidMinor: 1 })).status).toBe(403);
    expect((await req("DELETE", `/api/church/settlements/${id}`, member.cookie)).status).toBe(403);
  });

  it("a member can edit their own", async () => {
    const id = await createOne(member.cookie);
    const res = await req("PATCH", `/api/church/settlements/${id}`, member.cookie, { paidMinor: 40_000 });
    expect(res.status).toBe(200);
    expect(fund(await snapshot(), "christmas-2k26").withYouMinor).toBe(210_000);
  });

  it("outsiders and unknown ids both get 404", async () => {
    const id = await createOne();
    expect((await req("PATCH", `/api/church/settlements/${id}`, outsider.cookie, { paidMinor: 1 })).status).toBe(404);
    expect((await req("PATCH", "/api/church/settlements/nope", owner.cookie, { paidMinor: 1 })).status).toBe(404);
  });

  it("delete restores the amount to with-you", async () => {
    const id = await createOne();
    expect(fund(await snapshot(), "christmas-2k26").withYouMinor).toBe(200_000);
    expect((await req("DELETE", `/api/church/settlements/${id}`, owner.cookie)).status).toBe(200);
    expect(fund(await snapshot(), "christmas-2k26").withYouMinor).toBe(250_000);
  });
});

describe("POST /church/handover", () => {
  it("closes everything Mom holds in one go", async () => {
    await settle({ fundSlug: "christmas-2k26", paidMinor: 250_000, recipientId: momId });
    await settle({ fundSlug: "tech-contributions", paidMinor: 200_000, recipientId: momId });
    const res = await req("POST", "/api/church/handover", owner.cookie, { familyId, recipientId: momId });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, count: 2, amountMinor: 450_000 });
    const s = await snapshot();
    expect(holder(s, momId)).toMatchObject({ holdingMinor: 0, handedOverMinor: 450_000 });
    expect(s.totals.givenToChurchMinor).toBe(450_000);
  });

  it("a member's handover never touches restricted-fund rows", async () => {
    await settle({ fundSlug: "christmas-2k26", paidMinor: 250_000, recipientId: momId });
    await settle({ fundSlug: "tech-contributions", paidMinor: 200_000, recipientId: momId });
    const res = await req("POST", "/api/church/handover", member.cookie, { familyId, recipientId: momId });
    expect(await json(res)).toMatchObject({ count: 1, amountMinor: 250_000 });
    expect(holder(await snapshot(), momId)!.holdingMinor).toBe(200_000);
  });

  it("400 when there is nothing to hand over", async () => {
    const res = await req("POST", "/api/church/handover", owner.cookie, { familyId, recipientId: momId });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("nothing_to_hand_over");
  });

  it("400 validation_error without a recipient", async () => {
    const res = await req("POST", "/api/church/handover", owner.cookie, { familyId });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("validation_error");
  });
});
