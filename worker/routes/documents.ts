import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { insertAuditEvent, audit, ACTIONS } from "../lib/audit";
import {
  getStorageAccessToken,
  isStorageConfigured,
  createDriveFolder,
  createResumableUploadUrl,
  downloadDriveFile,
  STORAGE_ACCOUNT_ID,
  DriveError,
} from "../lib/drive";
import {
  buildR2Key,
  isR2Configured,
  putObject,
  getObject,
  R2_MAX_BYTES,
} from "../lib/r2";

export const documentRoutes = new Hono<HonoEnv>();

// ── Validation schemas ────────────────────────────────────────────────────────

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-mm-dd")
  .optional();

const createDocumentSchema = z.object({
  familyId: z.string().optional(),
  title: z.string().min(1).max(300),
  category: z.string().max(100).optional().default("other"),
  subjectMemberId: z.string().optional(),
  description: z.string().max(2000).optional(),
  expiryDate: isoDate,
  issuedDate: isoDate,
  visibility: z.enum(["family", "private"]).optional().default("family"),
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  category: z.string().max(100).optional(),
  subjectMemberId: z.string().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  expiryDate: isoDate,
  issuedDate: isoDate,
  visibility: z.enum(["family", "private"]).optional(),
});

const recordFileSchema = z.object({
  driveFileId: z.string().min(1),
  fileName: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().nonnegative().optional().default(0),
});

const uploadUrlSchema = z.object({
  fileName: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
});

const createCommentSchema = z.object({
  body: z.string().min(1).max(2000),
});

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

// ── Visibility helper ─────────────────────────────────────────────────────────

/**
 * Returns the Drizzle WHERE condition that enforces private-document visibility.
 * SECURITY: members can only see family-visible docs or their own private docs.
 * Owners and admins see everything.
 */
function visibilityWhere(
  familyId: string,
  userId: string,
  role: string,
) {
  const baseWhere = and(
    eq(schema.documents.familyId, familyId),
    ne(schema.documents.status, "trashed"),
  );

  if (role === "owner" || role === "admin") {
    return baseWhere;
  }

  return and(
    baseWhere,
    or(
      eq(schema.documents.visibility, "family"),
      eq(schema.documents.ownerUserId, userId),
    ),
  );
}

// ── Helper: ensure family has a Drive folder ──────────────────────────────────

async function ensureDriveFolder(
  env: HonoEnv["Bindings"],
  family: typeof schema.families.$inferSelect,
): Promise<string> {
  if (family.driveFolderId) return family.driveFolderId;

  const db = getDb(env);
  // Per-family subfolder lives under the shared storage account's root folder.
  const storage = await db
    .select({ rootFolderId: schema.storageAccounts.rootFolderId })
    .from(schema.storageAccounts)
    .where(eq(schema.storageAccounts.id, STORAGE_ACCOUNT_ID))
    .get();

  const accessToken = await getStorageAccessToken(env);
  const folderId = await createDriveFolder(
    accessToken,
    `Family Vault — ${family.name}`,
    storage?.rootFolderId ?? undefined,
  );

  await db
    .update(schema.families)
    .set({ driveFolderId: folderId })
    .where(eq(schema.families.id, family.id));

  return folderId;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /documents?familyId=:fid — list active documents (visibility-filtered).
documentRoutes.get("/", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const db = getDb(c.env);
  let familyId = c.req.query("familyId");

  if (!familyId) {
    // Resolve user's first active family
    const membership = await db
      .select({ familyId: schema.familyMembers.familyId })
      .from(schema.familyMembers)
      .where(
        and(
          eq(schema.familyMembers.userId, userId),
          eq(schema.familyMembers.status, "active"),
        ),
      )
      .get();
    if (!membership) return c.json({ documents: [] });
    familyId = membership.familyId;
  }

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const documents = await db
    .select()
    .from(schema.documents)
    .where(visibilityWhere(familyId, userId, membership.role))
    .orderBy(desc(schema.documents.updatedAt));

  return c.json({ documents });
});

