/**
 * Closed signup: demo requests, access grants, and super_admin approvals.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { app } from "../worker/index";
import { sha256Hex } from "../worker/lib/crypto";
import {
  canSignIn,
  ensureBootstrapSuperAdmin,
  normalizeEmail,
} from "../worker/lib/appAccess";
import {
  accessApprovedEmail,
  demoRequestNotifyEmail,
  demoRequestReceivedEmail,
} from "../worker/lib/emailTemplates";
import { getDb } from "../worker/db/client";
import {
  createTestEnv,
  seedFamily,
  seedSession,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

function seedSuperAdmin(
  env: TestEnv,
  email = "admin@familyvault.app",
): { userId: string; cookie: string; email: string } {
  const user = seedUser(env.sqlite, { email, name: "Super Admin" });
  env.sqlite
    .prepare(
      "INSERT INTO app_role_assignments (id, user_id, role) VALUES (?, ?, 'super_admin')",
    )
    .run(crypto.randomUUID(), user.id);
  return { userId: user.id, cookie: seedSession(env.sqlite, user.id), email };
}

describe("app access helpers", () => {
  let t: TestEnv;

  beforeEach(() => {
    t = createTestEnv({ SUPER_ADMIN_EMAILS: "boss@example.com" });
  });

  it("normalizes emails", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it("denies brand-new users without a grant", async () => {
    const db = getDb(t.env);
    const res = await canSignIn(db, t.env, {
      email: "stranger@example.com",
      googleSub: "sub-new",
    });
    expect(res).toEqual({ ok: false, reason: "access_denied" });
  });

  it("allows bootstrap SUPER_ADMIN_EMAILS", async () => {
    const db = getDb(t.env);
    const res = await canSignIn(db, t.env, {
      email: "Boss@Example.com",
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

  it("ensureBootstrapSuperAdmin assigns the role once", async () => {
    const user = seedUser(t.sqlite, { email: "boss@example.com" });
    const db = getDb(t.env);
    await ensureBootstrapSuperAdmin(db, t.env, user.id, user.email);
    await ensureBootstrapSuperAdmin(db, t.env, user.id, user.email);
    const rows = t.sqlite
      .prepare(
        "SELECT role FROM app_role_assignments WHERE user_id = ?",
      )
      .all(user.id) as { role: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("super_admin");
  });
});

describe("POST /api/access/demo-requests", () => {
  let t: TestEnv;
  const sent: { to: string; subject: string }[] = [];

  beforeEach(() => {
    sent.length = 0;
    t = createTestEnv({
      SUPER_ADMIN_EMAILS: "admin@familyvault.app",
      ACCESS_NOTIFY_EMAIL: "admin@familyvault.app",
      RESEND_API_KEY: "test-key",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          to: string;
          subject: string;
        };
        sent.push({ to: body.to, subject: body.subject });
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

  it("dedupes a second pending request for the same email", async () => {
    const payload = {
      method: "POST" as const,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Priya", email: "priya@acme.com" }),
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
    t = createTestEnv({
      SUPER_ADMIN_EMAILS: "admin@familyvault.app",
      RESEND_API_KEY: "test-key",
    });
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

  it("allows super_admin to approve in-app and forbids plain members", async () => {
    const admin = seedSuperAdmin(t);
    const family = seedFamily(t.sqlite, admin.userId);
    // Plain member in some family
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

    const list = await app.request(
      "/api/access/admin/demo-requests?status=approved",
      { headers: { Cookie: admin.cookie } },
      t.env,
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { requests: { email: string }[] };
    expect(listBody.requests.some((r) => r.email === "sam@acme.com")).toBe(true);
  });

  it("direct grant + revoke roundtrip", async () => {
    const admin = seedSuperAdmin(t);
    const grantRes = await app.request(
      "/api/access/admin/grants",
      {
        method: "POST",
        headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "newhire@acme.com", note: "Team" }),
      },
      t.env,
    );
    expect(grantRes.status).toBe(201);

    const revokeRes = await app.request(
      "/api/access/admin/grants/revoke",
      {
        method: "POST",
        headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "newhire@acme.com" }),
      },
      t.env,
    );
    expect(revokeRes.status).toBe(200);

    const row = t.sqlite
      .prepare("SELECT status FROM access_grants WHERE email = ?")
      .get("newhire@acme.com") as { status: string };
    expect(row.status).toBe("revoked");
  });

  it("GET /auth/me returns appRoles for super_admin", async () => {
    const admin = seedSuperAdmin(t);
    const res = await app.request(
      "/api/auth/me",
      { headers: { Cookie: admin.cookie } },
      t.env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { email: string; appRoles: string[] };
    };
    expect(body.user.email).toBe("admin@familyvault.app");
    expect(body.user.appRoles).toContain("super_admin");
  });
});

describe("access email templates", () => {
  it("notify email escapes content and includes approve/reject URLs", () => {
    const html = demoRequestNotifyEmail({
      name: `<script>x</script>`,
      email: "a@b.com",
      company: `Tom & Co`,
      message: `"hi"`,
      approveUrl: "https://vault.example/access/review?token=a&action=approve",
      rejectUrl: "https://vault.example/access/review?token=a&action=reject",
      adminUrl: "https://vault.example/admin",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Tom &amp; Co");
    expect(html).toContain("action=approve");
    expect(html).toContain("action=reject");
    expect(html).toContain("<table role=\"presentation\"");
    expect(html).not.toMatch(/<link|src=/);
  });

  it("received + approved templates render safely", () => {
    const received = demoRequestReceivedEmail({
      name: "Priya",
      appUrl: "https://vault.example/login",
    });
    expect(received).toContain("Priya");
    const approved = accessApprovedEmail({
      name: "Priya",
      loginUrl: "https://vault.example/login",
    });
    expect(approved).toContain("Sign in with Google");
    expect(approved).toContain("https://vault.example/login");
  });
});
