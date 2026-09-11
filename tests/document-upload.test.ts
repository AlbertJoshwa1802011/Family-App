/**
 * Document / photo upload contracts.
 *
 * Preferred path: browser POSTs multipart to /files/content (Worker → Drive).
 * CSP still allows googleapis as defense-in-depth for any legacy direct PUT.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { titleFromFileName } from "../src/lib/documentTitle";
import {
  createAndUploadDocument,
  DRIVE_NETWORK_ERROR,
  isGoogleDriveUploadUrl,
  mapDrivePutError,
  resolveUploadFileName,
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

describe("resolveUploadFileName", () => {
  it("keeps a normal file name", () => {
    expect(resolveUploadFileName(new File(["x"], "kids.jpg", { type: "image/jpeg" }))).toBe(
      "kids.jpg",
    );
  });

  it("synthesizes a name when File.name is empty (iOS camera)", () => {
    const name = resolveUploadFileName(new File(["x"], "", { type: "image/jpeg" }));
    expect(name).toMatch(/^upload-\d+\.jpg$/);
  });

  it("uses .heic for image/heic with empty name", () => {
    const name = resolveUploadFileName(new File(["x"], "  ", { type: "image/heic" }));
    expect(name).toMatch(/^upload-\d+\.heic$/);
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

describe("public/_headers CSP allows Drive hosts (defense-in-depth)", () => {
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
    expect(headers.toLowerCase()).toMatch(/load failed|proxy|upload/);
  });
});

describe("uploadDocumentFile (Worker proxy)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/files/content") && init?.method === "POST") {
          expect(init.body).toBeInstanceOf(FormData);
          const form = init.body as FormData;
          const file = form.get("file");
          expect(file).toBeInstanceOf(File);
          const headers = new Headers(init.headers);
          expect(headers.get("Content-Type") ?? "").not.toContain("application/json");
          return new Response(
            JSON.stringify({
              file: { id: "f1", version: 1, mimeType: (file as File).type },
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ error: "unexpected", url }), { status: 500 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POSTs multipart to /files/content (never contacts googleapis)", async () => {
    const file = new File(["hello"], "passport.pdf", { type: "application/pdf" });
    await uploadDocumentFile("doc-1", file);

    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/api/documents/doc-1/files/content");
    expect(calls.some((u) => u.includes("googleapis.com"))).toBe(false);
  });

  it("uploads a JPEG photo via the proxy", async () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "kids.jpg", {
      type: "image/jpeg",
    });
    await uploadDocumentFile("doc-photo", file);
    const form = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as FormData;
    const uploaded = form.get("file") as File;
    expect(uploaded.name).toBe("kids.jpg");
    expect(uploaded.type).toBe("image/jpeg");
  });

  it("synthesizes a filename when File.name is empty", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "", { type: "image/heic" });
    await uploadDocumentFile("doc-heic", file);
    const form = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as FormData;
    const uploaded = form.get("file") as File;
    expect(uploaded.name).toMatch(/^upload-\d+\.heic$/);
  });

  it("maps TypeError('Load failed') on the proxy POST to DRIVE_NETWORK_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Load failed");
      }),
    );

    const file = new File(["x"], "shot.jpg", { type: "image/jpeg" });
    await expect(uploadDocumentFile("doc-1", file)).rejects.toThrow(DRIVE_NETWORK_ERROR);
  });

  it("surfaces drive_reauth_required with a clear message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ error: "drive_reauth_required" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    await expect(
      uploadDocumentFile("doc-1", new File(["x"], "a.pdf", { type: "application/pdf" })),
    ).rejects.toThrow(/sign in again/i);
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
        if (url.includes("/files/content") && init?.method === "POST") {
          expect(init.body).toBeInstanceOf(FormData);
          return new Response(JSON.stringify({ file: { id: "f9", version: 1 } }), {
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

  it("creates a document then uploads the file via proxy", async () => {
    const file = new File(["bytes"], "My_Passport.pdf", { type: "application/pdf" });
    const doc = await createAndUploadDocument("fam-1", file);
    expect(doc.id).toBe("doc-new");
    expect(doc.category).toBe("identity");
    const urls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/files/content"))).toBe(true);
    expect(urls.some((u) => u.includes("googleapis.com"))).toBe(false);
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
        if (url.includes("/files/content")) {
          return new Response(JSON.stringify({ file: { id: "f2", version: 1 } }), {
            status: 201,
          });
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