// POST /documents — create document metadata record.
documentRoutes.post("/", requireSession, zv(createDocumentSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");
  const db = getDb(c.env);

  let familyId = data.familyId;
  if (!familyId) {
    // Resolve user's first active family
    const m = await db
      .select({ familyId: schema.familyMembers.familyId })
      .from(schema.familyMembers)
      .where(
        and(
          eq(schema.familyMembers.userId, userId),
          eq(schema.familyMembers.status, "active"),
        ),
      )
      .get();
    if (!m) {
      return c.json({ error: "no_family_membership" }, 400);
    }
    familyId = m.familyId;
  }

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const docId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db.insert(schema.documents).values({
    id: docId,
    familyId,
    ownerUserId: userId,
    title: data.title,
    category: data.category,
    subjectMemberId: data.subjectMemberId,
    description: data.description,
    expiryDate: data.expiryDate,
    issuedDate: data.issuedDate,
    visibility: data.visibility,
    status: "active",
    updatedAt: now,
  });

  await insertAuditEvent(db, {
    familyId,
    actorUserId: userId,
    action: ACTIONS.DOCUMENT_CREATED,
    targetType: "document",
    targetId: docId,
    visibility: data.visibility,
    meta: { title: data.title, visibility: data.visibility },
  });

  const document = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, docId))
    .get();

  return c.json({ document }, 201);
});

// GET /documents/:id — get a single document (visibility enforced).
documentRoutes.get("/:id", requireSession, async (c) => {
  const { id: docId } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const doc = await db
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.id, docId), ne(schema.documents.status, "trashed")))
    .get();

  if (!doc) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, doc.familyId);
  if (membership instanceof Response) return membership;

  // Enforce private visibility
  if (
    doc.visibility === "private" &&
    doc.ownerUserId !== userId &&
    membership.role === "member"
  ) {
    return c.json({ error: "not_found" }, 404); // 404 not 403 (don't reveal existence)
  }

  // Audit a view, deduped via a short-TTL KV key so repeat opens don't spam the log.
  if (c.env.KV) {
    const viewKey = `seen:view:${userId}:${docId}`;
    if (!(await c.env.KV.get(viewKey))) {
      await c.env.KV.put(viewKey, "1", { expirationTtl: 300 });
      await audit(c, {
        familyId: doc.familyId,
        action: ACTIONS.DOCUMENT_VIEWED,
        targetType: "document",
        targetId: docId,
        visibility: doc.visibility,
      });
    }
  }

  return c.json({ document: doc });
});

// PATCH /documents/:id — update document metadata.
documentRoutes.patch("/:id", requireSession, zv(updateDocumentSchema), async (c) => {
  const { id: docId } = c.req.param();
  const userId = c.get("userId")!;
  const updates = c.req.valid("json");
  const db = getDb(c.env);

  const doc = await db
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.id, docId), ne(schema.documents.status, "trashed")))
    .get();

  if (!doc) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, doc.familyId);
  if (membership instanceof Response) return membership;

  // Only owner or admin can edit private docs that don't belong to them
  if (
    doc.visibility === "private" &&
    doc.ownerUserId !== userId &&
    membership.role === "member"
  ) {
    return c.json({ error: "not_found" }, 404);
  }

  const set: Partial<typeof schema.documents.$inferInsert> = {
    updatedAt: Math.floor(Date.now() / 1000),
  };
  if (updates.title !== undefined) set.title = updates.title;
  if (updates.category !== undefined) set.category = updates.category;
  if (updates.description !== undefined) set.description = updates.description ?? undefined;
  if (updates.subjectMemberId !== undefined) set.subjectMemberId = updates.subjectMemberId ?? undefined;
  if (updates.expiryDate !== undefined) set.expiryDate = updates.expiryDate;
  if (updates.issuedDate !== undefined) set.issuedDate = updates.issuedDate;
  if (updates.visibility !== undefined) set.visibility = updates.visibility;

  await db.update(schema.documents).set(set).where(eq(schema.documents.id, docId));

  const document = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, docId))
    .get();

  return c.json({ document });
});

