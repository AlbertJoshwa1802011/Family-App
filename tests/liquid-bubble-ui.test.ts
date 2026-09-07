import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MONEY_ACCENT } from "../src/lib/liquidGlass";
import { inputCls } from "../src/lib/fieldCls";
import { NAV_ITEMS } from "../src/components/shell/navItems";

const root = resolve(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("liquid bubble design tokens", () => {
  const css = read("src/index.css");

  it("defines themeable liquid surface tokens", () => {
    for (const token of [
      "--liquid-fill",
      "--liquid-fill-strong",
      "--liquid-border",
      "--liquid-field",
      "--liquid-bubble",
    ]) {
      expect(css).toContain(token);
    }
    // Light theme must re-point the fill so cards are not flat white/gray.
    expect(css).toMatch(
      /\[data-theme="light"\][\s\S]*--liquid-fill:\s*rgba\(255,\s*255,\s*255/,
    );
  });

  it("ships the three liquid surface recipes", () => {
    expect(css).toMatch(/\.liquid-bubble\s*\{/);
    expect(css).toMatch(/\.liquid-pill-track\s*\{/);
    expect(css).toMatch(/\.liquid-field\s*\{/);
    expect(css).toMatch(/backdrop-filter:\s*blur\(24px\)/);
  });
});

describe("Card is a liquid bubble", () => {
  it("uses liquid-bubble instead of flat bg-surface", () => {
    const card = read("src/components/ui/Card.tsx");
    expect(card).toContain("liquid-bubble");
    expect(card).not.toMatch(/className=\{cn\(\s*["'][^"']*bg-surface/);
    expect(card).not.toMatch(/["']rounded-2xl border border-line bg-surface/);
  });
});

describe("Money sub-nav matches Home/Vault/Docs liquid pill", () => {
  it("Money accent matches the AppShell Money tab color", () => {
    const money = NAV_ITEMS.find((i) => i.label === "Money");
    expect(money?.color).toBe(MONEY_ACCENT);
    expect(MONEY_ACCENT).toBe("#22c55e");
  });

  it("exposes Overview / Spending / Funds / Committed / Wishlist", () => {
    const src = read("src/components/money/MoneySubNav.tsx");
    for (const label of ["Overview", "Spending", "Funds", "Committed", "Wishlist"]) {
      expect(src).toContain(`label: "${label}"`);
    }
    expect(src).toContain("SectionSubNav");
    expect(src).toContain("MONEY_ACCENT");
    expect(src).toContain("Money views");
  });

  it("keeps nested expense/fund/commitment routes on the parent tab", () => {
    const src = read("src/components/money/MoneySubNav.tsx");
    expect(src).toContain('pathname.startsWith("/money/expenses")');
    expect(src).toContain('pathname.startsWith("/money/funds")');
    expect(src).toContain('pathname.startsWith("/money/commitments")');
    expect(src).toContain('pathname.startsWith("/money/wishlist")');
    expect(src).toContain('pathname === "/money"');
  });

  it("SectionSubNav and LiquidPillTabs use liquid-pill-track", () => {
    expect(read("src/components/ui/SectionSubNav.tsx")).toContain("liquid-pill-track");
    expect(read("src/components/ui/LiquidPillTabs.tsx")).toContain("liquid-pill-track");
    expect(read("src/components/ui/LiquidPillTabs.tsx")).toContain("MONEY_ACCENT");
  });
});

describe("Money pages no longer use old white/gray chrome", () => {
  const moneyPages = [
    "src/pages/money/Overview.tsx",
    "src/pages/Expenses.tsx",
    "src/pages/money/Funds.tsx",
    "src/pages/money/Commitments.tsx",
    "src/pages/money/Wishlist.tsx",
    "src/pages/money/MoneySettings.tsx",
  ];

  it("every Money tab mounts MoneySubNav", () => {
    for (const page of moneyPages) {
      if (page.endsWith("MoneySettings.tsx")) continue; // settings is off the sub-nav strip
      expect(read(page)).toContain("MoneySubNav");
    }
  });

  it("shared field chrome is liquid-field, not bg-ink-950 boxes", () => {
    expect(inputCls).toContain("liquid-field");
    expect(inputCls).not.toContain("bg-ink-950");
    expect(inputCls).not.toContain("bg-surface");

    for (const page of [
      "src/pages/money/Funds.tsx",
      "src/pages/money/Wishlist.tsx",
      "src/pages/money/FundDetail.tsx",
      "src/pages/money/CommitmentForm.tsx",
      "src/pages/money/MoneySettings.tsx",
      "src/pages/ExpenseForm.tsx",
    ]) {
      const src = read(page);
      expect(src).toContain('from "');
      expect(src).toMatch(/fieldCls/);
      expect(src).not.toMatch(
        /const inputClass\s*=\s*["'][^"']*bg-ink-950/,
      );
    }
  });

  it("Overview and Spending drop ad-hoc glassBubble / flat surface cards", () => {
    const overview = read("src/pages/money/Overview.tsx");
    expect(overview).not.toContain("glassBubble");
    expect(overview).not.toMatch(/bg-surface[^-]/);
    expect(overview).toContain("<MoneySubNav");

    const spending = read("src/pages/Expenses.tsx");
    expect(spending).not.toContain(
      "border-white/15 bg-white/8 p-5 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.45)] backdrop-blur-xl",
    );
    expect(spending).toContain("liquid-field");
    expect(spending).toContain("<MoneySubNav");
  });

  it("EmptyState and Modal use liquid-bubble", () => {
    expect(read("src/components/ui/EmptyState.tsx")).toContain("liquid-bubble");
    expect(read("src/components/ui/Modal.tsx")).toContain("liquid-bubble");
    expect(read("src/components/ui/Modal.tsx")).not.toContain("bg-surface");
  });
});
