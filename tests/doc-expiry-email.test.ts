/**
 * Document expiry reminders — especially day-of email.
 *
 * The product requirement: if a passport/license expires today and the user
 * never opens the app, they must still get a clear email. Lead-time windows
 * (7d / 2d) must not share a dedupe slot with day-of (0), or yesterday's
 * "expires in 2 days" reminder would suppress today's email.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runExpiryReminders } from "../worker/cron";
import {
  createTestEnv,
  seedActor,
  seedDocument,
  seedFamily,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

describe("document expiry email reminders", () => {
  let t: TestEnv;
  let familyId: string;
  let owner: ReturnType<typeof seedActor>;
  let sent: { to: string; subject: string; html: string }[];
  let originalFetch: typeof fetch;

  beforeEach(() => {
    t = createTestEnv({
      RESEND_API_KEY: "test-key",
      APP_URL: "https://vault.example",
    });
    const ownerUser = seedUser(t.sqlite, { email: "holder@example.com" });
    familyId = seedFamily(t.sqlite, ownerUser.id).id;
    owner = seedActor(t.sqlite, familyId, "owner", {
      email: "owner@example.com",
      name: "Owner",
    });

    sent = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        to: string;
        subject: string;
        html: string;
      };
      sent.push(body);
      return new Response(JSON.stringify({ id: "msg_test" }), { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("emails clearly when a document expires today (user may not log in)", async () => {
    seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
      title: "Passport",
      expiryDate: isoDaysFromNow(0),
    });

    await runExpiryReminders(t.env);

    const dayOf = sent.filter((m) => m.subject.includes("Expires today"));
    expect(dayOf.length).toBeGreaterThanOrEqual(1);
    expect(dayOf.some((m) => m.to === "owner@example.com")).toBe(true);
    expect(dayOf[0]!.subject).toContain("Expires today: Passport");
    expect(dayOf[0]!.html.toLowerCase()).toContain("expires today");
    expect(dayOf[0]!.html.toLowerCase()).toContain("renew");
  });

  it("emails at the 7-day and 2-day planning windows", async () => {
    seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
      title: "Driver License",
      expiryDate: isoDaysFromNow(7),
    });
    await runExpiryReminders(t.env);
    expect(sent.some((m) => m.subject.includes("Driver License"))).toBe(true);
    expect(sent[0]!.html).toContain("7 day");

    sent.length = 0;
    seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
      title: "Insurance Card",
      expiryDate: isoDaysFromNow(2),
    });
    await runExpiryReminders(t.env);
    expect(sent.some((m) => /Expiring in 2 days: Insurance Card/.test(m.subject))).toBe(
      true,
    );
  });

  it("still sends day-of after a prior 2-day reminder (distinct dedupe slots)", async () => {
    const docId = seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
      title: "Visa",
      expiryDate: isoDaysFromNow(2),
    }).id;

    await runExpiryReminders(t.env);
    expect(sent.some((m) => m.subject.includes("Visa"))).toBe(true);
    const afterLead = sent.length;

    // Move expiry to today. Window 2 is already logged; window 0 must still
    // claim a fresh slot so day-of is not suppressed.
    t.sqlite
      .prepare("UPDATE documents SET expiry_date = ? WHERE id = ?")
      .run(isoDaysFromNow(0), docId);

    await runExpiryReminders(t.env);
    expect(sent.length).toBeGreaterThan(afterLead);
    expect(sent.some((m) => m.subject === "Expires today: Visa")).toBe(true);
  });

  it("catch-up emails an already-expired document when day-of was missed", async () => {
    seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
      title: "Old Permit",
      expiryDate: isoDaysFromNow(-3),
    });

    await runExpiryReminders(t.env);

    expect(sent.some((m) => m.subject === "Expired: Old Permit")).toBe(true);
    expect(sent.find((m) => m.subject.startsWith("Expired:"))!.html).toContain(
      "3 days ago",
    );
  });

  it("does not email when reminder email prefs are off", async () => {
    t.sqlite
      .prepare(
        "INSERT INTO reminder_prefs (user_id, email_enabled, push_enabled, windows_json) VALUES (?, 0, 0, '[30,7,2,0]')",
      )
      .run(owner.userId);

    seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
      title: "Quiet Doc",
      expiryDate: isoDaysFromNow(0),
    });

    await runExpiryReminders(t.env);
    expect(sent.filter((m) => m.to === "owner@example.com")).toHaveLength(0);
  });

  it("forces day-of even when lead-time prefs omit window 0", async () => {
    t.sqlite
      .prepare(
        "INSERT INTO reminder_prefs (user_id, email_enabled, push_enabled, windows_json) VALUES (?, 1, 0, '[30,7]')",
      )
      .run(owner.userId);

    seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
      title: "Forced Today",
      expiryDate: isoDaysFromNow(0),
    });

    await runExpiryReminders(t.env);
    expect(sent.some((m) => m.subject === "Expires today: Forced Today")).toBe(true);
  });
});
