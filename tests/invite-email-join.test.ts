/**
 * Family invite → email → sign-in → accept join.
 *
 * Pins the contract that lets a new person join from the mail link:
 *  - invite creates a hashed single-use token + email-bound row
 *  - invite upserts an approved access_grant (closed signup)
 *  - Resend is called with the /invite/:token URL when configured
 *  - Resend failure still returns the invite (emailSent: false)
 *  - accept enforces email match, expiry, single-use, already-member
 *  - OAuth ?next= preserves /invite/:token through sign-in
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../worker/index";
import { canSignIn } from "../worker/lib/appAccess";
import { sha256Hex } from "../worker/lib/crypto";
import { getDb } from "../worker/db/client";
import { loginBounceHtml, safeAppPath } from "../worker/lib/publicUrl";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedSession,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

type InviteBody = {
  invite: {
    email: string;
    role: string;
    token: string;
    inviteUrl: string;
    emailSent: boolean;
    expiresAt: number;
  };
};

function originFor(env: TestEnv): string {
  return env.env.APP_URL ?? "http://localhost:5173";
}

async function api(
  env: TestEnv,
  method: string,
  path: string,
  cookie?: string,
  body?: unknown,
): Promise<Response> {
  const origin = originFor(env);
  return app.request(
    path,
    {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined
          ? {
              "Content-Type": "application/json",
              Origin: origin,
              Referer: `${origin}/`,
            }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env.env,
  );
}

describe("invite email → join family", () => {
  let t: TestEnv;
  let familyId: string;
  let owner: ReturnType<typeof seedActor>;
  let admin: ReturnType<typeof seedActor>;
  let member: ReturnType<typeof seedActor>;
  const sent: Array<{
    from?: string;
    to: string;
    subject: string;
    html: string;
  }> = [];

  beforeEach(() => {
    sent.length = 0;
    t = createTestEnv({
      RESEND_API_KEY: "re_test",
      APP_URL: "https://vault.example",
    });
    const ownerUser = seedUser(t.sqlite, { name: "Olive Owner" });
    familyId = seedFamily(t.sqlite, ownerUser.id, "Hall Family").id;
    owner = seedActor(t.sqlite, familyId, "owner", { name: "Olive Owner" });
    admin = seedActor(t.sqlite, familyId, "admin", { name: "Ada Admin" });
    member = seedActor(t.sqlite, familyId, "member", { name: "Milo Member" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          from?: string;
          to: string;
          subject: string;
          html: string;
        };
        sent.push(body);
        return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("owner invite emails the join link, grants access, and accept joins the family", async () => {
    const create = await api(t, "POST", `/api/families/${familyId}/invites`, owner.cookie, {
      email: "Cousin@Example.com",
      role: "member",
    });
    expect(create.status).toBe(201);
    const { invite } = (await create.json()) as InviteBody;

    expect(invite.email).toBe("cousin@example.com");
    expect(invite.role).toBe("member");
    expect(invite.emailSent).toBe(true);
    expect(invite.inviteUrl).toBe(`https://vault.example/invite/${invite.token}`);
    expect(invite.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // Resend payload carries the clickable join URL.
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("cousin@example.com");
    expect(sent[0].subject).toContain("Hall Family");
    expect(sent[0].html).toContain(invite.inviteUrl);
    expect(sent[0].html).toContain("Join the family");
    expect(sent[0].html).toContain("Hall Family");

    // Token is stored hashed — plaintext must not appear in invites.
    const hash = await sha256Hex(invite.token);
    const row = t.sqlite
      .prepare(
        "SELECT email, token_hash, role, accepted_at FROM invites WHERE token_hash = ?",
      )
      .get(hash) as {
      email: string;
      token_hash: string;
      role: string;
      accepted_at: number | null;
    };
    expect(row.email).toBe("cousin@example.com");
    expect(row.token_hash).toBe(hash);
    expect(row.accepted_at).toBeNull();

    // Closed signup: brand-new Google identity for that email may sign in.
    const grant = t.sqlite
      .prepare("SELECT status, note FROM access_grants WHERE email = ?")
      .get("cousin@example.com") as { status: string; note: string | null };
    expect(grant.status).toBe("approved");
    expect(grant.note).toContain(familyId);

    const gate = await canSignIn(getDb(t.env), t.env, {
      email: "cousin@example.com",
      googleSub: "sub-cousin-new",
    });
    expect(gate).toEqual({ ok: true });

    // Click-through accept (after Google session exists).
    const cousin = seedUser(t.sqlite, { email: "cousin@example.com", name: "Cousin" });
    const cookie = seedSession(t.sqlite, cousin.id);
    const accept = await api(
      t,
      "POST",
      `/api/families/invites/${invite.token}/accept`,
      cookie,
    );
    expect(accept.status).toBe(200);
    const accepted = (await accept.json()) as { ok: true; familyId: string };
    expect(accepted.familyId).toBe(familyId);

    const members = await api(t, "GET", `/api/families/${familyId}/members`, cookie);
    expect(members.status).toBe(200);
    const body = (await members.json()) as {
      members: Array<{ email: string | null; role: string; status: string }>;
    };
    expect(
      body.members.some(
        (m) => m.email === "cousin@example.com" && m.role === "member" && m.status === "active",
      ),
    ).toBe(true);

    // Single-use
    const again = await api(
      t,
      "POST",
      `/api/families/invites/${invite.token}/accept`,
      cookie,
    );
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe("invite_already_used");
  });

  it("admin can invite as admin role and email still fires", async () => {
    const create = await api(t, "POST", `/api/families/${familyId}/invites`, admin.cookie, {
      email: "new.admin@example.com",
      role: "admin",
    });
    expect(create.status).toBe(201);
    const { invite } = (await create.json()) as InviteBody;
    expect(invite.role).toBe("admin");
    expect(invite.emailSent).toBe(true);
    expect(sent[0].html).toContain(invite.inviteUrl);

    const joiner = seedUser(t.sqlite, { email: "new.admin@example.com" });
    const cookie = seedSession(t.sqlite, joiner.id);
    const accept = await api(
      t,
      "POST",
      `/api/families/invites/${invite.token}/accept`,
      cookie,
    );
    expect(accept.status).toBe(200);

    const members = await api(t, "GET", `/api/families/${familyId}/members`, owner.cookie);
    const body = (await members.json()) as {
      members: Array<{ email: string | null; role: string }>;
    };
    expect(
      body.members.some((m) => m.email === "new.admin@example.com" && m.role === "admin"),
    ).toBe(true);
  });

  it("Resend failure still creates invite + grant with emailSent:false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429 })),
    );

    const create = await api(t, "POST", `/api/families/${familyId}/invites`, owner.cookie, {
      email: "fallback@example.com",
    });
    expect(create.status).toBe(201);
    const { invite } = (await create.json()) as InviteBody;
    expect(invite.emailSent).toBe(false);
    expect(invite.inviteUrl).toContain(`/invite/${invite.token}`);

    const grant = t.sqlite
      .prepare("SELECT status FROM access_grants WHERE email = ?")
      .get("fallback@example.com") as { status: string };
    expect(grant.status).toBe("approved");
  });

  it("no RESEND_API_KEY → no fetch, emailSent false, invite still usable", async () => {
    vi.unstubAllGlobals();
    const bare = createTestEnv({ APP_URL: "https://vault.example" });
    const ownerUser = seedUser(bare.sqlite);
    const famId = seedFamily(bare.sqlite, ownerUser.id).id;
    const actor = seedActor(bare.sqlite, famId, "owner");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const create = await api(bare, "POST", `/api/families/${famId}/invites`, actor.cookie, {
      email: "offline@example.com",
    });
    expect(create.status).toBe(201);
    const { invite } = (await create.json()) as InviteBody;
    expect(invite.emailSent).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();

    const gate = await canSignIn(getDb(bare.env), bare.env, {
      email: "offline@example.com",
      googleSub: "sub-offline",
    });
    expect(gate).toEqual({ ok: true });
  });

  it("re-inviting a revoked email re-approves access", async () => {
    t.sqlite
      .prepare(
        "INSERT INTO access_grants (id, email, status) VALUES (?, ?, 'revoked')",
      )
      .run(crypto.randomUUID(), "returning@example.com");

    expect(
      await canSignIn(getDb(t.env), t.env, {
        email: "returning@example.com",
        googleSub: "sub-returning",
      }),
    ).toEqual({ ok: false, reason: "access_revoked" });

    const create = await api(t, "POST", `/api/families/${familyId}/invites`, owner.cookie, {
      email: "returning@example.com",
    });
    expect(create.status).toBe(201);

    expect(
      await canSignIn(getDb(t.env), t.env, {
        email: "returning@example.com",
        googleSub: "sub-returning",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects invalid invite payloads with validation_error", async () => {
    const missing = await api(t, "POST", `/api/families/${familyId}/invites`, owner.cookie, {
      role: "member",
    });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toBe("validation_error");

    const bad = await api(t, "POST", `/api/families/${familyId}/invites`, owner.cookie, {
      email: "not-an-email",
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("validation_error");
  });

  it("plain member cannot create invites", async () => {
    const res = await api(t, "POST", `/api/families/${familyId}/invites`, member.cookie, {
      email: "nope@example.com",
    });
    expect(res.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("wrong Google account cannot accept (email-bound)", async () => {
    const create = await api(t, "POST", `/api/families/${familyId}/invites`, owner.cookie, {
      email: "intended@example.com",
    });
    const { invite } = (await create.json()) as InviteBody;

    const interloper = seedUser(t.sqlite, { email: "other@example.com" });
    const res = await api(
      t,
      "POST",
      `/api/families/invites/${invite.token}/accept`,
      seedSession(t.sqlite, interloper.id),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("invite_email_mismatch");
  });

  it("unknown / expired / already-member accept failures", async () => {
    const unknown = await api(
      t,
      "POST",
      `/api/families/invites/${crypto.randomUUID()}/accept`,
      owner.cookie,
    );
    expect(unknown.status).toBe(404);

    const create = await api(t, "POST", `/api/families/${familyId}/invites`, owner.cookie, {
      email: "expiree@example.com",
    });
    const { invite } = (await create.json()) as InviteBody;
    const hash = await sha256Hex(invite.token);
    t.sqlite
      .prepare("UPDATE invites SET expires_at = ? WHERE token_hash = ?")
      .run(Math.floor(Date.now() / 1000) - 10, hash);

    const expiree = seedUser(t.sqlite, { email: "expiree@example.com" });
    const expired = await api(
      t,
      "POST",
      `/api/families/invites/${invite.token}/accept`,
      seedSession(t.sqlite, expiree.id),
    );
    expect(expired.status).toBe(410);
    expect(((await expired.json()) as { error: string }).error).toBe("invite_expired");

    // Invite an email that already has membership → already_a_member
    const create2 = await api(t, "POST", `/api/families/${familyId}/invites`, owner.cookie, {
      email: member.email,
    });
    const { invite: inv2 } = (await create2.json()) as InviteBody;
    const already = await api(
      t,
      "POST",
      `/api/families/invites/${inv2.token}/accept`,
      member.cookie,
    );
    expect(already.status).toBe(409);
    expect(((await already.json()) as { error: string }).error).toBe("already_a_member");
  });

  it("unauthenticated accept and invite creation are 401", async () => {
    const create = await api(t, "POST", `/api/families/${familyId}/invites`, undefined, {
      email: "x@example.com",
    });
    expect(create.status).toBe(401);

    const accept = await api(
      t,
      "POST",
      `/api/families/invites/${crypto.randomUUID()}/accept`,
    );
    expect(accept.status).toBe(401);
  });
});

describe("invite deep-link survives OAuth (?next=)", () => {
  it("stores /invite/:token in PKCE state and bounce HTML", async () => {
    const t = createTestEnv({
      GOOGLE_CLIENT_ID: "test-client-id",
      APP_URL: "https://vault.example",
    });
    const next = "/invite/tok-from-email";
    const res = await app.request(
      `https://vault.example/api/auth/google/start?next=${encodeURIComponent(next)}`,
      { method: "GET" },
      t.env,
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    const state = new URL(location).searchParams.get("state");
    expect(state).toBeTruthy();

    const stored = (await t.env.KV.get(`oauth:state:${state}`, "json")) as {
      returnTo?: string;
    } | null;
    expect(stored?.returnTo).toBe(next);

    expect(safeAppPath(next)).toBe(next);
    const html = loginBounceHtml(next);
    expect(html).toContain(`url=${next}`);
    expect(html).toContain(`href="${next}"`);
  });

  it("rejects open-redirect style next values", async () => {
    expect(safeAppPath("//evil.example/phish")).toBe("/");
    expect(safeAppPath("https://evil.example")).toBe("/");
    expect(safeAppPath("/invite/ok")).toBe("/invite/ok");
  });
});
