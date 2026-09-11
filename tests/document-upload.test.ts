/**
 * Document / photo upload contracts.
 *
 * Guards the three-step Drive flow and the CSP allowlist that makes the
 * browser PUT possible. A prior regression (`connect-src 'self'` only) made
 * Safari report TypeError("Load failed") on every photo upload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { titleFromFileName } from "../src/lib/documentTitle";
import {
  createAndUploadDocument,
  DRIVE_NETWORK_ERROR,
  isGoogleDriveUploadUrl,
  mapDrivePutError,
  uploadDocumentFile,
} from "../src/lib/uploadDocumentFile";

const DRIVE_UPLOAD =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc";

describe("titleFromFileName", () => {
  it("strips a final extension and cleans underscores", () => {
    expect(titleFromFileName("Passport_scan.pdf")).toBe("Passport scan");
    expect(titleFromFileName("  Ella ID.jpg  ")).toBe("Ella ID");
  });

  it("keeps names that are only an extension-less token", () => {
    expect(titleFromFileName("IMG_1234")).toBe("IMG 1234");
  });

  it("falls back when the name is empty after stripping", () => {
    expect(titleFromFileName(".pdf")).toBe(".pdf");
  });

  it("caps at 300 characters", () => {
    const long = `${"a".repeat(400)}.pdf`;
    expect(titleFromFileName(long).length).toBe(300);
  });
});

describe("isGoogleDriveUploadUrl", () => {
  it("accepts www.googleapis.com and subdomain hosts", () => {
    expect(isGoogleDriveUploadUrl(DRIVE_UPLOAD)).toBe(true);
    expect(
      isGoogleDriveUploadUrl("https://content.googleapis.com/upload/drive/v3/files?upload_id=1"),
    ).toBe(true);
  });

  it("rejects non-Drive hosts (open redirect / SSRF guard)", () => {
    expect(isGoogleDriveUploadUrl("https://evil.example/upload")).toBe(false);
    expect(isGoogleDriveUploadUrl("https://googleapis.com.evil.example/x")).toBe(false);
    expect(isGoogleDriveUploadUrl("not-a-url")).toBe(false);
  });
});

describe("mapDrivePutError", () => {
  it("maps Safari CSP TypeError('Load failed') to a clear Drive message", () => {
    const err = mapDrivePutError(new TypeError("Load failed"));
    expect(err.message).toBe(DRIVE_NETWORK_ERROR);
    expect(err.message.toLowerCase()).not.toContain("load failed");
  });

  it("maps Failed to fetch the same way", () => {
    expect(mapDrivePutError(new TypeError("Failed to fetch")).message).toBe(
      DRIVE_NETWORK_ERROR,
    );
  });

  it("preserves non-network Error messages", () => {
    expect(mapDrivePutError(new Error("Drive upload failed (403)")).message).toBe(
      "Drive upload failed (403)",
    );
  });
});

describe("public/_headers CSP allows Drive PUT", () => {
  const headers = readFileSync("public/_headers", "utf8");
  const csp = headers.match(/Content-Security-Policy:\s*(.+)/)?.[1] ?? "";
  const connect = csp
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("connect-src "))!;

  it("allows www.googleapis.com and *.googleapis.com in connect-src", () => {
    expect(connect).toContain("'self'");
    expect(connect).toContain("https://www.googleapis.com");
    expect(connect).toContain("https://*.googleapis.com");
  });

  it("keeps a comment explaining why (agent foot-gun guard)", () => {
    expect(headers.toLowerCase()).toMatch(/drive/);
    expect(headers.toLowerCase()).toMatch(/load failed|resumable|upload/);
  });
});

describe("uploadDocumentFile", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/files/upload-url")) {
          return new Response(JSON.stringify({ uploadUrl: DRIVE_UPLOAD }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.startsWith("https://www.googleapis.com/")) {
          expect(init?.method).toBe("PUT");
          expect((init?.headers as Record<string, string>)["Content-Type"]).toBeTruthy();
          return new Response(JSON.stringify({ id: "drive-file-1" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/files") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as {
            driveFileId: string;
            mimeType: string;
            sizeBytes: number;
          };
          expect(body.driveFileId).toBe("drive-file-1");
          expect(body.sizeBytes).toBeGreaterThan(0);
          return new Response(JSON.stringify({ ok: true }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "unexpected", url }), { status: 500 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requests a resumable URL, PUTs bytes to Drive, then records metadata", async () => {
    const file = new File(["hello"], "passport.pdf", { type: "application/pdf" });
    await uploadDocumentFile("doc-1", file);

    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(calls[0]).toContain("/api/documents/doc-1/files/upload-url");
    expect(calls[1]).toBe(DRIVE_UPLOAD);
    expect(calls[2]).toContain("/api/documents/doc-1/files");
  });

  it("uploads a JPEG photo with image/jpeg content-type", async () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "kids.jpg", {
      type: "image/jpeg",
    });
    await uploadDocumentFile("doc-photo", file);
    const put = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(String(put[0])).toContain("googleapis.com");
    expect((put[1] as RequestInit).headers).toMatchObject({
      "Content-Type": "image/jpeg",
    });
  });

  it("defaults empty file.type (common on some iOS photos) to octet-stream", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "IMG_0001.HEIC", { type: "" });
    await uploadDocumentFile("doc-heic", file);
    const put = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect((put[1] as RequestInit).headers).toMatchObject({
      "Content-Type": "application/octet-stream",
    });
  });

  it("maps TypeError('Load failed') on Drive PUT to DRIVE_NETWORK_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/files/upload-url")) {
          return new Response(JSON.stringify({ uploadUrl: DRIVE_UPLOAD }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("googleapis.com")) {
          throw new TypeError("Load failed");
        }
        throw new Error(`unexpected ${url}`);
      }),
    );

    const file = new File(["x"], "shot.jpg", { type: "image/jpeg" });
    await expect(uploadDocumentFile("doc-1", file)).rejects.toThrow(DRIVE_NETWORK_ERROR);
  });

  it("refuses to PUT to a non-Drive upload URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/files/upload-url")) {
          return new Response(
            JSON.stringify({ uploadUrl: "https://evil.example/steal" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        throw new Error(`should not fetch ${url}`);
      }),
    );

    const file = new File(["x"], "shot.jpg", { type: "image/jpeg" });
    await expect(uploadDocumentFile("doc-1", file)).rejects.toThrow(/not a Google Drive/i);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("surfaces Drive HTTP failures with status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/files/upload-url")) {
          return new Response(JSON.stringify({ uploadUrl: DRIVE_UPLOAD }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("googleapis.com")) {
          return new Response("forbidden", { status: 403 });
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    await expect(
      uploadDocumentFile("doc-1", new File(["x"], "a.pdf", { type: "application/pdf" })),
    ).rejects.toThrow("Drive upload failed (403)");
  });
});

describe("createAndUploadDocument", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/suggest-category")) {
          return new Response(
            JSON.stringify({ category: "identity", source: "heuristic" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.endsWith("/documents") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as {
            title: string;
            category: string;
            familyId: string;
            visibility: string;
          };
          expect(body.title).toBe("My Passport");
          expect(body.category).toBe("identity");
          expect(body.familyId).toBe("fam-1");
          expect(body.visibility).toBe("family");
          return new Response(
            JSON.stringify({
              document: { id: "doc-new", title: body.title, category: body.category },
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/files/upload-url")) {
          return new Response(JSON.stringify({ uploadUrl: DRIVE_UPLOAD }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("googleapis.com")) {
          return new Response(JSON.stringify({ id: "drive-9" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/files") && init?.method === "POST") {
          return new Response(JSON.stringify({ ok: true }), { status: 201 });
        }
        return new Response(JSON.stringify({ error: "unexpected", url }), { status: 500 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates a document then uploads the file", async () => {
    const file = new File(["bytes"], "My_Passport.pdf", { type: "application/pdf" });
    const doc = await createAndUploadDocument("fam-1", file);
    expect(doc.id).toBe("doc-new");
    expect(doc.category).toBe("identity");
  });

  it("still uploads when category suggestion fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/suggest-category")) {
          return new Response(JSON.stringify({ error: "ai_unavailable" }), { status: 503 });
        }
        if (url.endsWith("/documents") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { category: string };
          expect(body.category).toBe("other");
          return new Response(
            JSON.stringify({
              document: { id: "doc-2", title: "Shot", category: "other" },
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/files/upload-url")) {
          return new Response(JSON.stringify({ uploadUrl: DRIVE_UPLOAD }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("googleapis.com")) {
          return new Response(JSON.stringify({ id: "drive-2" }), { status: 200 });
        }
        if (url.includes("/files") && init?.method === "POST") {
          return new Response(JSON.stringify({ ok: true }), { status: 201 });
        }
        return new Response("nope", { status: 500 });
      }),
    );

    const doc = await createAndUploadDocument(
      "fam-1",
      new File(["img"], "Shot.jpg", { type: "image/jpeg" }),
    );
    expect(doc.id).toBe("doc-2");
    expect(doc.category).toBe("other");
  });
});
