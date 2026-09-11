/**
 * Worker-side document upload API contracts (photo + file).
 *
 * Complements the client helper tests: these hit the real Hono routes against
 * the sqlite D1 adapter so Zod shapes, authz, proxy upload, and finalize
 * versioning cannot silently drift.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../worker";
import {
  createTestEnv,
  seedActor,
  seedDocument,
  seedFamily,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

let t: TestEnv;
let familyId: string;
let familyOwnerId: string;
let owner: ReturnType<typeof seedActor>;

beforeEach(() => {
  t = createTestEnv();
  const ownerUser = seedUser(t.sqlite);
  familyOwnerId = ownerUser.id;
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
  owner = seedActor(t.sqlite, familyId, "owner", { name: "Olive Owner" });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function post(
  path: string,
  cookie: string,
  body: unknown,
): Promise<Response> {
  return app.request(
    path,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify(body),
    },
    t.env,
  );
}

function mockDriveUploadSuccess(driveFileId = "drive-proxied-1") {
  const DRIVE_LOC =
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("uploadType=resumable") && !url.includes("upload_id=")) {
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toMatch(/^Bearer /);
        return new Response(null, {
          status: 200,
          headers: { Location: DRIVE_LOC },
        });
      }
      if (url === DRIVE_LOC || url.includes("upload_id=test")) {
        expect(init?.method).toBe("PUT");
        return new Response(JSON.stringify({ id: driveFileId }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("googleapis.com/drive/v3/files") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "folder-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

function withDriveConfigured() {
  t = createTestEnv({
    GOOGLE_CLIENT_ID: "test-client",
    GOOGLE_CLIENT_SECRET: "test-secret",
  });
  const ownerUser = seedUser(t.sqlite);
  familyOwnerId = ownerUser.id;
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
  t.sqlite
    .prepare("UPDATE families SET drive_folder_id = ? WHERE id = ?")
    .run("folder-existing", familyId);
  owner = seedActor(t.sqlite, familyId, "owner", { name: "Olive Owner" });
}

describe("POST /documents/:id/files/upload-url — photo MIME contracts", () => {
  it.each([
    ["image/jpeg", "kids.jpg"],
    ["image/png", "scan.png"],
    ["image/heic", "IMG_0001.HEIC"],
    ["application/octet-stream", "IMG_0001.HEIC"],
    ["application/pdf", "passport.pdf"],
  ])("accepts mimeType %s for %s (does not 400)", async (mimeType, fileName) => {
    const doc = seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
    });
    const res = await post(
      `/api/documents/${doc.id}/files/upload-url`,
      owner.cookie,
      { fileName, mimeType },
    );
    expect(res.status).not.toBe(400);
    expect([401, 403, 404]).not.toContain(res.status);
    expect([503, 502, 200]).toContain(res.status);
  });

  it("rejects empty fileName with validation_error", async () => {
    const doc = seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
    });
    const res = await post(
      `/api/documents/${doc.id}/files/upload-url`,
      owner.cookie,
      { fileName: "", mimeType: "image/jpeg" },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("returns 401 without a session", async () => {
    const doc = seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
    });
    const res = await app.request(
      `/api/documents/${doc.id}/files/upload-url`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ fileName: "a.jpg", mimeType: "image/jpeg" }),
      },
      t.env,
    );
    expect(res.status).toBe(401);
  });

  it("forwards Origin on Drive resumable init (CORS for legacy browser PUT)", async () => {
    withDriveConfigured();
    await t.env.KV.put(`user:access_token:${familyOwnerId}`, "access-token-xyz");

    const seen: { origin?: string | null } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("uploadType=resumable")) {
          const headers = new Headers(init?.headers);
          seen.origin = headers.get("Origin");
          return new Response(null, {
            status: 200,
            headers: {
              Location:
                "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=1",
            },
          });
        }
        throw new Error(`unexpected ${url}`);
      }),
    );

    const doc = seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
    });
    const res = await post(
      `/api/documents/${doc.id}/files/upload-url`,
      owner.cookie,
      { fileName: "kids.jpg", mimeType: "image/jpeg" },
    );
    expect(res.status).toBe(200);
    expect(seen.origin).toBe("http://localhost");
    const body = (await res.json()) as { uploadUrl: string };
    expect(body.uploadUrl).toContain("googleapis.com");
  });
});

describe("POST /documents/:id/files/content — Worker-proxied upload", () => {
  beforeEach(async () => {
    withDriveConfigured();
    await t.env.KV.put(`user:access_token:${familyOwnerId}`, "access-token-xyz");
    mockDriveUploadSuccess();
  });

  it("accepts multipart JPEG and records a file version", async () => {
    const doc = seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
    });
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "kids.jpg", {
        type: "image/jpeg",
      }),
    );

    const res = await app.request(
      `/api/documents/${doc.id}/files/content`,
      {
        method: "POST",
        headers: { Cookie: owner.cookie, Origin: "http://localhost" },
        body: form,
      },
      t.env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      file: { driveFileId: string; mimeType: string; version: number; fileName: string };
    };
    expect(body.file.driveFileId).toBe("drive-proxied-1");
    expect(body.file.mimeType).toBe("image/jpeg");
    expect(body.file.version).toBe(1);
    expect(body.file.fileName).toBe("kids.jpg");

    const get = await app.request(
      `/api/documents/${doc.id}`,
      { headers: { Cookie: owner.cookie } },
      t.env,
    );
    const detail = (await get.json()) as { document: { currentFileId: string } };
    expect(detail.document.currentFileId).toBeTruthy();
  });

  it("synthesizes a filename when multipart File.name is blank", async () => {
    const doc = seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
    });
    const form = new FormData();
    // Whitespace-only name exercises server-side fallback; truly empty names are
    // filled in by the client helper before upload.
    form.append(
      "file",
      new File([new Uint8Array([1, 2, 3, 4])], "   ", { type: "image/png" }),
    );

    const res = await app.request(
      `/api/documents/${doc.id}/files/content`,
      {
        method: "POST",
        headers: { Cookie: owner.cookie, Origin: "http://localhost" },
        body: form,
      },
      t.env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { file: { fileName: string } };
    expect(body.file.fileName).toMatch(/^upload-\d+\.png$/);
  });

  it("rejects missing file field with validation_error", async () => {
    const doc = seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
    });
    const form = new FormData();
    form.append("notfile", "x");
    const res = await app.request(
      `/api/documents/${doc.id}/files/content`,
      {
        method: "POST",
        headers: { Cookie: owner.cookie, Origin: "http://localhost" },
        body: form,
      },
      t.env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("returns 401 without a session", async () => {
    const doc = seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
    });
    const form = new FormData();
    form.append("file", new File(["x"], "a.jpg", { type: "image/jpeg" }));
    const res = await app.request(
      `/api/documents/${doc.id}/files/content`,
      {
        method: "POST",
        headers: { Origin: "http://localhost" },
        body: form,
      },
      t.env,
    );
    expect(res.status).toBe(401);
  });

  it("returns drive_reauth_required when family owner has no tokens", async () => {
    await t.env.KV.delete(`user:access_token:${familyOwnerId}`);
    await t.env.KV.delete(`user:refresh_token:${familyOwnerId}`);
    vi.unstubAllGlobals();

    const doc = seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
    });
    const form = new FormData();
    form.append("file", new File(["x"], "a.jpg", { type: "image/jpeg" }));
    const res = await app.request(
      `/api/documents/${doc.id}/files/content`,
      {
        method: "POST",
        headers: { Cookie: owner.cookie, Origin: "http://localhost" },
        body: form,
      },
      t.env,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("drive_reauth_required");
  });
});

describe("POST /documents/:id/files — finalize after Drive PUT", () => {
  it("records a JPEG photo version and advances currentFileId", async () => {
    const create = await post("/api/documents", owner.cookie, {
      familyId,
      title: "Family photo",
      category: "other",
      visibility: "family",
    });
    expect(create.status).toBe(201);
    const { document } = (await create.json()) as { document: { id: string } };

    const v1 = await post(`/api/documents/${document.id}/files`, owner.cookie, {
      driveFileId: "drive-photo-1",
      fileName: "kids.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 345678,
    });
    expect(v1.status).toBe(201);
    const f1 = (await v1.json()) as {
      file: { id: string; version: number; mimeType: string };
    };
    expect(f1.file.version).toBe(1);
    expect(f1.file.mimeType).toBe("image/jpeg");

    const v2 = await post(`/api/documents/${document.id}/files`, owner.cookie, {
      driveFileId: "drive-photo-2",
      fileName: "kids-edited.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 400000,
    });
    expect(v2.status).toBe(201);
    const f2 = (await v2.json()) as { file: { id: string; version: number } };
    expect(f2.file.version).toBe(2);

    const get = await app.request(
      `/api/documents/${document.id}`,
      { headers: { Cookie: owner.cookie } },
      t.env,
    );
    const body = (await get.json()) as {
      document: { currentFileId: string };
    };
    expect(body.document.currentFileId).toBe(f2.file.id);
  });

  it("rejects finalize without driveFileId", async () => {
    const doc = seedDocument(t.sqlite, {
      familyId,
      ownerUserId: owner.userId,
    });
    const res = await post(`/api/documents/${doc.id}/files`, owner.cookie, {
      fileName: "kids.jpg",
      mimeType: "image/jpeg",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });
});
