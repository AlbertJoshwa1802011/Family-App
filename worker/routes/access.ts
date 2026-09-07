import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { generateRandom, sha256Hex } from "../lib/crypto";
import { checkRateLimit, clientIp } from "../lib/rateLimit";
import { sendEmail } from "../lib/email";
import {
  accessApprovedEmail,
  accessRejectedEmail,
  demoRequestNotifyEmail,
  demoRequestReceivedEmail,
} from "../lib/accessEmails";
import {
  accessNotifyEmail,
  normalizeEmail,
  revokeAccessGrant,
  upsertAccessGrant,
} from "../lib/appAccess";
import { requireSession } from "../middleware/requireSession";
import { requirePlatformAdmin } from "../middleware/requirePlatformAdmin";

export const accessRoutes = new Hono<HonoEnv>();

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

const demoRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  company: z.string().trim().max(200).optional().or(z.literal("")),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
});

const reviewSchema = z.object({
  token: z.string().min(16).max(128),
  action: z.enum(["approve", "reject"]),
});

const grantSchema = z.object({
  email: z.string().trim().email().max(254),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

const revokeSchema = z.object({
  email: z.string().trim().email().max(254),
});

function reviewUrls(appUrl: string, token: string) {
  const base = `${appUrl}/access/review`;
  return {
    approveUrl: `${base}?token=${encodeURIComponent(token)}&action=approve`,
    rejectUrl: `${base}?token=${encodeURIComponent(token)}&action=reject`,
  };
}

async function applyReview(
  env: HonoEnv["Bindings"],
  opts: {
    requestId: string;
    action: "approve" | "reject";
    reviewerUserId: string | null;
  },
): Promise<
  | { ok: true; status: "approved" | "rejected"; email: string; name: string }
  | { ok: false; error: string; status: number }
> {
  const db = getDb(env);
  const row = await db
    .select()
    .from(schema.demoRequests)
    .where(eq(schema.demoRequests.id, opts.requestId))
    .get();

  if (!row) return { ok: false, error: "not_found", status: 404 };
  if (row.status !== "pending") {
    return { ok: false, error: "already_reviewed", status: 409 };
  }

  const now = Math.floor(Date.now() / 1000);

  if (opts.action === "approve") {
    await db
      .update(schema.demoRequests)
      .set({
        status: "approved",
        reviewedByUserId: opts.reviewerUserId,
        reviewedAt: now,
      })
      .where(eq(schema.demoRequests.id, row.id));

    await upsertAccessGrant(db, {
      email: row.email,
      grantedByUserId: opts.reviewerUserId,
      demoRequestId: row.id,
      note: "Approved access request",
    });

    await sendEmail(env, {
      to: row.email,
      subject: "You're approved — sign in to Family Vault",
      html: accessApprovedEmail({
        name: row.name,
        loginUrl: `${env.APP_URL}/login`,
      }),
    });

    return { ok: true, status: "approved", email: row.email, name: row.name };
  }

  await db
    .update(schema.demoRequests)
    .set({
      status: "rejected",
      reviewedByUserId: opts.reviewerUserId,
      reviewedAt: now,
    })
    .where(eq(schema.demoRequests.id, row.id));

  await sendEmail(env, {
    to: row.email,
    subject: "Update on your Family Vault access request",
    html: accessRejectedEmail({ name: row.name }),
  });

  return { ok: true, status: "rejected", email: row.email, name: row.name };
}

// POST /access/demo-requests — public; rate-limited.
accessRoutes.post("/demo-requests", zv(demoRequestSchema), async (c) => {
  const limited = await checkRateLimit(c, `demo-request:${clientIp(c)}`, {
    limit: 5,
    windowSecs: 3600,
  });
  if (limited) return limited;

  const data = c.req.valid("json");
  const email = normalizeEmail(data.email);
  const db = getDb(c.env);

  const existingPending = await db
    .select({ id: schema.demoRequests.id })
    .from(schema.demoRequests)
    .where(
      and(
        eq(schema.demoRequests.email, email),
        eq(schema.demoRequests.status, "pending"),
      ),
    )
    .get();

  if (existingPending) {
    return c.json({ ok: true, status: "pending", deduped: true });
  }

  const grant = await db
    .select({ status: schema.accessGrants.status })
    .from(schema.accessGrants)
    .where(eq(schema.accessGrants.email, email))
    .get();
  if (grant?.status === "approved") {
    return c.json({ ok: true, status: "already_approved" });
  }

  const token = generateRandom(24);
  const tokenHash = await sha256Hex(token);
  const id = crypto.randomUUID();
  const company = data.company?.trim() ? data.company.trim() : null;
  const message = data.message?.trim() ? data.message.trim() : null;

  await db.insert(schema.demoRequests).values({
    id,
    name: data.name.trim(),
    email,
    company,
    message,
    status: "pending",
    reviewTokenHash: tokenHash,
  });

  const appUrl = c.env.APP_URL ?? "";
  const { approveUrl, rejectUrl } = reviewUrls(appUrl, token);
  const notifyTo = accessNotifyEmail(c.env);

  if (notifyTo) {
    await sendEmail(c.env, {
      to: notifyTo,
      subject: `Access request: ${data.name.trim()} <${email}>`,
      html: demoRequestNotifyEmail({
        name: data.name.trim(),
        email,
        company,
        message,
        approveUrl,
        rejectUrl,
        adminUrl: `${appUrl}/admin/access`,
      }),
    });
  }

  await sendEmail(c.env, {
    to: email,
    subject: "We received your Family Vault access request",
    html: demoRequestReceivedEmail({
      name: data.name.trim(),
      appUrl: `${appUrl}/login`,
    }),
  });

  return c.json({ ok: true, status: "pending" }, 201);
});

// POST /access/review — public tokenized approve/reject (from email landing page).
accessRoutes.post("/review", zv(reviewSchema), async (c) => {
  const limited = await checkRateLimit(c, `access-review:${clientIp(c)}`, {
    limit: 20,
    windowSecs: 3600,
  });
  if (limited) return limited;

  const { token, action } = c.req.valid("json");
  const tokenHash = await sha256Hex(token);
  const db = getDb(c.env);
  const row = await db
    .select({ id: schema.demoRequests.id, status: schema.demoRequests.status })
    .from(schema.demoRequests)
    .where(eq(schema.demoRequests.reviewTokenHash, tokenHash))
    .get();

  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.status !== "pending") {
    return c.json({ error: "already_reviewed", status: row.status }, 409);
  }

  const result = await applyReview(c.env, {
    requestId: row.id,
    action,
    reviewerUserId: null,
  });
  if (!result.ok) return c.json({ error: result.error }, result.status as 404);

  return c.json({ ok: true, status: result.status });
});

// ── Platform-admin surfaces ───────────────────────────────────────────────────

accessRoutes.get(
  "/admin/demo-requests",
  requireSession,
  requirePlatformAdmin,
  async (c) => {
    const status = c.req.query("status") ?? "pending";
    if (!["pending", "approved", "rejected", "all"].includes(status)) {
      return c.json(
        { error: "validation_error", issues: [{ message: "invalid status" }] },
        400,
      );
    }

    const db = getDb(c.env);
    const rows =
      status === "all"
        ? await db
            .select()
            .from(schema.demoRequests)
            .orderBy(desc(schema.demoRequests.createdAt), desc(sql`"demo_requests".rowid`))
        : await db
            .select()
            .from(schema.demoRequests)
            .where(
              eq(
                schema.demoRequests.status,
                status as "pending" | "approved" | "rejected",
              ),
            )
            .orderBy(desc(schema.demoRequests.createdAt), desc(sql`"demo_requests".rowid`));

    return c.json({
      requests: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        company: r.company,
        message: r.message,
        status: r.status,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
      })),
    });
  },
);

