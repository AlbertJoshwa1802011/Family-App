/**
 * Reminder email override — prefs API + recipient resolution helper.
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { createTestEnv, seedActor, seedFamily, seedUser } from "./helpers/testEnv";
import { resolveReminderRecipientEmail } from "../worker/lib/reminders/recipientEmail";
import type { Env } from "../worker/types";

const ORIGIN = "http://localhost:5173";

function put(env: Env, path: string, cookie: string, body: unknown) {
  return app.request(
    path,
    {
      method: "PUT",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: ORIGIN,
      },
      body: JSON.stringify(body),
    },
    env,
  );
}

function get(env: Env, path: string, cookie: string) {
  return app.request(path, { headers: { Cookie: cookie } }, env);
}

describe("resolveReminderRecipientEmail", () => {
  it("uses the override when set", () => {
    expect(
      resolveReminderRecipientEmail("alerts@example.com", "me@example.com"),
    ).toBe("alerts@example.com");
  });

  it("falls back to the account email when override is null/blank", () => {
    expect(resolveReminderRecipientEmail(null, "me@example.com")).toBe(
      "me@example.com",
    );
    expect(resolveReminderRecipientEmail("  ", "me@example.com")).toBe(
      "me@example.com",
    );
    expect(resolveReminderRecipientEmail(undefined, "me@example.com")).toBe(
      "me@example.com",
    );
  });
});

describe("/api/notifications/prefs reminderEmail", () => {
  it("defaults emailEnabled true and reminderEmail null", async () => {
    const { env, sqlite } = createTestEnv();
    const user = seedUser(sqlite);
    const family = seedFamily(sqlite, user.id);
    const actor = seedActor(sqlite, family.id, "owner");

    const res = await get(env, "/api/notifications/prefs", actor.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      prefs: {
        emailEnabled: boolean;
        reminderEmail: string | null;
      };
    };
    expect(body.prefs.emailEnabled).toBe(true);
    expect(body.prefs.reminderEmail).toBeNull();
  });

  it("stores and clears reminderEmail", async () => {
    const { env, sqlite } = createTestEnv();
    const user = seedUser(sqlite);
    const family = seedFamily(sqlite, user.id);
    const actor = seedActor(sqlite, family.id, "member");

    const putRes = await put(env, "/api/notifications/prefs", actor.cookie, {
      reminderEmail: "override@example.com",
      emailEnabled: true,
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as {
      prefs: { reminderEmail: string | null };
    };
    expect(putBody.prefs.reminderEmail).toBe("override@example.com");

    const getRes = await get(env, "/api/notifications/prefs", actor.cookie);
    const getBody = (await getRes.json()) as {
      prefs: { reminderEmail: string | null };
    };
    expect(getBody.prefs.reminderEmail).toBe("override@example.com");

    const clear = await put(env, "/api/notifications/prefs", actor.cookie, {
      reminderEmail: null,
    });
    expect(clear.status).toBe(200);
    const cleared = (await clear.json()) as {
      prefs: { reminderEmail: string | null };
    };
    expect(cleared.prefs.reminderEmail).toBeNull();
  });

  it("rejects an invalid reminderEmail", async () => {
    const { env, sqlite } = createTestEnv();
    const user = seedUser(sqlite);
    const family = seedFamily(sqlite, user.id);
    const actor = seedActor(sqlite, family.id, "member");

    const res = await put(env, "/api/notifications/prefs", actor.cookie, {
      reminderEmail: "not-an-email",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });
});