// DELETE /documents/:id — soft delete (status = trashed).
documentRoutes.delete("/:id", requireSession, async (c) => {
  const { id: docId } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const doc = await db
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.id, docId), ne(schema.documents.status, "trashed")))
    .get();

  if (!doc) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, doc.familyId);
  if (membership instanceof Response) return membership;

  // Members can only delete their own documents; owners/admins can delete any
  if (doc.ownerUserId !== userId && membership.role === "member") {
    return c.json({ error: "forbidden" }, 403);
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(schema.documents)
    .set({ status: "trashed", trashedAt: now })
    .where(eq(schema.documents.id, docId));

  await insertAuditEvent(db, {
    familyId: doc.familyId,
    actorUserId: userId,
    action: ACTIONS.DOCUMENT_TRASHED,
    targetType: "document",
    targetId: docId,
    visibility: doc.visibility,
    meta: { title: doc.title },
  });

  return c.json({ ok: true });
});

// POST /documents/:id/files/upload — multipart upload to R2 (primary path).
// Fields: `file` (required File), optional `contentType` string override.
// MUST be registered before /:id/files/:fid to avoid route collision.
documentRoutes.post("/:id/files/upload", requireSession, async (c) => {
  const { id: docId } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const doc = await db
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.id, docId), ne(schema.documents.status, "trashed")))
    .get();

  if (!doc) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, doc.familyId);
  if (membership instanceof Response) return membership;

  // Enforce private visibility on upload
  if (
    doc.visibility === "private" &&
    doc.ownerUserId !== userId &&
    membership.role === "member"
  ) {
    return c.json({ error: "not_found" }, 404);
  }

  if (!isR2Configured(c.env) || !c.env.FILES) {
    return c.json(
      {
        error: "r2_not_configured",
        message:
          "Document cloud storage (R2) is not configured yet. Files cannot be uploaded until the FILES bucket is bound.",
      },
      503,
    );
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json(
      {
        error: "validation_error",
        issues: [{ path: ["file"], message: "Expected multipart form data" }],
      },
      400,
    );
  }

  const fileField = form.get("file");
  // Duck-type the multipart part (Workers FormDataEntryValue typing varies).
  const part = fileField as unknown;
  const isBlobLike =
    part !== null &&
    typeof part === "object" &&
    typeof (part as { arrayBuffer?: unknown }).arrayBuffer === "function" &&
    typeof (part as { size?: unknown }).size === "number";

  if (!isBlobLike) {
    return c.json(
      {
        error: "validation_error",
        issues: [{ path: ["file"], message: "file is required" }],
      },
      400,
    );
  }

  const blob = part as {
    arrayBuffer: () => Promise<ArrayBuffer>;
    size: number;
    type?: string;
    name?: string;
  };
  const fileName = blob.name && blob.name.length > 0 ? blob.name : "file";
  const contentTypeOverride = form.get("contentType");
  const mimeType =
    (typeof contentTypeOverride === "string" && contentTypeOverride.trim()) ||
    blob.type ||
    "application/octet-stream";

  if (blob.size > R2_MAX_BYTES) {
    return c.json(
      {
        error: "validation_error",
        issues: [
          {
            path: ["file"],
            message: `File too large. Maximum size is ${R2_MAX_BYTES / (1024 * 1024)} MB.`,
          },
        ],
      },
      400,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(schema.files)
    .set({ isCurrent: false })
    .where(and(eq(schema.files.documentId, docId), eq(schema.files.isCurrent, true)));

  const prev = await db
    .select({ version: schema.files.version })
    .from(schema.files)
    .where(eq(schema.files.documentId, docId))
    .orderBy(desc(schema.files.version))
    .get();

  const version = (prev?.version ?? 0) + 1;
  const fileId = crypto.randomUUID();
  const r2Key = buildR2Key({
    familyId: doc.familyId,
    documentId: docId,
    fileId,
    fileName,
  });

  const bytes = await blob.arrayBuffer();
  await putObject(c.env.FILES, r2Key, bytes, {
    contentType: mimeType,
    customMetadata: { documentId: docId, fileId, familyId: doc.familyId },
  });

  await db.insert(schema.files).values({
    id: fileId,
    documentId: docId,
    storageProvider: "r2",
    r2Key,
    driveFileId: null,
    fileName,
    mimeType,
    sizeBytes: blob.size,
    version,
    isCurrent: true,
    status: "active",
  });

  await db
    .update(schema.documents)
    .set({ currentFileId: fileId, updatedAt: now })
    .where(eq(schema.documents.id, docId));

  await insertAuditEvent(db, {
    familyId: doc.familyId,
    actorUserId: userId,
    action: ACTIONS.DOCUMENT_UPLOADED,
    targetType: "document",
    targetId: docId,
    visibility: doc.visibility,
    meta: {
      fileName,
      mimeType,
      sizeBytes: blob.size,
      version,
      storageProvider: "r2",
    },
  });

  const file = await db
    .select()
    .from(schema.files)
    .where(eq(schema.files.id, fileId))
    .get();

  return c.json({ file }, 201);
});

