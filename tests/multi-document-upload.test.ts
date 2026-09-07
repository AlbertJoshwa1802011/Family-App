import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  createAndUploadDocument,
  guessCategoryFromFileName,
  titleFromFileName,
} from "../src/lib/documents";

describe("titleFromFileName", () => {
  it("strips extension and cleans underscores", () => {
    expect(titleFromFileName("Passport_scan.pdf")).toBe("Passport scan");
  });

  it("caps at 300 characters", () => {
    expect(titleFromFileName(`${"a".repeat(400)}.pdf`).length).toBe(300);
  });
});

describe("guessCategoryFromFileName", () => {
  it("maps common keywords", () => {
    expect(guessCategoryFromFileName("ella-passport.pdf")).toBe("passport");
    expect(guessCategoryFromFileName("car-insurance.pdf")).toBe("insurance");
    expect(guessCategoryFromFileName("random-scan.jpg")).toBe("other");
  });
});

describe("createAndUploadDocument", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "XMLHttpRequest",
      class {
        status = 201;
        responseText = "{}";
        upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        open() {}
        setRequestHeader() {}
        send() {
          queueMicrotask(() => this.onload?.());
        }
      },
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/documents") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as {
            title: string;
            category: string;
          };
          expect(body.title).toBe("My Passport");
          expect(body.category).toBe("passport");
          return new Response(
            JSON.stringify({
              document: {
                id: "doc-new",
                title: body.title,
                category: body.category,
              },
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ error: "unexpected", url }), {
          status: 500,
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates a document then uploads via R2 xhr path", async () => {
    const file = new File(["bytes"], "My_Passport.pdf", {
      type: "application/pdf",
    });
    const doc = await createAndUploadDocument(file);
    expect(doc.id).toBe("doc-new");
    expect(doc.category).toBe("passport");
  });
});
