import { Outlet } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { AssistantSheet } from "./AssistantSheet";
import { useOptionalAuth } from "../context/AuthContext";
import { hasModuleAccess } from "../lib/modules";

export function Layout() {
  const auth = useOptionalAuth();
  const activeFamily = auth?.activeFamily ?? null;
  const showAssistant = hasModuleAccess(
    activeFamily?.modules,
    "assistant",
    activeFamily?.role,
  );

  return (
    <>
      <main className="min-h-full">
        <Outlet />
      </main>
      <BottomNav />
      {showAssistant && <AssistantSheet />}
    </>
  );
}
