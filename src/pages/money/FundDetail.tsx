import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HandCoins } from "lucide-react";
import { AppBar } from "../../components/ui/AppBar";
import { Page } from "../../components/ui/Page";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { useAuth } from "../../context/AuthContext";
import { api, ApiError } from "../../lib/api";
import {
  formatMoney,
  parseMajorToMinor,
  todayIsoDate,
} from "../../lib/money";
import { cn } from "../../lib/cn";

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
  balances: FundBalances;
}

interface Contribution {
  id: string;
  payerName: string;
  amountMinor: number;
  currency: string;
  paidAt: number;
  note: string | null;
  externalRef: string | null;
}

interface Spend {
  id: string;
  amountMinor: number;
  currency: string;
  spendDate: string;
  merchant: string | null;
  description: string | null;
}

interface ActivityRow {
  id: string;
  action: string;
  createdAt: number;
  meta: Record<string, unknown> | null;
}

type Tab = "contributions" | "spends" | "settle" | "activity";

const inputClass =
  "w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none";

function paidAtLabel(secs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(secs * 1000));
}

export function FundDetail() {
  const { id } = useParams<{ id: string }>();
  const { activeFamilyId } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("contributions");
  const [today] = useState(() => todayIsoDate());
  const [formError, setFormError] = useState<string | null>(null);

  // Contribution form
  const [payerName, setPayerName] = useState("");
  const [contribAmount, setContribAmount] = useState("");
  const [contribNote, setContribNote] = useState("");
  const [externalRef, setExternalRef] = useState("");

  // Spend form
  const [spendAmount, setSpendAmount] = useState("");
  const [spendDate, setSpendDate] = useState(today);
  const [spendMerchant, setSpendMerchant] = useState("");
  const [spendDesc, setSpendDesc] = useState("");

  // Settle form
  const [periodKey, setPeriodKey] = useState(() => today.slice(0, 7));
  const [settleNote, setSettleNote] = useState("");

  const fundQ = useQuery({
    queryKey: ["funds", "detail", id],
    queryFn: () => api<{ fund: Fund }>(`/funds/${id}`),
    enabled: Boolean(id),
  });

  const contribQ = useQuery({
    queryKey: ["funds", "contributions", id],
    queryFn: () =>
      api<{ contributions: Contribution[] }>(`/funds/${id}/contributions`),
    enabled: Boolean(id) && tab === "contributions",
  });

  const spendsQ = useQuery({
    queryKey: ["funds", "spends", id],
    queryFn: () => api<{ spends: Spend[] }>(`/funds/${id}/spends`),
    enabled: Boolean(id) && tab === "spends",
  });

  const activityQ = useQuery({
    queryKey: ["funds", "activity", id],
    queryFn: () => api<{ activity: ActivityRow[] }>(`/funds/${id}/activity`),
    enabled: Boolean(id) && tab === "activity",
  });

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["funds"] });
  };

  const addContrib = useMutation({
    mutationFn: async () => {
      const fund = fundQ.data?.fund;
      if (!fund) throw new Error("Fund not loaded.");
      const amountMinor = parseMajorToMinor(contribAmount, fund.currency);
      if (amountMinor === null || amountMinor <= 0) {
        throw new Error("Enter a valid contribution amount.");
      }
      if (!payerName.trim()) throw new Error("Enter who paid.");
      return api(`/funds/${id}/contributions`, {
        method: "POST",
        body: JSON.stringify({
          payerName: payerName.trim(),
          amountMinor,
          note: contribNote.trim() || null,
          externalRef: externalRef.trim() || null,
        }),
      });
    },
    onSuccess: async () => {
      setPayerName("");
      setContribAmount("");
      setContribNote("");
      setExternalRef("");
      setFormError(null);
      await invalidate();
      await qc.invalidateQueries({ queryKey: ["funds", "contributions", id] });
    },
    onError: (e: unknown) => {
      setFormError(
        e instanceof ApiError || e instanceof Error ? e.message : "Failed.",
      );
    },
  });

  const addSpend = useMutation({
    mutationFn: async () => {
      const fund = fundQ.data?.fund;
      if (!fund) throw new Error("Fund not loaded.");
      const amountMinor = parseMajorToMinor(spendAmount, fund.currency);
      if (amountMinor === null || amountMinor <= 0) {
        throw new Error("Enter a valid spend amount.");
      }
      return api(`/funds/${id}/spends`, {
        method: "POST",
        body: JSON.stringify({
          amountMinor,
          spendDate,
          merchant: spendMerchant.trim() || null,
          description: spendDesc.trim() || null,
        }),
      });
    },
    onSuccess: async () => {
      setSpendAmount("");
      setSpendMerchant("");
      setSpendDesc("");
      setFormError(null);
      await invalidate();
      await qc.invalidateQueries({ queryKey: ["funds", "spends", id] });
    },
    onError: (e: unknown) => {
      setFormError(
        e instanceof ApiError || e instanceof Error ? e.message : "Failed.",
      );
    },
  });

  const settle = useMutation({
    mutationFn: async () => {
      return api(`/funds/${id}/settle`, {
        method: "POST",
        body: JSON.stringify({
          periodKey,
          note: settleNote.trim() || null,
        }),
      });
    },
    onSuccess: async () => {
      setSettleNote("");
      setFormError(null);
      await invalidate();
      await qc.invalidateQueries({ queryKey: ["funds", "activity", id] });
    },
    onError: (e: unknown) => {
      setFormError(
        e instanceof ApiError || e instanceof Error ? e.message : "Failed.",
      );
    },
  });

  if (fundQ.isLoading) {
    return (
      <>
        <AppBar title="Fund" back />
        <Page>
          <Card className="space-y-3 p-5">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-2/3" />
          </Card>
        </Page>
      </>
    );
  }

  if (fundQ.error || !fundQ.data) {
    return (
      <>
        <AppBar title="Fund" back />
        <Page>
          <EmptyState
            icon={HandCoins}
            title="Fund not found"
            description="It may have been archived, or you don't have access."
          />
        </Page>
      </>
    );
  }

  const fund = fundQ.data.fund;
  const b = fund.balances;

  return (
    <>
      <AppBar title={fund.name} back />
      <Page className="space-y-4 pb-24">
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
            Remaining
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-fg">
            {formatMoney(b.remainingMinor, fund.currency)}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-fg-subtle">In</p>
              <p className="text-sm font-semibold tabular-nums text-fg">
                {formatMoney(b.contributionsMinor, fund.currency)}
              </p>
            </div>
            <div>
              <p className="text-xs text-fg-subtle">Out</p>
              <p className="text-sm font-semibold tabular-nums text-fg">
                {formatMoney(b.spendsMinor, fund.currency)}
              </p>
            </div>
          </div>
          {b.lastSettledPeriodKey && (
            <p className="mt-3 text-xs text-fg-subtle">
              Last settled: {b.lastSettledPeriodKey}
              {b.unsettledSince ? ` · unsettled since ${b.unsettledSince}` : ""}
            </p>
          )}
        </Card>

        <div
          role="tablist"
          aria-label="Fund sections"
          className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1"
        >
          {(
            [
              ["contributions", "Contributions"],
              ["spends", "Spends"],
              ["settle", "Settle"],
              ["activity", "Activity"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => {
                setTab(key);
                setFormError(null);
              }}
              className={cn(
                "flex-1 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors",
                tab === key
                  ? "bg-vault-500/15 text-vault-300"
                  : "text-fg-subtle hover:text-fg-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {formError && (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        )}

        {tab === "contributions" && (
          <div className="space-y-4">
            <Card className="space-y-3 p-4">
              <h2 className="text-sm font-semibold text-fg">Record contribution</h2>
              <input
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                placeholder="Payer name"
                className={inputClass}
                maxLength={120}
              />
              <input
                inputMode="decimal"
                value={contribAmount}
                onChange={(e) => setContribAmount(e.target.value)}
                placeholder="Amount"
                className={inputClass}
              />
              <input
                value={externalRef}
                onChange={(e) => setExternalRef(e.target.value)}
                placeholder="Razorpay / ref (optional)"
                className={inputClass}
                maxLength={200}
              />
              <input
                value={contribNote}
                onChange={(e) => setContribNote(e.target.value)}
                placeholder="Note (optional)"
                className={inputClass}
              />
              <Button
                fullWidth
                loading={addContrib.isPending}
                onClick={() => addContrib.mutate()}
              >
                Add contribution
              </Button>
            </Card>

            {contribQ.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <Card className="divide-y divide-line overflow-hidden">
                {(contribQ.data?.contributions ?? []).length === 0 ? (
                  <p className="px-4 py-3 text-sm text-fg-subtle">No contributions yet.</p>
                ) : (
                  (contribQ.data?.contributions ?? []).map((c) => (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-fg">{c.payerName}</p>
                        <p className="text-xs text-fg-subtle">{paidAtLabel(c.paidAt)}</p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums text-fg">
                        {formatMoney(c.amountMinor, c.currency)}
                      </p>
                    </div>
                  ))
                )}
              </Card>
            )}
          </div>
        )}

        {tab === "spends" && (
          <div className="space-y-4">
            <Card className="space-y-3 p-4">
              <h2 className="text-sm font-semibold text-fg">Record spend from pot</h2>
              <input
                inputMode="decimal"
                value={spendAmount}
                onChange={(e) => setSpendAmount(e.target.value)}
                placeholder="Amount"
                className={inputClass}
              />
              <input
                type="date"
                value={spendDate}
                onChange={(e) => setSpendDate(e.target.value)}
                className={inputClass}
              />
              <input
                value={spendMerchant}
                onChange={(e) => setSpendMerchant(e.target.value)}
                placeholder="Merchant (optional)"
                className={inputClass}
              />
              <input
                value={spendDesc}
                onChange={(e) => setSpendDesc(e.target.value)}
                placeholder="Description (optional)"
                className={inputClass}
              />
              <Button
                fullWidth
                loading={addSpend.isPending}
                onClick={() => addSpend.mutate()}
              >
                Add spend
              </Button>
            </Card>

            {spendsQ.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <Card className="divide-y divide-line overflow-hidden">
                {(spendsQ.data?.spends ?? []).length === 0 ? (
                  <p className="px-4 py-3 text-sm text-fg-subtle">No spends yet.</p>
                ) : (
                  (spendsQ.data?.spends ?? []).map((s) => (
                    <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-fg">
                          {s.merchant || s.description || "Spend"}
                        </p>
                        <p className="text-xs text-fg-subtle">{s.spendDate}</p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums text-fg">
                        {formatMoney(s.amountMinor, s.currency)}
                      </p>
                    </div>
                  ))
                )}
              </Card>
            )}
          </div>
        )}

        {tab === "settle" && (
          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold text-fg">Settle a month</h2>
            <p className="text-xs text-fg-muted">
              Mark settled only after money is actually withdrawn/reconciled in the bank.
              This snapshots contributions and spends for the month and cannot be repeated.
            </p>
            <label htmlFor="period" className="text-xs font-medium text-fg-subtle">
              Month (yyyy-mm)
            </label>
            <input
              id="period"
              value={periodKey}
              onChange={(e) => setPeriodKey(e.target.value)}
              placeholder="2026-09"
              className={inputClass}
            />
            <input
              value={settleNote}
              onChange={(e) => setSettleNote(e.target.value)}
              placeholder="Note (optional)"
              className={inputClass}
            />
            <Button
              fullWidth
              loading={settle.isPending}
              onClick={() => settle.mutate()}
              disabled={!activeFamilyId}
            >
              Mark settled
            </Button>
          </Card>
        )}

        {tab === "activity" && (
          <Card className="divide-y divide-line overflow-hidden">
            {activityQ.isLoading ? (
              <div className="p-4">
                <Skeleton className="h-16 w-full" />
              </div>
            ) : (activityQ.data?.activity ?? []).length === 0 ? (
              <p className="px-4 py-3 text-sm text-fg-subtle">No activity yet.</p>
            ) : (
              (activityQ.data?.activity ?? []).map((a) => (
                <div key={a.id} className="px-4 py-3">
                  <p className="text-sm font-medium text-fg">{a.action.replace(/_/g, " ")}</p>
                  <p className="text-xs text-fg-subtle">{paidAtLabel(a.createdAt)}</p>
                </div>
              ))
            )}
          </Card>
        )}
      </Page>
    </>
  );
}
