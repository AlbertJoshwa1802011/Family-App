import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq, inArray, or } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { audit, ACTIONS } from "../lib/audit";

export const vaultRoutes = new Hono<HonoEnv>();

// ── Validation helper ─────────────────────────────────────────────────────────

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const vaultKeySchema = z.object({
  familyId: z.string().min(1),
  wrapMethod: z.enum(["passkey", "passphrase", "recovery_code", "ecdh_grant"]),
  wrappedDek: z.string().min(1),
  wrapIv: z.string().optional(),
  kdfSalt: z.string().optional(),
  kdfParams: z.string().optional(),
  grantEphemeralPubkey: z.string().optional(),
  isEscrow: z.boolean().optional(),
});

const memberKeySchema = z.object({
  familyId: z.string().min(1),
  publicKey: z.string().min(1),
  wrappedPrivkey: z.string().min(1),
  privkeyIv: z.string().min(1),
});

const createItemSchema = z.object({
  familyId: z.string().min(1),
  type: z.enum(["login", "wifi", "bank", "card", "pin", "note", "totp_seed", "other"]),
  visibility: z.enum(["family", "private"]),
  cipher: z.string().min(1),
  iv: z.string().min(1),
  secretCipher: z.string().optional(),
  secretIv: z.string().optional(),
  escrowExcluded: z.boolean().optional(),
  voiceReadable: z.boolean().optional(),
  blindTitle: z.string().optional(),
  blindAccount: z.string().optional(),
  blindIssuer: z.string().optional(),
});

const patchItemSchema = z.object({
  cipher: z.string().optional(),
  iv: z.string().optional(),
  secretCipher: z.string().optional(),
  secretIv: z.string().optional(),
  blindTitle: z.string().optional(),
  blindAccount: z.string().optional(),
  blindIssuer: z.string().optional(),
  visibility: z.enum(["family", "private"]).optional(),
  escrowExcluded: z.boolean().optional(),
  voiceReadable: z.boolean().optional(),
  status: z.enum(["active", "trashed"]).optional(),
});

const tagsSchema = z.object({
  tags: z.array(z.string().min(1)).min(1),
});

const revealSchema = z.object({
  stepUpToken: z.string().optional(),
});

// ── Helper: strip secret fields from item rows ────────────────────────────────

function stripSecrets<T extends { secretCipher?: unknown; secretIv?: unknown }>(
  item: T,
): Omit<T, "secretCipher" | "secretIv"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { secretCipher: _sc, secretIv: _si, ...rest } = item;
  return rest;
}

// ── 1. POST /vault/init?familyId=xxx ─────────────────────────────────────────

vaultRoutes.post("/init", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId, "owner");
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);

  const existing = await db
    .select()
    .from(schema.vaults)
    .where(eq(schema.vaults.familyId, familyId))
    .get();

  if (existing) return c.json({ error: "already_initialized" }, 409);

  const id = crypto.randomUUID();

  await db.insert(schema.vaults).values({
    id,
    familyId,
    schemeVersion: 1,
    kdfParams: '{"alg":"PBKDF2-SHA256","iter":600000}',
  });

  const vault = await db
    .select()
    .from(schema.vaults)
    .where(eq(schema.vaults.id, id))
    .get();

  return c.json({ vault }, 201);
});

// ── 2. GET /vault/status?familyId=xxx ────────────────────────────────────────

vaultRoutes.get("/status", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);

  const vault = await db
    .select()
    .from(schema.vaults)
    .where(eq(schema.vaults.familyId, familyId))
    .get();

  if (!vault) return c.json({ initialized: false, hasKey: false });

  // Whether the *family* has a vault says nothing about whether THIS member can
  // open it. Without this per-member check the client showed an unlock prompt to
  // members who have no wrapped key, asking for a passphrase they never set and
  // could never satisfy. `hasKey` is what decides setup vs unlock vs no-access.
  const myKey = await db
    .select({ id: schema.vaultKeys.id })
    .from(schema.vaultKeys)
    .where(
      and(
        eq(schema.vaultKeys.vaultId, vault.id),
        eq(schema.vaultKeys.memberId, membership.id),
      ),
    )
    .get();

  return c.json({
    initialized: true,
    hasKey: Boolean(myKey),
    vaultId: vault.id,
  });
});

