/**
 * Device lock — PIN setup/verify/reset and WebAuthn options + clientData
 * rejection (assertion crypto is unit-tested in webauthn.test.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../worker/index";
import { sha256Hex } from "../worker/lib/crypto";
import { b64urlEncode } from "../worker/lib/webauthn";
import { createTestEnv, seedActor, seedFamily, seedUser } from "./helpers/testEnv";

const ORIGIN = "http://localhost:5173";

afterEach(() => {
  vi.restoreAllMocks();
});

function req(
  env: ReturnType<typeof createTestEnv>["env"],
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
  origin = ORIGIN,
) {
  return app.request(
    path,
    {
      method,
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: origin,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

function packClientData(data: object): string {
  return b64urlEncode(new TextEncoder().encode(JSON.stringify(data)));
}

describe("device lock PIN", () => {
  it("status is empty for a new user", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const res = await req(env, "GET", "/api/device-lock/status", actor.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { webauthn: boolean; pin: boolean; rpId: string };
    expect(body.webauthn).toBe(false);
    expect(body.pin).toBe(false);
    expect(body.rpId).toBe("localhost");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("status rpId follows the page Origin (production Face ID)", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const res = await req(
      env,
      "GET",
      "/api/device-lock/status",
      actor.cookie,
      undefined,
      "https://fam.connect-cloud.workers.dev",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rpId: string };
    expect(body.rpId).toBe("fam.connect-cloud.workers.dev");
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

  it("PIN reset request without email transport → 503", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    await req(env, "POST", "/api/device-lock/pin/setup", actor.cookie, { pin: "123456" });
    const res = await req(env, "POST", "/api/device-lock/pin/reset/request", actor.cookie);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("email_not_configured");
  });

  it("PIN reset confirm rejects a wrong code", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const res = await req(env, "POST", "/api/device-lock/pin/reset/confirm", actor.cookie, {
      code: "000000",
      pin: "654321",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_reset_code");
  });

  it("PIN reset confirm with a stored code replaces the PIN", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    await req(env, "POST", "/api/device-lock/pin/setup", actor.cookie, { pin: "123456" });
    await env.KV.put(`pinreset:${actor.userId}`, await sha256Hex("111222"));

    const res = await req(env, "POST", "/api/device-lock/pin/reset/confirm", actor.cookie, {
      code: "111222",
      pin: "654321",
    });
    expect(res.status).toBe(200);

    expect((await req(env, "POST", "/api/device-lock/pin/verify", actor.cookie, { pin: "123456" })).status).toBe(401);
    expect((await req(env, "POST", "/api/device-lock/pin/verify", actor.cookie, { pin: "654321" })).status).toBe(200);

    const reuse = await req(env, "POST", "/api/device-lock/pin/reset/confirm", actor.cookie, {
      code: "111222",
      pin: "000000",
    });
    expect(reuse.status).toBe(400);
  });

  it("PIN reset confirm rejects a short code with validation_error", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const res = await req(env, "POST", "/api/device-lock/pin/reset/confirm", actor.cookie, {
      code: "12",
      pin: "654321",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("validation_error");
  });

  it("PIN reset request emails the signed-in Google address when Resend is set", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const { env, sqlite } = createTestEnv({
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "Family Vault <noreply@example.com>",
    });
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner", { email: "albert@example.com" });
    const res = await req(env, "POST", "/api/device-lock/pin/reset/request", actor.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; to: string };
    expect(body.ok).toBe(true);
    expect(body.to).toBe("albert@example.com");
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it("PIN reset request and confirm are 401 without a session", async () => {
    const { env } = createTestEnv();
    expect((await req(env, "POST", "/api/device-lock/pin/reset/request", "")).status).toBe(401);
    expect(
      (await req(env, "POST", "/api/device-lock/pin/reset/confirm", "", { code: "111111", pin: "222222" })).status,
    ).toBe(401);
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

  it("webauthn register without a challenge is challenge_expired", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const res = await req(env, "POST", "/api/device-lock/webauthn/register", actor.cookie, {
      id: "cred",
      rawId: "cred",
      clientDataJSON: packClientData({
        type: "webauthn.create",
        challenge: "abc",
        origin: ORIGIN,
      }),
      authenticatorData: "AAAA",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("challenge_expired");
  });

  it("webauthn register with a foreign origin is invalid_client_data", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const opts = await req(env, "POST", "/api/device-lock/webauthn/options", actor.cookie);
    const { challenge } = (await opts.json()) as { challenge: string };
    const res = await req(env, "POST", "/api/device-lock/webauthn/register", actor.cookie, {
      id: "cred",
      rawId: "cred",
      clientDataJSON: packClientData({
        type: "webauthn.create",
        challenge,
        origin: "https://evil.example",
      }),
      authenticatorData: "AAAA",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("invalid_client_data");
    expect(body.message.toLowerCase()).toContain("face id");
  });

  it("webauthn options rp.id matches the request Origin hostname", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const res = await req(
      env,
      "GET",
      "/api/device-lock/webauthn/options?purpose=register",
      actor.cookie,
      undefined,
      "https://fam.connect-cloud.workers.dev",
    );
    const body = (await res.json()) as { rp: { id: string } };
    expect(body.rp.id).toBe("fam.connect-cloud.workers.dev");
  });
});
