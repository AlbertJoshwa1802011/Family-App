import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HandCoins, Plus } from "lucide-react";
import { AppBar } from "../../components/ui/AppBar";
import { Page } from "../../components/ui/Page";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Fab } from "../../components/ui/Fab";
import { EmptyState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { MoneySubNav } from "../../components/money/MoneySubNav";
import { useAuth } from "../../context/AuthContext";
import { api, ApiError } from "../../lib/api";
import { formatMoney } from "../../lib/money";

interface FundBalances {
  contributionsMinor: number;
  spendsMinor: number;
  remainingMinor: number;
  unsettledSince: string | null;
  lastSettledPeriodKey: string | null;
}

interface Fund {
  id: string;
  name: string;
  currency: string;
  notes: string | null;
  status: string;
  balances: FundBalances;
}

const inputClass =
  "w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none";

export function Funds() {
  const { activeFamilyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("Church offering");
  const [error, setError] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["funds", activeFamilyId],
    queryFn: () =>
      api<{ funds: Fund[] }>(`/funds?familyId=${activeFamilyId}`),
    enabled: Boolean(activeFamilyId),
  });

  const settingsQ = useQuery({
    queryKey: ["finance", "settings", activeFamilyId],
    queryFn: () =>
      api<{ currency: string }>(`/finance/settings?familyId=${activeFamilyId}`),
    enabled: Boolean(activeFamilyId),
  });

  const create = useMutation({
    mutationFn: () =>
      api<{ fund: Fund }>("/funds", {
        method: "POST",
        body: JSON.stringify({
          familyId: activeFamilyId,
          name: name.trim() || "Church offering",
          currency: settingsQ.data?.currency,
        }),
      }),
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: ["funds"] });
      setCreating(false);
      navigate(`/money/funds/${data.fund.id}`);
    },
    onError: (e: unknown) => {
      setError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : "Could not create fund.",
      );
    },
  });

  if (!activeFamilyId) {
    return (
      <>
        <AppBar title="Funds" />
        <Page width="list">
          <EmptyState
            icon={HandCoins}
            title="No family yet"
            description="You need a family before you can track collection funds."
          />
        </Page>
      </>
    );
  }

  const funds = listQ.data?.funds ?? [];

  return (
    <>
      <AppBar title="Funds" />
      <Page width="list" className="space-y-4 pb-24">
        <MoneySubNav />
        <Card className="p-4">
          <p className="text-sm text-fg-muted">
            Shared pots for church offerings and collections. Record who paid in,
            what was spent, then settle when the money is reconciled in the bank.
          </p>
        </Card>

        {creating && (
          <Card className="space-y-3 p-4">
            <label htmlFor="fundName" className="text-xs font-medium text-fg-subtle">
              Fund name
            </label>
            <input
              id="fundName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              maxLength={120}
            />
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                fullWidth
                onClick={() => {
                  setCreating(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button fullWidth loading={create.isPending} onClick={() => create.mutate()}>
                Create
              </Button>
            </div>
          </Card>
        )}

        {listQ.isLoading ? (
          <Card className="space-y-3 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </Card>
        ) : funds.length === 0 ? (
          <EmptyState
            icon={HandCoins}
            title="No funds yet"
            description='Create a "Church offering" fund to track contributions, spends, and monthly settle.'
          />
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {funds.map((f) => (
              <Link
                key={f.id}
                to={`/money/funds/${f.id}`}
                className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-white/5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">
                    {f.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-fg-subtle">
                    In {formatMoney(f.balances.contributionsMinor, f.currency)} · Out{" "}
                    {formatMoney(f.balances.spendsMinor, f.currency)}
                  </span>
                </span>
                <span className="text-sm font-semibold tabular-nums text-fg">
                  {formatMoney(f.balances.remainingMinor, f.currency)}
                </span>
              </Link>
            ))}
          </Card>
        )}
      </Page>

      {!creating && (
        <Fab
          icon={Plus}
          label="New fund"
          onClick={() => {
            setName("Church offering");
            setCreating(true);
          }}
        />
      )}
    </>
  );
}
