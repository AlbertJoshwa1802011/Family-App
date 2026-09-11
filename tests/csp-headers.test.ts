/**
 * CSP / static-header contracts that keep document photo upload working.
 *
 * The browser PUTs file bytes directly to Google Drive (resumable Location URL).
 * If `connect-src` is only `'self'`, Safari throws TypeError("Load failed") and
 * the Documents UI shows that opaque string. These tests pin the allowlist so
 * agents cannot "harden" CSP and silently break uploads again.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const headers = readFileSync("public/_headers", "utf8");

function cspDirective(): string {
  const match = headers.match(/Content-Security-Policy:\s*(.+)/);
  if (!match?.[1]) throw new Error("Content-Security-Policy missing from public/_headers");
  return match[1].trim();
}

function connectSrc(csp: string): string {
  const part = csp
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("connect-src "));
  if (!part) throw new Error("connect-src directive missing from CSP");
  return part;
}

describe("public/_headers CSP — document Drive upload", () => {
  it("declares a Content-Security-Policy on /*", () => {
    expect(headers).toMatch(/^\/\*/m);
    expect(headers).toMatch(/Content-Security-Policy:/);
  });

  it("keeps default-src locked to self (XSS floor)", () => {
    const csp = cspDirective();
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
  });

  it("allows Google Drive upload hosts in connect-src (photo upload)", () => {
    const connect = connectSrc(cspDirective());
    // Exact host used by Drive resumable sessions today.
    expect(connect).toContain("https://www.googleapis.com");
    // Wildcard covers upload Location host variants Google may return.
    expect(connect).toContain("https://*.googleapis.com");
    // Still same-origin for /api/*.
    expect(connect).toContain("'self'");
  });

  it("does not allow open connect-src wildcards that would undo hardening", () => {
    const connect = connectSrc(cspDirective());
    // Reject bare `*` / `*:` sources; `https://*.googleapis.com` is intentional.
    const sources = connect.replace(/^connect-src\s+/, "").split(/\s+/);
    expect(sources).not.toContain("*");
    expect(sources.some((s) => s === "http:" || s.startsWith("http://"))).toBe(
      false,
    );
  });

  it("documents why googleapis is required (comment guard for future agents)", () => {
    expect(headers.toLowerCase()).toMatch(/drive/);
    expect(headers.toLowerCase()).toMatch(/load failed|resumable|upload/);
  });
});
