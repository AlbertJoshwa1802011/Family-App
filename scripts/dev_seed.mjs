#!/usr/bin/env node
/**
 * Seed local D1 with two family members + session cookies (no Google OAuth).
 *
 * Usage:
 *   npm run db:migrate:local
 *   npm run dev:seed
 *   npm run dev   # separate terminal
 *
 * Then curl with the printed Cookie header against http://localhost:5173.
 * Never use this against --remote / production.
 */
import { execFileSync } from "node:child_process";

const DB = "family-vault-db";
const APP = "http://localhost:5173";

function d1(sql) {
  return execFileSync(
    "npx",
    ["wrangler", "d1", "execute", DB, "--local", "--command", sql, "--json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

const now = Math.floor(Date.now() / 1000);
const familyId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const memberId = "33333333-3333-4333-8333-333333333333";
const ownerMemberRow = "44444444-4444-4444-8444-444444444444";
const memberMemberRow = "55555555-5555-4555-8555-555555555555";
const ownerSid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const memberSid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ownerGrantId = "66666666-6666-4666-8666-666666666666";
const memberGrantId = "77777777-7777-4777-8777-777777777777";

const statements = [
  `INSERT OR IGNORE INTO users (id, google_sub, email, name, created_at) VALUES ('${ownerId}', 'dev-owner', 'owner@local.test', 'Dev Owner', ${now})`,
  `INSERT OR IGNORE INTO users (id, google_sub, email, name, created_at) VALUES ('${memberId}', 'dev-member', 'member@local.test', 'Dev Member', ${now})`,
  `INSERT OR IGNORE INTO families (id, name, owner_user_id, created_at) VALUES ('${familyId}', 'Dev Family', '${ownerId}', ${now})`,
  `INSERT OR IGNORE INTO family_members (id, family_id, user_id, member_type, role, status, created_at) VALUES ('${ownerMemberRow}', '${familyId}', '${ownerId}', 'user', 'owner', 'active', ${now})`,
  `INSERT OR IGNORE INTO family_members (id, family_id, user_id, member_type, role, status, created_at) VALUES ('${memberMemberRow}', '${familyId}', '${memberId}', 'user', 'member', 'active', ${now})`,
  `DELETE FROM sessions WHERE id IN ('${ownerSid}', '${memberSid}')`,
  `INSERT INTO sessions (id, user_id, expires_at, idle_expires_at, last_seen_at, created_at) VALUES ('${ownerSid}', '${ownerId}', ${now + 30 * 24 * 3600}, ${now + 8 * 3600}, ${now}, ${now})`,
  `INSERT INTO sessions (id, user_id, expires_at, idle_expires_at, last_seen_at, created_at) VALUES ('${memberSid}', '${memberId}', ${now + 30 * 24 * 3600}, ${now + 8 * 3600}, ${now}, ${now})`,
  `INSERT OR IGNORE INTO access_grants (id, email, status, note, created_at, updated_at) VALUES ('${ownerGrantId}', 'owner@local.test', 'approved', 'dev:seed', ${now}, ${now})`,
  `INSERT OR IGNORE INTO access_grants (id, email, status, note, created_at, updated_at) VALUES ('${memberGrantId}', 'member@local.test', 'approved', 'dev:seed', ${now}, ${now})`,
];

console.log("Seeding local D1 (family-vault-db --local)…");
for (const sql of statements) {
  try {
    d1(sql);
  } catch (err) {
    const msg = err?.stderr?.toString?.() || err?.message || String(err);
    if (sql.includes("access_grants")) {
      console.warn("  (skip access_grants)", msg.split("\n").find(Boolean));
      continue;
    }
    console.error("Failed:", sql.slice(0, 100), "…");
    console.error(msg);
    process.exit(1);
  }
}

const ownerCookie = `sid=${ownerSid}`;
const memberCookie = `sid=${memberSid}`;

console.log(`
Local seed ready (no OAuth needed).

  FAMILY_ID=${familyId}
  OWNER_COOKIE='${ownerCookie}'
  MEMBER_COOKIE='${memberCookie}'
  APP=${APP}

Examples:

  curl -s -H "Cookie: ${ownerCookie}" \\
    "${APP}/api/auth/me"

  curl -s -H "Cookie: ${ownerCookie}" \\
    "${APP}/api/settlements/summary?familyId=${familyId}"

  curl -s -X POST -H "Cookie: ${ownerCookie}" -H "Content-Type: application/json" \\
    -H "Origin: ${APP}" \\
    -d '{"familyId":"${familyId}","name":"Mom","kind":"person"}' \\
    "${APP}/api/settlements/destinations"

Start the app with:  npm run dev

Agents: prefer Vitest + seedActor (.claude/skills/verify-authenticated/SKILL.md).
Production curl without a browser sid → 401 is EXPECTED, not a feature bug.
`);
