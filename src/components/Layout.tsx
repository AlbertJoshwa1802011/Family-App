import { Outlet, useLocation } from "react-router-dom";
import { BottomNav } from "./BottomNav";

export function Layout() {
  const { pathname } = useLocation();
  // Full-screen experiences (the chat thread) hide the bottom nav so the
  // composer can dock to the bottom like a native messaging app.
  const hideNav = pathname.startsWith("/chat");

  return (
    <>
      <main className="min-h-full">
        <Outlet />
      </main>
      {!hideNav && <BottomNav />}
    </>
  );
}
