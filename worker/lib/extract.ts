/**
 * Document search indexing + (optional) OCR extraction.
 *
 * `reindexDocument` always runs on writes and builds a lightweight, normalized
 * keyword blob from the document metadata + current file name — so search works
 * immediately with no external services.
 *
 * `runDocumentExtraction` is the background "process after upload" pass (think
 * YouTube indexing a video). It only does anything when an OCR provider is
 * configured (env.OCR_PROVIDER_URL); otherwise it's a safe no-op. It downloads
 * each pending file and stores the extracted text so search can match document
 * *contents*, not just metadata.
 */
import { and, eq, isNotNull, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { schema } from "../db/client";
import type { Env } from "../types";
import { getDriveAccessToken, downloadDriveFile, isDriveConfigured } from "./drive";

/** Normalize free text into a deduped, lowercase, space-joined keyword blob. */
export function buildKeywords(parts: Array<string | null | undefined>): string {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  const tokens = text.match(/[a-z0-9]+/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (t.length < 2 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.join(" ").slice(0, 4000);
}

/** Rebuild a document's keyword index from its metadata + current file name. */
export async function reindexDocument(db: Db, documentId: string): Promise<void> {
  const doc = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId))
    .get();
  if (!doc) return;

  const file = await db
    .select({ fileName: schema.files.fileName })
    .from(schema.files)
    .where(
      and(
        eq(schema.files.documentId, documentId),
        eq(schema.files.isCurrent, true),
      ),
    )
    .get();

  const keywords = buildKeywords([
    doc.title,
    doc.category,
    doc.description,
    file?.fileName,
  ]);

  const now = Math.floor(Date.now() / 1000);
  const existing = await db
    .select({ documentId: schema.documentExtracts.documentId })
    .from(schema.documentExtracts)
    .where(eq(schema.documentExtracts.documentId, documentId))
    .get();

  if (existing) {
    await db
      .update(schema.documentExtracts)
      .set({ keywords, updatedAt: now })
      .where(eq(schema.documentExtracts.documentId, documentId));
  } else {
    await db
      .insert(schema.documentExtracts)
      .values({ documentId, keywords, status: "pending", updatedAt: now });
  }
}

/** True when a text-extraction (OCR) provider is configured. */
export function isExtractionConfigured(env: Env): boolean {
  return Boolean(env.OCR_PROVIDER_URL) && isDriveConfigured(env);
}

/**
 * Background extraction pass. No-ops unless an OCR provider is configured.
 * Processes a bounded batch of pending documents per run so a daily cron
 * gradually indexes the whole library. Each document is isolated in try/catch.
 */
export async function runDocumentExtraction(
  db: Db,
  env: Env,
  batchSize = 10,
): Promise<{ processed: number }> {
  if (!isExtractionConfigured(env)) return { processed: 0 };

  const pending = await db
    .select({
      documentId: schema.documentExtracts.documentId,
      familyId: schema.documents.familyId,
      currentFileId: schema.documents.currentFileId,
    })
    .from(schema.documentExtracts)
    .innerJoin(
      schema.documents,
      eq(schema.documentExtracts.documentId, schema.documents.id),
    )
    .where(
      and(
        eq(schema.documentExtracts.status, "pending"),
        isNotNull(schema.documents.currentFileId),
        ne(schema.documents.status, "trashed"),
      ),
    )
    .limit(batchSize);

  let processed = 0;
  for (const row of pending) {
    try {
      const file = await db
        .select()
        .from(schema.files)
        .where(eq(schema.files.id, row.currentFileId!))
        .get();
      const family = await db
        .select()
        .from(schema.families)
        .where(eq(schema.families.id, row.familyId))
        .get();
      if (!file || !family) {
        await markExtract(db, row.documentId, "skipped");
        continue;
      }

      const token = await getDriveAccessToken(env, family.ownerUserId);
      const driveRes = await downloadDriveFile(token, file.driveFileId);
      const ocrRes = await fetch(env.OCR_PROVIDER_URL!, {
        method: "POST",
        headers: {
          ...(env.OCR_API_KEY ? { Authorization: `Bearer ${env.OCR_API_KEY}` } : {}),
          "Content-Type": file.mimeType,
        },
        body: driveRes.body,
      });
      if (!ocrRes.ok) {
        await markExtract(db, row.documentId, "failed");
        continue;
      }
      const { text } = (await ocrRes.json()) as { text?: string };
      const extractedText = (text ?? "").slice(0, 20_000);

      // Keep the metadata keywords; add the extracted body as a separate
      // searchable column so search matches keywords OR contents.
      await db
        .update(schema.documentExtracts)
        .set({
          text: extractedText,
          status: "done",
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(schema.documentExtracts.documentId, row.documentId));
      processed++;
    } catch (err) {
      console.error(`[extract] document ${row.documentId} failed:`, err);
      await markExtract(db, row.documentId, "failed");
    }
  }
  return { processed };
}

async function markExtract(
  db: Db,
  documentId: string,
  status: "skipped" | "failed",
): Promise<void> {
  await db
    .update(schema.documentExtracts)
    .set({ status, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.documentExtracts.documentId, documentId));
}
