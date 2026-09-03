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
 * iOS-style liquid-glass pill sub-nav. Matches the floating bottom tab bar:
 * frosted capsule, morphing active bubble, 44px+ targets.
 */
export function SectionSubNav({
  ariaLabel,
  items,
}: {
  ariaLabel: string;
  items: SectionSubNavItem[];
}) {
  const { pathname, search } = useLocation();
  const activeIndex = items.findIndex((item) =>
    item.isActive
      ? item.isActive(pathname, search)
      : pathname === item.to.split("?")[0] &&
        (item.end ? search === "" || search === "?" : true),
  );

  return (
    <nav
      aria-label={ariaLabel}
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
              left: `calc(${activeIndex} * (100% / ${items.length}) + 4px)`,
              width: `calc(100% / ${items.length} - 8px)`,
            }}
          />
        )}
        <ul className="relative z-10 flex min-w-max">
          {items.map((item) => {
            const active = item.isActive
              ? item.isActive(pathname, search)
              : undefined;
            return (
              <li key={item.to + item.label} className="flex-1">
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive: navActive }) =>
                    cn(
                      "block min-h-11 whitespace-nowrap rounded-full px-4 py-2.5 text-center text-xs font-medium transition-colors",
                      (active ?? navActive)
                        ? "font-semibold text-white"
                        : "text-fg-subtle/90 hover:text-fg-muted",
                    )
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}