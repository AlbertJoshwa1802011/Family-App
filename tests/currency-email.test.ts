/**
 * Integration: test-email delivery gate + family currency PATCH.
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { createTestEnv, seedActor, seedFamily, seedUser } from "./helpers/testEnv";
import type { Env } from "../worker/types";

const ORIGIN = "http://localhost:5173";

function req(env: Env, method: string, path: string, cookie: string, body?: unknown) {
  return app.request(
    path,
    {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json", Origin: ORIGIN },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

describe("POST /api/notifications/test-email", () => {
  it("returns 503 when RESEND_API_KEY is missing", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "member");

    const res = await req(env, "POST", "/api/notifications/test-email", alice.cookie);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("email_not_configured");
  });
});

describe("PATCH /api/families/:id currency", () => {
  it("updates defaultCurrency to USD", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    // Seed family starts as USD; flip to INR then back to prove the write path.
    sqlite
      .prepare("UPDATE families SET default_currency = ? WHERE id = ?")
      .run("INR", family.id);
    const alice = seedActor(sqlite, family.id, "member");

    const bad = await req(env, "PATCH", `/api/families/${family.id}`, alice.cookie, {
      defaultCurrency: "XYZ",
    });
    expect(bad.status).toBe(400);
    const badBody = (await bad.json()) as { error: string };
    expect(badBody.error).toBe("validation_error");

    const res = await req(env, "PATCH", `/api/families/${family.id}`, alice.cookie, {
      defaultCurrency: "USD",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { family: { defaultCurrency: string } };
    expect(body.family.defaultCurrency).toBe("USD");

    const get = await req(env, "GET", `/api/families/${family.id}`, alice.cookie);
    const got = (await get.json()) as { family: { defaultCurrency: string } };
    expect(got.family.defaultCurrency).toBe("USD");
  });

  it("rejects empty body", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "member");

    const res = await req(env, "PATCH", `/api/families/${family.id}`, alice.cookie, {});
    expect(res.status).toBe(400);
  });
});
