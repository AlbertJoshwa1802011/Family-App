import { NavLink, useLocation } from "react-router-dom";
import { cn } from "../../lib/cn";

/**
 * Money section nav — same liquid-glass iOS pill as SectionSubNav.
 */
const LINKS = [
  { to: "/money", label: "Overview", end: true },
  { to: "/money/expenses", label: "Spending" },
  { to: "/money/funds", label: "Funds" },
  { to: "/money/commitments", label: "Committed" },
  { to: "/money/wishlist", label: "Wishlist" },
];

export function MoneySubNav() {
  const { pathname } = useLocation();
  const activeIndex = LINKS.findIndex(({ to, end }) =>
    end ? pathname === to : pathname.startsWith(to),
  );

  return (
    <nav
      aria-label="Money views"
      className="-mx-4 mb-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div
        className={cn(
          "relative mx-auto flex min-w-max overflow-hidden",
          "rounded-full border border-white/15 bg-white/10 shadow-lg backdrop-blur-2xl",
        )}
      >
        {activeIndex >= 0 && (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute top-1 bottom-1 rounded-full",
              "bg-white/18 shadow-inner",
              "transition-[left,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              "motion-reduce:transition-none",
            )}
            style={{
              left: `calc(${activeIndex} * (100% / ${LINKS.length}) + 4px)`,
              width: `calc(100% / ${LINKS.length} - 8px)`,
            }}
          />
        )}
        <ul className="relative z-10 flex min-w-max">
          {LINKS.map(({ to, label, end }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "block min-h-11 whitespace-nowrap rounded-full px-3.5 py-2.5 text-center text-xs font-medium transition-colors",
                    isActive
                      ? "font-semibold text-white"
                      : "text-fg-subtle/90 hover:text-fg-muted",
                  )
                }
              >
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}