// ── 3. GET /vault/keys?familyId=xxx ──────────────────────────────────────────

vaultRoutes.get("/keys", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);

  const vault = await db
    .select()
    .from(schema.vaults)
    .where(eq(schema.vaults.familyId, familyId))
    .get();

  if (!vault) return c.json({ error: "not_found" }, 404);

  const myMemberId = membership.id;

  const keys = await db
    .select()
    .from(schema.vaultKeys)
    .where(
      and(
        eq(schema.vaultKeys.vaultId, vault.id),
        or(
          eq(schema.vaultKeys.memberId, myMemberId),
          eq(schema.vaultKeys.isEscrow, true),
        ),
      ),
    );

  return c.json({ keys });
});

// ── 4. PUT /vault/keys ────────────────────────────────────────────────────────

vaultRoutes.put("/keys", requireSession, zv(vaultKeySchema), async (c) => {
  const body = c.req.valid("json");

  const membership = await requireFamilyMember(c, body.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);

  const vault = await db
    .select()
    .from(schema.vaults)
    .where(eq(schema.vaults.familyId, body.familyId))
    .get();

  if (!vault) return c.json({ error: "not_found" }, 404);

  const myMemberId = membership.id;
  const id = crypto.randomUUID();

  await db
    .insert(schema.vaultKeys)
    .values({
      id,
      vaultId: vault.id,
      memberId: myMemberId,
      isEscrow: body.isEscrow ?? false,
      wrapMethod: body.wrapMethod,
      wrappedDek: body.wrappedDek,
      wrapIv: body.wrapIv,
      kdfSalt: body.kdfSalt,
      kdfParams: body.kdfParams,
      grantEphemeralPubkey: body.grantEphemeralPubkey,
    })
    .onConflictDoUpdate({
      target: [schema.vaultKeys.vaultId, schema.vaultKeys.memberId, schema.vaultKeys.wrapMethod],
      set: {
        wrappedDek: body.wrappedDek,
        wrapIv: body.wrapIv,
        kdfSalt: body.kdfSalt,
        kdfParams: body.kdfParams,
        grantEphemeralPubkey: body.grantEphemeralPubkey,
      },
    });

  const key = await db
    .select()
    .from(schema.vaultKeys)
    .where(
      and(
        eq(schema.vaultKeys.vaultId, vault.id),
        eq(schema.vaultKeys.memberId, myMemberId),
        eq(schema.vaultKeys.wrapMethod, body.wrapMethod),
      ),
    )
    .get();

  return c.json({ key });
});

// ── 5. GET /vault/member-keys?familyId=xxx&userId=xxx ────────────────────────

