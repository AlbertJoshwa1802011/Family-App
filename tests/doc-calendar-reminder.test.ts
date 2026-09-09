/**
 * Per-document "Add to family calendar" — renew marker ~7 days before expiry.
 *
 * Family-visible docs create a real events row (in-app + ICS).
 * Private docs only get a visibility-filtered ICS renew item (no shared event).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../worker/index";
import {
  CALENDAR_REMINDER_LEAD_DAYS,
  isoMinusDays,
  renewReminderTitle,
} from "../worker/lib/expiryCalendar";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function req(
  t: TestEnv,
  method: string,
  path: string,
  cookie?: string,
  body?: unknown,
) {
  return app.request(
    path,
    {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    t.env,
  );
}

describe("isoMinusDays", () => {
  it("subtracts whole UTC days", () => {
    expect(isoMinusDays("2026-06-15", 7)).toBe("2026-06-08");
    expect(isoMinusDays("2026-03-01", 1)).toBe("2026-02-28");
    expect(isoMinusDays("bad", 7)).toBeNull();
  });
});

describe("document calendar reminder", () => {
  let t: TestEnv;
  let familyId: string;
  let owner: ReturnType<typeof seedActor>;
  let member: ReturnType<typeof seedActor>;

  beforeEach(() => {
    t = createTestEnv({ APP_URL: "https://vault.example" });
    const ownerUser = seedUser(t.sqlite);
    familyId = seedFamily(t.sqlite, ownerUser.id).id;
    owner = seedActor(t.sqlite, familyId, "owner", { name: "Owner" });
    member = seedActor(t.sqlite, familyId, "member", { name: "Member" });
  });

  it("creates a Renew event 7 days before expiry when enabled", async () => {
    const expiry = isoDaysFromNow(20);
    const renew = isoMinusDays(expiry, CALENDAR_REMINDER_LEAD_DAYS)!;

    const create = await req(t, "POST", "/api/documents", owner.cookie, {
      familyId,
      title: "Passport",
      expiryDate: expiry,
      calendarReminderEnabled: true,
    });
    expect(create.status).toBe(201);
    const { document } = (await create.json()) as {
      document: {
        id: string;
        calendarReminderEnabled: boolean;
        expiryReminderEventId: string | null;
      };
    };
    expect(document.calendarReminderEnabled).toBe(true);
    expect(document.expiryReminderEventId).toBeTruthy();

    const ev = await req(
      t,
      "GET",
      `/api/events/${document.expiryReminderEventId}`,
      owner.cookie,
    );
    expect(ev.status).toBe(200);
    const body = (await ev.json()) as {
      event: { title: string; allDay: boolean; startAt: number; source: string | null };
    };
    expect(body.event.title).toBe(renewReminderTitle("Passport"));
    expect(body.event.allDay).toBe(true);
    expect(body.event.source).toBe("document_expiry");
    expect(new Date(body.event.startAt * 1000).toISOString().slice(0, 10)).toBe(
      renew,
    );
  });

  it("does not create a shared event for private docs (privacy)", async () => {
    const create = await req(t, "POST", "/api/documents", owner.cookie, {
      familyId,
      title: "Secret ID",
      expiryDate: isoDaysFromNow(30),
      visibility: "private",
      calendarReminderEnabled: true,
    });
    expect(create.status).toBe(201);
    const { document } = (await create.json()) as {
      document: { expiryReminderEventId: string | null; calendarReminderEnabled: boolean };
    };
    expect(document.calendarReminderEnabled).toBe(true);
    expect(document.expiryReminderEventId).toBeNull();
  });

  it("updates the renew event when expiry date changes", async () => {
    const create = await req(t, "POST", "/api/documents", owner.cookie, {
      familyId,
      title: "Visa",
      expiryDate: isoDaysFromNow(40),
      calendarReminderEnabled: true,
    });
    const { document } = (await create.json()) as {
      document: { id: string; expiryReminderEventId: string };
    };
    const eventId = document.expiryReminderEventId;

    const newExpiry = isoDaysFromNow(50);
    const patch = await req(t, "PATCH", `/api/documents/${document.id}`, owner.cookie, {
      expiryDate: newExpiry,
    });
    expect(patch.status).toBe(200);
    const updated = (await patch.json()) as {
      document: { expiryReminderEventId: string };
    };
    expect(updated.document.expiryReminderEventId).toBe(eventId);

    const ev = await req(t, "GET", `/api/events/${eventId}`, owner.cookie);
    const body = (await ev.json()) as { event: { startAt: number } };
    expect(new Date(body.event.startAt * 1000).toISOString().slice(0, 10)).toBe(
      isoMinusDays(newExpiry, 7),
    );
  });

  it("trashes the renew event when calendar reminder is turned off", async () => {
    const create = await req(t, "POST", "/api/documents", owner.cookie, {
      familyId,
      title: "License",
      expiryDate: isoDaysFromNow(25),
      calendarReminderEnabled: true,
    });
    const { document } = (await create.json()) as {
      document: { id: string; expiryReminderEventId: string };
    };

    const patch = await req(t, "PATCH", `/api/documents/${document.id}`, owner.cookie, {
      calendarReminderEnabled: false,
    });
    expect(patch.status).toBe(200);
    const after = (await patch.json()) as {
      document: { expiryReminderEventId: string | null; calendarReminderEnabled: boolean };
    };
    expect(after.document.calendarReminderEnabled).toBe(false);
    expect(after.document.expiryReminderEventId).toBeNull();

    const ev = await req(
      t,
      "GET",
      `/api/events/${document.expiryReminderEventId}`,
      owner.cookie,
    );
    // Soft-trashed events 404 from the detail route (or cancelled) — either is fine
    // as long as they're gone from the active calendar.
    if (ev.status === 200) {
      const body = (await ev.json()) as { event: { status: string } };
      expect(["trashed", "cancelled"]).toContain(body.event.status);
    } else {
      expect(ev.status).toBe(404);
    }
  });

  it("ICS feed includes renew marker for opted-in private docs (owner only)", async () => {
    const expiry = isoDaysFromNow(21);
    const renew = isoMinusDays(expiry, 7)!;

    await req(t, "POST", "/api/documents", owner.cookie, {
      familyId,
      title: "Private Passport",
      expiryDate: expiry,
      visibility: "private",
      calendarReminderEnabled: true,
    });

    const tokenRes = await req(t, "POST", "/api/calendar/feed-token", owner.cookie);
    expect(tokenRes.status).toBe(200);
    const { url } = (await tokenRes.json()) as { url: string };
    const feedPath = new URL(url).pathname;

    const feed = await req(t, "GET", feedPath);
    expect(feed.status).toBe(200);
    const ics = await feed.text();
    expect(ics).toContain("Renew: Private Passport");
    expect(ics).toContain(renew.replace(/-/g, ""));

    // Other family member must not see the private renew item.
    const memberToken = await req(t, "POST", "/api/calendar/feed-token", member.cookie);
    const memberUrl = ((await memberToken.json()) as { url: string }).url;
    const memberFeed = await req(t, "GET", new URL(memberUrl).pathname);
    const memberIcs = await memberFeed.text();
    expect(memberIcs).not.toContain("Renew: Private Passport");
    expect(memberIcs).not.toContain("Private Passport expires");
  });

  it("rejects invalid calendarReminderEnabled type", async () => {
    const res = await req(t, "POST", "/api/documents", owner.cookie, {
      familyId,
      title: "Bad",
      calendarReminderEnabled: "yes",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });
});
