import { describe, expect, it } from "vitest";
import { hashPin, rpIdFromAppUrl, b64urlEncode, b64urlDecode } from "../worker/lib/webauthn";
import { extraScopesFromConnect, GOOGLE_SCOPES } from "../worker/lib/google";

describe("webauthn helpers", () => {
  it("rpIdFromAppUrl uses the hostname", () => {
    expect(rpIdFromAppUrl("https://fam.connect-cloud.workers.dev")).toBe(
      "fam.connect-cloud.workers.dev",
    );
  });

  it("hashPin is deterministic for the same salt", async () => {
    const a = await hashPin("123456", "salt");
    const b = await hashPin("123456", "salt");
    const c = await hashPin("000000", "salt");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("b64url round-trips", () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 255]);
    const encoded = b64urlEncode(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect([...b64urlDecode(encoded)]).toEqual([...bytes]);
  });
});

describe("extraScopesFromConnect", () => {
  it("maps contacts and gmail connect flags", () => {
    expect(extraScopesFromConnect("contacts,gmail")).toEqual([
      GOOGLE_SCOPES.contacts,
      GOOGLE_SCOPES.gmailSend,
    ]);
    expect(extraScopesFromConnect(undefined)).toEqual([]);
    expect(extraScopesFromConnect("gmail")).toEqual([GOOGLE_SCOPES.gmailSend]);
    expect(extraScopesFromConnect("contacts")).toEqual([GOOGLE_SCOPES.contacts]);
    expect(extraScopesFromConnect("nope")).toEqual([]);
  });
});
