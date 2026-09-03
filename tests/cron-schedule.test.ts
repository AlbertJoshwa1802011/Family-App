/**
 * Pins the production reminder cron so it cannot silently drift from
 * "every morning at 9" (Asia/Kolkata). Cloudflare cron expressions are UTC.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const wrangler = readFileSync(join(__dirname, "..", "wrangler.jsonc"), "utf8");

describe("reminder cron", () => {
  it("fires daily at 09:00 Asia/Kolkata (03:30 UTC)", () => {
    expect(wrangler).toMatch(/"crons":\s*\[\s*"30 3 \* \* \*"\s*\]/);
  });
});
