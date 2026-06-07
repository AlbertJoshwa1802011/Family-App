import { useQueryClient } from "@tanstack/react-query";
import { Bell, Info, LogOut } from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Avatar } from "../components/ui/Avatar";
import { ListItem } from "../components/ui/ListItem";
import { Badge } from "../components/ui/Badge";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

export function Settings() {
  const { user } = useAuth();
  const qc = useQueryClient();

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
            Notifications
          </h3>
          <Card className="divide-y divide-line overflow-hidden">
            <ListItem
              leading={<Bell className="size-5 text-fg-muted" />}
              title="Reminder preferences"
              subtitle="Channels & lead times"
              trailing={<Badge tone="vault">Phase 3</Badge>}
            />
          </Card>
        </section>

        <section className="space-y-2">
          <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            About
          </h3>
          <Card className="divide-y divide-line overflow-hidden">
            <ListItem
              leading={<Info className="size-5 text-fg-muted" />}
              title="Version"
              trailing={<span className="text-sm text-fg-muted">0.0.0 · Phase 0</span>}
            />
          </Card>
        </section>

        <Button
          variant="danger"
          fullWidth
          leadingIcon={<LogOut className="size-4" />}
          onClick={async () => {
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
