#!/usr/bin/env node
/**
 * Reconcile remote D1 migration ledger drift.
 *
 * Prod schema was sometimes applied outside wrangler's ledger, so
 * `d1 migrations apply --remote` tries to re-CREATE tables that already
 * exist (e.g. money_movements from 0010). This script probes sentinel
 * objects and INSERTs missing rows into `d1_migrations` so only truly
 * pending migrations run.
 *
 * Safe / idempotent: never drops data; only inserts ledger rows when the
 * migration's objects are already present AND the row is missing.
 *
 * Usage (requires CLOUDFLARE_API_TOKEN):
 *   node scripts/reconcile_remote_migrations.mjs
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const DB = "family-vault-db";
const MIGRATIONS_DIR = join(process.cwd(), "migrations");

/** Sentinel probes: migration is "already in schema" when EVERY probe is true. */
const SENTINELS = {
  "0010_mighty_shriek.sql": [
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='money_movements'",
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='settlement_destinations'",
  ],
  "0011_legal_havok.sql": [
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='notebooks'",
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='notes'",
  ],
  "0012_wandering_stardust.sql": [
    "SELECT 1 AS ok FROM pragma_table_info('family_members') WHERE name='modules_json'",
    "SELECT 1 AS ok FROM pragma_table_info('invites') WHERE name='modules_json'",
  ],
  "0013_flaky_sheva_callister.sql": [
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='resource_links'",
    "SELECT 1 AS ok FROM pragma_table_info('events') WHERE name='travel_buffer_mins'",
  ],
  "0014_plain_reptil.sql": [
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='family_labels'",
  ],
};

function wranglerJson(args) {
  const out = execFileSync(
    "npx",
    ["wrangler", ...args, "--json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: process.env },
  );
  // wrangler sometimes prints non-JSON logs before the payload; find last JSON value.
  const trimmed = out.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.lastIndexOf("[");
    const startObj = trimmed.lastIndexOf("{");
    const i = Math.max(start, startObj);
    if (i < 0) throw new Error(`No JSON in wrangler output:\n${trimmed}`);
    return JSON.parse(trimmed.slice(i));
  }
}

function query(sql) {
  const result = wranglerJson([
    "d1",
    "execute",
    DB,
    "--remote",
    "--command",
    sql,
  ]);
  // Shape: [{ results: [...], success: true }, ...] or { results: [...] }
  const rows = Array.isArray(result)
    ? (result[0]?.results ?? [])
    : (result.results ?? []);
  return rows;
}

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function main() {
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    console.error("CLOUDFLARE_API_TOKEN is required");
    process.exit(1);
  }

  // Ensure ledger table exists (wrangler creates it on first apply; create if missing).
  query(`
    CREATE TABLE IF NOT EXISTS d1_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )
  `);

  const applied = new Set(
    query("SELECT name FROM d1_migrations").map((r) => String(r.name)),
  );
  console.log(`Ledger has ${applied.size} row(s).`);

  const files = migrationFiles();
  let marked = 0;

  for (const file of files) {
    if (applied.has(file)) continue;
    const probes = SENTINELS[file];
    if (!probes) {
      // Unknown / early migrations without sentinels — leave for wrangler.
      continue;
    }
    const present = probes.every((sql) => query(sql).length > 0);
    if (!present) {
      console.log(`Pending (schema incomplete): ${file}`);
      continue;
    }
    console.log(`Marking already-applied: ${file}`);
    // Escape single quotes in filename (none expected).
    query(
      `INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${file.replace(/'/g, "''")}')`,
    );
    marked += 1;
  }

  const after = query("SELECT name FROM d1_migrations ORDER BY id");
  console.log(`Done. Marked ${marked}. Ledger now:`);
  for (const row of after) console.log(`  - ${row.name}`);
}

main();
