import { NavLink, Outlet } from "react-router-dom";

const navItems = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/documents", label: "Documents" },
  { to: "/family", label: "Family" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🗄️</span>
          <span className="text-lg font-semibold tracking-tight text-white">
            Family Vault
          </span>
        </div>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-white/10 px-2 py-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                isActive
                  ? "bg-vault-700 text-white"
                  : "text-slate-300 hover:bg-white/5"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1 p-4">
        <Outlet />
      </main>
    </div>
  );
}