vaultRoutes.get("/member-keys", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  const targetUserId = c.req.query("userId");

  if (!familyId) return c.json({ error: "familyId query param required" }, 400);
  if (!targetUserId) return c.json({ error: "userId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);

  // Find the familyMember row for the target user in this family
  const targetMember = await db
    .select()
    .from(schema.familyMembers)
    .where(
      and(
        eq(schema.familyMembers.familyId, familyId),
        eq(schema.familyMembers.userId, targetUserId),
        eq(schema.familyMembers.status, "active"),
      ),
    )
    .get();

  if (!targetMember) return c.json({ error: "not_found" }, 404);

  const memberKey = await db
    .select()
    .from(schema.vaultMemberKeys)
    .where(eq(schema.vaultMemberKeys.memberId, targetMember.id))
    .get();

  if (!memberKey) return c.json({ error: "not_found" }, 404);

  return c.json({ memberKey });
});

// ── 6. PUT /vault/member-keys ─────────────────────────────────────────────────

vaultRoutes.put("/member-keys", requireSession, zv(memberKeySchema), async (c) => {
  const body = c.req.valid("json");

  const membership = await requireFamilyMember(c, body.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const myMemberId = membership.id;

  await db
    .insert(schema.vaultMemberKeys)
    .values({
      memberId: myMemberId,
      publicKey: body.publicKey,
      wrappedPrivkey: body.wrappedPrivkey,
      privkeyIv: body.privkeyIv,
    })
    .onConflictDoUpdate({
      target: [schema.vaultMemberKeys.memberId],
      set: {
        publicKey: body.publicKey,
        wrappedPrivkey: body.wrappedPrivkey,
        privkeyIv: body.privkeyIv,
      },
    });

  return c.json({ ok: true });
});

// ── 7. GET /vault/items?familyId=xxx ─────────────────────────────────────────

vaultRoutes.get("/items", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);

  const vault = await db
    .select()
    .from(schema.vaults)
    .where(eq(schema.vaults.familyId, familyId))
    .get();

  if (!vault) return c.json({ error: "not_found" }, 404);

  const myMemberId = membership.id;

  const rows = await db
    .select()
    .from(schema.vaultItems)
    .where(
      and(
        eq(schema.vaultItems.vaultId, vault.id),
        eq(schema.vaultItems.status, "active"),
        or(
          eq(schema.vaultItems.visibility, "family"),
          eq(schema.vaultItems.ownerMemberId, myMemberId),
        ),
      ),
    );

  const items = rows.map(stripSecrets);

  return c.json({ items });
});

// ── 8. POST /vault/items ──────────────────────────────────────────────────────

vaultRoutes.post("/items", requireSession, zv(createItemSchema), async (c) => {
  const body = c.req.valid("json");

  const membership = await requireFamilyMember(c, body.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);

  const vault = await db
    .select()
    .from(schema.vaults)
    .where(eq(schema.vaults.familyId, body.familyId))
    .get();

  if (!vault) return c.json({ error: "not_found" }, 404);

  const myMemberId = membership.id;
  const id = crypto.randomUUID();

  await db.insert(schema.vaultItems).values({
    id,
    vaultId: vault.id,
    familyId: body.familyId,
    ownerMemberId: myMemberId,
    type: body.type,
    visibility: body.visibility,
    cipher: body.cipher,
    iv: body.iv,
    secretCipher: body.secretCipher,
    secretIv: body.secretIv,
    escrowExcluded: body.escrowExcluded ?? false,
    voiceReadable: body.voiceReadable ?? false,
    blindTitle: body.blindTitle,
    blindAccount: body.blindAccount,
    blindIssuer: body.blindIssuer,
  });

  await audit(c, {
    familyId: body.familyId,
    action: ACTIONS.VAULT_ITEM_CREATED,
    targetType: "vault_item",
    targetId: id,
    visibility: body.visibility,
  });

  const item = await db
    .select()
    .from(schema.vaultItems)
    .where(eq(schema.vaultItems.id, id))
    .get();

  return c.json({ item: item ? stripSecrets(item) : null }, 201);
});

// ── 9. GET /vault/items/:id ───────────────────────────────────────────────────

vaultRoutes.get("/items/:id", requireSession, async (c) => {
  const { id } = c.req.param();
  const db = getDb(c.env);

  const item = await db
    .select()
    .from(schema.vaultItems)
    .where(eq(schema.vaultItems.id, id))
    .get();

  if (!item) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, item.familyId);
  if (membership instanceof Response) return membership;

  const myMemberId = membership.id;

  if (item.visibility === "private" && item.ownerMemberId !== myMemberId) {
    return c.json({ error: "not_found" }, 404);
  }

  await audit(c, {
    familyId: item.familyId,
    action: ACTIONS.VAULT_ITEM_VIEWED,
    targetType: "vault_item",
    targetId: item.id,
    visibility: item.visibility,
  });

  return c.json({ item: stripSecrets(item) });
});

