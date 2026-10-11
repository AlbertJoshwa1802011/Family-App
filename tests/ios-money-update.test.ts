/**
 * Contract for the iOS Money app's "Check for updates" feature.
 *
 * The app fetches `public/ios-money/version.json` from the Worker and offers an
 * update when `latestVersion` is newer than its own CFBundleShortVersionString
 * (MARKETING_VERSION in the Xcode project). Breaking the file shape, its URL, or
 * announcing a version the project hasn't built yet would silently break updates.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("public/ios-money/version.json", "utf8")) as Record<
  string,
  unknown
>;
const pbxproj = readFileSync("ios-money/AlbertMoney.xcodeproj/project.pbxproj", "utf8");
const checker = readFileSync("ios-money/AlbertMoney/Update/UpdateChecker.swift", "utf8");
const headers = readFileSync("public/_headers", "utf8");

const SEMVER = /^\d+\.\d+\.\d+$/;

function compare(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

describe("public/ios-money/version.json", () => {
  it("has the fields UpdateInfo decodes", () => {
    expect(typeof manifest.latestVersion).toBe("string");
    expect(manifest.latestVersion).toMatch(SEMVER);
    expect(typeof manifest.updateURL).toBe("string");
    if (manifest.notes !== undefined) expect(typeof manifest.notes).toBe("string");
  });

  it("points updates at TestFlight or https (never plain http)", () => {
    const url = manifest.updateURL as string;
    expect(url.startsWith("itms-beta://") || url.startsWith("https://")).toBe(true);
  });

  it("never announces a version newer than the project builds", () => {
    const versions = [...pbxproj.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]!.trim());
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) {
      expect(v).toMatch(SEMVER);
      expect(compare(manifest.latestVersion as string, v)).toBeLessThanOrEqual(0);
    }
    expect(new Set(versions).size).toBe(1);
  });

  it("is the exact path the app requests", () => {
    expect(checker).toContain('/ios-money/version.json"');
  });

  it("is served with no-cache so new releases show up immediately", () => {
    expect(headers).toMatch(/^\/ios-money\/version\.json\s*\n\s+Cache-Control: no-cache/m);
  });
});
