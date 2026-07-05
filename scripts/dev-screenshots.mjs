/**
 * Capture mobile-viewport screenshots of every key screen from the running
 * dev server — the fastest way to review UI changes like a phone user.
 *
 * Usage:
 *   npm run dev                        # terminal 1
 *   node scripts/dev-seed.mjs          # seed sessions once
 *   node scripts/dev-screenshots.mjs [baseUrl] [outDir]
 *
 * Defaults: baseUrl http://localhost:5173, outDir ./screenshots (gitignored).
 * Uses the seeded "sess-ravi" session; pass SID=sess-priya to switch user.
 * Requires playwright-core (npm i --no-save playwright-core) and a Chromium
 * binary (CI/dev containers: /opt/pw-browsers/chromium; else set CHROMIUM).
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:5173";
const outDir = process.argv[3] ?? "screenshots";
const sid = process.env.SID ?? "sess-ravi";
const executablePath = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium";

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, // iPhone-ish
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await ctx.addCookies([{ name: "sid", value: sid, url: base }]);
const page = await ctx.newPage();

const screens = [
  ["/", "dashboard"],
  ["/documents", "documents"],
  ["/documents/new", "document-form"],
  ["/chat", "chat"],
  ["/notifications", "activity"],
  ["/calendar", "calendar"],
  ["/tasks", "tasks"],
  ["/family", "family"],
  ["/settings", "settings"],
];

for (const [path, name] of screens) {
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`✓ ${name}.png`);
}

// Login page, signed out.
const anon = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
});
const p2 = await anon.newPage();
await p2.goto(`${base}/login`, { waitUntil: "networkidle" });
await p2.waitForTimeout(500);
await p2.screenshot({ path: `${outDir}/login.png` });
console.log("✓ login.png");

await browser.close();
console.log(`\nAll screenshots in ${outDir}/`);
