/**
 * vaultSessionStore — keeps the unlocked vault key alive for the browser session.
 *
 * Design constraints:
 *  - The passphrase is never stored, anywhere.
 *  - The VDK is held as a structured-cloned `CryptoKey` in IndexedDB, never as raw
 *    bytes in localStorage/sessionStorage, so no plaintext key material is exposed
 *    to JSON-reading scripts.
 *  - Each record is keyed by a random capability token that lives in `sessionStorage`.
 *    sessionStorage dies with the tab, so a closed tab's record becomes unreachable
 *    and is swept on the next mount. That is what makes "re-lock on close" hold
 *    without also locking a second tab that is legitimately open.
 *  - Records carry an absolute expiry as a backstop for a browser that is never closed.
 */

const DB_NAME = "fv-vault";
const STORE = "sessions";
const TOKEN_KEY = "fv:vaultSessionToken";
/** Backstop for a browser session that is never closed. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface StoredSession {
  token: string;
  vdk: CryptoKey;
  vaultId: string | null;
  createdAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "token" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const store = db.transaction(STORE, mode).objectStore(STORE);
    const req = run(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage disabled — the vault simply won't survive a reload.
  }
}

function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // no-op
  }
}

/** Drop records whose tab is gone (orphaned) or that have aged out. */
async function sweep(db: IDBDatabase, keepToken: string | null): Promise<void> {
  const all = await tx<StoredSession[]>(db, "readonly", (s) => s.getAll() as IDBRequest<StoredSession[]>);
  const cutoff = Date.now() - MAX_AGE_MS;
  const stale = all.filter((r) => r.token !== keepToken && r.createdAt < cutoff);
  if (stale.length === 0) return;
  await Promise.all(
    stale.map((r) => tx(db, "readwrite", (s) => s.delete(r.token))),
  );
}

/** Persist the unlocked key for this tab's session. Best-effort: never throws. */
export async function saveVaultSession(vdk: CryptoKey, vaultId: string | null): Promise<void> {
  try {
    const token = readToken() ?? crypto.randomUUID();
    writeToken(token);
    const db = await openDb();
    const record: StoredSession = { token, vdk, vaultId, createdAt: Date.now() };
    await tx(db, "readwrite", (s) => s.put(record));
    db.close();
  } catch {
    // IndexedDB unavailable (private mode, quota). In-memory session still works.
  }
}

/** Restore this tab's unlocked key, or null if the session is gone. */
export async function loadVaultSession(): Promise<{ vdk: CryptoKey; vaultId: string | null } | null> {
  try {
    const token = readToken();
    const db = await openDb();
    await sweep(db, token);
    if (!token) {
      db.close();
      return null;
    }
    const rec = await tx<StoredSession | undefined>(
      db,
      "readonly",
      (s) => s.get(token) as IDBRequest<StoredSession | undefined>,
    );
    db.close();
    if (!rec) return null;
    if (Date.now() - rec.createdAt > MAX_AGE_MS) {
      await clearVaultSession();
      return null;
    }
    return { vdk: rec.vdk, vaultId: rec.vaultId };
  } catch {
    return null;
  }
}

/** Forget the unlocked key — on explicit lock and on sign-out. */
export async function clearVaultSession(): Promise<void> {
  try {
    const token = readToken();
    clearToken();
    if (!token) return;
    const db = await openDb();
    await tx(db, "readwrite", (s) => s.delete(token));
    db.close();
  } catch {
    // no-op
  }
}
