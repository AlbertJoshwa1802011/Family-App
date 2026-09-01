import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, HardDrive, Info, LogOut, Mail } from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Avatar } from "../components/ui/Avatar";
import { ListItem } from "../components/ui/ListItem";
import { Skeleton } from "../components/ui/Skeleton";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/cn";
import { api } from "../lib/api";

interface ReminderPrefs {
  emailEnabled: boolean;
  pushEnabled: boolean;
  windows: number[];
  reminderEmail: string | null;
}

// Lead-time options offered in the UI (days before expiry/event).
const WINDOW_OPTIONS = [1, 3, 7, 14, 30, 60];

const emailInputClass =
  "w-full rounded-xl border border-line bg-ink-950 px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none";

/**
 * Local draft for the reminder-email override. Remounted via `key` when the
 * server value changes so we never sync draft→props through an effect.
 */
function ReminderEmailField({
  initial,
  disabled,
  onSave,
  saving,
}: {
  initial: string | null;
  disabled?: boolean;
  onSave: (next: string | null) => void;
  saving?: boolean;
}) {
  const [draft, setDraft] = useState(initial ?? "");
  const dirty = draft.trim() !== (initial ?? "").trim();

  const commit = () => {
    if (!dirty || saving) return;
    // Empty string clears the override so the cron falls back to the login email.
    onSave(draft.trim() === "" ? null : draft.trim());
  };

  return (
    <div className="space-y-2 px-4 py-3">
      <label htmlFor="reminder-email" className="text-sm font-medium text-fg">
        Send reminders to
      </label>
      <div className="flex gap-2">
        <input
          id="reminder-email"
          type="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          placeholder="albertjoshrock101@gmail.com"
          disabled={disabled || saving}
          className={emailInputClass}
        />
        {dirty && (
          <Button
            type="button"
            variant="secondary"
            loading={saving}
            onClick={commit}
            className="shrink-0"
          >
            Save
          </Button>
        )}
      </div>
      <p className="text-xs text-fg-muted">
        Daily cron emails reminders even if you don't open the app. Leave blank
        to use your Google account email.
      </p>
    </div>
  );
}

function ReminderPrefsCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["reminder-prefs"],
    queryFn: () => api<{ prefs: ReminderPrefs }>("/notifications/prefs"),
  });

  const save = useMutation({
    mutationFn: (patch: Partial<ReminderPrefs>) =>
      api<{ prefs: ReminderPrefs }>("/notifications/prefs", {
        method: "PUT",
        body: JSON.stringify(patch),
      }),
    // Optimistically reflect the change, then reconcile with the server.
    onSuccess: (res) => qc.setQueryData(["reminder-prefs"], res),
  });

  const [testMsg, setTestMsg] = useState<string | null>(null);
  const testEmail = useMutation({
    mutationFn: () =>
      api<{ ok: true; to: string }>("/notifications/test-email", { method: "POST" }),
    onSuccess: (res) => setTestMsg(`Sent to ${res.to}`),
    onError: (e: unknown) =>
      setTestMsg(e instanceof Error ? e.message : "Could not send test email."),
  });

  if (isLoading || !data) {
    return (
      <Card className="space-y-3 p-4">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </Card>
    );
  }

  const prefs = data.prefs;

  const toggleWindow = (w: number) => {
    const next = prefs.windows.includes(w)
      ? prefs.windows.filter((x) => x !== w)
      : [...prefs.windows, w];
    save.mutate({ windows: next.sort((a, b) => b - a) });
  };

  return (
    <Card className="divide-y divide-line overflow-hidden">
      <ListItem
        leading={<Mail className="size-5 text-fg-muted" />}
        title="Email reminders"
        subtitle="Receive expiry & event reminders by email"
        trailing={
          <button
            role="switch"
            aria-checked={prefs.emailEnabled}
            aria-label="Toggle email reminders"
            disabled={save.isPending}
            onClick={() => save.mutate({ emailEnabled: !prefs.emailEnabled })}
            className={cn(
              "relative flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 px-0.5",
              prefs.emailEnabled ? "bg-vault-600" : "bg-white/10",
            )}
          >
            <span
              className={cn(
                "size-5 rounded-full bg-white transition-transform duration-200 shadow-sm",
                prefs.emailEnabled ? "translate-x-5" : "translate-x-0",
              )}
            />
          </button>
        }
      />
      <ReminderEmailField
        key={prefs.reminderEmail ?? "none"}
        initial={prefs.reminderEmail}
        disabled={save.isPending}
        saving={save.isPending}
        onSave={(next) => save.mutate({ reminderEmail: next })}
      />
      <div className="px-4 py-3">
        <div className="text-sm font-medium text-fg">Lead time</div>
        <div className="mt-0.5 text-xs text-fg-muted">
          How far ahead to remind you. Pick one or more.
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {WINDOW_OPTIONS.map((w) => {
            const on = prefs.windows.includes(w);
            return (
              <button
                key={w}
                disabled={save.isPending}
                onClick={() => toggleWindow(w)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                  on
                    ? "border-vault-500/40 bg-vault-500/15 text-vault-300"
                    : "border-line text-fg-muted hover:bg-white/5",
                )}
              >
                {w}d
              </button>
            );
          })}
        </div>
      </div>
      <div className="space-y-2 px-4 py-3">
        <Button
          fullWidth
          variant="secondary"
          loading={testEmail.isPending}
          onClick={() => {
            setTestMsg(null);
            testEmail.mutate();
          }}
        >
          Send test email
        </Button>
        {testMsg && (
          <p className="text-xs text-fg-muted" role="status">
            {testMsg}
          </p>
        )}
      </div>
    </Card>
  );
}

