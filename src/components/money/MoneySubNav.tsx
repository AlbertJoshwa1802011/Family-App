import { SectionSubNav } from "../ui/SectionSubNav";
import { MONEY_ACCENT, moneyTabForPath } from "../../lib/liquidGlass";

/**
 * Money section nav — same liquid-bubble pill as Home/Vault/Docs/Family,
 * tinted with the Money tab green from AppShell.
 *
 * Nested routes (`/money/expenses/:id`, `/money/funds/:id`, …) keep their
 * parent tab active via moneyTabForPath — Overview stays exact.
 */
const LINKS = [
  {
    to: "/money",
    label: "Overview",
    end: true,
    tab: "overview" as const,
  },
  {
    to: "/money/expenses",
    label: "Spending",
    tab: "spending" as const,
  },
  {
    to: "/money/funds",
    label: "Funds",
    tab: "funds" as const,
  },
  {
    to: "/money/commitments",
    label: "Committed",
    tab: "committed" as const,
  },
  {
    to: "/money/wishlist",
    label: "Wishlist",
    tab: "wishlist" as const,
  },
];

export function MoneySubNav() {
  return (
    <SectionSubNav
      ariaLabel="Money views"
      accentColor={MONEY_ACCENT}
      items={LINKS.map(({ to, label, end, tab }) => ({
        to,
        label,
        end,
        isActive: (pathname) => moneyTabForPath(pathname) === tab,
      }))}
    />
  );
}
