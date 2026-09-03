import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { HardDrive } from "lucide-react";
import { AppBar } from "../../components/ui/AppBar";
import { Page } from "../../components/ui/Page";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Skeleton } from "../../components/ui/Skeleton";
import { api } from "../../lib/api";

interface StorageStatus {
  connected: boolean;
  status: "connected" | "disconnected";
  email: string | null;
  rootFolderId: string | null;
  updatedAt: number | null;
}

interface StorageStats {
  limitBytes: number | null;
  usageBytes: number | null;
  usageInDriveBytes: number | null;
  usageInDriveTrashBytes: number | null;
}

const ERROR_LABELS: Record<string, string> = {
  missing_params: "The authorization response was incomplete.",
  invalid_state: "The request expired or was tampered with. Try again.",
  token_exchange_failed: "Google rejected the token exchange.",
  token_invalid: "Could not verify the connected account.",
  no_refresh_token:
    "Google did not return a refresh token. Revoke the app's access in your Google account, then reconnect.",
  oauth_not_configured: "Google OAuth is not configured on the server.",
};

function fmtBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function StorageBar({ usage, limit }: { usage: number; limit: number }) {
  const pct = Math.min((usage / limit) * 100, 100);
  const tone =
    pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warning" : "bg-vault-500";
  return (
    <div className="space-y-1.5">
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all ${tone}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-fg-muted">
        <span>{fmtBytes(usage)} used</span>
        <span>{fmtBytes(limit - usage)} free of {fmtBytes(limit)}</span>
      </div>
    </div>
  );
}

function StatsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-fg-muted">{label}</span>
      <span className="text-sm font-medium text-fg">{value}</span>
    </div>
  );
}

export function AdminStorage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const errorCode = params.get("error");
  const justConnected = params.get("connected") === "1";

  const { data, isLoading } = useQuery({
    queryKey: ["admin-storage"],
    queryFn: () => api<StorageStatus>("/admin/storage"),
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["admin-storage-stats"],
    queryFn: () => api<StorageStats>("/admin/storage/stats"),
    enabled: data?.connected === true,
    retry: false,
  });

  const connect = useMutation({
    mutationFn: () =>
      api<{ url: string }>("/admin/storage/connect/start", { method: "POST" }),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });

  const disconnect = useMutation({
    mutationFn: () => api("/admin/storage/disconnect", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-storage"] });
      qc.removeQueries({ queryKey: ["admin-storage-stats"] });
    },
  });

  const clearBanner = () => setParams({}, { replace: true });

  return (
    <>
      <AppBar title="Storage account" back />
      <Page className="space-y-6">
        <p className="rounded-xl border border-line bg-surface/60 px-3 py-2 text-xs text-fg-muted">
          Files upload to Cloudflare R2 when a bucket is bound. Until then,
          connecting this Google account stores documents in Drive — reconnect
          after this update so reminder emails can also send from the same
          Gmail (gmail.send). R2 remains optional.
        </p>
        {errorCode && (
          <Card className="border-danger/40 bg-danger/10 p-4 text-sm text-danger">
            {ERROR_LABELS[errorCode] ?? `Connection failed (${errorCode}).`}
            <button onClick={clearBanner} className="ml-2 underline">
              Dismiss
            </button>
          </Card>
        )}
        {justConnected && (
          <Card className="border-success/40 bg-success/10 p-4 text-sm text-success">
            Storage account connected. Reminder emails can now leave from this
            Gmail. Reconnect if you connected before Gmail send was added.
            <button onClick={clearBanner} className="ml-2 underline">
              Dismiss
            </button>
          </Card>
        )}

        {/* Status card */}
        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-3">
            <HardDrive className="size-6 text-fg-muted" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-fg">Shared Google Drive</div>
              <div className="text-sm text-fg-muted">
                Optional legacy backend. Primary files use R2.
                {!data?.connected && !isLoading ? " Pending laptop setup." : ""}
              </div>
            </div>
            {!isLoading && data && (
              <Badge tone={data.connected ? "success" : "neutral"}>
                {data.connected ? "Connected" : "Not connected"}
              </Badge>
            )}
          </div>

          {isLoading || !data ? (
            <Skeleton className="h-5 w-2/3" />
          ) : data.connected ? (
            <>
              <div className="rounded-lg bg-white/5 px-3 py-2 text-sm">
                <span className="text-fg-muted">Account: </span>
                <span className="text-fg">{data.email ?? "unknown"}</span>
              </div>
              <Button
                variant="danger"
                fullWidth
                loading={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                Disconnect
              </Button>
            </>
          ) : (
            <Button
              fullWidth
              loading={connect.isPending}
              onClick={() => connect.mutate()}
            >
              Connect storage account
            </Button>
          )}
        </Card>

        {/* Storage quota card — shown only when connected */}
        {data?.connected && (
          <Card className="space-y-4 p-4">
            <div className="font-semibold text-fg">Storage usage</div>
            {statsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-2.5 w-full" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : stats ? (
              <>
                {stats.limitBytes && stats.usageBytes !== null ? (
                  <StorageBar usage={stats.usageBytes} limit={stats.limitBytes} />
                ) : null}
                <div className="divide-y divide-line">
                  {stats.limitBytes !== null && (
                    <StatsRow label="Total capacity" value={fmtBytes(stats.limitBytes)} />
                  )}
                  {stats.usageBytes !== null && (
                    <StatsRow label="Total used" value={fmtBytes(stats.usageBytes)} />
                  )}
                  {stats.usageInDriveBytes !== null && (
                    <StatsRow label="Used in Drive" value={fmtBytes(stats.usageInDriveBytes)} />
                  )}
                  {stats.usageInDriveTrashBytes !== null && (
                    <StatsRow
                      label="In Trash"
                      value={fmtBytes(stats.usageInDriveTrashBytes)}
                    />
                  )}
                  {stats.limitBytes !== null && stats.usageBytes !== null && (
                    <StatsRow
                      label="Free space"
                      value={fmtBytes(stats.limitBytes - stats.usageBytes)}
                    />
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-fg-muted">
                Could not load quota. Check the storage account connection.
              </p>
            )}
          </Card>
        )}

        <p className="px-1 text-xs text-fg-subtle">
          Connecting opens Google sign-in. Sign in as the account that should hold
          the files (the 5TB Drive). The app only accesses files it creates.
        </p>
      </Page>
    </>
  );
}
