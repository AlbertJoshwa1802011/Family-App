import { describe, it, expect } from "vitest";
import { app } from "../worker/index";
import { createTestEnv } from "./helpers/testEnv";
import { loginBounceHtml, requestOrigin, safeAppPath } from "../worker/lib/publicUrl";

describe("publicUrl helpers", () => {
  it("requestOrigin reads the Worker host", () => {
    expect(
      requestOrigin("https://fam.connect-cloud.workers.dev/api/auth/google/start"),
    ).toBe("https://fam.connect-cloud.workers.dev");
  });

  it("safeAppPath rejects protocol-relative junk", () => {
    expect(safeAppPath("/tasks")).toBe("/tasks");
    expect(safeAppPath("//evil.example")).toBe("/");
  });

  it("login bounce is first-party HTML with no inline script", () => {
    const html = loginBounceHtml("/");
    expect(html).toContain('http-equiv="refresh"');
    expect(html).not.toMatch(/<script/i);
  });
});

describe("GET /api/auth/google/start uses request host", () => {
  it("puts fam host in Google redirect_uri even if APP_URL differs", async () => {
    const t = createTestEnv({
      GOOGLE_CLIENT_ID: "test-client-id",
      APP_URL: "http://localhost:5173",
    });
    const res = await app.request(
      "https://fam.connect-cloud.workers.dev/api/auth/google/start",
      { method: "GET" },
      t.env,
    );
    expect([301, 302, 303, 307, 308]).toContain(res.status);
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith("https://accounts.google.com/")).toBe(true);
    expect(location).toContain(
      encodeURIComponent(
        "https://fam.connect-cloud.workers.dev/api/auth/google/callback",
      ),
    );
  });
});
