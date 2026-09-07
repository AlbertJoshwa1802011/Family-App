import { SectionSubNav } from "../ui/SectionSubNav";
import { MONEY_ACCENT } from "../../lib/liquidGlass";

/**
 * Money section nav — same liquid-bubble pill as Home/Vault/Docs/Family,
 * tinted with the Money tab green from AppShell.
 *
 * Nested routes (`/money/expenses/:id`, `/money/funds/:id`, …) keep their
 * parent tab active via startsWith — Overview stays exact.
 */
const LINKS = [
  {
    to: "/money",
    label: "Overview",
    end: true,
    isActive: (pathname: string) => pathname === "/money",
  },
  {
    to: "/money/expenses",
    label: "Spending",
    isActive: (pathname: string) => pathname.startsWith("/money/expenses"),
  },
  {
    to: "/money/funds",
    label: "Funds",
    isActive: (pathname: string) => pathname.startsWith("/money/funds"),
  },
  {
    to: "/money/commitments",
    label: "Committed",
    isActive: (pathname: string) => pathname.startsWith("/money/commitments"),
  },
  {
    to: "/money/wishlist",
    label: "Wishlist",
    isActive: (pathname: string) => pathname.startsWith("/money/wishlist"),
  },
];

export function MoneySubNav() {
  return (
    <SectionSubNav
      ariaLabel="Money views"
      accentColor={MONEY_ACCENT}
      items={LINKS.map(({ to, label, end, isActive }) => ({
        to,
        label,
        end,
        isActive: (pathname) => isActive(pathname),
      }))}
    />
  );
}
