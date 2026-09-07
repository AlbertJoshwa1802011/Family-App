import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("responsive shell — laptop vs mobile", () => {
  const shell = read("src/components/shell/AppShell.tsx");
  const page = read("src/components/ui/Page.tsx");
  const fab = read("src/components/ui/Fab.tsx");
  const overview = read("src/pages/money/Overview.tsx");

  it("keeps the liquid bottom tabs phone-only (md:hidden)", () => {
    expect(shell).toMatch(/md:hidden/);
    expect(shell).toContain("MobileBottomTabs");
    // Tablet rail + laptop sidebar must not use the bottom bar
    expect(shell).toMatch(/md:flex lg:hidden/);
    expect(shell).toMatch(/lg:flex/);
  });

  it("mobile tabs are a free-floating bubble, not a pinned dock", () => {
    expect(shell).toContain("snapBubbleToEdge");
    expect(shell).toContain("stepBubbleMotion");
    expect(shell).toContain("BUBBLE_NAV_STORAGE_KEY");
    expect(shell).not.toContain("LONG_PRESS_MS");
    expect(shell).not.toMatch(/fixed inset-x-0 bottom-0/);
  });

  it("offsets main content for rail (md) and sidebar (lg)", () => {
    expect(shell).toMatch(/md:ml-\[4\.5rem\]/);
    expect(shell).toMatch(/lg:ml-\[13\.75rem\]/);
    // Phone keeps bottom-nav clearance; laptop drops it
    expect(shell).toMatch(/md:pb-0/);
  });

  it("styles side nav with liquid glass chrome, not flat opaque ink", () => {
    expect(shell).toContain("liquid-bubble");
    expect(shell).toContain("liquid-chrome");
    expect(shell).not.toMatch(/bg-ink-950\/70/);
  });

  it("widens Page presets from md upward without shrinking mobile", () => {
    expect(page).toMatch(/list:[\s\S]*max-w-2xl[\s\S]*md:max-w-3xl[\s\S]*lg:max-w-5xl/);
    expect(page).toMatch(/prose:[\s\S]*max-w-xl[\s\S]*md:max-w-2xl/);
    expect(page).toMatch(/wide:[\s\S]*max-w-5xl[\s\S]*lg:max-w-6xl/);
  });

  it("raises Fab above the dock on phones but sits lower on laptop", () => {
    expect(fab).toMatch(/bottom-24/);
    expect(fab).toMatch(/md:bottom-6/);
  });

  it("Money Overview uses a two-column laptop layout", () => {
    expect(overview).toMatch(/lg:grid-cols-12/);
    expect(overview).toMatch(/lg:col-span-5/);
    expect(overview).toMatch(/lg:col-span-7/);
    // Mobile single-column stack preserved
    expect(overview).toMatch(/space-y-4 lg:grid/);
  });

  it("Money pages clear bottom-nav padding only on phones", () => {
    for (const file of [
      "src/pages/money/Overview.tsx",
      "src/pages/Expenses.tsx",
      "src/pages/money/Funds.tsx",
      "src/pages/money/Commitments.tsx",
      "src/pages/money/Wishlist.tsx",
    ]) {
      const src = read(file);
      expect(src).toMatch(/pb-24 md:pb-10/);
    }
  });
});
