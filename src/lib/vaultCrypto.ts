// vaultCrypto.ts — Family Vault client-side cryptography
// Runs in the BROWSER (React 19 PWA). Uses only the Web Crypto API (window.crypto.subtle).
// The server stores only opaque blobs; this is the ONLY place decryption happens.

const ALGO = 'AES-GCM' as const
const KEY_USAGE_ENCRYPT: KeyUsage[] = ['encrypt', 'decrypt']
const IV_BYTES = 12
const VDK_BITS = 256
const PBKDF2_ITERS = 600_000

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export interface EncryptedBlob {
  cipher: string // base64url
  iv: string     // base64url
}

// VaultSession is declared below as a class — the interface above is the shape reference.

// ---------------------------------------------------------------------------
// BASE64URL HELPERS
// ---------------------------------------------------------------------------

function toBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// Returns Uint8Array backed by a plain ArrayBuffer (never SharedArrayBuffer).
// Typed as Uint8Array<ArrayBuffer> so callers satisfy BufferSource without casts.
function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  // Restore standard base64 padding
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4
  if (pad === 2) b64 += '=='
  else if (pad === 3) b64 += '='
  const binary = atob(b64)
  // Explicit new ArrayBuffer() guarantees the backing type is ArrayBuffer
  const buf: ArrayBuffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buf) as Uint8Array<ArrayBuffer>
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// ---------------------------------------------------------------------------
// RANDOM
// ---------------------------------------------------------------------------

export function randomBase64Url(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return toBase64Url(buf.buffer)
}

// ---------------------------------------------------------------------------
// KEY IMPORT HELPER
// ---------------------------------------------------------------------------

// `extractable` defaults to true because the VDK must be exportable: deriveBlindKey()
// exports it as HKDF input material, and wrapKey() exports it to re-wrap for another
// member. Importing the unwrapped VDK as non-extractable made unlock throw
// InvalidAccessError on every correct passphrase. Pass false only for keys that are
// never re-derived from.
async function importAesKey(
  raw: ArrayBuffer,
  usages: KeyUsage[],
  extractable = true,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: ALGO, length: VDK_BITS },
    extractable,
    usages,
  )
}

// ---------------------------------------------------------------------------
// ENCRYPTION / DECRYPTION
// ---------------------------------------------------------------------------

export async function encryptBlob(key: CryptoKey, plaintext: string): Promise<EncryptedBlob> {
  const iv = new Uint8Array(IV_BYTES)
  crypto.getRandomValues(iv)

  const encoded = new TextEncoder().encode(plaintext)
  const cipherBuf = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    encoded,
  )

  return {
    cipher: toBase64Url(cipherBuf),
    iv: toBase64Url(iv.buffer),
  }
}

export async function decryptBlob(key: CryptoKey, blob: EncryptedBlob): Promise<string> {
  const iv = fromBase64Url(blob.iv)
  const cipherBytes = fromBase64Url(blob.cipher)

  const plainBuf = await crypto.subtle.decrypt(
    { name: ALGO, iv },
    key,
    cipherBytes,
  )

  return new TextDecoder().decode(plainBuf)
}

// ---------------------------------------------------------------------------
// KEY DERIVATION — PASSPHRASE PATH (PBKDF2)
// ---------------------------------------------------------------------------

export async function deriveKekFromPassphrase(passphrase: string, salt: string): Promise<CryptoKey> {
  const saltBytes = fromBase64Url(salt)
  const passphraseBytes = new TextEncoder().encode(passphrase)

  const baseKey = await crypto.subtle.importKey(
    'raw',
    passphraseBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: ALGO, length: VDK_BITS },
    false,
    KEY_USAGE_ENCRYPT,
  )
}

// ---------------------------------------------------------------------------
// KEY WRAP / UNWRAP (AES-GCM)
// ---------------------------------------------------------------------------

export async function wrapKey(
  kek: CryptoKey,
  keyToWrap: CryptoKey,
): Promise<{ wrappedDek: string; wrapIv: string }> {
  // Export the key to wrap as raw bytes
  const rawKey = await crypto.subtle.exportKey('raw', keyToWrap)

  // Encrypt the raw key bytes under kek using AES-GCM
  const iv = new Uint8Array(IV_BYTES)
  crypto.getRandomValues(iv)

  const wrappedBuf = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    kek,
    rawKey,
  )

  return {
    wrappedDek: toBase64Url(wrappedBuf),
    wrapIv: toBase64Url(iv.buffer),
  }
}

export async function unwrapKey(
  kek: CryptoKey,
  wrappedDek: string,
  wrapIv: string,
): Promise<CryptoKey> {
  const iv = fromBase64Url(wrapIv)
  const wrappedBytes = fromBase64Url(wrappedDek)

  const rawKey = await crypto.subtle.decrypt(
    { name: ALGO, iv },
    kek,
    wrappedBytes,
  )

  return importAesKey(rawKey, KEY_USAGE_ENCRYPT)
}

// ---------------------------------------------------------------------------
// VDK GENERATION
// ---------------------------------------------------------------------------

export async function generateVdk(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: ALGO, length: VDK_BITS },
    true,
    KEY_USAGE_ENCRYPT,
  ) as Promise<CryptoKey>
}