// POST /documents/:id/files/upload-url — generate a Drive resumable upload URL.
// Legacy / optional path when Drive is connected. Prefer R2 multipart upload.
// MUST be registered before /:id/files/:fid to avoid route collision.
documentRoutes.post("/:id/files/upload-url", requireSession, zv(uploadUrlSchema), async (c) => {
  const { id: docId } = c.req.param();
  const { fileName, mimeType } = c.req.valid("json");
  const db = getDb(c.env);

  const doc = await db
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.id, docId), ne(schema.documents.status, "trashed")))
    .get();

  if (!doc) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, doc.familyId);
  if (membership instanceof Response) return membership;

  if (!(await isStorageConfigured(c.env))) {
    return c.json({ error: "storage_not_configured" }, 503);
  }

  try {
    const family = await db
      .select()
      .from(schema.families)
      .where(eq(schema.families.id, doc.familyId))
      .get();

    if (!family) return c.json({ error: "not_found" }, 404);

    const folderId = await ensureDriveFolder(c.env, family);
    const accessToken = await getStorageAccessToken(c.env);
    const uploadUrl = await createResumableUploadUrl(accessToken, folderId, fileName, mimeType);

    return c.json({ uploadUrl });
  } catch (e) {
    if (e instanceof DriveError) {
      return c.json({ error: "drive_error", detail: e.message }, e.statusCode as 502 | 503);
    }
    throw e;
  }
});

// POST /documents/:id/files — record file metadata after client uploads to Drive.
documentRoutes.post("/:id/files", requireSession, zv(recordFileSchema), async (c) => {
  const { id: docId } = c.req.param();
  const userId = c.get("userId")!;
  const { driveFileId, fileName, mimeType, sizeBytes } = c.req.valid("json");
  const db = getDb(c.env);

  const doc = await db
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.id, docId), ne(schema.documents.status, "trashed")))
    .get();

  if (!doc) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, doc.familyId);
  if (membership instanceof Response) return membership;

  // Mark previous current file as non-current
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(schema.files)
    .set({ isCurrent: false })
    .where(and(eq(schema.files.documentId, docId), eq(schema.files.isCurrent, true)));

  // Get next version number
  const prev = await db
    .select({ version: schema.files.version })
    .from(schema.files)
    .where(eq(schema.files.documentId, docId))
    .orderBy(desc(schema.files.version))
    .get();

  const version = (prev?.version ?? 0) + 1;
  const fileId = crypto.randomUUID();

  await db.insert(schema.files).values({
    id: fileId,
    documentId: docId,
    storageProvider: "drive",
    r2Key: null,
    driveFileId,
    fileName,
    mimeType,
    sizeBytes,
    version,
    isCurrent: true,
    status: "active",
  });

  await db
    .update(schema.documents)
    .set({ currentFileId: fileId, updatedAt: now })
    .where(eq(schema.documents.id, docId));

  await insertAuditEvent(db, {
    familyId: doc.familyId,
    actorUserId: userId,
    action: ACTIONS.DOCUMENT_UPLOADED,
    targetType: "document",
    targetId: docId,
    visibility: doc.visibility,
    meta: { fileName, mimeType, sizeBytes, version, storageProvider: "drive" },
  });

  const file = await db
    .select()
    .from(schema.files)
    .where(eq(schema.files.id, fileId))
    .get();

  return c.json({ file }, 201);
});

