/**
 * Shared harness for the module catalog.
 *
 * One TestEnv per describe (never per-case) so a 1000-case file stays fast.
 */
import { app } from "../../worker/index";
import type { Env } from "../../worker/types";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedUser,
} from "../helpers/testEnv";

/** KV that never counts — catalog grids would otherwise 429 (e.g. expense-create 60/min). */
function passthroughKv(): Env["KV"] {
  return {
    get: async () => null,
    put: async () => {},
    delete: async () => {},
  } as unknown as Env["KV"];
}

export { createTestEnv } from "../helpers/testEnv";

export const ORIGIN = "http://localhost:5173";

export function catalogReq(
  env: Env,
  method: string,
  path: string,
  opts: {
    cookie?: string;
    body?: unknown;
    rawBody?: string;
    contentType?: string;
  } = {},
) {
  const headers: Record<string, string> = { Origin: ORIGIN };
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.body !== undefined || opts.rawBody !== undefined) {
    headers["Content-Type"] = opts.contentType ?? "application/json";
  }
  const body =
    opts.rawBody !== undefined
      ? opts.rawBody
      : opts.body === undefined
        ? undefined
        : JSON.stringify(opts.body);
  return app.request(path, { method, headers, ...(body !== undefined ? { body } : {}) }, env);
}

export function seedFamilySession(opts: { bypassRateLimit?: boolean } = {}) {
  const { env, sqlite } = createTestEnv(
    opts.bypassRateLimit ? { KV: passthroughKv() } : {},
  );
  const owner = seedUser(sqlite);
  const family = seedFamily(sqlite, owner.id);
  const actor = seedActor(sqlite, family.id, "owner", { name: "Catalog Owner" });
  const outsiderOwner = seedUser(sqlite, { email: "outsider@example.com" });
  const otherFamily = seedFamily(sqlite, outsiderOwner.id, "Other Family");
  const outsider = seedActor(sqlite, otherFamily.id, "owner", {
    email: "outsider-member@example.com",
    name: "Outsider",
  });
  return {
    env,
    sqlite,
    familyId: family.id,
    actor,
    otherFamilyId: otherFamily.id,
    outsider,
  };
}

export type FamilySession = ReturnType<typeof seedFamilySession>;

/** ISO yyyy-mm-dd from a UTC day ordinal relative to 2026-01-01. */
export function utcIsoFromDay(dayOffset: number): string {
  return new Date(Date.UTC(2026, 0, 1 + dayOffset)).toISOString().slice(0, 10);
}

export type CatalogRoute = {
  module: string;
  method: string;
  path: string;
  /** Session required to do anything useful. Public routes skip the 401 check. */
  auth: "required" | "public";
  mutation?: boolean;
};
