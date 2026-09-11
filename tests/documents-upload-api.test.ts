/**
 * Worker-side document upload API contracts (photo + file).
 *
 * Complements the client helper tests: these hit the real Hono routes against
 * the sqlite D1 adapter so Zod shapes, authz, and finalize versioning cannot
 * silently drift.
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
let owner: ReturnType<typeof seedActor>;

beforeEach(() => {
  t = createTestEnv();
  const ownerUser = seedUser(t.sqlite);
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
  owner = seedActor(t.sqlite, familyId, "owner", { name: "Olive Owner" });
});

afterEach(() => {
  vi.restoreAllMocks();
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

describe("POST /documents/:id/files/upload-url — photo MIME contracts", () => {
  it.each([
    ["image/jpeg", "kids.jpg"],
    ["image/png", "scan.png"],
    ["image/heic", "IMG_0001.HEIC"],
    ["application/octet-stream", "IMG_0001.HEIC"], // iOS often omits type
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
    // Drive isn't configured in unit tests → 503 drive_not_configured / drive_error.
    // A 400 would mean we rejected a legitimate photo MIME — that is the regression.
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
