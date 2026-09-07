import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MONEY_ACCENT, moneyTabForPath } from "../src/lib/liquidGlass";
import { inputCls } from "../src/lib/fieldCls";
import { NAV_ITEMS } from "../src/components/shell/navItems";

const root = resolve(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("liquid bubble design tokens", () => {
  const css = read("src/index.css");

  it("defines themeable liquid surface tokens for dark and light", () => {
    for (const token of [
      "--liquid-fill",
      "--liquid-fill-strong",
      "--liquid-border",
      "--liquid-field",
      "--liquid-field-border",
      "--liquid-bubble",
    ]) {
      expect(css).toContain(token);
    }
    // Light theme must re-point fill + field + border (not only fill).
    const lightBlock = css.match(/\[data-theme="light"\]\s*\{[^}]+\}/g)?.join("\n") ?? "";
    expect(lightBlock).toMatch(/--liquid-fill:\s*rgba\(255,\s*255,\s*255/);
    expect(lightBlock).toMatch(/--liquid-field:/);
    expect(lightBlock).toMatch(/--liquid-border:/);
  });

  it("ships the three liquid surface recipes inside @layer components", () => {
    // Unlayered glass would beat every Tailwind utility — same footgun as `.lq`.
    const layerIdx = css.indexOf("@layer components");
    const bubbleIdx = css.indexOf(".liquid-bubble");
    const pillIdx = css.indexOf(".liquid-pill-track");
    const fieldIdx = css.indexOf(".liquid-field");
    expect(layerIdx).toBeGreaterThan(-1);
    expect(bubbleIdx).toBeGreaterThan(layerIdx);
    expect(pillIdx).toBeGreaterThan(layerIdx);
    expect(fieldIdx).toBeGreaterThan(layerIdx);
    expect(css).toMatch(/backdrop-filter:\s*blur\(24px\)/);
  });
});

describe("Card is a liquid bubble", () => {
  it("uses liquid-bubble instead of flat bg-surface", () => {
    const card = read("src/components/ui/Card.tsx");
    expect(card).toContain("liquid-bubble");
    expect(card).not.toMatch(/["']rounded-2xl border border-line bg-surface/);
    // overflow is opt-in so focus rings / blurs aren't clipped by default
    expect(card).not.toMatch(/className=\{cn\("liquid-bubble overflow-hidden"/);
    expect(card).toMatch(/className=\{cn\("liquid-bubble"/);
  });
});

describe("moneyTabForPath", () => {
  it("maps nested Money routes to the owning tab", () => {
    expect(moneyTabForPath("/money")).toBe("overview");
    expect(moneyTabForPath("/money/expenses")).toBe("spending");
    expect(moneyTabForPath("/money/expenses/new")).toBe("spending");
    expect(moneyTabForPath("/money/expenses/abc")).toBe("spending");
    expect(moneyTabForPath("/money/funds")).toBe("funds");
    expect(moneyTabForPath("/money/funds/xyz")).toBe("funds");
    expect(moneyTabForPath("/money/commitments")).toBe("committed");
    expect(moneyTabForPath("/money/commitments/new")).toBe("committed");
    expect(moneyTabForPath("/money/wishlist")).toBe("wishlist");
    expect(moneyTabForPath("/money/settings")).toBeNull();
    expect(moneyTabForPath("/documents")).toBeNull();
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
    expect(src).toContain("moneyTabForPath");
    expect(src).toContain("Money views");
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
      if (page.endsWith("MoneySettings.tsx")) continue;
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
      expect(src).toMatch(/fieldCls/);
      expect(src).not.toMatch(
        /const inputClass\s*=\s*["'][^"']*bg-ink-950/,
      );
    }
  });

  it("Spending search icon sits above the liquid field", () => {
    const spending = read("src/pages/Expenses.tsx");
    expect(spending).toMatch(/Search className="[^"]*\bz-10\b/);
    expect(spending).toContain("liquid-field");
    expect(spending).not.toMatch(/bg-ink-950/);
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
    expect(spending).toContain("<MoneySubNav");
  });

  it("EmptyState and Modal use liquid-bubble", () => {
    expect(read("src/components/ui/EmptyState.tsx")).toContain("liquid-bubble");
    expect(read("src/components/ui/Modal.tsx")).toContain("liquid-bubble");
    expect(read("src/components/ui/Modal.tsx")).not.toContain("bg-surface");
  });
});
