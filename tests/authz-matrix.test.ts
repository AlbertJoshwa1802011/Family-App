/**
 * SECURITY-CRITICAL: private-document authorization matrix (FEATURES §5.1).
 *
 * documents.visibility='private' must hide a document from other plain
 * members on EVERY surface: list, get, update, download, comments, and the
 * file-attach endpoints. Owners/admins and the document's own owner see it.
 * Responses for hidden docs are 404 (not 403) so existence isn't revealed.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../worker/index";
import {
  createTestEnv,
  seedActor,
  seedDocument,
  seedFamily,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

interface Actors {
  owner: ReturnType<typeof seedActor>;
  admin: ReturnType<typeof seedActor>;
  memberA: ReturnType<typeof seedActor>;
  memberB: ReturnType<typeof seedActor>;
  familyId: string;
  privateDocId: string; // owned by memberB, visibility=private
  familyDocId: string; // owned by memberB, visibility=family
}

let t: TestEnv;
let a: Actors;

beforeEach(() => {
  t = createTestEnv();
  const ownerUser = seedUser(t.sqlite);
  const family = seedFamily(t.sqlite, ownerUser.id);

  const owner = seedActor(t.sqlite, family.id, "owner");
  const admin = seedActor(t.sqlite, family.id, "admin");
  const memberA = seedActor(t.sqlite, family.id, "member");
  const memberB = seedActor(t.sqlite, family.id, "member");

  const privateDoc = seedDocument(t.sqlite, {
    familyId: family.id,
    ownerUserId: memberB.userId,
    title: "B's private passport",
    visibility: "private",
  });
  const familyDoc = seedDocument(t.sqlite, {
    familyId: family.id,
    ownerUserId: memberB.userId,
    title: "Shared insurance",
    visibility: "family",
  });

  a = {
    owner,
    admin,
    memberA,
    memberB,
    familyId: family.id,
    privateDocId: privateDoc.id,
    familyDocId: familyDoc.id,
  };
});

function get(path: string, cookie: string) {
  return app.request(path, { headers: { Cookie: cookie } }, t.env);
}

function send(method: string, path: string, cookie: string, body?: object) {
  return app.request(
    path,
    {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
    t.env,
  );
}

describe("private-document visibility matrix", () => {
  it("list: another member does NOT see the private doc; owner/admin/doc-owner do", async () => {
    const cases: [string, boolean][] = [
      [a.memberA.cookie, false],
      [a.memberB.cookie, true],
      [a.admin.cookie, true],
      [a.owner.cookie, true],
    ];
    for (const [cookie, shouldSee] of cases) {
      const res = await get(`/api/documents?familyId=${a.familyId}`, cookie);
      expect(res.status).toBe(200);
      const { documents } = (await res.json()) as { documents: { id: string }[] };
      const ids = documents.map((d) => d.id);
      expect(ids.includes(a.privateDocId)).toBe(shouldSee);
      // The family-visible doc is always listed.
      expect(ids).toContain(a.familyDocId);
    }
  });

  it("get: hidden from another member with 404; visible to owner/admin/doc-owner", async () => {
    expect((await get(`/api/documents/${a.privateDocId}`, a.memberA.cookie)).status).toBe(404);
    expect((await get(`/api/documents/${a.privateDocId}`, a.memberB.cookie)).status).toBe(200);
    expect((await get(`/api/documents/${a.privateDocId}`, a.admin.cookie)).status).toBe(200);
    expect((await get(`/api/documents/${a.privateDocId}`, a.owner.cookie)).status).toBe(200);
  });

  it("update: another member cannot PATCH the private doc (404)", async () => {
    const res = await send("PATCH", `/api/documents/${a.privateDocId}`, a.memberA.cookie, {
      title: "hijacked",
    });
    expect(res.status).toBe(404);
    // Unchanged
    const check = await get(`/api/documents/${a.privateDocId}`, a.memberB.cookie);
    const { document } = (await check.json()) as { document: { title: string } };
    expect(document.title).toBe("B's private passport");
  });

  it("download: another member gets 404 before any Drive access", async () => {
    const res = await get(
      `/api/documents/${a.privateDocId}/files/some-file/download`,
      a.memberA.cookie,
    );
    expect(res.status).toBe(404);
  });

  it("comments: another member can neither read nor post (404)", async () => {
    expect(
      (await get(`/api/documents/${a.privateDocId}/comments`, a.memberA.cookie)).status,
    ).toBe(404);
    expect(
      (
        await send("POST", `/api/documents/${a.privateDocId}/comments`, a.memberA.cookie, {
          body: "peeking",
        })
      ).status,
    ).toBe(404);
  });

  it("file list: another member cannot enumerate a private doc's files (404)", async () => {
    expect(
      (await get(`/api/documents/${a.privateDocId}/files`, a.memberA.cookie)).status,
    ).toBe(404);
    expect(
      (await get(`/api/documents/${a.privateDocId}/files`, a.memberB.cookie)).status,
    ).toBe(200);
  });

  it("file attach: another member cannot request an upload URL or record a file (404)", async () => {
    expect(
      (
        await send(
          "POST",
          `/api/documents/${a.privateDocId}/files/upload-url`,
          a.memberA.cookie,
          { fileName: "x.pdf", mimeType: "application/pdf" },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await send("POST", `/api/documents/${a.privateDocId}/files`, a.memberA.cookie, {
          driveFileId: "drive-x",
          fileName: "x.pdf",
          mimeType: "application/pdf",
        })
      ).status,
    ).toBe(404);
  });

  it("non-member of the family sees nothing at all (404), even family-visible docs", async () => {
    const outsiderUser = seedUser(t.sqlite);
    const outsiderFamily = seedFamily(t.sqlite, outsiderUser.id);
    const outsider = seedActor(t.sqlite, outsiderFamily.id, "owner");

    expect((await get(`/api/documents/${a.familyDocId}`, outsider.cookie)).status).toBe(404);
    expect((await get(`/api/documents/${a.privateDocId}`, outsider.cookie)).status).toBe(404);
    // Listing someone else's family is a 404 too (membership check).
    expect((await get(`/api/documents?familyId=${a.familyId}`, outsider.cookie)).status).toBe(404);
  });

  it("delete: another member cannot trash someone else's doc (403 family doc / 404 private)", async () => {
    expect(
      (await send("DELETE", `/api/documents/${a.familyDocId}`, a.memberA.cookie)).status,
    ).toBe(403);
    expect(
      (await send("DELETE", `/api/documents/${a.privateDocId}`, a.memberA.cookie)).status,
    ).toBe(404);
    // Admin can delete any.
    expect(
      (await send("DELETE", `/api/documents/${a.familyDocId}`, a.admin.cookie)).status,
    ).toBe(200);
  });
});
