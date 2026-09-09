#!/usr/bin/env node
/**
 * Reconcile remote D1 migration history when schema objects already exist
 * but d1_migrations is missing rows (common after manual applies / partial deploys).
 *
 * Safe: only INSERTs missing migration *names* into d1_migrations — never re-runs SQL.
 * Requires CLOUDFLARE_API_TOKEN (and usually CLOUDFLARE_ACCOUNT_ID) in the env.
 *
 * Usage: node scripts/reconcile_remote_migrations.mjs
 */
import { spawnSync } from "node:child_process";

const DB = "family-vault-db";

/** Hallmark probes: migration is considered applied when the probe returns a row. */
const PROBES = [
  {
    name: "0010_mighty_shriek.sql",
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='money_movements' LIMIT 1",
  },
  {
    name: "0011_legal_havok.sql",
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='notebooks' LIMIT 1",
  },
  {
    name: "0012_wandering_stardust.sql",
    sql: "SELECT name FROM pragma_table_info('family_members') WHERE name='modules_json' LIMIT 1",
  },
  {
    name: "0013_flaky_sheva_callister.sql",
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='resource_links' LIMIT 1",
  },
  {
    name: "0014_plain_reptil.sql",
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='family_labels' LIMIT 1",
  },
];

function wranglerJson(args) {
  const res = spawnSync("npx", ["wrangler", ...args, "--json"], {
    encoding: "utf8",
    env: process.env,
  });
  if (res.status !== 0) {
    const err = (res.stderr || res.stdout || "").trim();
    throw new Error(`wrangler ${args.join(" ")} failed (exit ${res.status}): ${err}`);
  }
  const out = (res.stdout || "").trim();
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch {
    // Some wrangler versions print logs before JSON — take the last {...} block.
    const start = out.lastIndexOf("[");
    const startObj = out.lastIndexOf("{");
    const i = Math.max(start, startObj);
    if (i < 0) throw new Error(`unparseable wrangler output: ${out.slice(0, 400)}`);
    return JSON.parse(out.slice(i));
  }
}

function execute(sql) {
  return wranglerJson([
    "d1",
    "execute",
    DB,
    "--remote",
    "--command",
    sql,
  ]);
}

function rowsFrom(result) {
  if (!result) return [];
  // wrangler --json shape: [{ results: [...], success: true }, ...]
  if (Array.isArray(result)) {
    const first = result[0];
    if (first?.results) return first.results;
    if (Array.isArray(first)) return first;
    return result;
  }
  if (result.results) return result.results;
  return [];
}

function hasRows(result) {
  return rowsFrom(result).length > 0;
}

function main() {
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    console.error("CLOUDFLARE_API_TOKEN is required");
    process.exit(1);
  }

  console.log("Reading remote d1_migrations…");
  let applied = new Set();
  try {
    const listed = execute("SELECT name FROM d1_migrations");
    for (const row of rowsFrom(listed)) {
      if (row?.name) applied.add(row.name);
    }
  } catch (e) {
    // Table may not exist yet on a brand-new DB — apply will create it.
    console.warn(`Could not read d1_migrations (will rely on apply): ${e.message}`);
  }
  console.log(`Already recorded: ${[...applied].sort().join(", ") || "(none)"}`);

  const toStamp = [];
  for (const probe of PROBES) {
    if (applied.has(probe.name)) continue;
    let present = false;
    try {
      present = hasRows(execute(probe.sql));
    } catch (e) {
      console.warn(`Probe failed for ${probe.name}: ${e.message}`);
      continue;
    }
    if (present) {
      toStamp.push(probe.name);
      console.log(`Schema already has objects for ${probe.name} — will stamp`);
    }
  }

  if (toStamp.length === 0) {
    console.log("No migration history drift to reconcile.");
    return;
  }

  for (const name of toStamp) {
    // Escape single quotes in name (none expected, but be safe).
    const safe = name.replace(/'/g, "''");
    execute(
      `INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${safe}')`,
    );
    console.log(`Stamped ${name}`);
  }

  console.log(`Reconciled ${toStamp.length} migration record(s).`);
}

main();
