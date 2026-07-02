/**
 * Phase-5 hardening: CSRF Origin/Referer verification + KV rate limiting.
 *
 * CSRF model (worker/middleware/csrf.ts): if the browser attests a source
 * (Origin, else Referer) it must match this deployment; requests with neither
 * header are non-browser clients and pass. Applied to all /api mutations and
 * the download proxy GET.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../worker/index";
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
let actor: ReturnType<typeof seedActor>;

beforeEach(() => {
  t = createTestEnv();
  const ownerUser = seedUser(t.sqlite);
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
  actor = seedActor(t.sqlite, familyId, "owner");
});

describe("CSRF protection on mutations", () => {
  const evil = "https://evil.example";

  it("rejects a cross-origin POST with 403 csrf_rejected (before auth runs)", async () => {
    const res = await app.request(
      "/api/families",
      {
        method: "POST",
        headers: {
          Origin: evil,
          Cookie: actor.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Forged" }),
      },
      t.env,
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("csrf_rejected");
  });

  it("rejects cross-origin PATCH and DELETE too", async () => {
    for (const method of ["PATCH", "DELETE"]) {
      const res = await app.request(
        "/api/documents/some-id",
        { method, headers: { Origin: evil, Cookie: actor.cookie } },
        t.env,
      );
      expect(res.status).toBe(403);
    }
  });

  it("rejects a forged Referer when Origin is absent", async () => {
    const res = await app.request(
      "/api/families",
      {
        method: "POST",
        headers: {
          Referer: "https://evil.example/attack.html",
          Cookie: actor.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Forged" }),
      },
      t.env,
    );
    expect(res.status).toBe(403);
  });

  it("allows a same-origin POST (Origin matches the request host)", async () => {
    const res = await app.request(
      "http://localhost/api/families",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          Cookie: actor.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Legit" }),
      },
      t.env,
    );
    expect(res.status).toBe(201);
  });

  it("allows a POST whose Origin matches APP_URL (dev server origin)", async () => {
    const res = await app.request(
      "http://127.0.0.1:8787/api/families",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost:5173", // APP_URL in test env
          Cookie: actor.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Dev" }),
      },
      t.env,
    );
    expect(res.status).toBe(201);
  });

  it("allows non-browser clients (no Origin/Referer) — they carry no ambient cookies", async () => {
    const res = await app.request(
      "/api/families",
      {
        method: "POST",
        headers: { Cookie: actor.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "CLI" }),
      },
      t.env,
    );
    expect(res.status).toBe(201);
  });

  it("plain GETs are never CSRF-blocked", async () => {
    const res = await app.request(
      "/api/families",
      { headers: { Origin: evil, Cookie: actor.cookie } },
      t.env,
    );
    expect(res.status).toBe(200);
  });

  it("download proxy GET IS origin-checked (Lax cookie rides top-level GETs)", async () => {
    const doc = seedDocument(t.sqlite, { familyId, ownerUserId: actor.userId });
    const res = await app.request(
      `/api/documents/${doc.id}/files/f1/download`,
      {
        headers: { Referer: "https://evil.example/", Cookie: actor.cookie },
      },
      t.env,
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("csrf_rejected");
  });
});

describe("rate limiting (KV fixed window)", () => {
  it("POST /auth/google/start returns 429 after 10 requests/min from one IP", async () => {
    const env = { ...t.env, GOOGLE_CLIENT_ID: "test-client-id" };
    const headers = { "cf-connecting-ip": "203.0.113.9" };

    for (let i = 0; i < 10; i++) {
      const res = await app.request(
        "/api/auth/google/start",
        { method: "POST", headers },
        env,
      );
      expect(res.status).toBe(200);
    }

    const blocked = await app.request(
      "/api/auth/google/start",
      { method: "POST", headers },
      env,
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect(((await blocked.json()) as { error: string }).error).toBe("rate_limited");
  });

  it("a different IP is not affected by another IP's limit", async () => {
    const env = { ...t.env, GOOGLE_CLIENT_ID: "test-client-id" };
    for (let i = 0; i < 10; i++) {
      await app.request(
        "/api/auth/google/start",
        { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9" } },
        env,
      );
    }
    const other = await app.request(
      "/api/auth/google/start",
      { method: "POST", headers: { "cf-connecting-ip": "198.51.100.7" } },
      env,
    );
    expect(other.status).toBe(200);
  });

  it("invite creation is limited to 20/hour per user", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await app.request(
        `/api/families/${familyId}/invites`,
        {
          method: "POST",
          headers: { Cookie: actor.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ email: `invitee${i}@example.com` }),
        },
        t.env,
      );
      expect(res.status).toBe(201);
    }
    const blocked = await app.request(
      `/api/families/${familyId}/invites`,
      {
        method: "POST",
        headers: { Cookie: actor.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "toomany@example.com" }),
      },
      t.env,
    );
    expect(blocked.status).toBe(429);
  });

  it("upload-url requests are limited to 30/min per user", async () => {
    const doc = seedDocument(t.sqlite, { familyId, ownerUserId: actor.userId });
    // Drive isn't configured in tests, so allowed requests return 503 — the
    // limiter must still fire first once the budget is exhausted.
    for (let i = 0; i < 30; i++) {
      const res = await app.request(
        `/api/documents/${doc.id}/files/upload-url`,
        {
          method: "POST",
          headers: { Cookie: actor.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: "a.pdf", mimeType: "application/pdf" }),
        },
        t.env,
      );
      expect(res.status).toBe(503);
    }
    const blocked = await app.request(
      `/api/documents/${doc.id}/files/upload-url`,
      {
        method: "POST",
        headers: { Cookie: actor.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: "a.pdf", mimeType: "application/pdf" }),
      },
      t.env,
    );
    expect(blocked.status).toBe(429);
  });

  it("fails open when KV is unavailable (unit-test envs)", async () => {
    const env = { ...t.env, KV: undefined as unknown as KVNamespace, GOOGLE_CLIENT_ID: "x" };
    for (let i = 0; i < 15; i++) {
      const res = await app.request("/api/auth/google/start", { method: "POST" }, env);
      // No KV → PKCE state can't be stored either; the route throws before
      // returning a URL — but it must never 429.
      expect(res.status).not.toBe(429);
    }
  });
});
