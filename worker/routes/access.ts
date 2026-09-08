import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import type { AppContext, HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { generateRandom, sha256Hex } from "../lib/crypto";
import { checkRateLimit, clientIp } from "../lib/rateLimit";
import { sendEmail } from "../lib/email";
import { absoluteAppUrl } from "../lib/publicUrl";
import {
  accessApprovedEmail,
  accessRejectedEmail,
  accessReviewResultHtml,
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

/** Email-safe path (no `?` / `&`) so Gmail/Outlook cannot mangle the action. */
function reviewUrls(appUrl: string, token: string) {
  const encoded = encodeURIComponent(token);
  return {
    approveUrl: `${appUrl}/api/access/review/approve/${encoded}`,
    rejectUrl: `${appUrl}/api/access/review/reject/${encoded}`,
    adminUrl: `${appUrl}/admin/access`,
    loginUrl: `${appUrl}/login`,
  };
}

const REVIEW_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
} as const;

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
        loginUrl: `${absoluteAppUrl(env)}/login`,
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

  const appUrl = absoluteAppUrl(c.env, c.req.url);
  const { approveUrl, rejectUrl, adminUrl, loginUrl } = reviewUrls(appUrl, token);
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
        adminUrl,
      }),
      text: [
        `Access request from ${data.name.trim()} <${email}>`,
        `Approve: ${approveUrl}`,
        `Reject: ${rejectUrl}`,
        `Admin: ${adminUrl}`,
      ].join("\n"),
    });
  }

  await sendEmail(c.env, {
    to: email,
    subject: "We received your Family Vault access request",
    html: demoRequestReceivedEmail({
      name: data.name.trim(),
      appUrl: loginUrl,
    }),
  });

  return c.json({ ok: true, status: "pending" }, 201);
});

async function reviewByToken(
  env: HonoEnv["Bindings"],
  token: string,
  action: "approve" | "reject",
) {
  const parsed = reviewSchema.safeParse({ token, action });
  if (!parsed.success) {
    return { ok: false as const, error: "validation_error", status: 400 };
  }

  const tokenHash = await sha256Hex(parsed.data.token);
  const db = getDb(env);
  const row = await db
    .select({ id: schema.demoRequests.id, status: schema.demoRequests.status })
    .from(schema.demoRequests)
    .where(eq(schema.demoRequests.reviewTokenHash, tokenHash))
    .get();

  if (!row) return { ok: false as const, error: "not_found", status: 404 };
  if (row.status !== "pending") {
    return { ok: false as const, error: "already_reviewed", status: 409 };
  }

  return applyReview(env, {
    requestId: row.id,
    action: parsed.data.action,
    reviewerUserId: null,
  });
}

function parseReviewAction(raw: string | undefined): "approve" | "reject" | null {
  if (raw === "approve" || raw === "reject") return raw;
  return null;
}

function reviewLanding(c: AppContext, opts: {
  status: number;
  kind: "approved" | "rejected" | "already" | "error";
  title: string;
  message: string;
}) {
  const appUrl = absoluteAppUrl(c.env, c.req.url);
  return c.html(
    accessReviewResultHtml({
      kind: opts.kind,
      title: opts.title,
      message: opts.message,
      adminUrl: `${appUrl}/admin/access`,
      loginUrl: `${appUrl}/login`,
    }),
    { status: opts.status as 200 | 400 | 404, headers: REVIEW_HEADERS },
  );
}

/**
 * Email "Approve access" / "Reject" buttons are GET (Gmail cannot POST).
 * Handles:
 *   GET /api/access/review/approve/:token
 *   GET /api/access/review?token=&action=
 *   GET /access/review?token=&action=   (links already sitting in inboxes)
 */
export async function handlePublicReviewGet(c: AppContext) {
  const limited = await checkRateLimit(c, `access-review:${clientIp(c)}`, {
    limit: 20,
    windowSecs: 3600,
  });
  if (limited) return limited;

  const url = new URL(c.req.url);
  const pathAction = c.req.param("action");
  const pathToken = c.req.param("token");
  let action: "approve" | "reject";
  let token: string;

  if (pathToken) {
    const parsed = parseReviewAction(pathAction);
    if (!parsed) {
      return reviewLanding(c, {
        status: 400,
        kind: "error",
        title: "Couldn’t complete",
        message: "This review link is invalid.",
      });
    }
    action = parsed;
    token = pathToken.trim();
  } else {
    action =
      parseReviewAction(url.searchParams.get("action") ?? undefined) ?? "approve";
    token = (url.searchParams.get("token") ?? "").trim();
  }

  if (!token) {
    return reviewLanding(c, {
      status: 400,
      kind: "error",
      title: "Couldn’t complete",
      message: "This review link is missing a token.",
    });
  }

  const result = await reviewByToken(c.env, token, action);
  if (result.ok) {
    return reviewLanding(c, {
      status: 200,
      kind: result.status,
      title: result.status === "approved" ? "Access approved" : "Request rejected",
      message:
        result.status === "approved"
          ? "They can now sign in with Google using the email on their request."
          : "They’ve been notified that access wasn’t approved.",
    });
  }

  if (result.error === "already_reviewed") {
    return reviewLanding(c, {
      status: 200,
      kind: "already",
      title: "Already handled",
      message: "This access request was already reviewed.",
    });
  }

  return reviewLanding(c, {
    status: result.status === 400 ? 400 : 404,
    kind: "error",
    title: "Couldn’t complete",
    message:
      result.error === "validation_error"
        ? "This review link is invalid."
        : "This review link is invalid or has expired.",
  });
}

// GET /access/review/:action/:token — email-safe (no query string).
accessRoutes.get("/review/:action/:token", handlePublicReviewGet);
// GET /access/review?token=&action= — still works if a client rewrites the path URL.
accessRoutes.get("/review", handlePublicReviewGet);

// POST /access/review — SPA landing page (JSON).
accessRoutes.post("/review", zv(reviewSchema), async (c) => {
  const limited = await checkRateLimit(c, `access-review:${clientIp(c)}`, {
    limit: 20,
    windowSecs: 3600,
  });
  if (limited) return limited;

  const { token, action } = c.req.valid("json");
  const result = await reviewByToken(c.env, token, action);
  if (!result.ok) {
    const status = result.status === 409 ? 409 : result.status === 400 ? 400 : 404;
    return c.json(
      { error: result.error, ...(result.error === "already_reviewed" ? { status: "already_reviewed" } : {}) },
      status,
    );
  }

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
        loginUrl: `${absoluteAppUrl(c.env, c.req.url)}/login`,
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
