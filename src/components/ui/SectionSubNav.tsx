import { NavLink, useLocation } from "react-router-dom";
import { cn } from "../../lib/cn";

export interface SectionSubNavItem {
  /** Path or path+search, e.g. `/documents` or `/documents?tab=expiring`. */
  to: string;
  label: string;
  /** When true, only exact path (no search) matches — for "All" tabs. */
  end?: boolean;
  /** Override active detection (useful for `?tab=` filters). */
  isActive?: (pathname: string, search: string) => boolean;
}

/**
 * Reusable Money-style horizontal sub-nav for section filters
 * (Docs, Vault, Family, etc.).
 */
export function SectionSubNav({
  ariaLabel,
  items,
}: {
  ariaLabel: string;
  items: SectionSubNavItem[];
}) {
  const { pathname, search } = useLocation();

  return (
    <nav
      aria-label={ariaLabel}
      className="-mx-4 mb-1 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <ul className="flex min-w-max gap-1 rounded-xl border border-line bg-surface p-1">
        {items.map((item) => {
          const active = item.isActive
            ? item.isActive(pathname, search)
            : undefined;
          return (
            <li key={item.to + item.label}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive: navActive }) =>
                  cn(
                    "block rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors",
                    (active ?? navActive)
                      ? "bg-vault-500/15 text-vault-300"
                      : "text-fg-subtle hover:text-fg-muted",
                  )
                }
              >
                {item.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
