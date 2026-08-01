/**
 * Real-database test harness.
 *
 * D1 is SQLite, so integration tests run the actual generated migrations
 * against an in-memory `node:sqlite` database wrapped in a D1-compatible
 * adapter. This exercises the REAL routes → drizzle → SQL path (constraints,
 * uniques, FK columns, defaults) with zero extra dependencies.
 *
 * Limitation: the adapter maps rows to positional arrays via object key order,
 * which matches SQLite column order. Queries whose selected columns share a
 * result name (e.g. two joined `created_at`s without aliases) would collapse —
 * every query in the codebase uses explicit aliased field selections, keep it
 * that way.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Env } from "../../worker/types";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

type SqlParam = string | number | bigint | null | Uint8Array;

function coerceParam(p: unknown): SqlParam {
  if (p === undefined) return null;
  if (typeof p === "boolean") return p ? 1 : 0;
  return p as SqlParam;
}

interface D1RunResult {
  success: true;
  results: unknown[];
  meta: { changes: number; last_row_id: number };
}

function makeStatement(sqlite: DatabaseSync, sql: string, params: unknown[] = []) {
  const bound = params.map(coerceParam);
  const stmt = {
    bind: (...p: unknown[]) => makeStatement(sqlite, sql, p),
    all: async () => {
      const results = sqlite.prepare(sql).all(...bound) as Record<string, unknown>[];
      return { results, success: true as const, meta: { changes: 0, last_row_id: 0 } };
    },
    raw: async () => {
      const rows = sqlite.prepare(sql).all(...bound) as Record<string, unknown>[];
      return rows.map((r) => Object.values(r));
    },
    first: async (col?: string) => {
      const row = sqlite.prepare(sql).get(...bound) as Record<string, unknown> | undefined;
      if (row === undefined) return null;
      return col ? (row[col] ?? null) : row;
    },
    run: async (): Promise<D1RunResult> => {
      const info = sqlite.prepare(sql).run(...bound);
      return {
        success: true,
        results: [],
        meta: {
          changes: Number(info.changes),
          last_row_id: Number(info.lastInsertRowid),
        },
      };
    },
  };
  return stmt;
}

export function createTestD1(): { d1: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }

  const d1 = {
    prepare: (sql: string) => makeStatement(sqlite, sql),
    batch: async (stmts: ReturnType<typeof makeStatement>[]) => {
      const out = [];
      for (const s of stmts) out.push(await s.all());
      return out;
    },
    exec: async (sql: string) => {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;

  return { d1, sqlite };
}

/** In-memory KV honoring expirationTtl — enough for rate limits + OAuth state. */
export function createTestKV(): KVNamespace {
  const store = new Map<string, { value: string; expiresAt: number | null }>();

  const kv = {
    get: async (key: string, type?: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== null && Date.now() / 1000 > entry.expiresAt) {
        store.delete(key);
        return null;
      }
      return type === "json" ? JSON.parse(entry.value) : entry.value;
    },
    put: async (
      key: string,
      value: string,
      opts?: { expirationTtl?: number },
    ) => {
      store.set(key, {
        value,
        expiresAt: opts?.expirationTtl ? Date.now() / 1000 + opts.expirationTtl : null,
      });
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;

  return kv;
}

export interface TestEnv {
  env: Env;
  sqlite: DatabaseSync;
}

export function createTestEnv(overrides: Partial<Env> = {}): TestEnv {
  const { d1, sqlite } = createTestD1();
  const env: Env = {
    ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } as unknown as Fetcher,
    DB: d1,
    KV: createTestKV(),
    APP_URL: "http://localhost:5173",
    ...overrides,
  };
  return { env, sqlite };
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

let seedCounter = 0;

export function seedUser(
  sqlite: DatabaseSync,
  opts: { email?: string; name?: string } = {},
): { id: string; email: string } {
  const id = crypto.randomUUID();
  const email = opts.email ?? `user${++seedCounter}@example.com`;
  sqlite
    .prepare(
      "INSERT INTO users (id, google_sub, email, name) VALUES (?, ?, ?, ?)",
    )
    .run(id, `sub-${id}`, email, opts.name ?? `User ${seedCounter}`);
  return { id, email };
}

/** Creates a live session row and returns the Cookie header value. */
export function seedSession(sqlite: DatabaseSync, userId: string): string {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  sqlite
    .prepare(
      "INSERT INTO sessions (id, user_id, expires_at, idle_expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(id, userId, now + 30 * 24 * 3600, now + 2 * 3600, now);
  return `sid=${id}`;
}

export function seedFamily(
  sqlite: DatabaseSync,
  ownerUserId: string,
  name = "Test Family",
): { id: string } {
  const id = crypto.randomUUID();
  sqlite
    .prepare("INSERT INTO families (id, name, owner_user_id) VALUES (?, ?, ?)")
    .run(id, name, ownerUserId);
  return { id };
}

export function seedMember(
  sqlite: DatabaseSync,
  familyId: string,
  userId: string,
  role: "owner" | "admin" | "member" = "member",
): { id: string } {
  const id = crypto.randomUUID();
  sqlite
    .prepare(
      "INSERT INTO family_members (id, family_id, user_id, member_type, role, status) VALUES (?, ?, ?, 'user', ?, 'active')",
    )
    .run(id, familyId, userId, role);
  return { id };
}

/** Convenience: user + active session + membership in one call. */
export function seedActor(
  sqlite: DatabaseSync,
  familyId: string,
  role: "owner" | "admin" | "member",
  opts: { email?: string; name?: string } = {},
): { userId: string; memberId: string; cookie: string; email: string } {
  const user = seedUser(sqlite, opts);
  const member = seedMember(sqlite, familyId, user.id, role);
  const cookie = seedSession(sqlite, user.id);
  return { userId: user.id, memberId: member.id, cookie, email: user.email };
}

export function seedExpenseCategory(
  sqlite: DatabaseSync,
  opts: {
    familyId: string;
    slug: string;
    name?: string;
    parentId?: string | null;
    status?: "active" | "archived";
  },
): { id: string } {
  const id = crypto.randomUUID();
  sqlite
    .prepare(
      `INSERT INTO expense_categories (id, family_id, parent_id, name, slug, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      opts.familyId,
      opts.parentId ?? null,
      opts.name ?? opts.slug,
      opts.slug,
      opts.status ?? "active",
    );
  return { id };
}

export function seedExpense(
  sqlite: DatabaseSync,
  opts: {
    familyId: string;
    createdByUserId: string;
    categoryId: string;
    subcategoryId?: string | null;
    amountMinor?: number;
    currency?: string;
    spentOn?: string;
    merchant?: string | null;
    merchantKey?: string | null;
    payerMemberId?: string | null;
    visibility?: "family" | "private";
    status?: "active" | "trashed";
    source?: string;
    externalId?: string | null;
  },
): { id: string } {
  const id = crypto.randomUUID();
  sqlite
    .prepare(
      `INSERT INTO expenses
         (id, family_id, created_by_user_id, payer_member_id, amount_minor, currency,
          spent_on, category_id, subcategory_id, merchant, merchant_key,
          visibility, status, source, external_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
    )
    .run(
      id,
      opts.familyId,
      opts.createdByUserId,
      opts.payerMemberId ?? null,
      opts.amountMinor ?? 10000,
      opts.currency ?? "INR",
      opts.spentOn ?? "2026-08-01",
      opts.categoryId,
      opts.subcategoryId ?? null,
      opts.merchant ?? null,
      opts.merchantKey ?? null,
      opts.visibility ?? "family",
      opts.status ?? "active",
      opts.source ?? "manual",
      opts.externalId ?? null,
    );
  return { id };
}

export function seedDocument(
  sqlite: DatabaseSync,
  opts: {
    familyId: string;
    ownerUserId: string;
    title?: string;
    visibility?: "family" | "private";
    expiryDate?: string | null;
    status?: string;
  },
): { id: string } {
  const id = crypto.randomUUID();
  sqlite
    .prepare(
      `INSERT INTO documents (id, family_id, owner_user_id, title, category, visibility, status, expiry_date, updated_at)
       VALUES (?, ?, ?, ?, 'other', ?, ?, ?, unixepoch())`,
    )
    .run(
      id,
      opts.familyId,
      opts.ownerUserId,
      opts.title ?? "Seed Document",
      opts.visibility ?? "family",
      opts.status ?? "active",
      opts.expiryDate ?? null,
    );
  return { id };
}
