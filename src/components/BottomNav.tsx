import { CalendarDays, FileText, LayoutDashboard, Settings, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NavLink } from "react-router-dom";
import { cn } from "../lib/cn";

const items: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/", label: "Home", icon: LayoutDashboard, end: true },
  { to: "/documents", label: "Docs", icon: FileText },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/family", label: "Family", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function BottomNav() {
  return (
    <nav
      aria-label="Primary"
      className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink-950/85 backdrop-blur-lg"
    >
      <ul className="mx-auto flex max-w-md items-stretch">
        {items.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors",
                  isActive ? "text-vault-300" : "text-fg-subtle hover:text-fg-muted",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className="size-5"
                    strokeWidth={isActive ? 2.4 : 1.8}
                    aria-hidden="true"
                  />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
