/**
 * VaultContext — manages the unlocked VaultSession for the current browser session.
 *
 * Crypto invariant: The VDK (Vault Data Key) lives ONLY in memory as a CryptoKey.
 * It is NEVER serialized or sent to the server. The server stores only wrapped copies.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  VaultSession,
  deriveKekFromPassphrase,
  generateVdk,
  randomBase64Url,
  unwrapKey,
  wrapKey,
} from "../lib/vaultCrypto";
import { api } from "../lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VaultState = "unchecked" | "not_initialized" | "locked" | "unlocked";

interface VaultContextValue {
  state: VaultState;
  session: VaultSession | null;
  vaultId: string | null;
  /** Initialize the vault for the first time. Creates VDK, wraps with passphrase KEK. */
  initVault: (familyId: string, passphrase: string) => Promise<void>;
  /** Unlock an already-initialized vault using the passphrase. */
  unlock: (familyId: string, passphrase: string) => Promise<void>;
  /** Lock the vault (clears the session key from memory). */
  lock: () => void;
  /** Update state to "not_initialized" or "locked" after checking the server. */
  setVaultState: (s: VaultState, vaultId?: string) => void;
  /** Last error from init/unlock operations. */
  error: string | null;
  clearError: () => void;
  isWorking: boolean;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const VaultCtx = createContext<VaultContextValue | undefined>(undefined);

export function VaultProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VaultState>("unchecked");
  const [session, setSession] = useState<VaultSession | null>(null);
  const [vaultId, setVaultId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const setVaultState = useCallback((s: VaultState, vid?: string) => {
    setState(s);
    if (vid !== undefined) setVaultId(vid);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  /**
   * Initialize vault for the first time.
   * Flow: generate VDK → derive KEK from passphrase → wrap VDK under KEK
   *       → POST /vault/init → PUT /vault/keys → unlock in memory.
   */
  const initVault = useCallback(async (familyId: string, passphrase: string) => {
    setIsWorking(true);
    setError(null);
    try {
      // 1. Create the vault container on the server
      const initRes = await api<{ vault: { id: string } }>(
        `/vault/init?familyId=${encodeURIComponent(familyId)}`,
        { method: "POST" },
      );
      const newVaultId = initRes.vault.id;

      // 2. Generate VDK client-side
      const vdk = await generateVdk();

      // 3. Derive KEK from passphrase
      const kdfSalt = randomBase64Url(32);
      const kek = await deriveKekFromPassphrase(passphrase, kdfSalt);

      // 4. Wrap VDK under KEK
      const { wrappedDek, wrapIv } = await wrapKey(kek, vdk);

      // 5. Store wrapped key on the server
      await api("/vault/keys", {
        method: "PUT",
        body: JSON.stringify({
          familyId,
          wrapMethod: "passphrase",
          wrappedDek,
          wrapIv,
          kdfSalt,
          kdfParams: JSON.stringify({ alg: "PBKDF2-SHA256", iter: 600_000 }),
        }),
      });

      // 6. Create and store the unlocked session
      const vs = await VaultSession.create(vdk);
      setSession(vs);
      setVaultId(newVaultId);
      setState("unlocked");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Vault initialization failed";
      setError(msg);
      throw e;
    } finally {
      setIsWorking(false);
    }
  }, []);

  /**
   * Unlock an already-initialized vault.
   * Flow: GET /vault/keys → find passphrase key → derive KEK → unwrap VDK → session.
   */
  const unlock = useCallback(async (familyId: string, passphrase: string) => {
    setIsWorking(true);
    setError(null);
    try {
      // 1. Fetch wrapped keys for this user
      const keysRes = await api<{
        keys: {
          wrappedDek: string;
          wrapIv: string | null;
          kdfSalt: string | null;
          wrapMethod: string;
        }[];
      }>(`/vault/keys?familyId=${encodeURIComponent(familyId)}`);

      const passphraseKey = keysRes.keys.find((k) => k.wrapMethod === "passphrase");
      if (!passphraseKey) {
        throw new Error("No passphrase key found. Please contact your family admin.");
      }

      if (!passphraseKey.kdfSalt || !passphraseKey.wrapIv) {
        throw new Error("Key data is incomplete. Cannot unlock vault.");
      }

      // 2. Derive KEK from passphrase using stored salt
      const kek = await deriveKekFromPassphrase(passphrase, passphraseKey.kdfSalt);

      // 3. Unwrap VDK
      const vdk = await unwrapKey(kek, passphraseKey.wrappedDek, passphraseKey.wrapIv);

      // 4. Create session
      const vs = await VaultSession.create(vdk);
      setSession(vs);
      setState("unlocked");
    } catch (e) {
      // Distinguish crypto errors (wrong passphrase) from network errors
      const msg =
        e instanceof Error
          ? e.message.includes("decrypt") || e.message.includes("OperationError")
            ? "Incorrect passphrase. Please try again."
            : e.message
          : "Failed to unlock vault";
      setError(msg);
      throw new Error(msg, { cause: e });
    } finally {
      setIsWorking(false);
    }
  }, []);

  const lock = useCallback(() => {
    setSession(null);
    setState("locked");
    setError(null);
  }, []);

  const value = useMemo<VaultContextValue>(
    () => ({
      state,
      session,
      vaultId,
      initVault,
      unlock,
      lock,
      setVaultState,
      error,
      clearError,
      isWorking,
    }),
    [state, session, vaultId, initVault, unlock, lock, setVaultState, error, clearError, isWorking],
  );

  return <VaultCtx value={value}>{children}</VaultCtx>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useVault(): VaultContextValue {
  const ctx = useContext(VaultCtx);
  if (!ctx) throw new Error("useVault must be used within <VaultProvider>");
  return ctx;
}
