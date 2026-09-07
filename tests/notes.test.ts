/**
 * Family notebook: folders + notes, private visibility, soft-delete trash.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../worker/index";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

let t: TestEnv;
let familyId: string;
let owner: ReturnType<typeof seedActor>;
let member: ReturnType<typeof seedActor>;
let admin: ReturnType<typeof seedActor>;

beforeEach(() => {
  t = createTestEnv();
  const ownerUser = seedUser(t.sqlite);
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
  owner = seedActor(t.sqlite, familyId, "owner", { name: "Olive Owner" });
  admin = seedActor(t.sqlite, familyId, "admin", { name: "Ada Admin" });
  member = seedActor(t.sqlite, familyId, "member", { name: "Milo Member" });
});

function req(method: string, path: string, cookie: string, body?: object) {
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

async function createNote(
  cookie: string,
  body: Record<string, unknown> = {},
) {
  const res = await req("POST", "/api/notes", cookie, {
    familyId,
    ...body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { note: { id: string; title: string } }).note;
}

async function createNotebook(
  cookie: string,
  name: string,
  forFamilyId: string = familyId,
) {
  const res = await req("POST", "/api/notes/notebooks", cookie, {
    familyId: forFamilyId,
    name,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { notebook: { id: string; name: string } })
    .notebook;
}

describe("notebooks", () => {
  it("create → list → rename → delete (notes become unfiled)", async () => {
    const nb = await createNotebook(owner.cookie, "Bible Study");
    expect(nb.name).toBe("Bible Study");

    const note = await createNote(owner.cookie, {
      title: "John 3",
      body: "For God so loved…",
      kind: "bible",
      notebookId: nb.id,
    });

    const list = await req(
      "GET",
      `/api/notes/notebooks?familyId=${familyId}`,
      member.cookie,
    );
    expect(list.status).toBe(200);
    const { notebooks } = (await list.json()) as {
      notebooks: { name: string }[];
    };
    expect(notebooks.map((n) => n.name)).toEqual(["Bible Study"]);

    expect(
      (
        await req("PATCH", `/api/notes/notebooks/${nb.id}`, owner.cookie, {
          name: "Morning Devotion",
        })
      ).status,
    ).toBe(200);

    expect(
      (await req("DELETE", `/api/notes/notebooks/${nb.id}`, owner.cookie))
        .status,
    ).toBe(200);

    const got = await req("GET", `/api/notes/${note.id}`, owner.cookie);
    const { note: after } = (await got.json()) as {
      note: { notebookId: string | null };
    };
    expect(after.notebookId).toBeNull();
  });

  it("validation + authz for notebooks", async () => {
    expect(
      (await req("POST", "/api/notes/notebooks", member.cookie, {
        familyId,
        name: "",
      })).status,
    ).toBe(400);
    expect(
      (await req("GET", "/api/notes/notebooks", member.cookie)).status,
    ).toBe(400);

    const nb = await createNotebook(owner.cookie, "Shared");
    expect(
      (await req("DELETE", `/api/notes/notebooks/${nb.id}`, member.cookie))
        .status,
    ).toBe(403);
    expect(
      (await req("DELETE", `/api/notes/notebooks/${nb.id}`, admin.cookie))
        .status,
    ).toBe(200);
  });
});

describe("notes CRUD", () => {
  it("create → list → get → patch → soft-delete → restore → permanent delete", async () => {
    const note = await createNote(member.cookie, {
      title: "Day 1",
      body: "Psalm 23 — The Lord is my shepherd.",
      kind: "bible",
      noteDate: "2026-09-07",
      visibility: "private",
    });

    const list = await req(
      "GET",
      `/api/notes?familyId=${familyId}`,
      member.cookie,
    );
    expect(list.status).toBe(200);
    const { notes } = (await list.json()) as {
      notes: { id: string; pinned: boolean; kind: string }[];
    };
    expect(notes).toHaveLength(1);
    expect(notes[0].pinned).toBe(false);
    expect(notes[0].kind).toBe("bible");

    const got = await req("GET", `/api/notes/${note.id}`, member.cookie);
    expect(got.status).toBe(200);

    const patched = await req("PATCH", `/api/notes/${note.id}`, member.cookie, {
      title: "Day 1 — Psalm 23",
      pinned: true,
      body: "Updated reflection.",
    });
    expect(patched.status).toBe(200);
    const { note: p } = (await patched.json()) as {
      note: { title: string; pinned: boolean; body: string };
    };
    expect(p.title).toBe("Day 1 — Psalm 23");
    expect(p.pinned).toBe(true);
    expect(p.body).toBe("Updated reflection.");

    // Soft delete
    const del = await req("DELETE", `/api/notes/${note.id}`, member.cookie);
    expect(del.status).toBe(200);
    expect(((await del.json()) as { permanent: boolean }).permanent).toBe(
      false,
    );

    const live = await req(
      "GET",
      `/api/notes?familyId=${familyId}`,
      member.cookie,
    );
    expect(
      ((await live.json()) as { notes: unknown[] }).notes,
    ).toHaveLength(0);

    const trash = await req(
      "GET",
      `/api/notes?familyId=${familyId}&trashed=1`,
      member.cookie,
    );
    expect(
      ((await trash.json()) as { notes: unknown[] }).notes,
    ).toHaveLength(1);

    const restored = await req(
      "POST",
      `/api/notes/${note.id}/restore`,
      member.cookie,
    );
    expect(restored.status).toBe(200);

    // Soft delete again, then permanent
    await req("DELETE", `/api/notes/${note.id}`, member.cookie);
    const perm = await req("DELETE", `/api/notes/${note.id}`, member.cookie);
    expect(perm.status).toBe(200);
    expect(((await perm.json()) as { permanent: boolean }).permanent).toBe(
      true,
    );
    expect(
      (await req("GET", `/api/notes/${note.id}`, member.cookie)).status,
    ).toBe(404);
  });

  it("defaults: empty title/body, private visibility, general kind", async () => {
    const res = await req("POST", "/api/notes", member.cookie, { familyId });
    expect(res.status).toBe(201);
    const { note } = (await res.json()) as {
      note: {
        title: string;
        body: string;
        visibility: string;
        kind: string;
        pinned: boolean;
      };
    };
    expect(note.title).toBe("");
    expect(note.body).toBe("");
    expect(note.visibility).toBe("private");
    expect(note.kind).toBe("general");
    expect(note.pinned).toBe(false);
  });

  it("search, kind filter, notebook filter, pinned sort", async () => {
    const bibleNb = await createNotebook(owner.cookie, "Bible");
    await createNote(owner.cookie, {
      title: "Genesis",
      body: "In the beginning",
      kind: "bible",
      notebookId: bibleNb.id,
    });
    await createNote(owner.cookie, {
      title: "Shopping",
      body: "milk and eggs",
      kind: "general",
      pinned: true,
    });
    await createNote(owner.cookie, {
      title: "Journal",
      body: "grateful for family",
      kind: "journal",
    });

    const search = await req(
      "GET",
      `/api/notes?familyId=${familyId}&q=beginning`,
      owner.cookie,
    );
    const s = (await search.json()) as { notes: { title: string }[] };
    expect(s.notes.map((n) => n.title)).toEqual(["Genesis"]);

    const byKind = await req(
      "GET",
      `/api/notes?familyId=${familyId}&kind=bible`,
      owner.cookie,
    );
    expect(
      ((await byKind.json()) as { notes: unknown[] }).notes,
    ).toHaveLength(1);

    const unfiled = await req(
      "GET",
      `/api/notes?familyId=${familyId}&notebookId=none`,
      owner.cookie,
    );
    const u = (await unfiled.json()) as { notes: { title: string }[] };
    expect(u.notes.map((n) => n.title).sort()).toEqual(["Journal", "Shopping"]);

    const all = await req(
      "GET",
      `/api/notes?familyId=${familyId}`,
      owner.cookie,
    );
    const a = (await all.json()) as { notes: { title: string; pinned: boolean }[] };
    expect(a.notes[0].title).toBe("Shopping"); // pinned first
    expect(a.notes[0].pinned).toBe(true);
  });

  it("null clears notebookId and noteDate on PATCH", async () => {
    const nb = await createNotebook(owner.cookie, "Folder");
    const note = await createNote(owner.cookie, {
      notebookId: nb.id,
      noteDate: "2026-09-07",
      title: "x",
    });

    const res = await req("PATCH", `/api/notes/${note.id}`, owner.cookie, {
      notebookId: null,
      noteDate: null,
    });
    expect(res.status).toBe(200);
    const { note: n } = (await res.json()) as {
      note: { notebookId: string | null; noteDate: string | null };
    };
    expect(n.notebookId).toBeNull();
    expect(n.noteDate).toBeNull();
  });
});

describe("notes security", () => {
  it("401 without session; 404 for outsiders; CSRF rejected", async () => {
    expect(
      (await app.request(`/api/notes?familyId=${familyId}`, {}, t.env)).status,
    ).toBe(401);

    const strangerUser = seedUser(t.sqlite);
    const otherFamily = seedFamily(t.sqlite, strangerUser.id);
    const stranger = seedActor(t.sqlite, otherFamily.id, "owner");

    expect(
      (
        await req("GET", `/api/notes?familyId=${familyId}`, stranger.cookie)
      ).status,
    ).toBe(404);
    expect(
      (
        await req("POST", "/api/notes", stranger.cookie, {
          familyId,
          title: "nope",
        })
      ).status,
    ).toBe(404);

    const csrf = await app.request(
      "/api/notes",
      {
        method: "POST",
        headers: {
          Cookie: member.cookie,
          "Content-Type": "application/json",
          Origin: "https://evil.example",
        },
        body: JSON.stringify({ familyId, title: "forged" }),
      },
      t.env,
    );
    expect(csrf.status).toBe(403);
  });

  it("private notes hidden from other members (404); visible to owner/admin", async () => {
    const note = await createNote(member.cookie, {
      title: "Private prayer",
      body: "secret",
      visibility: "private",
    });

    expect(
      (await req("GET", `/api/notes/${note.id}`, owner.cookie)).status,
    ).toBe(200); // owner role
    expect(
      (await req("GET", `/api/notes/${note.id}`, admin.cookie)).status,
    ).toBe(200); // admin role

    const other = seedActor(t.sqlite, familyId, "member", {
      name: "Other Member",
    });
    expect(
      (await req("GET", `/api/notes/${note.id}`, other.cookie)).status,
    ).toBe(404);
    expect(
      (
        await req("PATCH", `/api/notes/${note.id}`, other.cookie, {
          title: "hack",
        })
      ).status,
    ).toBe(404);

    const list = await req(
      "GET",
      `/api/notes?familyId=${familyId}`,
      other.cookie,
    );
    expect(
      ((await list.json()) as { notes: unknown[] }).notes,
    ).toHaveLength(0);
  });

  it("family-visible notes readable by members; only owner/admin can edit others'", async () => {
    const note = await createNote(owner.cookie, {
      title: "Shared liturgy",
      visibility: "family",
    });

    expect(
      (await req("GET", `/api/notes/${note.id}`, member.cookie)).status,
    ).toBe(200);

    expect(
      (
        await req("PATCH", `/api/notes/${note.id}`, member.cookie, {
          title: "nope",
        })
      ).status,
    ).toBe(403);

    expect(
      (
        await req("PATCH", `/api/notes/${note.id}`, admin.cookie, {
          title: "yes",
        })
      ).status,
    ).toBe(200);
  });

  it("cross-family notebookId rejected", async () => {
    const strangerUser = seedUser(t.sqlite);
    const otherFamily = seedFamily(t.sqlite, strangerUser.id);
    const stranger = seedActor(t.sqlite, otherFamily.id, "owner");
    const foreignNb = await createNotebook(
      stranger.cookie,
      "Foreign",
      otherFamily.id,
    );

    const res = await req("POST", "/api/notes", member.cookie, {
      familyId,
      title: "inject",
      notebookId: foreignNb.id,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "invalid_notebook_id",
    );
  });

  it("Zod boundaries: over-max title/body, bad kind/date/visibility", async () => {
    expect(
      (
        await req("POST", "/api/notes", member.cookie, {
          familyId,
          title: "x".repeat(201),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req("POST", "/api/notes", member.cookie, {
          familyId,
          body: "x".repeat(100_001),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req("POST", "/api/notes", member.cookie, {
          familyId,
          kind: "sermon",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req("POST", "/api/notes", member.cookie, {
          familyId,
          noteDate: "09-07-2026",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req("POST", "/api/notes", member.cookie, {
          familyId,
          visibility: "secret",
        })
      ).status,
    ).toBe(400);
    expect((await req("GET", "/api/notes", member.cookie)).status).toBe(400);

    // Deep unknown path
    expect(
      (
        await req(
          "GET",
          `/api/notes/${crypto.randomUUID()}/nope`,
          member.cookie,
        )
      ).status,
    ).toBe(404);
  });
});