export function Settings() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return (
    <>
      <AppBar title="Settings" />
      <Page width="wide" className="space-y-6">
        <Card className="flex items-center gap-3 p-4">
          <Avatar
            name={user?.name}
            email={user?.email}
            src={user?.picture}
            className="size-12"
          />
          <div className="min-w-0">
            <div className="truncate font-semibold text-white">
              {user?.name ?? "Guest"}
            </div>
            <div className="truncate text-sm text-fg-muted">
              {user?.email ?? "Not signed in"}
            </div>
          </div>
        </Card>

        <section className="space-y-2">
          <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            Reminders
          </h3>
          <ReminderPrefsCard />
        </section>

        <section className="space-y-2">
          <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            Notifications
          </h3>
          <Card className="divide-y divide-line overflow-hidden">
            <ListItem
              to="/notifications"
              leading={<Bell className="size-5 text-fg-muted" />}
              title="Notification center"
              subtitle="View reminders & updates"
            />
          </Card>
        </section>

        {user?.isPlatformAdmin && (
          <section className="space-y-2">
            <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">Admin</h3>
            <Card className="divide-y divide-line overflow-hidden">
              <ListItem
                to="/admin/storage"
                leading={<HardDrive className="size-5 text-fg-muted" />}
                title="Storage account"
                subtitle="Configure the shared Google Drive backend"
              />
            </Card>
          </section>
        )}

        <section className="space-y-2">
          <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            About
          </h3>
          <Card className="divide-y divide-line overflow-hidden">
            <ListItem
              leading={<Info className="size-5 text-fg-muted" />}
              title="Version"
              trailing={<span className="text-sm text-fg-muted">0.0.0 · Phase 3</span>}
            />
          </Card>
        </section>

        <Button
          variant="danger"
          fullWidth
          leadingIcon={<LogOut className="size-4" />}
          onClick={async () => {
            if (!window.confirm("Are you sure you want to sign out?")) return;
            await api("/auth/logout", { method: "POST" });
            await qc.invalidateQueries({ queryKey: ["me"] });
          }}
        >
          Sign out
        </Button>
      </Page>
    </>
  );
}
