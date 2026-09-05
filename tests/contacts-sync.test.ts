/**
 * Google Contacts sync contract — unconnected users get 409, not a 5xx.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../worker/index";
import { GOOGLE_SCOPES } from "../worker/lib/google";
import {
  contactDbErrorMessage,
  ensureContactsGoogleColumns,
} from "../worker/lib/contactsSchema";
import { createTestEnv, seedActor, seedFamily, seedUser } from "./helpers/testEnv";

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("returns 400 when familyId is missing", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const res = await app.request("/api/contacts/sync", {
      method: "POST",
      headers: {
        Cookie: actor.cookie,
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: "{}",
    }, env);
    expect(res.status).toBe(400);
  });

  it("GET /api/auth/google/status is 401 without a session", async () => {
    const { env } = createTestEnv();
    const res = await app.request("/api/auth/google/status", {}, env);
    expect(res.status).toBe(401);
  });

  it("GET /api/auth/google/status is false/false by default", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const res = await app.request("/api/auth/google/status", {
      headers: { Cookie: actor.cookie },
    }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { contacts: boolean; gmail: boolean; calendar: boolean };
    expect(body.contacts).toBe(false);
    expect(body.gmail).toBe(false);
    expect(body.calendar).toBe(false);
  });

  it("People API 403 becomes google_sync_failed with a human message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("People API has not been used", { status: 403 }),
    );
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    await env.KV.put(
      `user:google_scopes:${actor.userId}`,
      JSON.stringify([GOOGLE_SCOPES.contacts]),
    );
    await env.KV.put(`user:access_token:${actor.userId}`, "ya29.test");

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
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("google_sync_failed");
    expect(body.message).toMatch(/People API/i);
  });

  it("adds missing Google columns then pulls a People API connection", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          connections: [
            {
              resourceName: "people/c7367869478483806601",
              names: [{ displayName: "Amma" }],
              emailAddresses: [{ value: "amma@example.com" }],
              phoneNumbers: [{ value: "+91 90000 00001" }],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const { env, sqlite } = createTestEnv();
    sqlite.exec("DROP INDEX IF EXISTS uq_contact_google_resource");
    sqlite.exec("ALTER TABLE contacts DROP COLUMN google_resource_name");
    sqlite.exec("ALTER TABLE contacts DROP COLUMN google_etag");
    sqlite.exec("ALTER TABLE contacts DROP COLUMN last_pushed_at");

    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    await env.KV.put(
      `user:google_scopes:${actor.userId}`,
      JSON.stringify([GOOGLE_SCOPES.contacts]),
    );
    await env.KV.put(`user:access_token:${actor.userId}`, "ya29.test");

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
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: number; pulled: number };
    expect(body.pulled).toBe(1);
    expect(body.created).toBe(1);

    const row = sqlite
      .prepare("SELECT name, google_resource_name FROM contacts WHERE family_id = ?")
      .get(family.id) as { name: string; google_resource_name: string };
    expect(row.name).toBe("Amma");
    expect(row.google_resource_name).toBe("people/c7367869478483806601");
  });
});

describe("ensureContactsGoogleColumns", () => {
  it("is a no-op when migration 0013 is already applied", async () => {
    const { env } = createTestEnv();
    await ensureContactsGoogleColumns(env.DB);
    await ensureContactsGoogleColumns(env.DB);
  });
});

describe("contactDbErrorMessage", () => {
  it("hides the raw SELECT from the family", () => {
    const mapped = contactDbErrorMessage(
      new Error(
        'Failed query: select "id", "google_resource_name" from "contacts" where ("contacts"."family_id" = ? and "contacts"."google_resource_name" = ?)\nparams: abc,people/c7367869478483806601',
      ),
    );
    expect(mapped.message).not.toMatch(/select "/i);
    expect(mapped.message).toMatch(/family database/i);
  });
});