// ---------------------------------------------------------------------------
// BLIND INDEX KEY (HKDF-SHA256 from VDK)
// ---------------------------------------------------------------------------

export async function deriveBlindKey(vdk: CryptoKey): Promise<CryptoKey> {
  const rawVdk = await crypto.subtle.exportKey('raw', vdk)

  // Import as HKDF key material
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    rawVdk,
    { name: 'HKDF' },
    false,
    ['deriveKey'],
  )

  const infoBytes = new TextEncoder().encode('blind-index-key')

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0), // empty salt as specified
      info: infoBytes,
    },
    hkdfKey,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  )
}

// ---------------------------------------------------------------------------
// BLIND TAG COMPUTATION
// ---------------------------------------------------------------------------

export async function computeBlindTag(blindKey: CryptoKey, value: string): Promise<string> {
  const normalized = new TextEncoder().encode(value.toLowerCase().trim())
  const sigBuf = await crypto.subtle.sign('HMAC', blindKey, normalized)
  return toBase64Url(sigBuf)
}

export async function computeBlindTags(blindKey: CryptoKey, value: string): Promise<string[]> {
  const normalized = value.toLowerCase().trim()

  // Build trigrams
  const seen = new Set<string>()
  const tokens: string[] = []

  // Add trigrams
  for (let i = 0; i <= normalized.length - 3; i++) {
    const tri = normalized.slice(i, i + 3)
    if (!seen.has(tri)) {
      seen.add(tri)
      tokens.push(tri)
    }
  }

  // Add full value if not already present (and non-empty)
  if (normalized.length > 0 && !seen.has(normalized)) {
    tokens.push(normalized)
  }

  // Limit to 50 tags to prevent abuse
  const limited = tokens.slice(0, 50)

  // Compute HMAC tag for each token in parallel
  return Promise.all(limited.map((token) => computeBlindTag(blindKey, token)))
}

// ---------------------------------------------------------------------------
// ECDH GRANT FLOW
// ---------------------------------------------------------------------------

export async function generateEcdhKeyPair(): Promise<{ publicKey: string; privateKey: CryptoKey }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // private key is non-extractable
    ['deriveKey', 'deriveBits'],
  ) as CryptoKeyPair

  const spkiBuf = await crypto.subtle.exportKey('spki', keyPair.publicKey)

  return {
    publicKey: toBase64Url(spkiBuf),
    privateKey: keyPair.privateKey,
  }
}

export async function wrapEcdhPrivateKey(
  kek: CryptoKey,
  privateKey: CryptoKey,
): Promise<{ wrappedPrivkey: string; privkeyIv: string }> {
  const pkcs8Buf = await crypto.subtle.exportKey('pkcs8', privateKey)

  const iv = new Uint8Array(IV_BYTES)
  crypto.getRandomValues(iv)

  const wrappedBuf = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    kek,
    pkcs8Buf,
  )

  return {
    wrappedPrivkey: toBase64Url(wrappedBuf),
    privkeyIv: toBase64Url(iv.buffer),
  }
}

export async function deriveGrantKek(
  myPrivateKey: CryptoKey,
  recipientPublicKeySpki: string,
): Promise<CryptoKey> {
  const spkiBytes = fromBase64Url(recipientPublicKeySpki)

  const recipientPublicKey = await crypto.subtle.importKey(
    'spki',
    spkiBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )

  // Derive raw shared secret bits (P-256 → 256 bits)
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: recipientPublicKey },
    myPrivateKey,
    256,
  )

  // Import shared secret as HKDF key material
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedBits,
    { name: 'HKDF' },
    false,
    ['deriveKey'],
  )

  const infoBytes = new TextEncoder().encode('vault-grant-kek')

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0), // empty salt as specified
      info: infoBytes,
    },
    hkdfKey,
    { name: ALGO, length: VDK_BITS },
    false,
    KEY_USAGE_ENCRYPT,
  )
}

// ---------------------------------------------------------------------------
// VAULT SESSION
// ---------------------------------------------------------------------------

export class VaultSession {
  readonly vdk: CryptoKey
  readonly blindKey: CryptoKey

  private constructor(vdk: CryptoKey, blindKey: CryptoKey) {
    this.vdk = vdk
    this.blindKey = blindKey
  }

  static async create(vdk: CryptoKey): Promise<VaultSession> {
    const blindKey = await deriveBlindKey(vdk)
    return new VaultSession(vdk, blindKey)
  }

  async encrypt(plaintext: string): Promise<EncryptedBlob> {
    return encryptBlob(this.vdk, plaintext)
  }

  async decrypt(blob: EncryptedBlob): Promise<string> {
    return decryptBlob(this.vdk, blob)
  }

  // Semantic alias — same implementation, distinct name allows future per-item subkey logic
  async encryptSecret(value: string): Promise<EncryptedBlob> {
    return encryptBlob(this.vdk, value)
  }

  async decryptSecret(blob: EncryptedBlob): Promise<string> {
    return decryptBlob(this.vdk, blob)
  }

  async computeBlindTag(value: string): Promise<string> {
    return computeBlindTag(this.blindKey, value)
  }

  async computeBlindTags(value: string): Promise<string[]> {
    return computeBlindTags(this.blindKey, value)
  }
}
