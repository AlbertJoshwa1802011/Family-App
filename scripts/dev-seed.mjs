/**
 * Seed the LOCAL dev database with realistic multi-user test data.
 *
 * Usage:
 *   npm run db:migrate:local          # once, so tables exist
 *   npm run dev                       # in another terminal (creates local D1)
 *   node scripts/dev-seed.mjs         # then run this
 *
 * Creates two users with live sessions you can use as cookies:
 *   Cookie: sid=sess-priya   (Priya Sharma — will own the family)
 *   Cookie: sid=sess-ravi    (Ravi Sharma — invite target)
 *
 * Only sessions/users are seeded directly (they normally come from Google
 * OAuth, which doesn't exist locally). Everything else — family, docs, chat —
 * should be created THROUGH THE API so you exercise real code paths; see
 * .claude/skills/live-test/SKILL.md for the full scripted journey.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const D1_DIR = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";

function findDb() {
  let files;
  try {
    files = readdirSync(D1_DIR).filter(
      (f) => f.endsWith(".sqlite") && f !== "metadata.sqlite",
    );
  } catch {
    console.error(
      `No local D1 found at ${D1_DIR}.\nRun \`npm run db:migrate:local\` and start \`npm run dev\` once first.`,
    );
    process.exit(1);
  }
  if (files.length === 0) {
    console.error("Local D1 directory exists but has no database yet — start `npm run dev` once.");
    process.exit(1);
  }
  return join(D1_DIR, files[0]);
}

const dbPath = findDb();
const db = new DatabaseSync(dbPath);
const now = Math.floor(Date.now() / 1000);

function user(id, email, name) {
  db.prepare(
    "INSERT OR IGNORE INTO users (id, google_sub, email, name) VALUES (?, ?, ?, ?)",
  ).run(id, `sub-${id}`, email, name);
}

function session(id, userId) {
  db.prepare(
    "INSERT OR REPLACE INTO sessions (id, user_id, expires_at, idle_expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, userId, now + 30 * 86400, now + 7200, now);
}

user("user-priya", "priya@example.com", "Priya Sharma");
user("user-ravi", "ravi@example.com", "Ravi Sharma");
session("sess-priya", "user-priya");
session("sess-ravi", "user-ravi");

console.log(`Seeded into ${dbPath}:
  Priya Sharma  → curl -H "Cookie: sid=sess-priya" http://localhost:5173/api/auth/me
  Ravi Sharma   → curl -H "Cookie: sid=sess-ravi"  http://localhost:5173/api/auth/me

Note: sessions idle-expire after 2h of no requests — re-run this script to refresh.`);