accessRoutes.post(
  "/admin/demo-requests/:id/approve",
  requireSession,
  requirePlatformAdmin,
  async (c) => {
    const requestId = c.req.param("id");
    if (!requestId) return c.json({ error: "not_found" }, 404);
    const result = await applyReview(c.env, {
      requestId,
      action: "approve",
      reviewerUserId: c.get("userId")!,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status as 404);
    return c.json({ ok: true, status: result.status });
  },
);

accessRoutes.post(
  "/admin/demo-requests/:id/reject",
  requireSession,
  requirePlatformAdmin,
  async (c) => {
    const requestId = c.req.param("id");
    if (!requestId) return c.json({ error: "not_found" }, 404);
    const result = await applyReview(c.env, {
      requestId,
      action: "reject",
      reviewerUserId: c.get("userId")!,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status as 404);
    return c.json({ ok: true, status: result.status });
  },
);

accessRoutes.get("/admin/grants", requireSession, requirePlatformAdmin, async (c) => {
  const db = getDb(c.env);
  const grants = await db
    .select()
    .from(schema.accessGrants)
    .orderBy(desc(schema.accessGrants.updatedAt), desc(sql`"access_grants".rowid`));

  return c.json({
    grants: grants.map((g) => ({
      id: g.id,
      email: g.email,
      status: g.status,
      note: g.note,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    })),
  });
});

accessRoutes.post(
  "/admin/grants",
  requireSession,
  requirePlatformAdmin,
  zv(grantSchema),
  async (c) => {
    const data = c.req.valid("json");
    const email = normalizeEmail(data.email);
    const db = getDb(c.env);
    const { id } = await upsertAccessGrant(db, {
      email,
      grantedByUserId: c.get("userId")!,
      note: data.note?.trim() || "Direct invite",
    });

    await sendEmail(c.env, {
      to: email,
      subject: "You're invited to Family Vault",
      html: accessApprovedEmail({
        name: null,
        loginUrl: `${c.env.APP_URL}/login`,
      }),
    });

    return c.json({ ok: true, grant: { id, email, status: "approved" } }, 201);
  },
);

accessRoutes.post(
  "/admin/grants/revoke",
  requireSession,
  requirePlatformAdmin,
  zv(revokeSchema),
  async (c) => {
    const { email } = c.req.valid("json");
    const db = getDb(c.env);
    await revokeAccessGrant(db, email, c.get("userId")!);
    return c.json({ ok: true, status: "revoked" });
  },
);
