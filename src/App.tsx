import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { UpdateToast } from "./components/UpdateToast";
import { useAuth } from "./context/AuthContext";
import { Login } from "./pages/Login";
import { AcceptInvite } from "./pages/AcceptInvite";
import { CreateFamily } from "./pages/CreateFamily";
import { Dashboard } from "./pages/Dashboard";
import { Documents } from "./pages/Documents";
import { DocumentDetail } from "./pages/DocumentDetail";
import { DocumentForm } from "./pages/DocumentForm";
import { FamilyPage } from "./pages/Family";
import { MemberProfile } from "./pages/MemberProfile";
import { CalendarPage } from "./pages/Calendar";
import { EventDetailPage } from "./pages/EventDetail";
import { EventForm } from "./pages/EventForm";
import { Tasks } from "./pages/Tasks";
import { Expenses } from "./pages/Expenses";
import { ExpenseForm } from "./pages/ExpenseForm";
import { ExpenseDetail } from "./pages/ExpenseDetail";
import { Contacts } from "./pages/Contacts";
import { Chat } from "./pages/Chat";
import { Settings } from "./pages/Settings";
import { Notifications } from "./pages/Notifications";
import { NotFound } from "./pages/NotFound";

function Protected({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, families } = useAuth();
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  // Every screen is family-scoped; a user with no family must create one first.
  if (families.length === 0) return <CreateFamily />;
  return <>{children}</>;
}

/** Auth required but NO family gate — invitees usually have no family yet. */
function AuthOnly({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/invite/:token"
          element={
            <AuthOnly>
              <AcceptInvite />
            </AuthOnly>
          }
        />
        <Route
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/documents/new" element={<DocumentForm />} />
          <Route path="/documents/:id" element={<DocumentDetail />} />
          <Route path="/documents/:id/edit" element={<DocumentForm />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/calendar/events/new" element={<EventForm />} />
          <Route path="/calendar/events/:id" element={<EventDetailPage />} />
          <Route path="/calendar/events/:id/edit" element={<EventForm />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/expenses/new" element={<ExpenseForm />} />
          <Route path="/expenses/:id" element={<ExpenseDetail />} />
          <Route path="/expenses/:id/edit" element={<ExpenseForm />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/family" element={<FamilyPage />} />
          <Route path="/family/members/:id" element={<MemberProfile />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      <UpdateToast />
    </>
  );
}
