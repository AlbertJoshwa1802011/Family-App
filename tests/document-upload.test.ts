import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { titleFromFileName } from "../src/lib/documentTitle";
import { createAndUploadDocument, uploadDocumentFile } from "../src/lib/uploadDocumentFile";

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

describe("uploadDocumentFile", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/files/upload-url")) {
          return new Response(JSON.stringify({ uploadUrl: "https://drive.example/upload" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url === "https://drive.example/upload") {
          expect(init?.method).toBe("PUT");
          return new Response(JSON.stringify({ id: "drive-file-1" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/files") && init?.method === "POST") {
          return new Response(JSON.stringify({ ok: true }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
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
    expect(calls[1]).toBe("https://drive.example/upload");
    expect(calls[2]).toContain("/api/documents/doc-1/files");
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
          };
          expect(body.title).toBe("My Passport");
          expect(body.category).toBe("identity");
          expect(body.familyId).toBe("fam-1");
          return new Response(
            JSON.stringify({
              document: { id: "doc-new", title: body.title, category: body.category },
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/files/upload-url")) {
          return new Response(JSON.stringify({ uploadUrl: "https://drive.example/upload" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url === "https://drive.example/upload") {
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
});
