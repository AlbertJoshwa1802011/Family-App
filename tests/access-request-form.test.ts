/**
 * Request-access form contracts: Google deny prefills email/name; company is required.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const login = readFileSync("src/pages/Login.tsx", "utf8");
const auth = readFileSync("worker/routes/auth.ts", "utf8");
const access = readFileSync("worker/routes/access.ts", "utf8");

describe("access request email autofill + company", () => {
  it("OAuth access deny redirects with email (and name when present)", () => {
    expect(auth).toContain("error: access.reason");
    expect(auth).toContain("email");
    expect(auth).toMatch(/q\.set\("name"/);
  });

  it("Login prefills email/name from query and locks email when present", () => {
    expect(login).toContain('params.get("email")');
    expect(login).toContain('params.get("name")');
    expect(login).toContain("readOnly={emailLocked}");
    expect(login).toContain("Filled from your Google sign-in");
  });

  it("company is required in the UI and API schema", () => {
    expect(login).toMatch(/Company \/ team[\s\S]*?required/);
    expect(access).toMatch(
      /company:\s*z\.string\(\)\.trim\(\)\.min\(1\)/,
    );
  });

  it("name and purpose remain available", () => {
    expect(login).toContain("Your name");
    expect(login).toContain("Why do you need access?");
  });
});
