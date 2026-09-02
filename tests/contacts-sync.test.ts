/**
 * Google Contacts sync contract — unconnected users get 409, not a 5xx.
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { createTestEnv, seedActor, seedFamily, seedUser } from "./helpers/testEnv";

describe("POST /api/contacts/sync", () => {
  it("returns 409 contacts_not_connected when the user has not granted the scope", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");

    const res = await app.request(
      `/api/contacts/sync?familyId=${family.id}`,
      {
        method: "POST",
        headers: {
          Cookie: actor.cookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: "{}",
      },
      env,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("contacts_not_connected");
  });

  it("google-status is false by default", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const res = await app.request("/api/contacts/google-status", {
      headers: { Cookie: actor.cookie },
    }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { connected: boolean };
    expect(body.connected).toBe(false);
  });

  it("creates a local contact without Google (no scope)", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const res = await app.request(
      "/api/contacts",
      {
        method: "POST",
        headers: {
          Cookie: actor.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          familyId: family.id,
          name: "Dr. Rao",
          phone: "+91 90000 00000",
        }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { contact: { name: string } };
    expect(body.contact.name).toBe("Dr. Rao");
  });
});