// ── 10. POST /vault/items/:id/reveal ─────────────────────────────────────────

vaultRoutes.post("/items/:id/reveal", requireSession, zv(revealSchema), async (c) => {
  const { id } = c.req.param();
  const db = getDb(c.env);

  const item = await db
    .select()
    .from(schema.vaultItems)
    .where(eq(schema.vaultItems.id, id))
    .get();

  if (!item) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, item.familyId);
  if (membership instanceof Response) return membership;

  const myMemberId = membership.id;

  if (item.visibility === "private" && item.ownerMemberId !== myMemberId) {
    return c.json({ error: "not_found" }, 404);
  }

  // Step-up assertion accepted as-is (Phase 1 Task #7 will verify)
  // body.stepUpToken is available but not yet validated

  await audit(c, {
    familyId: item.familyId,
    action: ACTIONS.SECRET_REVEALED,
    targetType: "vault_item",
    targetId: item.id,
    visibility: item.visibility,
  });

  return c.json({ secretCipher: item.secretCipher, secretIv: item.secretIv });
});

// ── 11. PATCH /vault/items/:id ────────────────────────────────────────────────

vaultRoutes.patch("/items/:id", requireSession, zv(patchItemSchema), async (c) => {
  const { id } = c.req.param();
  const updates = c.req.valid("json");
  const db = getDb(c.env);

  const item = await db
    .select()
    .from(schema.vaultItems)
    .where(eq(schema.vaultItems.id, id))
    .get();

  if (!item) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, item.familyId);
  if (membership instanceof Response) return membership;

  const myMemberId = membership.id;

  if (item.visibility === "private" && item.ownerMemberId !== myMemberId) {
    return c.json({ error: "not_found" }, 404);
  }

  // Snapshot current cipher into version history
  const versionId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db.insert(schema.vaultItemVersions).values({
    id: versionId,
    itemId: item.id,
    cipher: item.cipher,
    iv: item.iv,
    editedByMemberId: myMemberId,
  });

  // Build the update set
  const set: Partial<typeof schema.vaultItems.$inferInsert> = {
    updatedAt: now,
  };
  if (updates.cipher !== undefined) set.cipher = updates.cipher;
  if (updates.iv !== undefined) set.iv = updates.iv;
  if (updates.secretCipher !== undefined) set.secretCipher = updates.secretCipher;
  if (updates.secretIv !== undefined) set.secretIv = updates.secretIv;
  if (updates.blindTitle !== undefined) set.blindTitle = updates.blindTitle;
  if (updates.blindAccount !== undefined) set.blindAccount = updates.blindAccount;
  if (updates.blindIssuer !== undefined) set.blindIssuer = updates.blindIssuer;
  if (updates.visibility !== undefined) set.visibility = updates.visibility;
  if (updates.escrowExcluded !== undefined) set.escrowExcluded = updates.escrowExcluded;
  if (updates.voiceReadable !== undefined) set.voiceReadable = updates.voiceReadable;
  if (updates.status !== undefined) set.status = updates.status;

  await db.update(schema.vaultItems).set(set).where(eq(schema.vaultItems.id, id));

  await audit(c, {
    familyId: item.familyId,
    action: ACTIONS.VAULT_ITEM_UPDATED,
    targetType: "vault_item",
    targetId: item.id,
    visibility: updates.visibility ?? item.visibility,
  });

  const updated = await db
    .select()
    .from(schema.vaultItems)
    .where(eq(schema.vaultItems.id, id))
    .get();

  return c.json({ item: updated ? stripSecrets(updated) : null });
});

// ── 12. DELETE /vault/items/:id ───────────────────────────────────────────────

