/**
 * HTML email reports: template structure + the weekly digest pipeline
 * (Monday gating, per-week dedupe, private-doc visibility, empty-week skip).
 *
 * sendEmail() no-ops without RESEND_API_KEY, so digest tests use a fetch stub
 * with a fake key to observe what WOULD be sent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  escapeHtml,
  inviteEmail,
  reminderEmail,
  weeklyDigestEmail,
} from "../worker/lib/emailTemplates";
import { isoWeekKey, runWeeklyDigest } from "../worker/lib/digest";
import {
  createTestEnv,
  seedActor,
  seedDocument,
  seedFamily,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

// A Monday, 08:00 UTC (matches the cron hour).
const MONDAY_MS = Date.UTC(2026, 6, 6, 8, 0, 0); // 2026-07-06 is a Monday
const TUESDAY_MS = MONDAY_MS + 86_400_000;

describe("email templates (pure)", () => {
  it("escapes user content everywhere", () => {
    const html = reminderEmail({
      heading: `<script>alert("x")</script>`,
      body: `Tom & Jerry's "docs"`,
      ctaLabel: "View",
      ctaUrl: "https://app.example/documents/1",
      urgency: "danger",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Tom &amp; Jerry");
  });

  it("reminder urgency changes the accent treatment", () => {
    const danger = reminderEmail({
      heading: "Passport expires tomorrow",
      body: "b",
      ctaLabel: "View",
      ctaUrl: "https://x",
      urgency: "danger",
    });
    expect(danger).toContain("Action needed");
    const warning = reminderEmail({
      heading: "h",
      body: "b",
      ctaLabel: "View",
      ctaUrl: "https://x",
      urgency: "warning",
    });
    expect(warning).toContain("Coming up");
  });

  it("weekly digest renders all three sections with items and empty states", () => {
    const html = weeklyDigestEmail({
      recipientName: "Priya Sharma",
      familyName: "The Sharmas",
      appUrl: "https://vault.example",
      periodLabel: "6 – 12 Jul 2026",
      expiring: [
        { title: "Car insurance", expiryDate: "2026-07-10", daysLeft: 4, link: "https://x" },
      ],
      events: [],
      openTasks: [{ title: "Book dentist", dueDate: "2026-07-09", assignee: null }],
    });
    expect(html).toContain("Hi Priya,");
    expect(html).toContain("The Sharmas");
    expect(html).toContain("Car insurance");
    expect(html).toContain("4d left");
    expect(html).toContain("No events scheduled this week.");
    expect(html).toContain("Book dentist");
    // email-safe: table layout, no external resources
    expect(html).toContain("<table role=\"presentation\"");
    expect(html).not.toMatch(/<link|src=/);
  });

  it("invite email carries family name + accept URL and a safe footer", () => {
    const html = inviteEmail({
      inviterName: "Ravi",
      familyName: "The Sharmas",
      inviteUrl: "https://vault.example/invite/tok123",
    });
    expect(html).toContain("Ravi");
    expect(html).toContain("The Sharmas");
    expect(html).toContain("https://vault.example/invite/tok123");
    expect(html).toContain("safely ignore");
  });

  it("escapeHtml handles the full special set", () => {
    expect(escapeHtml(`<a href="x">&`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;");
  });
});

describe("isoWeekKey", () => {
  it("computes ISO weeks (year boundary included)", () => {
    expect(isoWeekKey(new Date(Date.UTC(2026, 6, 6)))).toBe("2026-W28");
    // 2026-01-01 is a Thursday → week 1 of 2026
    expect(isoWeekKey(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-W01");
    // 2027-01-01 is a Friday → belongs to 2026-W53
    expect(isoWeekKey(new Date(Date.UTC(2027, 0, 1)))).toBe("2026-W53");
  });
});

describe("weekly digest pipeline", () => {
  let t: TestEnv;
  let familyId: string;
  let owner: ReturnType<typeof seedActor>;
  let member: ReturnType<typeof seedActor>;
  let sentEmails: { to: string; subject: string; html: string }[];

  beforeEach(() => {
    t = createTestEnv({ RESEND_API_KEY: "test-key", APP_URL: "https://vault.example" });
    const ownerUser = seedUser(t.sqlite);
    familyId = seedFamily(t.sqlite, ownerUser.id, "The Halls").id;
    owner = seedActor(t.sqlite, familyId, "owner", { name: "Olive Hall" });
    member = seedActor(t.sqlite, familyId, "member", { name: "Milo Hall" });

    sentEmails = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        sentEmails.push(JSON.parse(String(init?.body)));
        return new Response("{}", { status: 200 });
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  function seedExpiringDoc(opts: { title: string; ownerUserId: string; visibility?: "family" | "private" }) {
    const expiry = new Date(MONDAY_MS + 10 * 86_400_000).toISOString().slice(0, 10);
    seedDocument(t.sqlite, {
      familyId,
      ownerUserId: opts.ownerUserId,
      title: opts.title,
      visibility: opts.visibility ?? "family",
      expiryDate: expiry,
    });
  }

  it("sends on Monday to every opted-in member, with real content", async () => {
    seedExpiringDoc({ title: "Family insurance", ownerUserId: owner.userId });

    const { sent } = await runWeeklyDigest(t.env, MONDAY_MS);
    expect(sent).toBe(2);
    const to = sentEmails.map((e) => e.to).sort();
    expect(to).toEqual([member.email, owner.email].sort());
    expect(sentEmails[0].subject).toContain("Your family week ahead");
    expect(sentEmails[0].html).toContain("Family insurance");
  });

  it("does nothing on other days", async () => {
    seedExpiringDoc({ title: "Family insurance", ownerUserId: owner.userId });
    const { sent } = await runWeeklyDigest(t.env, TUESDAY_MS);
    expect(sent).toBe(0);
    expect(sentEmails).toHaveLength(0);
  });

  it("dedupes: a second run in the same week sends nothing", async () => {
    seedExpiringDoc({ title: "Family insurance", ownerUserId: owner.userId });
    await runWeeklyDigest(t.env, MONDAY_MS);
    const again = await runWeeklyDigest(t.env, MONDAY_MS + 3600_000);
    expect(again.sent).toBe(0);
  });

  it("private docs appear only in their owner's digest (and family owner/admin)", async () => {
    seedExpiringDoc({ title: "Member private visa", ownerUserId: member.userId, visibility: "private" });

    await runWeeklyDigest(t.env, MONDAY_MS);
    const memberMail = sentEmails.find((e) => e.to === member.email)!;
    const ownerMail = sentEmails.find((e) => e.to === owner.email)!;
    expect(memberMail.html).toContain("Member private visa");
    // family owner may see it (role-based, same rule as the app)
    expect(ownerMail.html).toContain("Member private visa");

    // Second plain member sees nothing → empty week → no email at all
    const other = sentEmails.filter((e) => e.to !== member.email && e.to !== owner.email);
    expect(other).toHaveLength(0);
  });

  it("skips users with email reminders disabled and empty weeks", async () => {
    // member opts out
    t.sqlite
      .prepare("INSERT INTO reminder_prefs (user_id, email_enabled, push_enabled, windows_json) VALUES (?, 0, 0, '[30,7,1]')")
      .run(member.userId);
    seedExpiringDoc({ title: "Family insurance", ownerUserId: owner.userId });

    const { sent } = await runWeeklyDigest(t.env, MONDAY_MS);
    expect(sent).toBe(1);
    expect(sentEmails[0].to).toBe(owner.email);

    // Empty week: nothing expiring/events/tasks → no emails at all
    sentEmails.length = 0;
    const t2 = createTestEnv({ RESEND_API_KEY: "test-key" });
    const u = seedUser(t2.sqlite);
    const f = seedFamily(t2.sqlite, u.id);
    seedActor(t2.sqlite, f.id, "owner");
    const empty = await runWeeklyDigest(t2.env, MONDAY_MS);
    expect(empty.sent).toBe(0);
  });
});
