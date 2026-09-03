/**
 * Device lock — Face ID / fingerprint (WebAuthn platform authenticator)
 * plus a 6-digit PIN fallback. Used to gate Money and Vault screens.
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { generateRandom } from "../lib/crypto";
import { audit, ACTIONS } from "../lib/audit";
import {
  WEBAUTHN_CHALLENGE_TTL,
  rpIdFromAppUrl,
  parseClientData,
  publicKeyFromAuthData,
  extractAuthDataFromAttestationObject,
  signCountFromAuthData,
  verifyAssertion,
  hashPin,
  type EcJwk,
} from "../lib/webauthn";

export const deviceLockRoutes = new Hono<HonoEnv>();

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "validation_error", issues: result.error.issues },
        400,
      );
    }
  });
}

function originFromEnv(env: HonoEnv["Bindings"], reqUrl: string): string {
  if (env.APP_URL) {
    try {
      return new URL(env.APP_URL).origin;
    } catch {
      /* fall through */
    }
  }
  return new URL(reqUrl).origin;
}

deviceLockRoutes.get("/status", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const db = getDb(c.env);
  const cred = await db
    .select({ id: schema.deviceCredentials.id })
    .from(schema.deviceCredentials)
    .where(eq(schema.deviceCredentials.userId, userId))
    .get();
  const pin = await db
    .select({ userId: schema.devicePins.userId })
    .from(schema.devicePins)
    .where(eq(schema.devicePins.userId, userId))
    .get();
  return c.json({
    webauthn: Boolean(cred),
    pin: Boolean(pin),
    rpId: rpIdFromAppUrl(c.env.APP_URL ?? new URL(c.req.url).origin),
  });
});

async function webauthnOptions(c: import("hono").Context<HonoEnv>) {

  const userId = c.get("userId")!;
  const db = getDb(c.env);
  const user = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!user) return c.json({ error: "not_found" }, 404);

  const challenge = generateRandom(32);
  await c.env.KV.put(`webauthn:challenge:${userId}`, challenge, {
    expirationTtl: WEBAUTHN_CHALLENGE_TTL,
  });

  const existing = await db
    .select({ credentialId: schema.deviceCredentials.credentialId })
    .from(schema.deviceCredentials)
    .where(eq(schema.deviceCredentials.userId, userId));

  const rpId = rpIdFromAppUrl(c.env.APP_URL ?? new URL(c.req.url).origin);
  const purpose = c.req.query("purpose") === "assert" ? "assert" : "register";

  return c.json({
    purpose,
    rp: { id: rpId, name: "Family Vault" },
    user: {
      id: user.id,
      name: user.email,
      displayName: user.name ?? user.email,
    },
    challenge,
    timeout: 60_000,
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      userVerification: "required",
      residentKey: "preferred",
    },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    allowCredentials: existing.map((r) => ({
      type: "public-key",
      id: r.credentialId,
    })),
  });
}

deviceLockRoutes.on(
  ["GET", "POST"],
  "/webauthn/options",
  requireSession,
  (c) => webauthnOptions(c),
);

const registerSchema = z
  .object({
    id: z.string().min(1),
    rawId: z.string().min(1),
    clientDataJSON: z.string().min(1),
    authenticatorData: z.string().min(1).optional(),
    attestationObject: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.authenticatorData || v.attestationObject), {
    message: "authenticatorData or attestationObject is required",
  });

deviceLockRoutes.post(
  "/webauthn/register",
  requireSession,
  zv(registerSchema),
  async (c) => {
    const userId = c.get("userId")!;
    const data = c.req.valid("json");
    const challenge = await c.env.KV.get(`webauthn:challenge:${userId}`);
    if (!challenge) return c.json({ error: "challenge_expired" }, 400);

    const origin = originFromEnv(c.env, c.req.url);
    try {
      parseClientData(data.clientDataJSON, {
        type: "webauthn.create",
        challenge,
        origin,
      });
    } catch {
      return c.json({ error: "invalid_client_data" }, 400);
    }

    let parsed: ReturnType<typeof publicKeyFromAuthData>;
    try {
      const authData =
        data.authenticatorData ??
        extractAuthDataFromAttestationObject(data.attestationObject!);
      parsed = publicKeyFromAuthData(authData);
    } catch {
      return c.json({ error: "invalid_authenticator_data" }, 400);
    }

    const db = getDb(c.env);
    await db.insert(schema.deviceCredentials).values({
      id: crypto.randomUUID(),
      userId,
      credentialId: parsed.credentialId,
      publicKeyJwk: JSON.stringify(parsed.jwk),
      counter: parsed.signCount,
    });
    await c.env.KV.delete(`webauthn:challenge:${userId}`);
    await audit(c, {
      actorUserId: userId,
      action: ACTIONS.DEVICE_LOCK_REGISTERED,
      meta: { method: "webauthn" },
    });
    return c.json({ ok: true }, 201);
  },
);

