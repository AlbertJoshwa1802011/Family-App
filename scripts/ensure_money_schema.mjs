#!/usr/bin/env node
/**
 * Idempotent expenses + families.default_currency reconciliation.
 *
 * NEVER deletes expense rows. If the live table still has the feature-branch
 * simple shape (amount_cents / spent_on), it is renamed to
 * expenses_legacy_simple_<ts> and a rich Money Manager table is created; rows
 * are copied across. If amount_minor already exists, this is a no-op.
 *
 * Usage:
 *   node scripts/ensure_money_schema.mjs --remote   # prod D1 via wrangler
 *   node scripts/ensure_money_schema.mjs --local    # local D1
 */
import { spawnSync } from "node:child_process";

const DB = "family-vault-db";
const remote = process.argv.includes("--remote");
const local = process.argv.includes("--local") || !remote;

function wrangler(args) {
  const res = spawnSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    env: process.env,
  });
  if (res.status !== 0) {
    throw new Error(`wrangler failed: ${(res.stderr || res.stdout || "").slice(0, 800)}`);
  }
  return res.stdout || "";
}

function execute(sql) {
  const args = ["d1", "execute", DB, "--command", sql];
  if (remote) args.push("--remote");
  else args.push("--local");
  return wrangler(args);
}

function columns(table) {
  const out = execute(`PRAGMA table_info(${table})`);
  // wrangler prints a table; also try JSON
  const names = new Set();
  for (const m of out.matchAll(/\b(amount_cents|amount_minor|spent_on|expense_date|created_by|created_by_user_id|default_currency)\b/g)) {
    names.add(m[1]);
  }
  // More reliable: ask for JSON
  try {
    const args = ["d1", "execute", DB, "--command", `PRAGMA table_info(${table})`, "--json"];
    if (remote) args.push("--remote");
    else args.push("--local");
    const res = spawnSync("npx", ["wrangler", ...args], { encoding: "utf8", env: process.env });
    if (res.status === 0) {
      const start = (res.stdout || "").indexOf("[");
      if (start >= 0) {
        const parsed = JSON.parse(res.stdout.slice(start));
        const rows = parsed[0]?.results || parsed.results || [];
        return new Set(rows.map((r) => r.name));
      }
    }
  } catch {}
  return names;
}

function main() {
  if (!process.env.CLOUDFLARE_API_TOKEN && remote) {
    console.error("CLOUDFLARE_API_TOKEN required for --remote");
    process.exit(1);
  }

  console.log(`Ensuring money schema (${remote ? "remote" : "local"})…`);

  // default_currency on families
  const famCols = columns("families");
  if (!famCols.has("default_currency")) {
    console.log("Adding families.default_currency…");
    execute(`ALTER TABLE families ADD COLUMN default_currency text NOT NULL DEFAULT 'USD'`);
  } else {
    console.log("families.default_currency already present");
  }

  const cols = columns("expenses");
  if (cols.has("amount_minor") && cols.has("expense_date")) {
    console.log("expenses already rich (amount_minor) — leaving data untouched");
    return;
  }
  if (!cols.has("amount_cents")) {
    console.log("expenses has neither simple nor rich shape — creating rich table");
    execute(`CREATE TABLE IF NOT EXISTS expenses (
      id text PRIMARY KEY NOT NULL,
      family_id text NOT NULL,
      paid_by_member_id text NOT NULL,
      subject_member_id text,
      category_id text,
      parent_expense_id text,
      nest_depth integer DEFAULT 0 NOT NULL,
      amount_minor integer NOT NULL,
      currency text NOT NULL,
      expense_date text NOT NULL,
      merchant text,
      description text,
      payment_method text,
      split_type text DEFAULT 'none' NOT NULL,
      visibility text DEFAULT 'private' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      trashed_at integer,
      created_by_user_id text NOT NULL,
      client_request_id text,
      created_at integer DEFAULT (unixepoch()) NOT NULL,
      updated_at integer DEFAULT (unixepoch()) NOT NULL,
      FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE cascade,
      FOREIGN KEY (paid_by_member_id) REFERENCES family_members(id),
      FOREIGN KEY (subject_member_id) REFERENCES family_members(id) ON DELETE set null,
      FOREIGN KEY (category_id) REFERENCES expense_categories(id) ON DELETE set null,
      FOREIGN KEY (parent_expense_id) REFERENCES expenses(id) ON DELETE cascade,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE cascade
    )`);
    return;
  }

  const bak = `expenses_legacy_simple_${Date.now()}`;
  console.log(`Simple expenses detected — renaming to ${bak} and copying into rich table (no deletes)`);
  execute(`ALTER TABLE expenses RENAME TO ${bak}`);
  execute(`CREATE TABLE expenses (
    id text PRIMARY KEY NOT NULL,
    family_id text NOT NULL,
    paid_by_member_id text NOT NULL,
    subject_member_id text,
    category_id text,
    parent_expense_id text,
    nest_depth integer DEFAULT 0 NOT NULL,
    amount_minor integer NOT NULL,
    currency text NOT NULL,
    expense_date text NOT NULL,
    merchant text,
    description text,
    payment_method text,
    split_type text DEFAULT 'none' NOT NULL,
    visibility text DEFAULT 'family' NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    trashed_at integer,
    created_by_user_id text NOT NULL,
    client_request_id text,
    created_at integer DEFAULT (unixepoch()) NOT NULL,
    updated_at integer DEFAULT (unixepoch()) NOT NULL,
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE cascade,
    FOREIGN KEY (paid_by_member_id) REFERENCES family_members(id),
    FOREIGN KEY (subject_member_id) REFERENCES family_members(id) ON DELETE set null,
    FOREIGN KEY (category_id) REFERENCES expense_categories(id) ON DELETE set null,
    FOREIGN KEY (parent_expense_id) REFERENCES expenses(id) ON DELETE cascade,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE cascade
  )`);
  execute(`CREATE INDEX IF NOT EXISTS idx_expense_family_date ON expenses (family_id, expense_date)`);
  execute(`CREATE INDEX IF NOT EXISTS idx_expense_family_status ON expenses (family_id, status)`);
  execute(`CREATE INDEX IF NOT EXISTS idx_expense_created_by ON expenses (created_by_user_id)`);
  execute(`CREATE INDEX IF NOT EXISTS idx_expense_paid_by ON expenses (paid_by_member_id)`);
  execute(`CREATE INDEX IF NOT EXISTS idx_expense_category ON expenses (category_id)`);
  execute(`CREATE INDEX IF NOT EXISTS idx_expense_parent ON expenses (parent_expense_id)`);
  execute(`CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_client_request ON expenses (family_id, created_by_user_id, client_request_id)`);

  // Copy convertible rows; skip orphans with no membership (keep them in legacy table).
  execute(`INSERT INTO expenses (
    id, family_id, paid_by_member_id, amount_minor, currency, expense_date,
    description, visibility, status, created_by_user_id, created_at, updated_at, nest_depth, split_type
  )
  SELECT
    e.id, e.family_id, fm.id, e.amount_cents, e.currency, e.spent_on,
    e.note, 'family', 'active', e.created_by, e.created_at, e.updated_at, 0, 'none'
  FROM ${bak} e
  JOIN family_members fm
    ON fm.family_id = e.family_id AND fm.user_id = e.created_by
  WHERE fm.status = 'active'`);

  console.log(`Copied rows into rich expenses; legacy backup table retained: ${bak}`);
}

main();
