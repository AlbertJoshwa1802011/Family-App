#!/usr/bin/env node
/**
 * Read-only production D1 inventory — proves whether "missing" data
 * still exists after Worker overwrites (no DELETE/DROP).
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=… node scripts/audit_prod_data.mjs --remote
 *   node scripts/audit_prod_data.mjs --local
 *
 * Prints counts + shape checks. Never mutates.
 */
import { spawnSync } from "node:child_process";

const DB = "family-vault-db";
const remote = process.argv.includes("--remote");

function wranglerJson(sql) {
  const args = ["d1", "execute", DB, "--command", sql, "--json"];
  if (remote) args.push("--remote");
  else args.push("--local");
  const res = spawnSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    env: process.env,
  });
  if (res.status !== 0) {
    return { error: (res.stderr || res.stdout || "").slice(0, 500) };
  }
  try {
    const start = (res.stdout || "").indexOf("[");
    const parsed = JSON.parse(res.stdout.slice(start));
    return { rows: parsed[0]?.results || parsed.results || [] };
  } catch (e) {
    return { error: String(e), raw: (res.stdout || "").slice(0, 300) };
  }
}

function one(sql) {
  const r = wranglerJson(sql);
  if (r.error) return { error: r.error };
  return r.rows[0] || {};
}

function cols(table) {
  const r = wranglerJson(`PRAGMA table_info(${table})`);
  if (r.error) return { error: r.error, names: [] };
  return { names: (r.rows || []).map((x) => x.name) };
}

function tableExists(name) {
  const r = one(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`,
  );
  return Boolean(r.name);
}

if (remote && !process.env.CLOUDFLARE_API_TOKEN) {
  console.error("CLOUDFLARE_API_TOKEN required for --remote");
  process.exit(1);
}

console.log(`# Family Vault D1 audit (${remote ? "remote" : "local"})\n`);

const critical = [
  ["families", "SELECT COUNT(*) AS n FROM families"],
  ["users", "SELECT COUNT(*) AS n FROM users"],
  ["family_members", "SELECT COUNT(*) AS n FROM family_members WHERE status='active'"],
  ["documents", "SELECT COUNT(*) AS n FROM documents WHERE status != 'trashed' OR status IS NOT NULL"],
  ["files", "SELECT COUNT(*) AS n FROM files WHERE status='active'"],
  ["expenses", "SELECT COUNT(*) AS n FROM expenses"],
  ["money_movements", "SELECT COUNT(*) AS n FROM money_movements"],
  ["settlement_destinations", "SELECT COUNT(*) AS n FROM settlement_destinations"],
  ["fund_accounts", "SELECT COUNT(*) AS n FROM fund_accounts"],
  ["fund_contributions", "SELECT COUNT(*) AS n FROM fund_contributions"],
  ["fund_spends", "SELECT COUNT(*) AS n FROM fund_spends"],
  ["incomes", "SELECT COUNT(*) AS n FROM incomes"],
  ["commitments", "SELECT COUNT(*) AS n FROM commitments"],
  ["wishlist_items", "SELECT COUNT(*) AS n FROM wishlist_items"],
  ["church_settlements", "SELECT COUNT(*) AS n FROM church_settlements"],
  ["vaults", "SELECT COUNT(*) AS n FROM vaults"],
  ["vault_items", "SELECT COUNT(*) AS n FROM vault_items"],
  ["device_pins", "SELECT COUNT(*) AS n FROM device_pins"],
  ["device_credentials", "SELECT COUNT(*) AS n FROM device_credentials"],
  ["events", "SELECT COUNT(*) AS n FROM events WHERE status != 'trashed'"],
  ["tasks", "SELECT COUNT(*) AS n FROM tasks WHERE status != 'archived'"],
  ["chat_messages", "SELECT COUNT(*) AS n FROM chat_messages"],
  ["notes", "SELECT COUNT(*) AS n FROM notes"],
  ["contacts", "SELECT COUNT(*) AS n FROM contacts"],
];

console.log("## Core / Money / Vault counts");
for (const [label, sql] of critical) {
  if (!tableExists(label) && !tableExists(label.replace(/s$/, ""))) {
    // try exact name from label
  }
  const exists = tableExists(label);
  if (!exists) {
    console.log(`- ${label}: TABLE MISSING`);
    continue;
  }
  const row = one(sql);
  console.log(`- ${label}: ${row.error ? `ERROR ${row.error}` : row.n}`);
}

console.log("\n## Shape / lineage checks (overwrite risks)");

const fam = cols("families");
console.log(
  `- families.default_currency: ${fam.names?.includes("default_currency") ? "present" : "MISSING"}`,
);

const exp = cols("expenses");
console.log(
  `- expenses.amount_minor: ${exp.names?.includes("amount_minor") ? "yes" : "no"}`,
);
console.log(
  `- expenses.amount_cents: ${exp.names?.includes("amount_cents") ? "yes (simple/legacy shape)" : "no"}`,
);

const legacy = one(
  `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'expenses_legacy_simple_%' ORDER BY name DESC LIMIT 1`,
);
if (legacy.name) {
  const n = one(`SELECT COUNT(*) AS n FROM "${legacy.name}"`);
  console.log(`- legacy backup ${legacy.name}: ${n.n} rows (retained; not deleted)`);
} else {
  console.log("- legacy expenses backup: none");
}

const files = cols("files");
console.log(
  `- files.r2_key column: ${files.names?.includes("r2_key") ? "present" : "absent in live schema"}`,
);
console.log(
  `- files.storage_provider: ${files.names?.includes("storage_provider") ? "present" : "absent in live schema"}`,
);
if (files.names?.includes("storage_provider")) {
  const by = wranglerJson(
    `SELECT storage_provider AS p, COUNT(*) AS n FROM files GROUP BY storage_provider`,
  );
  console.log(`- files by provider: ${JSON.stringify(by.rows || by.error)}`);
}
if (files.names?.includes("drive_file_id")) {
  const d = one(
    `SELECT COUNT(*) AS n FROM files WHERE drive_file_id IS NOT NULL AND drive_file_id != ''`,
  );
  console.log(`- files with drive_file_id: ${d.n}`);
}

console.log("\n## Main-only tables (may exist in D1 even if Worker ignores them)");
for (const t of [
  "items",
  "item_reminders_log",
  "life_event_reminders_log",
  "platform_admins",
  "storage_accounts",
  "storage_snapshots",
  "job_runs",
]) {
  if (!tableExists(t)) {
    console.log(`- ${t}: not present`);
    continue;
  }
  const n = one(`SELECT COUNT(*) AS n FROM ${t}`);
  console.log(`- ${t}: ${n.n} rows`);
}

const ann = cols("family_members");
if (ann.names?.includes("anniversary_date")) {
  const n = one(
    `SELECT COUNT(*) AS n FROM family_members WHERE anniversary_date IS NOT NULL`,
  );
  console.log(`- family_members.anniversary_date set: ${n.n}`);
} else {
  console.log("- family_members.anniversary_date: column absent");
}

console.log("\n## Migration ledger (both lineages expected)");
const mig = wranglerJson(
  `SELECT id, name FROM d1_migrations ORDER BY id`,
);
if (mig.error) console.log(mig.error);
else for (const row of mig.rows || []) console.log(`- ${row.id}: ${row.name}`);

console.log("\nDone. This script is read-only.");
