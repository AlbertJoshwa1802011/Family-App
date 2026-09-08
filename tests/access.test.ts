/**
 * Closed signup: access requests, grants, and platform-admin approvals.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "../worker/index";
import { sha256Hex } from "../worker/lib/crypto";
import {
  canSignIn,
  isBootstrapAdminEmail,
  normalizeEmail,
} from "../worker/lib/appAccess";
import {
  accessApprovedEmail,
  demoRequestNotifyEmail,
  demoRequestReceivedEmail,
} from "../worker/lib/accessEmails";
import {
  PRODUCTION_APP_ORIGIN,
  absoluteAppUrl,
} from "../worker/lib/publicUrl";
import { getDb } from "../worker/db/client";
import {
  createTestEnv,
  seedFamily,
  seedSession,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

function seedPlatformAdmin(
  env: TestEnv,
  email = "admin@familyvault.app",
): { userId: string; cookie: string; email: string } {
  const user = seedUser(env.sqlite, { email, name: "Platform Admin" });
  env.sqlite
    .prepare(
      "INSERT INTO platform_admins (user_id, level, granted_by) VALUES (?, 'superadmin', ?)",
    )
    .run(user.id, user.id);
  return { userId: user.id, cookie: seedSession(env.sqlite, user.id), email };
}

describe("app access helpers", () => {
  let t: TestEnv;

  beforeEach(() => {
    t = createTestEnv();
  });

  it("normalizes emails", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it("recognizes bootstrap admin emails", () => {
    expect(isBootstrapAdminEmail("albertjoshrock101@gmail.com")).toBe(true);
    expect(isBootstrapAdminEmail("stranger@example.com")).toBe(false);
  });

  it("denies brand-new users without a grant", async () => {
    const db = getDb(t.env);
    const res = await canSignIn(db, t.env, {
      email: "stranger@example.com",
      googleSub: "sub-new",
    });
    expect(res).toEqual({ ok: false, reason: "access_denied" });
  });

  it("allows bootstrap admin emails", async () => {
    const db = getDb(t.env);
    const res = await canSignIn(db, t.env, {
      email: "AlbertJoshRock101@gmail.com",
      googleSub: "sub-boss",
    });
    expect(res).toEqual({ ok: true });
  });

  it("allows approved grants and blocks revoked", async () => {
    const db = getDb(t.env);
    t.sqlite
      .prepare(
        "INSERT INTO access_grants (id, email, status) VALUES (?, ?, 'approved')",
      )
      .run(crypto.randomUUID(), "ok@example.com");
    t.sqlite
      .prepare(
        "INSERT INTO access_grants (id, email, status) VALUES (?, ?, 'revoked')",
      )
      .run(crypto.randomUUID(), "nope@example.com");

    expect(
      await canSignIn(db, t.env, {
        email: "ok@example.com",
        googleSub: "sub-ok",
      }),
    ).toEqual({ ok: true });
    expect(
      await canSignIn(db, t.env, {
        email: "nope@example.com",
        googleSub: "sub-nope",
      }),
    ).toEqual({ ok: false, reason: "access_revoked" });
  });

  it("grandfathers existing users without a grant", async () => {
    const user = seedUser(t.sqlite, { email: "old@example.com" });
    const db = getDb(t.env);
    const res = await canSignIn(db, t.env, {
      email: "old@example.com",
      googleSub: `sub-${user.id}`,
    });
    expect(res).toEqual({ ok: true });
  });
});

describe("POST /api/access/demo-requests", () => {
  let t: TestEnv;
  const sent: { to: string; subject: string; html?: string; text?: string }[] = [];

  beforeEach(() => {
    sent.length = 0;
    t = createTestEnv({
      ACCESS_NOTIFY_EMAIL: "admin@familyvault.app",
      RESEND_API_KEY: "test-key",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const raw = String(init?.body ?? "{}");
        try {
          const body = JSON.parse(raw) as {
            to: string;
            subject: string;
            html?: string;
            text?: string;
          };
          if (body.to && body.subject) sent.push(body);
        } catch {
          // Gmail RFC822 bodies are not JSON
        }
        return new Response("{}", { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a pending request and emails admin + requester", async () => {
    const res = await app.request(
      "/api/access/demo-requests",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Priya",
          email: "priya@acme.com",
          company: "Acme",
          message: "Need a team vault",
        }),
      },
      t.env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("pending");

    const row = t.sqlite
      .prepare("SELECT email, status, name FROM demo_requests")
      .get() as { email: string; status: string; name: string };
    expect(row.email).toBe("priya@acme.com");
    expect(row.status).toBe("pending");
    expect(row.name).toBe("Priya");

    expect(sent.map((s) => s.to).sort()).toEqual([
      "admin@familyvault.app",
      "priya@acme.com",
    ]);

    const adminMail = sent.find((s) => s.to === "admin@familyvault.app");
    expect(adminMail?.html).toContain("Approve access");
    expect(adminMail?.html).toContain(
      `${t.env.APP_URL}/api/access/review/approve/`,
    );
    expect(adminMail?.html).toContain(
      `${t.env.APP_URL}/api/access/review/reject/`,
    );
    expect(adminMail?.html).not.toMatch(/href="\/access/);
    expect(adminMail?.text).toContain("/api/access/review/approve/");
  });

  it("falls back to the production origin when APP_URL is empty", async () => {
    t = createTestEnv({
      APP_URL: "",
      ACCESS_NOTIFY_EMAIL: "admin@familyvault.app",
      RESEND_API_KEY: "test-key",
    });
    const res = await app.request(
      "/api/access/demo-requests",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Priya", email: "priya@acme.com" }),
      },
      t.env,
    );
    expect(res.status).toBe(201);
    const adminMail = sent.find((s) => s.to === "admin@familyvault.app");
    expect(adminMail?.html).toContain(
      `${PRODUCTION_APP_ORIGIN}/api/access/review/approve/`,
    );
    expect(adminMail?.html).toMatch(/^[\s\S]*href="https:\/\//);
  });

  it("rejects invalid payloads with validation_error", async () => {
    const res = await app.request(
      "/api/access/demo-requests",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "", email: "not-an-email" }),
      },
      t.env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("validation_error");
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("requires company (name/email alone are not enough)", async () => {
    const res = await app.request(
      "/api/access/demo-requests",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Priya", email: "priya@acme.com" }),
      },
      t.env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("dedupes a second pending request for the same email", async () => {
    const payload = {
      method: "POST" as const,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Priya",
        email: "priya@acme.com",
        company: "Acme",
      }),
    };
    await app.request("/api/access/demo-requests", payload, t.env);
    const res = await app.request("/api/access/demo-requests", payload, t.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deduped?: boolean };
    expect(body.deduped).toBe(true);
    const count = t.sqlite
      .prepare("SELECT COUNT(*) AS n FROM demo_requests")
      .get() as { n: number };
    expect(count.n).toBe(1);
  });
});

describe("access review + admin approve", () => {
  let t: TestEnv;
  let reviewToken: string;
  let requestId: string;

  beforeEach(async () => {
    t = createTestEnv({ RESEND_API_KEY: "test-key" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    reviewToken = "review-token-plain-value-xx";
    requestId = crypto.randomUUID();
    const hash = await sha256Hex(reviewToken);
    t.sqlite
      .prepare(
        `INSERT INTO demo_requests (id, name, email, status, review_token_hash)
         VALUES (?, 'Sam', 'sam@acme.com', 'pending', ?)`,
      )
      .run(requestId, hash);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("approves via public token review and writes an access grant", async () => {
    const res = await app.request(
      "/api/access/review",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: reviewToken, action: "approve" }),
      },
      t.env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("approved");

    const grant = t.sqlite
      .prepare("SELECT email, status FROM access_grants WHERE email = ?")
      .get("sam@acme.com") as { email: string; status: string };
    expect(grant.status).toBe("approved");

    const demo = t.sqlite
      .prepare("SELECT status FROM demo_requests WHERE id = ?")
      .get(requestId) as { status: string };
    expect(demo.status).toBe("approved");
  });

  it("approves via GET email link without Origin (Gmail click)", async () => {
    const res = await app.request(
      `/api/access/review/approve/${reviewToken}`,
      { method: "GET" },
      t.env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("Access approved");
    expect(html).not.toContain("<script");

    const grant = t.sqlite
      .prepare("SELECT status FROM access_grants WHERE email = ?")
      .get("sam@acme.com") as { status: string };
    expect(grant.status).toBe("approved");
  });

  it("approves the legacy SPA query-string email URL on GET /access/review", async () => {
    const res = await app.request(
      `/access/review?token=${encodeURIComponent(reviewToken)}&action=approve`,
      { method: "GET" },
      t.env,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Access approved");
    const grant = t.sqlite
      .prepare("SELECT status FROM access_grants WHERE email = ?")
      .get("sam@acme.com") as { status: string };
    expect(grant.status).toBe("approved");
  });

  it("treats a second GET on the same token as already handled, not an error page", async () => {
    await app.request(`/api/access/review/approve/${reviewToken}`, {}, t.env);
    const res = await app.request(
      `/api/access/review/approve/${reviewToken}`,
      {},
      t.env,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Already handled");
  });

  it("returns HTML 404 for an unknown GET token, not JSON", async () => {
    const res = await app.request(
      "/api/access/review/approve/totally-wrong-token-xx",
      {},
      t.env,
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toContain("invalid or has expired");
  });

  it("rejects unknown tokens with 404", async () => {
    const res = await app.request(
      "/api/access/review",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "totally-wrong-token-xx", action: "approve" }),
      },
      t.env,
    );
    expect(res.status).toBe(404);
  });

  it("allows platform admin to approve in-app and forbids plain members", async () => {
    const admin = seedPlatformAdmin(t);
    const family = seedFamily(t.sqlite, admin.userId);
    const member = seedUser(t.sqlite, { email: "member@example.com" });
    t.sqlite
      .prepare(
        "INSERT INTO family_members (id, family_id, user_id, member_type, role, status) VALUES (?, ?, ?, 'user', 'member', 'active')",
      )
      .run(crypto.randomUUID(), family.id, member.id);
    const memberCookie = seedSession(t.sqlite, member.id);

    const forbidden = await app.request(
      `/api/access/admin/demo-requests/${requestId}/approve`,
      {
        method: "POST",
        headers: { Cookie: memberCookie, "Content-Type": "application/json" },
        body: "{}",
      },
      t.env,
    );
    expect(forbidden.status).toBe(403);

    const ok = await app.request(
      `/api/access/admin/demo-requests/${requestId}/approve`,
      {
        method: "POST",
        headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
        body: "{}",
      },
      t.env,
    );
    expect(ok.status).toBe(200);
    const grant = t.sqlite
      .prepare("SELECT status FROM access_grants WHERE email = ?")
      .get("sam@acme.com") as { status: string };
    expect(grant.status).toBe("approved");
  });
});

describe("access email templates", () => {
  it("includes approve/reject links for the admin notify mail", () => {
    const html = demoRequestNotifyEmail({
      name: "Priya",
      email: "priya@acme.com",
      company: "Acme",
      message: "Hello",
      approveUrl: "https://fam.connect-cloud.workers.dev/api/access/review/approve/a",
      rejectUrl: "https://fam.connect-cloud.workers.dev/api/access/review/reject/a",
      adminUrl: "https://app/admin/access",
    });
    expect(html).toContain("Approve access");
    expect(html).toContain("/api/access/review/approve/");
    expect(html).toContain("/api/access/review/reject/");
    expect(html).toContain("priya@acme.com");
    expect(html).toContain("https://fam.connect-cloud.workers.dev/api/access/review/approve/a");
  });

  it("renders requester confirmation and approval copy", () => {
    expect(
      demoRequestReceivedEmail({ name: "Priya", appUrl: "https://app/login" }),
    ).toContain("We got your request");
    expect(
      accessApprovedEmail({ name: "Priya", loginUrl: "https://app/login" }),
    ).toContain("Sign in with Google");
  });
});

describe("unknown access path", () => {
  it("returns JSON 404 not_found", async () => {
    const t = createTestEnv();
    const res = await app.request("/api/access/nope", {}, t.env);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});

describe("access email URL wiring", () => {
  it("never emits a relative origin for email buttons", () => {
    expect(absoluteAppUrl({ APP_URL: "" })).toBe(PRODUCTION_APP_ORIGIN);
    expect(absoluteAppUrl({ APP_URL: "https://fam.connect-cloud.workers.dev/" })).toBe(
      PRODUCTION_APP_ORIGIN,
    );
    expect(absoluteAppUrl({ APP_URL: "http://localhost:5173" })).toBe(
      "http://localhost:5173",
    );
    expect(
      absoluteAppUrl(
        { APP_URL: "http://localhost:5173" },
        "https://fam.connect-cloud.workers.dev/api/access/demo-requests",
      ),
    ).toBe(PRODUCTION_APP_ORIGIN);
    expect(
      absoluteAppUrl({ APP_URL: "" }, "http://localhost/api/access/demo-requests"),
    ).toBe(PRODUCTION_APP_ORIGIN);
  });

  it("keeps Worker-first routing for the email landing path", () => {
    const wrangler = readFileSync(join(__dirname, "..", "wrangler.jsonc"), "utf8");
    expect(wrangler).toMatch(/"run_worker_first":\s*\[\s*"\/api\/\*"\s*,\s*"\/access\/review"\s*\]/);
    const vite = readFileSync(join(__dirname, "..", "vite.config.ts"), "utf8");
    expect(vite).toContain("/^\\/access\\/review/");
  });
});
