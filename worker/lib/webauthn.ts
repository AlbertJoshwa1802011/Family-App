/**
 * Minimal WebAuthn (platform authenticator) helpers for Face ID / Touch ID /
 * Windows Hello. ES256 only — that's what every phone ships.
 *
 * We skip attestation verification (this is a first-party family PWA, not a
 * high-assurance IdP). We DO verify the assertion signature over
 * authenticatorData || SHA-256(clientDataJSON).
 */
import { sha256Hex } from "./crypto";

export const WEBAUTHN_CHALLENGE_TTL = 300;

export interface EcJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

export function rpIdFromAppUrl(appUrl: string): string {
  try {
    return new URL(appUrl).hostname;
  } catch {
    return "localhost";
  }
}

export function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "==".slice((s.length * 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Parse clientDataJSON and confirm type + challenge + origin. */
export function parseClientData(
  clientDataJSON: string,
  expected: { type: string; challenge: string; origin: string },
): void {
  const json = new TextDecoder().decode(b64urlDecode(clientDataJSON));
  const data = JSON.parse(json) as {
    type?: string;
    challenge?: string;
    origin?: string;
  };
  if (data.type !== expected.type) {
    throw new Error("clientData type mismatch");
  }
  if (data.challenge !== expected.challenge) {
    throw new Error("clientData challenge mismatch");
  }
  if (data.origin !== expected.origin) {
    throw new Error("clientData origin mismatch");
  }
}

/**
 * Extract the credential public key (ES256 JWK) from authenticatorData
 * produced at registration (AT flag set).
 *
 * Layout: rpIdHash(32) | flags(1) | signCount(4) | AAGUID(16) | credIdLen(2)
 *         | credId | COSE_Key
 */
export function publicKeyFromAuthData(authDataB64: string): {
  credentialId: string;
  jwk: EcJwk;
  signCount: number;
} {
  const data = b64urlDecode(authDataB64);
  if (data.length < 37) throw new Error("authenticatorData too short");
  const flags = data[32]!;
  const signCount = new DataView(data.buffer, data.byteOffset + 33, 4).getUint32(0);
  if ((flags & 0x40) === 0) throw new Error("attested credential data missing");
  const credIdLen = (data[53]! << 8) | data[54]!;
  const credId = data.slice(55, 55 + credIdLen);
  const cose = data.slice(55 + credIdLen);
  const jwk = parseCoseEs256(cose);
  return { credentialId: b64urlEncode(credId), jwk, signCount };
}

/** Parse a COSE_Key map for EC2 P-256 (kty=2, alg=-7, crv=1). */
function parseCoseEs256(bytes: Uint8Array): EcJwk {
  // Walk a tiny CBOR map looking for keys 1, 3, -1, -2, -3.
  let i = 0;
  const major = bytes[i]! >> 5;
  const extra = bytes[i]! & 0x1f;
  if (major !== 5) throw new Error("COSE key is not a map");
  i += 1;
  let count = extra;
  if (extra === 24) {
    count = bytes[i]!;
    i += 1;
  } else if (extra > 23) {
    throw new Error("unsupported COSE map size");
  }
  let x: Uint8Array | null = null;
  let y: Uint8Array | null = null;
  for (let n = 0; n < count; n++) {
    const { value: key, next: afterKey } = readCborInt(bytes, i);
    i = afterKey;
    if (key === -2 || key === -3) {
      const { bytes: b, next } = readCborBytes(bytes, i);
      i = next;
      if (key === -2) x = b;
      else y = b;
    } else {
      i = skipCbor(bytes, i);
    }
  }
  if (!x || !y || x.length !== 32 || y.length !== 32) {
    throw new Error("COSE EC2 coordinates missing");
  }
  return { kty: "EC", crv: "P-256", x: b64urlEncode(x), y: b64urlEncode(y) };
}

function readCborInt(
  bytes: Uint8Array,
  i: number,
): { value: number; next: number } {
  const b = bytes[i]!;
  const major = b >> 5;
  const extra = b & 0x1f;
  let value: number;
  let next = i + 1;
  if (extra < 24) value = extra;
  else if (extra === 24) {
    value = bytes[next]!;
    next += 1;
  } else {
    throw new Error("cbor int too large");
  }
  if (major === 1) value = -1 - value; // negative
  else if (major !== 0) throw new Error("expected cbor int");
  return { value, next };
}

function readCborBytes(
  bytes: Uint8Array,
  i: number,
): { bytes: Uint8Array; next: number } {
  const b = bytes[i]!;
  const major = b >> 5;
  const extra = b & 0x1f;
  if (major !== 2) throw new Error("expected cbor bstr");
  let len = extra;
  let next = i + 1;
  if (extra === 24) {
    len = bytes[next]!;
    next += 1;
  }
  return { bytes: bytes.slice(next, next + len), next: next + len };
}

function skipCbor(bytes: Uint8Array, i: number): number {
  const b = bytes[i]!;
  const major = b >> 5;
  const extra = b & 0x1f;
  let next = i + 1;
  let len = extra;
  if (extra === 24) {
    len = bytes[next]!;
    next += 1;
  } else if (extra === 25) {
    len = (bytes[next]! << 8) | bytes[next + 1]!;
    next += 2;
  } else if (extra > 27) {
    throw new Error("unsupported cbor skip");
  }
  if (major === 2 || major === 3) return next + len; // bstr / tstr
  if (major === 0 || major === 1) return next; // int already consumed extra
  if (major === 7) return next; // simple / bool
  if (major === 4) {
    let n = next;
    for (let k = 0; k < len; k++) n = skipCbor(bytes, n);
    return n;
  }
  if (major === 5) {
    let n = next;
    for (let k = 0; k < len; k++) {
      n = skipCbor(bytes, n);
      n = skipCbor(bytes, n);
    }
    return n;
  }
  throw new Error("unsupported cbor skip");
}

function readCborText(
  bytes: Uint8Array,
  i: number,
): { text: string; next: number } {
  const b = bytes[i]!;
  const major = b >> 5;
  const extra = b & 0x1f;
  if (major !== 3) throw new Error("expected cbor tstr");
  let len = extra;
  let next = i + 1;
  if (extra === 24) {
    len = bytes[next]!;
    next += 1;
  }
  return {
    text: new TextDecoder().decode(bytes.slice(next, next + len)),
    next: next + len,
  };
}

/** Pull authenticatorData out of a WebAuthn attestationObject (CBOR). */
export function extractAuthDataFromAttestationObject(attestationB64: string): string {
  const bytes = b64urlDecode(attestationB64);
  let i = 0;
  const major = bytes[i]! >> 5;
  const extra = bytes[i]! & 0x1f;
  if (major !== 5) throw new Error("attestation is not a map");
  i += 1;
  let count = extra;
  if (extra === 24) {
    count = bytes[i]!;
    i += 1;
  }
  for (let n = 0; n < count; n++) {
    const { text, next } = readCborText(bytes, i);
    i = next;
    if (text === "authData") {
      const { bytes: auth } = readCborBytes(bytes, i);
      return b64urlEncode(auth);
    }
    i = skipCbor(bytes, i);
  }
  throw new Error("authData missing from attestation");
}

export function signCountFromAuthData(authDataB64: string): number {
  const data = b64urlDecode(authDataB64);
  return new DataView(data.buffer, data.byteOffset + 33, 4).getUint32(0);
}

export async function verifyAssertion(opts: {
  jwk: EcJwk;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}): Promise<boolean> {
  const authData = b64urlDecode(opts.authenticatorData);
  const clientHash = await crypto.subtle.digest(
    "SHA-256",
    b64urlDecode(opts.clientDataJSON),
  );
  const signed = new Uint8Array(authData.length + 32);
  signed.set(authData, 0);
  signed.set(new Uint8Array(clientHash), authData.length);

  const key = await crypto.subtle.importKey(
    "jwk",
    { ...opts.jwk, ext: true, key_ops: ["verify"] },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  // WebAuthn signatures are ASN.1 DER; Web Crypto ECDSA verify wants raw r||s.
  const der = b64urlDecode(opts.signature);
  const raw = derToRawEs256(der);
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    raw,
    signed,
  );
}

/** Convert ASN.1 DER ECDSA signature to raw 64-byte r||s. */
function derToRawEs256(der: Uint8Array): Uint8Array {
  // SEQUENCE { INTEGER r, INTEGER s }
  let i = 0;
  if (der[i++] !== 0x30) throw new Error("bad DER sig");
  i += 1; // skip length
  if (der[i++] !== 0x02) throw new Error("bad DER r");
  const rLen = der[i++]!;
  let r = der.slice(i, i + rLen);
  i += rLen;
  if (der[i++] !== 0x02) throw new Error("bad DER s");
  const sLen = der[i++]!;
  let s = der.slice(i, i + sLen);
  // Strip leading zeros, left-pad to 32 bytes.
  while (r.length > 32 && r[0] === 0) r = r.slice(1);
  while (s.length > 32 && s[0] === 0) s = s.slice(1);
  const raw = new Uint8Array(64);
  raw.set(r, 32 - r.length);
  raw.set(s, 64 - s.length);
  return raw;
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${pin}`);
}