// GET /documents/:id/files — list files for a document (visibility enforced).
documentRoutes.get("/:id/files", requireSession, async (c) => {
  const { id: docId } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const doc = await db
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.id, docId), ne(schema.documents.status, "trashed")))
    .get();

  if (!doc) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, doc.familyId);
  if (membership instanceof Response) return membership;

  // Enforce private visibility
  if (
    doc.visibility === "private" &&
    doc.ownerUserId !== userId &&
    membership.role === "member"
  ) {
    return c.json({ error: "not_found" }, 404);
  }

  const files = await db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.documentId, docId), eq(schema.files.status, "active")))
    .orderBy(desc(schema.files.version));

  return c.json({ files });
});

// GET /documents/:id/files/:fid/download — stream from R2 or proxy Drive.
// Always sets Content-Disposition: attachment to prevent inline execution.
documentRoutes.get("/:id/files/:fid/download", requireSession, async (c) => {
  const { id: docId, fid: fileId } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const doc = await db
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.id, docId), ne(schema.documents.status, "trashed")))
    .get();

  if (!doc) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, doc.familyId);
  if (membership instanceof Response) return membership;

  // Enforce private visibility on download
  if (
    doc.visibility === "private" &&
    doc.ownerUserId !== userId &&
    membership.role === "member"
  ) {
    return c.json({ error: "not_found" }, 404);
  }

  const file = await db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.id, fileId), eq(schema.files.documentId, docId)))
    .get();

  if (!file || file.status === "deleted") return c.json({ error: "not_found" }, 404);

  const dispositionHeaders = {
    "Content-Type": file.mimeType,
    "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  } as const;

  // ── R2 path ──────────────────────────────────────────────────────────────
  if (file.storageProvider === "r2" || (!file.driveFileId && file.r2Key)) {
    if (!isR2Configured(c.env) || !c.env.FILES || !file.r2Key) {
      return c.json(
        {
          error: "r2_not_configured",
          message: "Document cloud storage (R2) is not configured.",
        },
        503,
      );
    }

    const obj = await getObject(c.env.FILES, file.r2Key);
    if (!obj) return c.json({ error: "not_found" }, 404);

    await insertAuditEvent(db, {
      familyId: doc.familyId,
      actorUserId: userId,
      action: ACTIONS.DOCUMENT_DOWNLOADED,
      targetType: "document",
      targetId: docId,
      visibility: doc.visibility,
      meta: { fileId, fileName: file.fileName, storageProvider: "r2" },
    });

    return new Response(obj.body, {
      status: 200,
      headers: dispositionHeaders,
    });
  }

  // ── Drive path (legacy / optional) ───────────────────────────────────────
  if (!file.driveFileId) {
    return c.json({ error: "not_found" }, 404);
  }

  if (!(await isStorageConfigured(c.env))) {
    return c.json({ error: "storage_not_configured" }, 503);
  }

  try {
    const family = await db
      .select()
      .from(schema.families)
      .where(eq(schema.families.id, doc.familyId))
      .get();

    if (!family) return c.json({ error: "not_found" }, 404);

    const accessToken = await getStorageAccessToken(c.env);
    const driveRes = await downloadDriveFile(accessToken, file.driveFileId);

    await insertAuditEvent(db, {
      familyId: doc.familyId,
      actorUserId: userId,
      action: ACTIONS.DOCUMENT_DOWNLOADED,
      targetType: "document",
      targetId: docId,
      visibility: doc.visibility,
      meta: { fileId, fileName: file.fileName, storageProvider: "drive" },
    });

    return new Response(driveRes.body, {
      status: driveRes.status,
      headers: dispositionHeaders,
    });
  } catch (e) {
    if (e instanceof DriveError) {
      return c.json({ error: "drive_error", detail: e.message }, e.statusCode as 502 | 503);
    }
    throw e;
  }
});

