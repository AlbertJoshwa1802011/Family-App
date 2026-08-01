import { Outlet } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { AIAssistant } from "./ai/AIAssistant";

export function Layout() {
  return (
    <>
      <main className="min-h-full">
        <Outlet />
      </main>
      <BottomNav />
      <AIAssistant />
    </>
  );
}
