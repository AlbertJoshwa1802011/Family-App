/** PKCE utilities and token hashing. All crypto uses the Web Crypto API (available in Workers). */

/** Generate a cryptographically-random base64url string (no padding). */
export function generateRandom(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return base64url(bytes);
}

/** SHA-256 a plain string and return base64url — used for PKCE code_challenge. */
export async function sha256Base64url(plain: string): Promise<string> {
  const encoded = new TextEncoder().encode(plain);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return base64url(new Uint8Array(hash));
}

/** SHA-256 a string and return lowercase hex — used for invite/session token storage. */
export async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}
