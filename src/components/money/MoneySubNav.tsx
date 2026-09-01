import { NavLink } from "react-router-dom";
import { cn } from "../../lib/cn";

/**
 * Section nav for the Money area.
 *
 * Money is one destination with several views rather than many tabs, which
 * keeps the bottom bar at five and keeps the plan, the ledger, funds,
 * commitments and the wishlist feeling like one thing.
 */
const LINKS = [
  { to: "/money", label: "Overview", end: true },
  { to: "/money/expenses", label: "Spending" },
  { to: "/money/funds", label: "Funds" },
  { to: "/money/commitments", label: "Committed" },
  { to: "/money/wishlist", label: "Wishlist" },
];

export function MoneySubNav() {
  return (
    <nav
      aria-label="Money views"
      className="-mx-4 mb-1 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <ul className="flex min-w-max gap-1 rounded-xl border border-line bg-surface p-1">
        {LINKS.map(({ to, label, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "block rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors",
                  isActive
                    ? "bg-vault-500/15 text-vault-300"
                    : "text-fg-subtle hover:text-fg-muted",
                )
              }
            >
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