// GET /documents/:id/comments — list non-deleted comments.
documentRoutes.get("/:id/comments", requireSession, async (c) => {
  const { id: docId } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const doc = await db
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.id, docId), ne(schema.documents.status, "trashed")))
    .get();

  if (!doc) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, doc.familyId);
  if (membership instanceof Response) return membership;

  // Enforce private visibility
  if (
    doc.visibility === "private" &&
    doc.ownerUserId !== userId &&
    membership.role === "member"
  ) {
    return c.json({ error: "not_found" }, 404);
  }

  const comments = await db
    .select({
      id: schema.documentComments.id,
      userId: schema.documentComments.userId,
      body: schema.documentComments.body,
      createdAt: schema.documentComments.createdAt,
      updatedAt: schema.documentComments.updatedAt,
      authorName: schema.users.name,
      authorPicture: schema.users.picture,
    })
    .from(schema.documentComments)
    .leftJoin(schema.users, eq(schema.documentComments.userId, schema.users.id))
    .where(
      and(
        eq(schema.documentComments.documentId, docId),
        isNull(schema.documentComments.deletedAt),
      ),
    )
    .orderBy(schema.documentComments.createdAt);

  return c.json({ comments });
});

// POST /documents/:id/comments — add a comment.
documentRoutes.post("/:id/comments", requireSession, zv(createCommentSchema), async (c) => {
  const { id: docId } = c.req.param();
  const userId = c.get("userId")!;
  const { body: commentBody } = c.req.valid("json");
  const db = getDb(c.env);

  const doc = await db
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.id, docId), ne(schema.documents.status, "trashed")))
    .get();

  if (!doc) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, doc.familyId);
  if (membership instanceof Response) return membership;

  if (
    doc.visibility === "private" &&
    doc.ownerUserId !== userId &&
    membership.role === "member"
  ) {
    return c.json({ error: "not_found" }, 404);
  }

  const commentId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db.insert(schema.documentComments).values({
    id: commentId,
    documentId: docId,
    userId,
    body: commentBody,
    updatedAt: now,
  });

  const comment = await db
    .select()
    .from(schema.documentComments)
    .where(eq(schema.documentComments.id, commentId))
    .get();

  return c.json({ comment }, 201);
});

// DELETE /documents/:id/comments/:cid — soft-delete a comment (own comments only, or admin+).
documentRoutes.delete("/:id/comments/:cid", requireSession, async (c) => {
  const { id: docId, cid: commentId } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const comment = await db
    .select()
    .from(schema.documentComments)
    .where(
      and(
        eq(schema.documentComments.id, commentId),
        eq(schema.documentComments.documentId, docId),
      ),
    )
    .get();

  if (!comment || comment.deletedAt !== null) return c.json({ error: "not_found" }, 404);

  // Get doc to check family membership
  const doc = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, docId))
    .get();

  if (!doc) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, doc.familyId);
  if (membership instanceof Response) return membership;

  // Only the comment author or admins/owners can delete
  if (comment.userId !== userId && membership.role === "member") {
    return c.json({ error: "forbidden" }, 403);
  }

  await db
    .update(schema.documentComments)
    .set({ deletedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.documentComments.id, commentId));

  return c.json({ ok: true });
});
