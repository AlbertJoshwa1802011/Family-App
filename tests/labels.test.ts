/**
 * Family labels: custom type/category chips with emoji.
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
import { mergeLabels, slugifyLabel } from "../worker/lib/labels";

let t: TestEnv;
let familyId: string;
let owner: ReturnType<typeof seedActor>;
let outsider: ReturnType<typeof seedActor>;

beforeEach(() => {
  t = createTestEnv();
  const ownerUser = seedUser(t.sqlite);
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
  owner = seedActor(t.sqlite, familyId, "owner", { name: "Olive Owner" });
  const strangerUser = seedUser(t.sqlite);
  const otherFamily = seedFamily(t.sqlite, strangerUser.id);
  outsider = seedActor(t.sqlite, otherFamily.id, "owner");
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

describe("labels helpers", () => {
  it("slugifyLabel normalizes names", () => {
    expect(slugifyLabel("Family Reunion")).toBe("family_reunion");
    expect(slugifyLabel("  Bible Study!  ")).toBe("bible_study");
    expect(slugifyLabel("!!!")).toBe("custom");
  });

  it("mergeLabels keeps builtins and appends customs", () => {
    const merged = mergeLabels("event_type", [
      {
        id: "c1",
        slug: "reunion",
        label: "Reunion",
        emoji: "🏠",
        sortOrder: 10,
      },
      {
        id: "c2",
        slug: "gathering",
        label: "Get-together",
        emoji: "🥳",
        sortOrder: 0,
      },
    ]);
    const gathering = merged.find((l) => l.slug === "gathering")!;
    expect(gathering.emoji).toBe("🥳");
    expect(gathering.label).toBe("Get-together");
    expect(gathering.custom).toBe(true);
    expect(gathering.builtin).toBe(true);
    expect(merged.some((l) => l.slug === "reunion" && l.emoji === "🏠")).toBe(
      true,
    );
  });
});

describe("GET /api/labels", () => {
  it("returns builtins for a domain", async () => {
    const res = await req(
      "GET",
      `/api/labels?familyId=${familyId}&domain=event_type`,
      owner.cookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      domain: string;
      labels: { slug: string; emoji: string; builtin: boolean }[];
    };
    expect(body.domain).toBe("event_type");
    expect(body.labels.map((l) => l.slug)).toEqual(
      expect.arrayContaining(["gathering", "appointment", "milestone", "other"]),
    );
    expect(body.labels.every((l) => l.emoji.length > 0)).toBe(true);
  });

  it("400 without familyId or domain; 401 without session; outsider 404", async () => {
    expect(
      (await req("GET", "/api/labels?domain=event_type", owner.cookie)).status,
    ).toBe(400);
    expect(
      (
        await req(
          "GET",
          `/api/labels?familyId=${familyId}`,
          owner.cookie,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          `/api/labels?familyId=${familyId}&domain=event_type`,
          {},
          t.env,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await req(
          "GET",
          `/api/labels?familyId=${familyId}&domain=event_type`,
          outsider.cookie,
        )
      ).status,
    ).toBe(404);
  });
});

describe("POST /api/labels", () => {
  it("creates a custom label and lists it", async () => {
    const created = await req("POST", "/api/labels", owner.cookie, {
      familyId,
      domain: "event_type",
      label: "Family Reunion",
      emoji: "🏠",
    });
    expect(created.status).toBe(201);
    const { label } = (await created.json()) as {
      label: { id: string; slug: string; emoji: string; label: string };
    };
    expect(label.slug).toBe("family_reunion");
    expect(label.emoji).toBe("🏠");
    expect(label.label).toBe("Family Reunion");

    const list = await req(
      "GET",
      `/api/labels?familyId=${familyId}&domain=event_type`,
      owner.cookie,
    );
    const body = (await list.json()) as {
      labels: { slug: string; custom: boolean }[];
    };
    expect(body.labels.some((l) => l.slug === "family_reunion" && l.custom)).toBe(
      true,
    );
  });

  it("Zod: missing fields, empty label, bad domain → 400", async () => {
    expect(
      (
        await req("POST", "/api/labels", owner.cookie, {
          familyId,
          domain: "event_type",
          emoji: "🎉",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req("POST", "/api/labels", owner.cookie, {
          familyId,
          domain: "event_type",
          label: "",
          emoji: "🎉",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req("POST", "/api/labels", owner.cookie, {
          familyId,
          domain: "not_a_domain",
          label: "X",
          emoji: "🎉",
        })
      ).status,
    ).toBe(400);
  });

  it("outsider cannot create; deep path 404", async () => {
    expect(
      (
        await req("POST", "/api/labels", outsider.cookie, {
          familyId,
          domain: "note_kind",
          label: "Sermon",
          emoji: "⛪",
        })
      ).status,
    ).toBe(404);
    const deep = await app.request("/api/labels/nope/extra", {}, t.env);
    expect(deep.status).toBe(404);
    expect(((await deep.json()) as { error: string }).error).toBe("not_found");
  });
});

describe("PATCH + DELETE /api/labels/:id", () => {
  it("updates emoji/label and deletes", async () => {
    const created = await (
      await req("POST", "/api/labels", owner.cookie, {
        familyId,
        domain: "expense_category",
        label: "Tithe",
        emoji: "🙏",
      })
    ).json() as { label: { id: string } };

    const patched = await req(
      "PATCH",
      `/api/labels/${created.label.id}`,
      owner.cookie,
      { emoji: "✝️", label: "Church tithe" },
    );
    expect(patched.status).toBe(200);
    const { label } = (await patched.json()) as {
      label: { emoji: string; label: string };
    };
    expect(label.emoji).toBe("✝️");
    expect(label.label).toBe("Church tithe");

    expect(
      (await req("DELETE", `/api/labels/${created.label.id}`, owner.cookie))
        .status,
    ).toBe(200);
    expect(
      (await req("DELETE", `/api/labels/${created.label.id}`, owner.cookie))
        .status,
    ).toBe(404);
  });
});

describe("custom types on entities", () => {
  it("events accept a custom type slug", async () => {
    await req("POST", "/api/labels", owner.cookie, {
      familyId,
      domain: "event_type",
      label: "Reunion",
      emoji: "🏠",
    });
    const res = await req("POST", "/api/events", owner.cookie, {
      familyId,
      title: "Summer reunion",
      type: "reunion",
      startAt: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { event: { type: string } };
    expect(body.event.type).toBe("reunion");
  });

  it("notes accept custom kind", async () => {
    const note = await req("POST", "/api/notes", owner.cookie, {
      familyId,
      title: "Sunday",
      kind: "sermon",
    });
    expect(note.status).toBe(201);
    const { note: n } = (await note.json()) as { note: { kind: string } };
    expect(n.kind).toBe("sermon");
  });

  it("rejects invalid slugs", async () => {
    expect(
      (
        await req("POST", "/api/events", owner.cookie, {
          familyId,
          title: "Bad",
          type: "has spaces",
          startAt: Math.floor(Date.now() / 1000) + 3600,
        })
      ).status,
    ).toBe(400);
  });
});
