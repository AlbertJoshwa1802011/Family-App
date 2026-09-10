/**
 * Record a video walkthrough of the running app on a phone viewport — the
 * companion to dev-screenshots.mjs when you need to review *motion* (the
 * sliding nav pill, sheet transitions, liquid press) rather than static frames.
 *
 * Usage:
 *   npm run dev                          # terminal 1
 *   node scripts/dev-seed.mjs            # seed sessions once
 *   npm run dev:record [baseUrl] [outDir]
 *
 * Defaults: baseUrl http://localhost:5173, outDir ./recordings (gitignored).
 * Uses the seeded "sess-ravi" session; pass SID=sess-priya to switch user.
 * Requires playwright-core (npm i --no-save playwright-core) and a Chromium
 * binary (CI/dev containers: /opt/pw-browsers/chromium; else set CHROMIUM).
 */
import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:5173";
const outDir = process.argv[3] ?? "recordings";
const sid = process.env.SID ?? "sess-ravi";
const executablePath = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium";

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  recordVideo: { dir: outDir, size: { width: 390, height: 844 } },
});
await ctx.addCookies([{ name: "sid", value: sid, url: base }]);
const page = await ctx.newPage();

/** Navigate, let the entrance animations settle, then pause on the screen. */
async function visit(path, hold = 1400) {
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(hold);
  console.log(`▸ ${path}`);
}

/** Tap a bottom-nav tab so the sliding pill animation is captured. */
async function tab(name) {
  await page.getByRole("link", { name: new RegExp(name) }).first().click();
  await page.waitForTimeout(1100);
  console.log(`▸ tab: ${name}`);
}

await visit("/");
await page.mouse.wheel(0, 420);
await page.waitForTimeout(900);
await page.mouse.wheel(0, -420);
await page.waitForTimeout(500);

// Nav pill sliding between tabs — the signature motion of the design.
await tab("Docs");
await tab("Chat");
await tab("Activity");
await tab("Family");
await tab("Home");

// Sheets and forms.
await visit("/documents");
await page.getByRole("button", { name: "Ask the assistant" }).click();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Close" }).click();
await page.waitForTimeout(700);

await visit("/documents/new");
await page.getByRole("button", { name: "Insurance" }).click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: "Only me" }).click();
await page.waitForTimeout(800);

await visit("/tasks");
await page.getByRole("button", { name: "Priority" }).click();
await page.waitForTimeout(800);
await page.getByRole("button", { name: "Due soon" }).click();
await page.waitForTimeout(800);

await visit("/settings");
await visit("/expenses");
await visit("/calendar");

const video = page.video();
await ctx.close();

if (video) {
  const src = await video.path();
  const dest = join(outDir, "walkthrough.webm");
  renameSync(src, dest);
  console.log(`\nRecording: ${dest}`);
} else {
  console.log(`\nRecording in ${outDir}: ${readdirSync(outDir).join(", ")}`);
}
await browser.close();
