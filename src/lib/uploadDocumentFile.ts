import { api } from "./api";
import { titleFromFileName } from "./documentTitle";

/**
 * Attach a file to an existing document.
 *
 * Worker never sees file bytes:
 * 1. POST /files/upload-url → Drive resumable session URL
 * 2. PUT the file straight to Drive
 * 3. POST /files to record Drive fileId + metadata in D1
 */
export async function uploadDocumentFile(
  documentId: string,
  file: File,
): Promise<void> {
  const mimeType = file.type || "application/octet-stream";
  const { uploadUrl } = await api<{ uploadUrl: string }>(
    `/documents/${documentId}/files/upload-url`,
    {
      method: "POST",
      body: JSON.stringify({ fileName: file.name, mimeType }),
    },
  );

  const driveRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: file,
  });
  if (!driveRes.ok) {
    throw new Error(`Drive upload failed (${driveRes.status})`);
  }
  const driveFile = (await driveRes.json()) as { id: string };

  await api(`/documents/${documentId}/files`, {
    method: "POST",
    body: JSON.stringify({
      driveFileId: driveFile.id,
      fileName: file.name,
      mimeType,
      sizeBytes: file.size,
    }),
  });
}

export interface CreatedDocument {
  id: string;
  title: string;
  category: string;
}

/**
 * Create a document from a file (title from filename) and upload bytes.
 * Category comes from /documents/suggest-category when available.
 */
export async function createAndUploadDocument(
  familyId: string,
  file: File,
): Promise<CreatedDocument> {
  const title = titleFromFileName(file.name);

  let category = "other";
  try {
    const suggestion = await api<{ category: string | null }>(
      "/documents/suggest-category",
      {
        method: "POST",
        body: JSON.stringify({ title, fileName: file.name }),
      },
    );
    if (suggestion.category) category = suggestion.category;
  } catch {
    // Suggestion is best-effort — uploads must not fail if AI/heuristics flake.
  }

  const { document } = await api<{ document: CreatedDocument }>("/documents", {
    method: "POST",
    body: JSON.stringify({
      familyId,
      title,
      category,
      visibility: "family",
    }),
  });

  await uploadDocumentFile(document.id, file);
  return document;
}
