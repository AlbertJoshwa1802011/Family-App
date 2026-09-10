import { NavLink, useLocation } from "react-router-dom";
import { cn } from "../../lib/cn";

export interface SectionSubNavItem {
  /** Path or path+search, e.g. `/documents` or `/documents?tab=expiring`. */
  to: string;
  label: string;
  /**
   * Compact label for narrow phones (≤390px). Shown below `sm`; full `label`
   * from `sm` up. Keeps five Money tabs readable without ellipsis.
   */
  shortLabel?: string;
  /** When true, only exact path (no search) matches — for "All" tabs. */
  end?: boolean;
  /** Override active detection (useful for `?tab=` filters). */
  isActive?: (pathname: string, search: string) => boolean;
}

function itemIsActive(
  item: SectionSubNavItem,
  pathname: string,
  search: string,
  navActive: boolean,
): boolean {
  if (item.isActive) return item.isActive(pathname, search);
  if (item.end) {
    return pathname === item.to.split("?")[0] && (search === "" || search === "?");
  }
  return navActive;
}

/**
 * iOS-style liquid-glass pill sub-nav. Matches the floating bottom tab bar:
 * frosted capsule, morphing active bubble, 44px+ targets.
 *
 * Tabs are equal-width across the full track so the sliding bubble lines up on
 * phones. (A prior content-sized row layout made labels different widths, so the
 * percentage-based bubble drifted off the active tab — especially Money's five
 * labels.)
 *
 * Pass `accentColor` (e.g. Money green) to tint the sliding bubble the same way
 * AppShell tints the primary tab.
 */
export function SectionSubNav({
  ariaLabel,
  items,
  accentColor,
}: {
  ariaLabel: string;
  items: SectionSubNavItem[];
  accentColor?: string;
}) {
  const { pathname, search } = useLocation();
  const activeIndex = items.findIndex((item) =>
    item.isActive
      ? item.isActive(pathname, search)
      : pathname === item.to.split("?")[0] &&
        (item.end ? search === "" || search === "?" : true),
  );

  const count = Math.max(items.length, 1);

  return (
    <nav aria-label={ariaLabel} className="-mx-4 mb-2 px-4">
      <div
        className="liquid-pill-track relative mx-auto w-full rounded-full p-0.5"
        style={accentColor ? { borderColor: `${accentColor}66` } : undefined}
      >
        {activeIndex >= 0 && (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute top-1.5 bottom-1.5 rounded-full",
              !accentColor && "bg-white/18 shadow-inner",
              "transition-[left,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              "motion-reduce:transition-none",
            )}
            style={{
              left: `calc(${activeIndex} * (100% / ${count}) + 6px)`,
              width: `calc(100% / ${count} - 12px)`,
              ...(accentColor
                ? {
                    background: `linear-gradient(180deg, ${accentColor}55, ${accentColor}28)`,
                    boxShadow: `0 0 22px ${accentColor}55, inset 0 1px 0 rgba(255,255,255,0.35)`,
                  }
                : undefined),
            }}
          />
        )}
        <ul
          className="relative z-10 grid w-full"
          style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
        >
          {items.map((item) => (
            <li key={item.to + item.label} className="min-w-0">
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive: navActive }) => {
                  const selected = itemIsActive(item, pathname, search, navActive);
                  return cn(
                    "block min-h-11 truncate rounded-full px-1 py-2.5 text-center text-[11px] font-medium transition-colors sm:px-3 sm:text-xs",
                    selected
                      ? accentColor
                        ? "font-semibold"
                        : "font-semibold text-white"
                      : "text-fg-subtle/90 hover:text-fg-muted",
                  );
                }}
                style={({ isActive: navActive }) => {
                  const selected = itemIsActive(item, pathname, search, navActive);
                  return selected && accentColor ? { color: accentColor } : undefined;
                }}
              >
                {item.shortLabel ? (
                  <>
                    <span className="sm:hidden">{item.shortLabel}</span>
                    <span className="hidden sm:inline">{item.label}</span>
                  </>
                ) : (
                  item.label
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
