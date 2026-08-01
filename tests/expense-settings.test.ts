/**
 * Expense settings + module bootstrap.
 *
 * Settings are family-wide, so they are owner/admin-only; the GET tells the
 * client which it is via `canEdit` so a member sees a disabled control rather
 * than a 403 after tapping.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { app } from "../worker/index";
import type { Env } from "../worker/types";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedSession,
  seedUser,
} from "./helpers/testEnv";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_PAYMENT_METHODS,
} from "../worker/lib/expenses/defaults";

let env: Env;
let sqlite: DatabaseSync;
let familyId: string;
let owner: { userId: string; cookie: string };
let admin: { userId: string; cookie: string };
let member: { userId: string; cookie: string };

interface Settings {
  familyId: string;
  defaultCurrency: string;
  weekStartsOn: number;
  monthStartDay: number;
}

interface SettingsResponse {
  settings: Settings;
  initialized: boolean;
  canEdit: boolean;
}

function req(path: string, init: RequestInit = {}, cookie?: string) {
  return app.request(
    `http://localhost/api${path}`,
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(init.headers ?? {}),
      },
    },
    env,
  );
}

const getSettings = (cookie: string, id = familyId) =>
  req(`/expense-settings?familyId=${id}`, {}, cookie);

const patchSettings = (body: Record<string, unknown>, cookie: string) =>
  req("/expense-settings", { method: "PATCH", body: JSON.stringify(body) }, cookie);

beforeEach(() => {
  ({ env, sqlite } = createTestEnv());
  const ownerUser = seedUser(sqlite);
  familyId = seedFamily(sqlite, ownerUser.id).id;
  owner = seedActor(sqlite, familyId, "owner");
  admin = seedActor(sqlite, familyId, "admin");
  member = seedActor(sqlite, familyId, "member");
});

describe("GET /expense-settings", () => {
  it("requires a session", async () => {
    const res = await req(`/expense-settings?familyId=${familyId}`);
    expect(res.status).toBe(401);
  });

  it("requires familyId", async () => {
    expect((await req("/expense-settings", {}, owner.cookie)).status).toBe(400);
  });

  it("404s for a non-member", async () => {
    const stranger = seedUser(sqlite);
    const res = await getSettings(seedSession(sqlite, stranger.id));
    expect(res.status).toBe(404);
  });

  it("returns INR defaults before initialization, without writing a row", async () => {
    const res = await getSettings(owner.cookie);
    const body = (await res.json()) as SettingsResponse;

    expect(res.status).toBe(200);
    expect(body.settings.defaultCurrency).toBe("INR");
    expect(body.settings.weekStartsOn).toBe(1);
    expect(body.settings.monthStartDay).toBe(1);
    expect(body.initialized).toBe(false);

    // A GET must never create data.
    const rows = sqlite
      .prepare("SELECT COUNT(*) AS c FROM expense_settings")
      .get() as { c: number };
    expect(rows.c).toBe(0);
  });

  it("reports canEdit per role", async () => {
    for (const actor of [owner, admin]) {
      const body = (await (await getSettings(actor.cookie)).json()) as SettingsResponse;
      expect(body.canEdit).toBe(true);
    }
    const memberBody = (await (
      await getSettings(member.cookie)
    ).json()) as SettingsResponse;
    expect(memberBody.canEdit).toBe(false);
  });
});

describe("PATCH /expense-settings", () => {
  it("creates the row on first save and returns it", async () => {
    const res = await patchSettings(
      { familyId, defaultCurrency: "USD", weekStartsOn: 0, monthStartDay: 5 },
      owner.cookie,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as SettingsResponse;
    expect(body.settings.defaultCurrency).toBe("USD");
    expect(body.settings.weekStartsOn).toBe(0);
    expect(body.settings.monthStartDay).toBe(5);
    expect(body.initialized).toBe(true);
  });

  it("updates only the fields provided", async () => {
    await patchSettings({ familyId, defaultCurrency: "USD", monthStartDay: 5 }, owner.cookie);
    const res = await patchSettings({ familyId, weekStartsOn: 6 }, owner.cookie);

    const body = (await res.json()) as SettingsResponse;
    expect(body.settings.weekStartsOn).toBe(6);
    expect(body.settings.defaultCurrency).toBe("USD"); // untouched
    expect(body.settings.monthStartDay).toBe(5);
  });

  it("allows an admin", async () => {
    expect((await patchSettings({ familyId, weekStartsOn: 0 }, admin.cookie)).status).toBe(
      200,
    );
  });

  it("forbids an ordinary member", async () => {
    const res = await patchSettings({ familyId, weekStartsOn: 0 }, member.cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("404s for a non-member (no family enumeration)", async () => {
    const stranger = seedUser(sqlite);
    const res = await patchSettings(
      { familyId, weekStartsOn: 0 },
      seedSession(sqlite, stranger.id),
    );
    expect(res.status).toBe(404);
  });

  it("rejects unsupported currencies and out-of-range periods", async () => {
    const cases = [
      { familyId, defaultCurrency: "XYZ" },
      { familyId, defaultCurrency: "inr" }, // case-sensitive ISO code
      { familyId, weekStartsOn: 7 },
      { familyId, weekStartsOn: -1 },
      { familyId, monthStartDay: 0 },
      // 29–31 don't exist in every month; a salary cycle must never skip.
      { familyId, monthStartDay: 29 },
      { familyId, monthStartDay: 1.5 },
      { defaultCurrency: "USD" }, // no familyId
    ];

    for (const body of cases) {
      const res = await patchSettings(body, owner.cookie);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("validation_error");
    }
  });

  it("keeps families isolated", async () => {
    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    const otherOwner = seedActor(sqlite, otherFamily, "owner");

    await patchSettings({ familyId, defaultCurrency: "USD" }, owner.cookie);
    await patchSettings(
      { familyId: otherFamily, defaultCurrency: "JPY" },
      otherOwner.cookie,
    );

    const mine = (await (await getSettings(owner.cookie)).json()) as SettingsResponse;
    const theirs = (await (
      await getSettings(otherOwner.cookie, otherFamily)
    ).json()) as SettingsResponse;

    expect(mine.settings.defaultCurrency).toBe("USD");
    expect(theirs.settings.defaultCurrency).toBe("JPY");
  });

  it("requires a session", async () => {
    const res = await req("/expense-settings", {
      method: "PATCH",
      body: JSON.stringify({ familyId, weekStartsOn: 0 }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /expense-settings/bootstrap", () => {
  const bootstrap = (cookie: string, body: Record<string, unknown> = { familyId }) =>
    req("/expense-settings/bootstrap", { method: "POST", body: JSON.stringify(body) }, cookie);

  it("seeds categories, payment methods and settings", async () => {
    const res = await bootstrap(owner.cookie);
    expect(res.status).toBe(200);

    const { setup } = (await res.json()) as {
      setup: {
        categoriesSeeded: number;
        paymentMethodsSeeded: number;
        settingsCreated: boolean;
      };
    };

    const expectedCategories =
      DEFAULT_EXPENSE_CATEGORIES.length +
      DEFAULT_EXPENSE_CATEGORIES.reduce((n, c) => n + c.children.length, 0);

    expect(setup.categoriesSeeded).toBe(expectedCategories);
    expect(setup.paymentMethodsSeeded).toBe(DEFAULT_PAYMENT_METHODS.length);
    expect(setup.settingsCreated).toBe(true);
  });

  it("is idempotent — repeated calls never duplicate", async () => {
    await bootstrap(owner.cookie);
    const res = await bootstrap(owner.cookie);

    const { setup } = (await res.json()) as {
      setup: { categoriesSeeded: number; paymentMethodsSeeded: number; settingsCreated: boolean };
    };
    expect(setup).toEqual({
      categoriesSeeded: 0,
      paymentMethodsSeeded: 0,
      settingsCreated: false,
    });

    const counts = sqlite
      .prepare(
        `SELECT (SELECT COUNT(*) FROM expense_categories WHERE family_id = ?) AS cats,
                (SELECT COUNT(*) FROM expense_payment_methods WHERE family_id = ?) AS pms,
                (SELECT COUNT(*) FROM expense_settings WHERE family_id = ?) AS settings`,
      )
      .get(familyId, familyId, familyId) as {
      cats: number;
      pms: number;
      settings: number;
    };

    expect(counts.pms).toBe(DEFAULT_PAYMENT_METHODS.length);
    expect(counts.settings).toBe(1);
  });

  it("can be triggered by any member", async () => {
    expect((await bootstrap(member.cookie)).status).toBe(200);
  });

  it("404s for a non-member", async () => {
    const stranger = seedUser(sqlite);
    expect((await bootstrap(seedSession(sqlite, stranger.id))).status).toBe(404);
  });

  it("requires a session and a familyId", async () => {
    const noSession = await req("/expense-settings/bootstrap", {
      method: "POST",
      body: JSON.stringify({ familyId }),
    });
    expect(noSession.status).toBe(401);

    const noFamily = await req(
      "/expense-settings/bootstrap",
      { method: "POST", body: JSON.stringify({}) },
      owner.cookie,
    );
    expect(noFamily.status).toBe(400);
  });

  it("marks settings initialized afterwards", async () => {
    await bootstrap(owner.cookie);
    const body = (await (await getSettings(owner.cookie)).json()) as SettingsResponse;
    expect(body.initialized).toBe(true);
    expect(body.settings.defaultCurrency).toBe("INR");
  });
});
