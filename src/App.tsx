import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
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
import { Expenses } from "./pages/Expenses";
import { ExpenseForm } from "./pages/ExpenseForm";
import { ExpenseDetail } from "./pages/ExpenseDetail";
import { MoneyOverview } from "./pages/money/Overview";
import { Commitments } from "./pages/money/Commitments";
import { CommitmentForm } from "./pages/money/CommitmentForm";
import { Wishlist } from "./pages/money/Wishlist";
import { MoneySettings } from "./pages/money/MoneySettings";
import { Funds } from "./pages/money/Funds";
import { FundDetail } from "./pages/money/FundDetail";
import { Vault } from "./pages/Vault";
import { VaultItemForm } from "./pages/VaultItemForm";
import { VaultItemDetail } from "./pages/VaultItemDetail";
import { DeviceLockGate } from "./components/DeviceLockGate";
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
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <Protected>
              <VaultProvider>
                <ErrorBoundary label="This screen crashed">
                  <Layout />
                </ErrorBoundary>
              </VaultProvider>
            </Protected>
          }
        >
          <Route path="/" element={<Dashboard />} />

          {/* Vault — Face ID / PIN every visit */}
          <Route element={<DeviceLockGate section="vault" title="Vault" />}>
            <Route path="/vault" element={<Vault />} />
            <Route path="/vault/new" element={<VaultItemForm />} />
            <Route path="/vault/:id" element={<VaultItemDetail />} />
            <Route path="/vault/:id/edit" element={<VaultItemForm />} />
          </Route>

          {/* Money — Face ID / PIN every visit */}
          <Route element={<DeviceLockGate section="money" title="Money" />}>
            <Route path="/money" element={<MoneyOverview />} />
            <Route path="/money/settings" element={<MoneySettings />} />
            <Route path="/money/expenses" element={<Expenses />} />
            <Route path="/money/expenses/new" element={<ExpenseForm />} />
            <Route path="/money/expenses/:id" element={<ExpenseDetail />} />
            <Route path="/money/expenses/:id/edit" element={<ExpenseForm />} />
            <Route path="/money/funds" element={<Funds />} />
            <Route path="/money/funds/:id" element={<FundDetail />} />
            <Route path="/money/commitments" element={<Commitments />} />
            <Route path="/money/commitments/new" element={<CommitmentForm />} />
            <Route path="/money/commitments/:id/edit" element={<CommitmentForm />} />
            <Route path="/money/wishlist" element={<Wishlist />} />
          </Route>

          {/* Legacy expense paths, kept so existing links and bookmarks work. */}
          <Route path="/expenses" element={<Navigate to="/money/expenses" replace />} />
          <Route path="/expenses/new" element={<Navigate to="/money/expenses/new" replace />} />

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
    </ErrorBoundary>
  );
}
