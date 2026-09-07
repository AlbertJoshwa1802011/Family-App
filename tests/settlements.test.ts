/**
 * Money settlements: destinations + received/settled ledger, balances,
 * family isolation, Zod boundaries.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../worker/index";
import { computeBalances, settledByDestination } from "../worker/lib/settlements";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

let t: TestEnv;
let familyId: string;
let otherFamilyId: string;
let owner: ReturnType<typeof seedActor>;
let member: ReturnType<typeof seedActor>;
let outsider: ReturnType<typeof seedActor>;

beforeEach(() => {
  t = createTestEnv();
  const ownerUser = seedUser(t.sqlite);
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
  owner = seedActor(t.sqlite, familyId, "owner", { name: "Olive Owner" });
  member = seedActor(t.sqlite, familyId, "member", { name: "Milo Member" });

  const otherOwner = seedUser(t.sqlite);
  otherFamilyId = seedFamily(t.sqlite, otherOwner.id).id;
  outsider = seedActor(t.sqlite, otherFamilyId, "owner", { name: "Oz Outsider" });
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

describe("settlement balance helpers", () => {
  it("computes available, settled, and in-hand from the ledger", () => {
    const bal = computeBalances([
      { type: "received", amountCents: 50_000 },
      { type: "received", amountCents: 10_000 },
      { type: "settled", amountCents: 20_000 },
      { type: "settled", amountCents: 5_000 },
    ]);
    expect(bal.availableCents).toBe(60_000);
    expect(bal.settledCents).toBe(25_000);
    expect(bal.inHandCents).toBe(35_000);
    expect(bal.inHand).toBe(350);
  });

  it("aggregates settled totals per destination", () => {
    const map = settledByDestination([
      { type: "received", amountCents: 10_000, destinationId: null },
      { type: "settled", amountCents: 3_000, destinationId: "mom" },
      { type: "settled", amountCents: 2_000, destinationId: "mom" },
      { type: "settled", amountCents: 4_000, destinationId: "church" },
    ]);
    expect(map.get("mom")).toBe(5_000);
    expect(map.get("church")).toBe(4_000);
  });
});

describe("settlement destinations API", () => {
  it("create → list destinations; duplicate active name → 409", async () => {
    const create = await req("POST", "/api/settlements/destinations", member.cookie, {
      familyId,
      name: "Mom",
      kind: "person",
    });
    expect(create.status).toBe(201);
    const { destination } = (await create.json()) as {
      destination: { id: string; name: string; kind: string; settled: number };
    };
    expect(destination.name).toBe("Mom");
    expect(destination.kind).toBe("person");
    expect(destination.settled).toBe(0);

    const dup = await req("POST", "/api/settlements/destinations", owner.cookie, {
      familyId,
      name: "mom",
    });
    expect(dup.status).toBe(409);

    const church = await req("POST", "/api/settlements/destinations", owner.cookie, {
      familyId,
      name: "Church",
      kind: "organization",
    });
    expect(church.status).toBe(201);

    const list = await req(
      "GET",
      `/api/settlements/destinations?familyId=${familyId}`,
      owner.cookie,
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      destinations: { name: string }[];
    };
    expect(body.destinations.map((d) => d.name).sort()).toEqual([
      "Church",
      "Mom",
    ]);
  });

  it("archives used destinations on DELETE; hard-deletes unused", async () => {
    const mom = await (
      await req("POST", "/api/settlements/destinations", owner.cookie, {
        familyId,
        name: "Mom",
      })
    ).json() as { destination: { id: string } };

    const unused = await (
      await req("POST", "/api/settlements/destinations", owner.cookie, {
        familyId,
        name: "Spare",
      })
    ).json() as { destination: { id: string } };

    await req("POST", "/api/settlements/movements", owner.cookie, {
      familyId,
      type: "received",
      amount: 1000,
    });
    await req("POST", "/api/settlements/movements", owner.cookie, {
      familyId,
      type: "settled",
      amount: 100,
      destinationId: mom.destination.id,
    });

    const archive = await req(
      "DELETE",
      `/api/settlements/destinations/${mom.destination.id}`,
      owner.cookie,
    );
    expect(archive.status).toBe(200);
    expect(await archive.json()).toMatchObject({ ok: true, archived: true });

    const hard = await req(
      "DELETE",
      `/api/settlements/destinations/${unused.destination.id}`,
      owner.cookie,
    );
    expect(hard.status).toBe(200);
    expect(await hard.json()).toMatchObject({ ok: true, archived: false });

    const active = await (
      await req(
        "GET",
        `/api/settlements/destinations?familyId=${familyId}`,
        owner.cookie,
      )
    ).json() as { destinations: { id: string }[] };
    expect(active.destinations).toEqual([]);

    const withArchived = await (
      await req(
        "GET",
        `/api/settlements/destinations?familyId=${familyId}&includeArchived=1`,
        owner.cookie,
      )
    ).json() as { destinations: { id: string; archivedAt: number | null }[] };
    expect(withArchived.destinations).toHaveLength(1);
    expect(withArchived.destinations[0]!.archivedAt).toBeTruthy();
  });

  it("rejects outsiders and missing familyId", async () => {
    const noFamily = await req("GET", "/api/settlements/destinations", owner.cookie);
    expect(noFamily.status).toBe(400);

    const created = await (
      await req("POST", "/api/settlements/destinations", owner.cookie, {
        familyId,
        name: "Mom",
      })
    ).json() as { destination: { id: string } };

    const denied = await req(
      "GET",
      `/api/settlements/destinations?familyId=${familyId}`,
      outsider.cookie,
    );
    expect(denied.status).toBe(404);

    const patchDenied = await req(
      "PATCH",
      `/api/settlements/destinations/${created.destination.id}`,
      outsider.cookie,
      { name: "Nope" },
    );
    expect(patchDenied.status).toBe(404);
  });

  it("Zod rejects empty destination name", async () => {
    const res = await req("POST", "/api/settlements/destinations", owner.cookie, {
      familyId,
      name: "  ",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("unarchive clashes with an active same-name destination", async () => {
    const first = await (
      await req("POST", "/api/settlements/destinations", owner.cookie, {
        familyId,
        name: "Mom",
      })
    ).json() as { destination: { id: string } };

    await req("POST", "/api/settlements/movements", owner.cookie, {
      familyId,
      type: "received",
      amount: 10,
    });
    await req("POST", "/api/settlements/movements", owner.cookie, {
      familyId,
      type: "settled",
      amount: 5,
      destinationId: first.destination.id,
    });
    // Archive used destination, then recreate the same name.
    await req(
      "DELETE",
      `/api/settlements/destinations/${first.destination.id}`,
      owner.cookie,
    );
    await req("POST", "/api/settlements/destinations", owner.cookie, {
      familyId,
      name: "Mom",
    });

    const clash = await req(
      "PATCH",
      `/api/settlements/destinations/${first.destination.id}`,
      owner.cookie,
      { archived: false },
    );
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { error: string }).error).toBe(
      "destination_exists",
    );
  });
});

describe("settlement movements + summary API", () => {
  async function seedTracks() {
    const mom = await (
      await req("POST", "/api/settlements/destinations", owner.cookie, {
        familyId,
        name: "Mom",
        kind: "person",
      })
    ).json() as { destination: { id: string } };
    const church = await (
      await req("POST", "/api/settlements/destinations", owner.cookie, {
        familyId,
        name: "Church",
        kind: "organization",
      })
    ).json() as { destination: { id: string } };
    return { momId: mom.destination.id, churchId: church.destination.id };
  }

  it("received + settled updates available / in-hand / per-destination totals", async () => {
    const { momId, churchId } = await seedTracks();

    const received = await req("POST", "/api/settlements/movements", member.cookie, {
      familyId,
      type: "received",
      amount: 50000,
      note: "August fund from site",
      movedOn: "2026-08-01",
    });
    expect(received.status).toBe(201);
    const receivedBody = (await received.json()) as {
      movement: { type: string; amount: number; destinationId: null };
      available: number;
      inHand: number;
      settled: number;
    };
    expect(receivedBody.movement.type).toBe("received");
    expect(receivedBody.available).toBe(50000);
    expect(receivedBody.inHand).toBe(50000);
    expect(receivedBody.settled).toBe(0);

    const toMom = await req("POST", "/api/settlements/movements", member.cookie, {
      familyId,
      type: "settled",
      amount: 15000,
      destinationId: momId,
      note: "August support",
      movedOn: "2026-08-05",
    });
    expect(toMom.status).toBe(201);

    const toChurch = await req("POST", "/api/settlements/movements", owner.cookie, {
      familyId,
      type: "settled",
      amount: 5000,
      destinationId: churchId,
      note: "Sunday offering",
      movedOn: "2026-08-10",
    });
    expect(toChurch.status).toBe(201);

    const summary = await req(
      "GET",
      `/api/settlements/summary?familyId=${familyId}`,
      owner.cookie,
    );
    expect(summary.status).toBe(200);
    const body = (await summary.json()) as {
      available: number;
      settled: number;
      inHand: number;
      destinations: { id: string; name: string; settled: number }[];
      movements: { type: string; destinationName: string | null; amount: number }[];
    };
    expect(body.available).toBe(50000);
    expect(body.settled).toBe(20000);
    expect(body.inHand).toBe(30000);

    const mom = body.destinations.find((d) => d.id === momId)!;
    const church = body.destinations.find((d) => d.id === churchId)!;
    expect(mom.settled).toBe(15000);
    expect(church.settled).toBe(5000);

    expect(body.movements).toHaveLength(3);
    expect(body.movements[0]!.destinationName).toBe("Church");
    expect(body.movements.some((m) => m.type === "received")).toBe(true);
  });

  it("settled without destinationId → 400; cross-family destination → 400", async () => {
    const { momId } = await seedTracks();

    const missing = await req("POST", "/api/settlements/movements", owner.cookie, {
      familyId,
      type: "settled",
      amount: 100,
    });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toBe(
      "validation_error",
    );

    const otherDest = await (
      await req("POST", "/api/settlements/destinations", outsider.cookie, {
        familyId: otherFamilyId,
        name: "Other Mom",
      })
    ).json() as { destination: { id: string } };

    const cross = await req("POST", "/api/settlements/movements", owner.cookie, {
      familyId,
      type: "settled",
      amount: 100,
      destinationId: otherDest.destination.id,
    });
    expect(cross.status).toBe(400);
    expect(((await cross.json()) as { error: string }).error).toBe(
      "invalid_destination_id",
    );

    // sanity: valid dest still works
    await req("POST", "/api/settlements/movements", owner.cookie, {
      familyId,
      type: "received",
      amount: 100,
    });
    const ok = await req("POST", "/api/settlements/movements", owner.cookie, {
      familyId,
      type: "settled",
      amount: 50,
      destinationId: momId,
    });
    expect(ok.status).toBe(201);
  });

  it("member cannot edit/delete owner's movement; author can", async () => {
    const { momId } = await seedTracks();
    await req("POST", "/api/settlements/movements", owner.cookie, {
      familyId,
      type: "received",
      amount: 1000,
    });
    const created = await (
      await req("POST", "/api/settlements/movements", owner.cookie, {
        familyId,
        type: "settled",
        amount: 200,
        destinationId: momId,
      })
    ).json() as { movement: { id: string } };

    const forbidden = await req(
      "PATCH",
      `/api/settlements/movements/${created.movement.id}`,
      member.cookie,
      { amount: 1 },
    );
    expect(forbidden.status).toBe(403);

    const delForbidden = await req(
      "DELETE",
      `/api/settlements/movements/${created.movement.id}`,
      member.cookie,
    );
    expect(delForbidden.status).toBe(403);

    const patched = await req(
      "PATCH",
      `/api/settlements/movements/${created.movement.id}`,
      owner.cookie,
      { amount: 250, note: null },
    );
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as {
      movement: { amount: number; note: string | null };
      settled: number;
    };
    expect(patchedBody.movement.amount).toBe(250);
    expect(patchedBody.movement.note).toBeNull();
    expect(patchedBody.settled).toBe(250);

    const deleted = await req(
      "DELETE",
      `/api/settlements/movements/${created.movement.id}`,
      owner.cookie,
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      ok: true,
      settled: 0,
      available: 1000,
      inHand: 1000,
    });
  });

  it("rejects invalid amount and unknown deep path", async () => {
    const bad = await req("POST", "/api/settlements/movements", owner.cookie, {
      familyId,
      type: "received",
      amount: -5,
    });
    expect(bad.status).toBe(400);

    const deep = await req(
      "GET",
      `/api/settlements/movements/nope/extra`,
      owner.cookie,
    );
    // Hono may 404 via money router or app catch-all
    expect([404, 400]).toContain(deep.status);
  });

  it("401 without session", async () => {
    const res = await app.request(
      `/api/settlements/summary?familyId=${familyId}`,
      { method: "GET" },
      t.env,
    );
    expect(res.status).toBe(401);
  });

  it("filters movements by destinationId", async () => {
    const { momId, churchId } = await seedTracks();
    await req("POST", "/api/settlements/movements", owner.cookie, {
      familyId,
      type: "received",
      amount: 1000,
    });
    await req("POST", "/api/settlements/movements", owner.cookie, {
      familyId,
      type: "settled",
      amount: 100,
      destinationId: momId,
    });
    await req("POST", "/api/settlements/movements", owner.cookie, {
      familyId,
      type: "settled",
      amount: 200,
      destinationId: churchId,
    });

    const filtered = await req(
      "GET",
      `/api/settlements/movements?familyId=${familyId}&destinationId=${momId}`,
      owner.cookie,
    );
    expect(filtered.status).toBe(200);
    const body = (await filtered.json()) as {
      movements: { destinationId: string | null; amount: number }[];
      inHand: number;
    };
    expect(body.movements).toHaveLength(1);
    expect(body.movements[0]!.amount).toBe(100);
    // balances remain family-wide
    expect(body.inHand).toBe(700);
  });
});
