import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { UpdateToast } from "./components/UpdateToast";
import { useAuth } from "./context/AuthContext";
import { VaultProvider } from "./context/VaultContext";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Documents } from "./pages/Documents";
import { DocumentDetail } from "./pages/DocumentDetail";
import { DocumentForm } from "./pages/DocumentForm";
import { FamilyPage } from "./pages/Family";
import { CalendarPage } from "./pages/Calendar";
import { EventDetailPage } from "./pages/EventDetail";
import { EventForm } from "./pages/EventForm";
import { Tasks } from "./pages/Tasks";
import { TaskForm } from "./pages/TaskForm";
import { Contacts } from "./pages/Contacts";
import { ContactForm } from "./pages/ContactForm";
import { Settings } from "./pages/Settings";
import { Notifications } from "./pages/Notifications";
import { AdminStorage } from "./pages/admin/Storage";
import { Vault } from "./pages/Vault";
import { VaultItemForm } from "./pages/VaultItemForm";
import { VaultItemDetail } from "./pages/VaultItemDetail";
import { NotFound } from "./pages/NotFound";

function Protected({ children }: { children: ReactNode }) {
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
          element={
            <Protected>
              <VaultProvider>
                <Layout />
              </VaultProvider>
            </Protected>
          }
        >
          <Route path="/" element={<Dashboard />} />

          {/* Vault */}
          <Route path="/vault" element={<Vault />} />
          <Route path="/vault/new" element={<VaultItemForm />} />
          <Route path="/vault/:id" element={<VaultItemDetail />} />
          <Route path="/vault/:id/edit" element={<VaultItemForm />} />

          {/* Documents */}
          <Route path="/documents" element={<Documents />} />
          <Route path="/documents/new" element={<DocumentForm />} />
          <Route path="/documents/:id" element={<DocumentDetail />} />
          <Route path="/documents/:id/edit" element={<DocumentForm />} />

          {/* Calendar */}
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/calendar/events/new" element={<EventForm />} />
          <Route path="/calendar/events/:id" element={<EventDetailPage />} />
          <Route path="/calendar/events/:id/edit" element={<EventForm />} />

          <Route path="/tasks" element={<Tasks />} />
          <Route path="/tasks/new" element={<TaskForm />} />
          <Route path="/tasks/:id/edit" element={<TaskForm />} />

          <Route path="/contacts" element={<Contacts />} />
          <Route path="/contacts/new" element={<ContactForm />} />
          <Route path="/contacts/:id/edit" element={<ContactForm />} />
          
          <Route path="/family" element={<FamilyPage />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/admin/storage" element={<AdminStorage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      <UpdateToast />
    </>
  );
}