vaultRoutes.delete("/items/:id", requireSession, async (c) => {
  const { id } = c.req.param();
  const db = getDb(c.env);

  const item = await db
    .select()
    .from(schema.vaultItems)
    .where(eq(schema.vaultItems.id, id))
    .get();

  if (!item) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, item.familyId);
  if (membership instanceof Response) return membership;

  const myMemberId = membership.id;

  if (item.visibility === "private" && item.ownerMemberId !== myMemberId) {
    return c.json({ error: "not_found" }, 404);
  }

  const now = Math.floor(Date.now() / 1000);

  await db
    .update(schema.vaultItems)
    .set({ status: "trashed", trashedAt: now, updatedAt: now })
    .where(eq(schema.vaultItems.id, id));

  await audit(c, {
    familyId: item.familyId,
    action: ACTIONS.VAULT_ITEM_TRASHED,
    targetType: "vault_item",
    targetId: item.id,
    visibility: item.visibility,
  });

  return c.json({ ok: true });
});

// ── 13. POST /vault/items/:id/tags ────────────────────────────────────────────

vaultRoutes.post("/items/:id/tags", requireSession, zv(tagsSchema), async (c) => {
  const { id } = c.req.param();
  const { tags } = c.req.valid("json");
  const db = getDb(c.env);

  const item = await db
    .select()
    .from(schema.vaultItems)
    .where(eq(schema.vaultItems.id, id))
    .get();

  if (!item) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, item.familyId);
  if (membership instanceof Response) return membership;

  const myMemberId = membership.id;

  if (item.visibility === "private" && item.ownerMemberId !== myMemberId) {
    return c.json({ error: "not_found" }, 404);
  }

  if (tags.length > 0) {
    await db
      .insert(schema.vaultBlindTags)
      .values(tags.map((tag) => ({ itemId: id, tag })))
      .onConflictDoNothing();
  }

  return c.json({ ok: true, count: tags.length });
});

// ── 14. GET /vault/search?familyId=xxx&tags=t1,t2 ────────────────────────────

vaultRoutes.get("/search", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  const tagsParam = c.req.query("tags");

  if (!familyId) return c.json({ error: "familyId query param required" }, 400);
  if (!tagsParam) return c.json({ itemIds: [] });

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);

  const vault = await db
    .select()
    .from(schema.vaults)
    .where(eq(schema.vaults.familyId, familyId))
    .get();

  if (!vault) return c.json({ error: "not_found" }, 404);

  const myMemberId = membership.id;

  // Split and clamp to 20 tags
  const tags = tagsParam
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 20);

  if (tags.length === 0) return c.json({ itemIds: [] });

  // Find itemIds whose blind tags intersect the query tags
  const tagRows = await db
    .selectDistinct({ itemId: schema.vaultBlindTags.itemId })
    .from(schema.vaultBlindTags)
    .where(inArray(schema.vaultBlindTags.tag, tags));

  if (tagRows.length === 0) return c.json({ itemIds: [] });

  const candidateIds = tagRows.map((r) => r.itemId);

  // Filter candidate items by visibility + status within this vault
  const items = await db
    .select({ id: schema.vaultItems.id })
    .from(schema.vaultItems)
    .where(
      and(
        eq(schema.vaultItems.vaultId, vault.id),
        eq(schema.vaultItems.status, "active"),
        inArray(schema.vaultItems.id, candidateIds),
        or(
          eq(schema.vaultItems.visibility, "family"),
          eq(schema.vaultItems.ownerMemberId, myMemberId),
        ),
      ),
    );

  return c.json({ itemIds: items.map((i) => i.id) });
});

// ── 15–18. WebAuthn stubs ─────────────────────────────────────────────────────

vaultRoutes.post("/passkeys/register/start", requireSession, async (c) => {
  return c.json({ error: "not_implemented", phase: 1 }, 501);
});

vaultRoutes.post("/passkeys/register/finish", requireSession, async (c) => {
  return c.json({ error: "not_implemented", phase: 1 }, 501);
});

vaultRoutes.post("/passkeys/authenticate/start", requireSession, async (c) => {
  return c.json({ error: "not_implemented", phase: 1 }, 501);
});

vaultRoutes.post("/passkeys/authenticate/finish", requireSession, async (c) => {
  return c.json({ error: "not_implemented", phase: 1 }, 501);
});
