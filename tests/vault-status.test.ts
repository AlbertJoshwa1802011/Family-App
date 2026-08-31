/**
 * GET /api/vault/status — the decision that drives setup vs unlock vs no-access.
 *
 * Regression: status used to report family-level initialization only, so a member
 * with no wrapped key was shown an unlock prompt for a passphrase they had never
 * set and could not have set.
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { createTestEnv, seedActor, seedFamily, seedUser } from "./helpers/testEnv";

function statusUrl(familyId: string) {
  return `/api/vault/status?familyId=${encodeURIComponent(familyId)}`;
}

interface StatusBody {
  initialized: boolean;
  hasKey: boolean;
  vaultId?: string;
}

function seedVault(sqlite: import("node:sqlite").DatabaseSync, familyId: string): string {
  const vaultId = crypto.randomUUID();
  sqlite
    .prepare("INSERT INTO vaults (id, family_id) VALUES (?, ?)")
    .run(vaultId, familyId);
  return vaultId;
}

function seedVaultKey(
  sqlite: import("node:sqlite").DatabaseSync,
  vaultId: string,
  memberId: string | null,
  isEscrow = false,
) {
  sqlite
    .prepare(
      `INSERT INTO vault_keys (id, vault_id, member_id, is_escrow, wrap_method, wrapped_dek, wrap_iv, kdf_salt)
       VALUES (?, ?, ?, ?, 'passphrase', 'wrapped', 'iv', 'salt')`,
    )
    .run(crypto.randomUUID(), vaultId, memberId, isEscrow ? 1 : 0);
}

describe("/api/vault/status", () => {
  it("reports not-initialized when the family has no vault", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");

    const res = await app.request(statusUrl(family.id), { headers: { Cookie: actor.cookie } }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as StatusBody;
    expect(body.initialized).toBe(false);
    expect(body.hasKey).toBe(false);
  });

  it("reports hasKey=true for the member who set the passphrase", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const vaultId = seedVault(sqlite, family.id);
    seedVaultKey(sqlite, vaultId, actor.memberId);

    const res = await app.request(statusUrl(family.id), { headers: { Cookie: actor.cookie } }, env);
    const body = (await res.json()) as StatusBody;
    expect(body.initialized).toBe(true);
    expect(body.hasKey).toBe(true);
    expect(body.vaultId).toBe(vaultId);
  });

  it("reports hasKey=false for a member who holds no wrapped key", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const creator = seedActor(sqlite, family.id, "owner");
    const other = seedActor(sqlite, family.id, "member");
    const vaultId = seedVault(sqlite, family.id);
    // Only the creator gets a key.
    seedVaultKey(sqlite, vaultId, creator.memberId);

    const res = await app.request(statusUrl(family.id), { headers: { Cookie: other.cookie } }, env);
    const body = (await res.json()) as StatusBody;
    expect(body.initialized).toBe(true);
    // The whole point: this member must NOT be sent to the unlock prompt.
    expect(body.hasKey).toBe(false);
  });

  it("does not count an escrow key as the member's own key", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "member");
    const vaultId = seedVault(sqlite, family.id);
    seedVaultKey(sqlite, vaultId, null, true); // escrow row, member_id NULL

    const res = await app.request(statusUrl(family.id), { headers: { Cookie: actor.cookie } }, env);
    const body = (await res.json()) as StatusBody;
    expect(body.hasKey).toBe(false);
  });

  // A non-member gets 404, not 403: requireFamilyMember deliberately does not
  // leak whether a family exists. 403 is reserved for insufficient role.
  it("hides the family from a non-member", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    seedVault(sqlite, family.id);

    const outsiderFamily = seedFamily(sqlite, seedUser(sqlite).id, "Other Family");
    const outsider = seedActor(sqlite, outsiderFamily.id, "owner");

    const res = await app.request(statusUrl(family.id), { headers: { Cookie: outsider.cookie } }, env);
    expect(res.status).toBe(404);
  });

  it("requires familyId", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");

    const res = await app.request("/api/vault/status", { headers: { Cookie: actor.cookie } }, env);
    expect(res.status).toBe(400);
  });
});
