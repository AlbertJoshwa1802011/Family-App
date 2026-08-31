import { Outlet } from "react-router-dom";
import { AppShell } from "./shell/AppShell";
import { Assistant } from "./money/Assistant";

/**
 * Root layout wrapper consumed by the protected route in App.tsx.
 * Delegates entirely to AppShell, which handles responsive nav
 * (mobile bottom tabs / tablet rail / desktop sidebar) and the
 * main content area offset.
 */
export function Layout() {
  return (
    <AppShell>
      <Outlet />
      <Assistant />
    </AppShell>
  );
}