const assertSchema = z.object({
  id: z.string().min(1),
  clientDataJSON: z.string().min(1),
  authenticatorData: z.string().min(1),
  signature: z.string().min(1),
});

deviceLockRoutes.post(
  "/webauthn/assert",
  requireSession,
  zv(assertSchema),
  async (c) => {
    const userId = c.get("userId")!;
    const data = c.req.valid("json");
    const challenge = await c.env.KV.get(`webauthn:challenge:${userId}`);
    if (!challenge) return c.json({ error: "challenge_expired" }, 400);

    const origin = originFromEnv(c.env, c.req.url);
    try {
      parseClientData(data.clientDataJSON, {
        type: "webauthn.get",
        challenge,
        origin,
      });
    } catch {
      return c.json({ error: "invalid_client_data" }, 400);
    }

    const db = getDb(c.env);
    const row = await db
      .select()
      .from(schema.deviceCredentials)
      .where(eq(schema.deviceCredentials.credentialId, data.id))
      .get();
    if (!row || row.userId !== userId) {
      return c.json({ error: "unknown_credential" }, 404);
    }

    const jwk = JSON.parse(row.publicKeyJwk) as EcJwk;
    const ok = await verifyAssertion({
      jwk,
      authenticatorData: data.authenticatorData,
      clientDataJSON: data.clientDataJSON,
      signature: data.signature,
    });
    if (!ok) return c.json({ error: "assertion_failed" }, 401);

    const signCount = signCountFromAuthData(data.authenticatorData);
    if (signCount < row.counter) {
      return c.json({ error: "cloned_authenticator" }, 401);
    }
    await db
      .update(schema.deviceCredentials)
      .set({ counter: signCount })
      .where(eq(schema.deviceCredentials.id, row.id));

    await c.env.KV.delete(`webauthn:challenge:${userId}`);
    await audit(c, {
      actorUserId: userId,
      action: ACTIONS.DEVICE_LOCK_UNLOCKED,
      meta: { method: "webauthn" },
    });
    return c.json({ ok: true });
  },
);

const pinSchema = z.object({
  pin: z.string().regex(/^\d{6}$/, "PIN must be 6 digits"),
});

deviceLockRoutes.post("/pin/setup", requireSession, zv(pinSchema), async (c) => {
  const userId = c.get("userId")!;
  const { pin } = c.req.valid("json");
  const salt = generateRandom(16);
  const pinHash = await hashPin(pin, salt);
  const db = getDb(c.env);
  const existing = await db
    .select({ userId: schema.devicePins.userId })
    .from(schema.devicePins)
    .where(eq(schema.devicePins.userId, userId))
    .get();
  if (existing) {
    await db
      .update(schema.devicePins)
      .set({ pinHash, salt })
      .where(eq(schema.devicePins.userId, userId));
  } else {
    await db.insert(schema.devicePins).values({ userId, pinHash, salt });
  }
  await audit(c, {
    actorUserId: userId,
    action: ACTIONS.DEVICE_LOCK_REGISTERED,
    meta: { method: "pin" },
  });
  return c.json({ ok: true });
});

deviceLockRoutes.post("/pin/verify", requireSession, zv(pinSchema), async (c) => {
  const userId = c.get("userId")!;
  const { pin } = c.req.valid("json");
  const db = getDb(c.env);
  const row = await db
    .select()
    .from(schema.devicePins)
    .where(eq(schema.devicePins.userId, userId))
    .get();
  if (!row) return c.json({ error: "pin_not_set" }, 404);
  const pinHash = await hashPin(pin, row.salt);
  if (pinHash !== row.pinHash) return c.json({ error: "pin_mismatch" }, 401);
  await audit(c, {
    actorUserId: userId,
    action: ACTIONS.DEVICE_LOCK_UNLOCKED,
    meta: { method: "pin" },
  });
  return c.json({ ok: true });
});
