/**
 * Client-side vault crypto round-trips.
 *
 * These run against Node's WebCrypto, which is the same API surface the browser
 * gives us, so the key-extractability rules that broke unlock are reproduced faithfully.
 */
import { describe, it, expect } from "vitest";
import {
  VaultSession,
  deriveKekFromPassphrase,
  generateVdk,
  randomBase64Url,
  unwrapKey,
  wrapKey,
} from "../src/lib/vaultCrypto";

describe("vault passphrase round-trip", () => {
  it("unlocks a vault with the passphrase it was created with", async () => {
    const passphrase = "correct horse battery staple";
    const salt = randomBase64Url(32);

    // Init: generate the VDK, wrap it under a passphrase-derived KEK.
    const vdk = await generateVdk();
    const kek = await deriveKekFromPassphrase(passphrase, salt);
    const { wrappedDek, wrapIv } = await wrapKey(kek, vdk);

    // Unlock: derive the same KEK and unwrap.
    const kek2 = await deriveKekFromPassphrase(passphrase, salt);
    const unwrapped = await unwrapKey(kek2, wrappedDek, wrapIv);

    // Regression: VaultSession.create derives the blind-index key, which exports
    // the VDK. If unwrapKey returns a non-extractable key this throws and unlock
    // is impossible even with the right passphrase.
    const session = await VaultSession.create(unwrapped);
    expect(session.vdk).toBeDefined();
  });

  it("encrypts and decrypts across a lock/unlock cycle", async () => {
    const passphrase = "a sufficiently long passphrase";
    const salt = randomBase64Url(32);

    const vdk = await generateVdk();
    const kek = await deriveKekFromPassphrase(passphrase, salt);
    const { wrappedDek, wrapIv } = await wrapKey(kek, vdk);

    const before = await VaultSession.create(vdk);
    const blob = await before.encryptSecret("hunter2");

    const kek2 = await deriveKekFromPassphrase(passphrase, salt);
    const after = await VaultSession.create(await unwrapKey(kek2, wrappedDek, wrapIv));

    expect(await after.decryptSecret(blob)).toBe("hunter2");
  });

  it("rejects the wrong passphrase", async () => {
    const salt = randomBase64Url(32);
    const vdk = await generateVdk();
    const kek = await deriveKekFromPassphrase("the right one", salt);
    const { wrappedDek, wrapIv } = await wrapKey(kek, vdk);

    const wrong = await deriveKekFromPassphrase("the wrong one", salt);
    await expect(unwrapKey(wrong, wrappedDek, wrapIv)).rejects.toThrow();
  });

  it("produces a stable blind tag for the same value", async () => {
    const vdk = await generateVdk();
    const session = await VaultSession.create(vdk);
    const a = await session.computeBlindTag("Chase Sapphire");
    const b = await session.computeBlindTag("  chase sapphire  ");
    expect(a).toBe(b);
  });
});
