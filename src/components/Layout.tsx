import { Outlet } from "react-router-dom";
import { BottomNav } from "./BottomNav";

export function Layout() {
  return (
    <>
      <main className="min-h-full">
        <Outlet />
      </main>
      <BottomNav />
    </>
  );
}
