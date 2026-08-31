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
const OWNER_EMAIL_HINT = "albertjoshrock101@gmail.com";

function ReminderPrefsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["reminder-prefs"],
    queryFn: () => api<{ prefs: ReminderPrefs }>("/notifications/prefs"),
  });

  if (isLoading || !data) {
    return (
      <Card className="space-y-3 p-4">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </Card>
    );
  }

  // Remount when the saved email changes so the draft reseeds without an effect.
  return (
    <ReminderPrefsFields
      key={data.prefs.reminderEmail ?? "__null__"}
      prefs={data.prefs}
    />
  );
}

function ReminderPrefsFields({ prefs }: { prefs: ReminderPrefs }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [emailDraft, setEmailDraft] = useState(() => prefs.reminderEmail ?? "");

  const save = useMutation({
    mutationFn: (patch: Partial<ReminderPrefs>) =>
      api<{ prefs: ReminderPrefs }>("/notifications/prefs", {
        method: "PUT",
        body: JSON.stringify(patch),
      }),
    onSuccess: (res) => qc.setQueryData(["reminder-prefs"], res),
  });

  const toggleWindow = (w: number) => {
    const next = prefs.windows.includes(w)
      ? prefs.windows.filter((x) => x !== w)
      : [...prefs.windows, w];
    save.mutate({ windows: next.sort((a, b) => b - a) });
  };

  const commitReminderEmail = () => {
    const trimmed = emailDraft.trim();
    const next = trimmed === "" ? null : trimmed;
    const current = prefs.reminderEmail ?? null;
    if (next === current) return;
    save.mutate({ reminderEmail: next });
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
      <div className="px-4 py-3">
        <label htmlFor="reminder-email" className="text-sm font-medium text-fg">
          Send reminders to
        </label>
        <input
          id="reminder-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={emailDraft}
          placeholder={user?.email ?? "you@example.com"}
          disabled={save.isPending}
          onChange={(e) => setEmailDraft(e.target.value)}
          onBlur={commitReminderEmail}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="mt-2 w-full rounded-xl border border-line bg-ink-950 px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none disabled:opacity-50"
        />
        <p className="mt-2 text-xs text-fg-muted">
          Daily job at 08:00 UTC emails document & event reminders even if you
          don&apos;t open the app. Leave blank to use your Google account email.
        </p>
        <p className="mt-1.5 text-xs text-fg-subtle">
          Tip for the family owner: you can set {OWNER_EMAIL_HINT}.
        </p>
      </div>
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
