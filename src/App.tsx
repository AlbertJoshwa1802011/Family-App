import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { UpdateToast } from "./components/UpdateToast";
import { useAuth } from "./context/AuthContext";
import { Login } from "./pages/Login";
import { AccessReview } from "./pages/AccessReview";
import { AdminAccess } from "./pages/AdminAccess";
import { AcceptInvite } from "./pages/AcceptInvite";
import { CreateFamily } from "./pages/CreateFamily";
import { Dashboard } from "./pages/Dashboard";
import { Documents } from "./pages/Documents";
import { DocumentDetail } from "./pages/DocumentDetail";
import { DocumentForm } from "./pages/DocumentForm";
import { FamilyPage } from "./pages/Family";
import { FamilyAccessPage } from "./pages/FamilyAccess";
import { MemberProfile } from "./pages/MemberProfile";
import { CalendarPage } from "./pages/Calendar";
import { EventDetailPage } from "./pages/EventDetail";
import { EventForm } from "./pages/EventForm";
import { Tasks } from "./pages/Tasks";
import { TaskDetailPage } from "./pages/TaskDetail";
import { Contacts } from "./pages/Contacts";
import { Notes } from "./pages/Notes";
import { NoteDetailPage } from "./pages/NoteDetail";
import { Chat } from "./pages/Chat";
import { Assistant } from "./pages/Assistant";
import { Expenses } from "./pages/Expenses";
import { Locations } from "./pages/Locations";
import { Settings } from "./pages/Settings";
import { Notifications } from "./pages/Notifications";
import { NotFound } from "./pages/NotFound";
import { hasModuleAccess, moduleForPath } from "./lib/modules";

function loginRedirect(nextPath: string) {
  const next = encodeURIComponent(nextPath);
  return <Navigate to={`/login?next=${next}`} replace />;
}

function Protected({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, families } = useAuth();
  const location = useLocation();
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }
  if (!isAuthenticated) {
    return loginRedirect(location.pathname + location.search);
  }
  if (families.length === 0) return <CreateFamily />;
  return <>{children}</>;
}

/** Blocks deep links into modules the member isn't allowed to use. */
function ModuleGate({ children }: { children: ReactNode }) {
  const { activeFamily } = useAuth();
  const { pathname } = useLocation();
  const module = moduleForPath(pathname);
  if (
    module &&
    activeFamily &&
    !hasModuleAccess(activeFamily.modules, module, activeFamily.role)
  ) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function SuperAdminOnly({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }
  if (!isAuthenticated) {
    return loginRedirect(location.pathname + location.search);
  }
  if (!user?.appRoles?.includes("super_admin")) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function AuthOnly({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }
  if (!isAuthenticated) {
    return loginRedirect(location.pathname + location.search);
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/access/review" element={<AccessReview />} />
        <Route
          path="/invite/:token"
          element={
            <AuthOnly>
              <AcceptInvite />
            </AuthOnly>
          }
        />
        <Route
          path="/admin"
          element={
            <SuperAdminOnly>
              <AdminAccess />
            </SuperAdminOnly>
          }
        />
        <Route
          element={
            <Protected>
              <ModuleGate>
                <Layout />
              </ModuleGate>
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
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/notes/:id" element={<NoteDetailPage />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/assistant" element={<Assistant />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/locations" element={<Locations />} />
          <Route path="/family" element={<FamilyPage />} />
          <Route path="/family/access" element={<FamilyAccessPage />} />
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
