/**
 * Google Contacts sync contract — unconnected users get 409, not a 5xx.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../worker/index";
import { GOOGLE_SCOPES } from "../worker/lib/google";
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
    const body = (await res.json()) as { contacts: boolean; gmail: boolean };
    expect(body.contacts).toBe(false);
    expect(body.gmail).toBe(false);
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
});
