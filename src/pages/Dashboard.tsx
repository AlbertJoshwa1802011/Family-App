import { CalendarClock, Clock, FileText, HardDrive, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { useAuth } from "../context/AuthContext";

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <Card className="p-4">
      <div
        className={`flex size-9 items-center justify-center rounded-xl ${accent}`}
      >
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <div className="mt-3 text-2xl font-bold tabular-nums text-white">
        {value}
      </div>
      <div className="mt-0.5 text-xs text-fg-muted">{label}</div>
    </Card>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0] ?? "there";

  return (
    <>
      <AppBar title="Family Vault" />
      <Page className="space-y-6">
        <div>
          <p className="text-sm text-fg-muted">Welcome back,</p>
          <h2 className="text-xl font-semibold text-white">{firstName} 👋</h2>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={FileText}
            label="Documents"
            value="—"
            accent="bg-vault-500/15 text-vault-300"
          />
          <StatCard
            icon={Clock}
            label="Expiring soon"
            value="—"
            accent="bg-warning/15 text-warning"
          />
          <StatCard
            icon={Users}
            label="Family members"
            value="—"
            accent="bg-info/15 text-info"
          />
          <StatCard
            icon={HardDrive}
            label="Storage used"
            value="—"
            accent="bg-success/15 text-success"
          />
        </div>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-fg-muted">
            Upcoming expiries
          </h3>
          <EmptyState
            icon={CalendarClock}
            title="Nothing expiring soon"
            description="Documents nearing their expiry date will show up here so you can renew in time."
          />
        </section>
      </Page>
    </>
  );
}
