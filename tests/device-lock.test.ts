/**
 * Device lock — PIN setup/verify (WebAuthn is covered at the options contract;
 * assertion crypto is unit-tested in webauthn.test.ts).
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { createTestEnv, seedActor, seedFamily, seedUser } from "./helpers/testEnv";

const ORIGIN = "http://localhost:5173";

function req(
  env: ReturnType<typeof createTestEnv>["env"],
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
) {
  return app.request(
    path,
    {
      method,
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: ORIGIN,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

describe("device lock PIN", () => {
  it("status is empty for a new user", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const res = await req(env, "GET", "/api/device-lock/status", actor.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { webauthn: boolean; pin: boolean };
    expect(body.webauthn).toBe(false);
    expect(body.pin).toBe(false);
  });

  it("sets a 6-digit PIN and verifies it", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");

    const setup = await req(env, "POST", "/api/device-lock/pin/setup", actor.cookie, {
      pin: "123456",
    });
    expect(setup.status).toBe(200);

    const status = await req(env, "GET", "/api/device-lock/status", actor.cookie);
    expect(((await status.json()) as { pin: boolean }).pin).toBe(true);

    const ok = await req(env, "POST", "/api/device-lock/pin/verify", actor.cookie, {
      pin: "123456",
    });
    expect(ok.status).toBe(200);

    const bad = await req(env, "POST", "/api/device-lock/pin/verify", actor.cookie, {
      pin: "000000",
    });
    expect(bad.status).toBe(401);
  });

  it("rejects a short PIN with validation_error", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const res = await req(env, "POST", "/api/device-lock/pin/setup", actor.cookie, {
      pin: "12",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("returns 401 without a session", async () => {
    const { env } = createTestEnv();
    const res = await req(env, "GET", "/api/device-lock/status", "");
    expect(res.status).toBe(401);
  });
});

describe("device lock webauthn options", () => {
  it("returns a challenge and platform authenticator params", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const res = await req(
      env,
      "POST",
      "/api/device-lock/webauthn/options",
      actor.cookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      challenge: string;
      authenticatorSelection: { userVerification: string };
    };
    expect(body.challenge.length).toBeGreaterThan(10);
    expect(body.authenticatorSelection.userVerification).toBe("required");
  });

  it("also accepts GET for the options challenge", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const res = await req(
      env,
      "GET",
      "/api/device-lock/webauthn/options?purpose=register",
      actor.cookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challenge: string };
    expect(body.challenge.length).toBeGreaterThan(10);
  });

  it("verify without a PIN returns pin_not_set", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const res = await req(env, "POST", "/api/device-lock/pin/verify", actor.cookie, {
      pin: "123456",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("pin_not_set");
  });

  it("unknown device-lock path is JSON 404", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const res = await req(env, "GET", "/api/device-lock/nope", actor.cookie);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});
