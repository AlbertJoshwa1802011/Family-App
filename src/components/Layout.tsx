import { Outlet } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { AssistantSheet } from "./AssistantSheet";

export function Layout() {
  return (
    <>
      <main className="min-h-full">
        <Outlet />
      </main>
      <BottomNav />
      <AssistantSheet />
    </>
  );
}
