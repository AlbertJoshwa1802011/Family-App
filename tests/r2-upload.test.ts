/**
 * R2 document storage — route contract + key builder unit tests.
 * Uses an in-memory mock bucket; no live Cloudflare R2 required.
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import {
  buildR2Key,
  safeFileName,
  R2_MAX_BYTES,
} from "../worker/lib/r2";
import {
  createTestEnv,
  createTestR2,
  seedActor,
  seedDocument,
  seedFamily,
  seedUser,
} from "./helpers/testEnv";

describe("r2 key helpers", () => {
  it("safeFileName strips path separators and control chars", () => {
    expect(safeFileName("passport/../secret.pdf")).toBe("passport_.._secret.pdf");
    expect(safeFileName("  hello world  ")).toBe("hello world");
    expect(safeFileName("")).toBe("file");
  });

  it("buildR2Key follows families/{fid}/documents/{did}/{fileId}/{name}", () => {
    expect(
      buildR2Key({
        familyId: "fam-1",
        documentId: "doc-1",
        fileId: "file-1",
        fileName: "Passport Scan.pdf",
      }),
    ).toBe("families/fam-1/documents/doc-1/file-1/Passport Scan.pdf");
  });
});

describe("POST /api/documents/:id/files/upload", () => {
  it("returns 401 without a session", async () => {
    const res = await app.request("/api/documents/doc-1/files/upload", {
      method: "POST",
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });

  it("returns 503 r2_not_configured when FILES binding is missing", async () => {
    const { env, sqlite } = createTestEnv(); // no FILES
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const doc = seedDocument(sqlite, {
      familyId: family.id,
      ownerUserId: actor.userId,
    });

    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "scan.pdf", { type: "application/pdf" }),
    );

    const res = await app.request(
      `/api/documents/${doc.id}/files/upload`,
      { method: "POST", headers: { Cookie: actor.cookie }, body: form },
      env,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; message?: string };
    expect(body.error).toBe("r2_not_configured");
    expect(body.message).toMatch(/R2/i);
  });

  it("returns 400 validation_error when file field is missing", async () => {
    const { env, sqlite } = createTestEnv({ FILES: createTestR2() });
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const doc = seedDocument(sqlite, {
      familyId: family.id,
      ownerUserId: actor.userId,
    });

    const form = new FormData();
    form.append("contentType", "application/pdf");

    const res = await app.request(
      `/api/documents/${doc.id}/files/upload`,
      { method: "POST", headers: { Cookie: actor.cookie }, body: form },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues?: unknown[] };
    expect(body.error).toBe("validation_error");
    expect(body.issues).toBeTruthy();
  });

  it("uploads to mock R2 and returns file meta", async () => {
    const bucket = createTestR2();
    const { env, sqlite } = createTestEnv({ FILES: bucket });
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const doc = seedDocument(sqlite, {
      familyId: family.id,
      ownerUserId: actor.userId,
    });

    const bytes = new Uint8Array([37, 80, 68, 70]); // %PDF
    const form = new FormData();
    form.append(
      "file",
      new File([bytes], "passport.pdf", { type: "application/pdf" }),
    );

    const res = await app.request(
      `/api/documents/${doc.id}/files/upload`,
      { method: "POST", headers: { Cookie: actor.cookie }, body: form },
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      file: {
        id: string;
        storageProvider: string;
        r2Key: string | null;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
      };
    };
    expect(body.file.storageProvider).toBe("r2");
    expect(body.file.fileName).toBe("passport.pdf");
    expect(body.file.mimeType).toBe("application/pdf");
    expect(body.file.sizeBytes).toBe(4);
    expect(body.file.r2Key).toContain(`families/${family.id}/documents/${doc.id}/`);

    const dl = await app.request(
      `/api/documents/${doc.id}/files/${body.file.id}/download`,
      { headers: { Cookie: actor.cookie } },
      env,
    );
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-disposition")).toMatch(/attachment/);
    expect(dl.headers.get("x-content-type-options")).toBe("nosniff");
    const downloaded = new Uint8Array(await dl.arrayBuffer());
    expect([...downloaded]).toEqual([37, 80, 68, 70]);
  });

  it("enforces a 25 MiB soft cap constant", () => {
    expect(R2_MAX_BYTES).toBe(25 * 1024 * 1024);
  });
});
