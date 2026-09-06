import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bell, CalendarPlus, Check, Copy, Info, LogOut, Mail } from "lucide-react";
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
}

// Lead-time options offered in the UI (days before expiry/event).
const WINDOW_OPTIONS = [1, 3, 7, 14, 30, 60];

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
    <Card className="divide-y divide-white/8 overflow-hidden">
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
              "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
              prefs.emailEnabled ? "lq lq-primary" : "lq lq-field",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 left-0.5 size-5 rounded-full bg-white",
                "transition-transform duration-300 ease-[var(--ease-liquid)]",
                prefs.emailEnabled ? "translate-x-5" : "translate-x-0",
              )}
            />
          </button>
        }
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
                  "lq lq-flat lq-press rounded-full px-3.5 py-1.5 text-xs font-semibold disabled:opacity-50",
                  on ? "lq-primary text-white" : "text-fg-muted hover:text-fg",
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

function CalendarFeedCard() {
  const [feedUrl, setFeedUrl] = useState("");
  const [copied, setCopied] = useState(false);

  const mint = useMutation({
    mutationFn: () =>
      api<{ url: string }>("/calendar/feed-token", { method: "POST" }),
    onSuccess: (res) => {
      setFeedUrl(res.url);
      setCopied(false);
    },
  });

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start gap-3">
        <CalendarPlus className="mt-0.5 size-5 shrink-0 text-fg-muted" />
        <div>
          <div className="text-sm font-medium text-fg">
            Subscribe in your calendar app
          </div>
          <p className="mt-0.5 text-xs text-fg-muted">
            Family events and document expiries in Google Calendar, Apple
            Calendar, or Outlook — updates automatically.
          </p>
        </div>
      </div>

      {feedUrl ? (
        <>
          <div className="flex items-center gap-2">
            <code className="lq lq-field min-w-0 flex-1 truncate rounded-xl px-3 py-2 text-xs text-fg-muted">
              {feedUrl}
            </code>
            <Button
              size="md"
              variant="secondary"
              leadingIcon={
                copied ? <Check className="size-4" /> : <Copy className="size-4" />
              }
              onClick={async () => {
                await navigator.clipboard.writeText(feedUrl);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-fg-subtle">
            In your calendar app choose "Subscribe / Add calendar from URL" and
            paste this link. Anyone with the link can read your calendar —
            regenerate it to revoke the old one.
          </p>
        </>
      ) : (
        <Button
          variant="secondary"
          fullWidth
          loading={mint.isPending}
          onClick={() => mint.mutate()}
        >
          Get calendar link
        </Button>
      )}
      {mint.isError && (
        <p className="text-xs text-danger">{(mint.error as Error).message}</p>
      )}
    </Card>
  );
}

export function Settings() {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <>
      <AppBar title="Settings" />
      <Page className="space-y-6">
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
            Calendar
          </h3>
          <CalendarFeedCard />
        </section>

        <section className="space-y-2">
          <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            Notifications
          </h3>
          <Card className="divide-y divide-white/8 overflow-hidden">
            <ListItem
              to="/notifications"
              leading={<Bell className="size-5 text-fg-muted" />}
              title="Notification center"
              subtitle="View reminders & updates"
            />
          </Card>
        </section>

        <section className="space-y-2">
          <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            About
          </h3>
          <Card className="divide-y divide-white/8 overflow-hidden">
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
          loading={signingOut}
          leadingIcon={<LogOut className="size-4" />}
          onClick={() => {
            setSigningOut(true);
            void signOut();
          }}
        >
          Sign out
        </Button>
      </Page>
    </>
  );
}
