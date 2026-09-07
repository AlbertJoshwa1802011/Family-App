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
    expect(layerIdx).toBeGreaterThan(-1);
    const layered = css.slice(layerIdx);
    expect(layered).toMatch(/\.liquid-bubble\s*,/);
    expect(layered).toMatch(/\.liquid-pill-track\s*\{/);
    expect(layered).toMatch(/\.liquid-field\s*\{/);
    // Full recipe: fill + specular rim + inner sheen + ambient orbs
    expect(layered).toMatch(/backdrop-filter:\s*blur\(var\(--lq-blur\)\)/);
    expect(layered).toMatch(/\.liquid-bubble::before/);
    expect(layered).toMatch(/\.liquid-bubble::after/);
    expect(css).toContain("orb-drift");
    expect(layered).toContain("liquid-chrome");
    expect(layered).toContain("liquid-raised");
  });

  it("AppBar is a floating liquid capsule on phone and laptop", () => {
    const bar = read("src/components/ui/AppBar.tsx");
    expect(bar).toContain("liquid-bubble");
    expect(bar).toContain("liquid-chrome");
    expect(bar).toContain("rounded-full");
    expect(bar).not.toMatch(/border-b border-white\/10 bg-ink-950/);
    // Scrim must not extend below the bar — that washed out Money/Vault heroes.
    expect(bar).toContain("bottom-0");
    expect(bar).not.toContain("-bottom-6");
  });

  it("laptop sidebar uses the same liquid-chrome recipe", () => {
    const shell = read("src/components/shell/AppShell.tsx");
    expect(shell).toContain("liquid-bubble liquid-chrome");
    expect(shell).toContain("NavSidebar");
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
    // Phone-width short labels so five tabs don't ellipsize to "Commi…" / "Wish…"
    for (const short of ["Plan", "Spend", "Due", "Wish"]) {
      expect(src).toContain(`shortLabel: "${short}"`);
    }
    expect(src).toContain("SectionSubNav");
    expect(src).toContain("MONEY_ACCENT");
    expect(src).toContain("moneyTabForPath");
    expect(src).toContain("Money views");
  });

  it("SectionSubNav uses equal-width grid so the bubble stays aligned on phones", () => {
    const src = read("src/components/ui/SectionSubNav.tsx");
    expect(src).toContain("liquid-pill-track");
    expect(src).toContain("gridTemplateColumns");
    expect(src).toContain("shortLabel");
    expect(src).toContain("sm:hidden");
    // overflow-hidden clipped the Money green glow — pad instead
    expect(src).not.toMatch(/liquid-pill-track[^"]*overflow-hidden/);
    expect(src).not.toMatch(/className="[^"]*min-w-max/);
    expect(read("src/components/ui/LiquidPillTabs.tsx")).toContain("liquid-pill-track");
    expect(read("src/components/ui/LiquidPillTabs.tsx")).toContain("MONEY_ACCENT");
  });

  it("primary Button is a liquid raised pill, not a flat solid fill", () => {
    const btn = read("src/components/ui/Button.tsx");
    expect(btn).toContain("liquid-bubble liquid-primary");
    expect(btn).not.toMatch(/primary:\s*"bg-vault-600/);
  });

  it("Vault + DeviceLock use liquid-field inputs (not flat ink boxes)", () => {
    const vault = read("src/pages/Vault.tsx");
    expect(vault).toContain("inputCls");
    expect(vault).toContain("liquid-bubble liquid-raised");
    expect(vault).not.toMatch(/bg-ink-950 px-3\.5 py-3 pr-10/);
    expect(vault).not.toMatch(/bg-surface border border-line pl-9/);

    const lock = read("src/components/DeviceLockGate.tsx");
    expect(lock).toContain("inputCls");
    expect(lock).not.toMatch(/border border-line bg-ink-950/);
  });

  it("Spending rows do not clamp amounts into a fixed w-24 column", () => {
    const spending = read("src/pages/Expenses.tsx");
    expect(spending).not.toMatch(/className="flex w-24 shrink-0/);
    expect(spending).toMatch(/tabular-nums/);
  });

  it("AccountMenu profile sheet is liquid-chrome (not flat bg-surface)", () => {
    const menu = read("src/components/AccountMenu.tsx");
    expect(menu).toContain("liquid-bubble liquid-chrome");
    expect(menu).toContain("liquid-press");
    expect(menu).not.toMatch(/border border-line bg-surface shadow-pop/);
  });

  it("Sign out uses AuthContext.signOut (hard redirect), not a client navigate", () => {
    const menu = read("src/components/AccountMenu.tsx");
    const settings = read("src/pages/Settings.tsx");
    expect(menu).toMatch(/signOut/);
    expect(menu).not.toMatch(/navigate\("\/login"/);
    expect(settings).toMatch(/void signOut\(\)/);
    expect(settings).not.toMatch(/window\.confirm/);
    const profile = settings.indexOf("Not signed in");
    const signOut = settings.indexOf("Sign out");
    const reminders = settings.indexOf("Reminders");
    expect(signOut).toBeGreaterThan(profile);
    expect(reminders).toBeGreaterThan(signOut);
  });

  it("assistant sheet is an edge-to-edge phone sheet, not a fully-rounded liquid bubble", () => {
    const src = read("src/components/money/Assistant.tsx");
    expect(src).toContain("rounded-t-3xl");
    expect(src).toContain("visualViewport");
    // Using .liquid-bubble on the sheet forced 28px radius on the bottom edge.
    expect(src).not.toMatch(/liquid-bubble fixed inset-x-0 bottom-0/);
  });

  it("assistant trigger lives in the AppBar, not a floating FAB over Add event", () => {
    const sheet = read("src/components/money/Assistant.tsx");
    const button = read("src/components/money/AssistantButton.tsx");
    const appBar = read("src/components/ui/AppBar.tsx");
    const fab = read("src/components/ui/Fab.tsx");

    // No fixed thumb-zone bubble that steals hits from Calendar / Tasks FABs.
    expect(sheet).not.toMatch(/fixed right-4/);
    expect(sheet).not.toMatch(/bottom-\[calc\(5\.5rem/);
    expect(button).not.toMatch(/\bfixed\b/);

    expect(appBar).toContain("AssistantButton");
    expect(button).toContain("family-vault:open-assistant");
    expect(fab).toMatch(/z-40/);
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
