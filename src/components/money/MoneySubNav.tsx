import { SectionSubNav } from "../ui/SectionSubNav";
import { MONEY_ACCENT, moneyTabForPath } from "../../lib/liquidGlass";

/**
 * Money section nav — same liquid-bubble pill as Home/Vault/Docs/Family,
 * tinted with the Money tab green from AppShell.
 *
 * Nested routes (`/money/expenses/:id`, `/money/funds/:id`, …) keep their
 * parent tab active via moneyTabForPath — Overview stays exact.
 *
 * `shortLabel` keeps five tabs readable on ~390px phones (full words ellipsize
 * to fragments like "Commi…" / "Wish…").
 */
const LINKS = [
  {
    to: "/money",
    label: "Overview",
    shortLabel: "Plan",
    end: true,
    tab: "overview" as const,
  },
  {
    to: "/money/expenses",
    label: "Spending",
    shortLabel: "Spend",
    tab: "spending" as const,
  },
  {
    to: "/money/funds",
    label: "Funds",
    shortLabel: "Funds",
    tab: "funds" as const,
  },
  {
    to: "/money/commitments",
    label: "Committed",
    shortLabel: "Due",
    tab: "committed" as const,
  },
  {
    to: "/money/wishlist",
    label: "Wishlist",
    shortLabel: "Wish",
    tab: "wishlist" as const,
  },
];

export function MoneySubNav() {
  return (
    <SectionSubNav
      ariaLabel="Money views"
      accentColor={MONEY_ACCENT}
      items={LINKS.map(({ to, label, shortLabel, end, tab }) => ({
        to,
        label,
        shortLabel,
        end,
        isActive: (pathname) => moneyTabForPath(pathname) === tab,
      }))}
    />
  );
}
