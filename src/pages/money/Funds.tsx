import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HandCoins } from "lucide-react";
import { AppBar } from "../../components/ui/AppBar";
import { Page } from "../../components/ui/Page";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { MoneySubNav } from "../../components/money/MoneySubNav";
import { useAuth } from "../../context/AuthContext";
import { api, ApiError } from "../../lib/api";
import { formatMoney } from "../../lib/money";

interface ChurchFund {
  slug: string;
  name: string;
  goalAmount: number;
  totalCollected: number;
  spentOnProducts: number;
  availableBalance: number;
  status: string;
}

interface ChurchPurchase {
  id: string;
  name: string;
  amount: number;
  date: string;
  fund: string;
  status: string;
}

interface ChurchSettlement {
  id: string;
  fundSlug: string;
  periodKey: string;
  collectedMinor: number;
  spentMinor: number;
  remainingMinor: number;
  settledAt: number;
  note: string | null;
}

interface Snapshot {
  configured: boolean;
  currency: string;
  funds: ChurchFund[];
  purchases: ChurchPurchase[];
  settlements: ChurchSettlement[];
}

interface LocalFund {
  id: string;
  name: string;
}

const inputClass =
  "w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none";

function rupees(n: number): string {
  return formatMoney(Math.round(n * 100), "INR");
}

export function Funds() {
  const { activeFamilyId } = useAuth();
  const qc = useQueryClient();
  const [today] = useState(() => new Date().toISOString().slice(0, 7));
  const [fundSlug, setFundSlug] = useState("");
  const [periodKey, setPeriodKey] = useState(today);
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const snapQ = useQuery({
    queryKey: ["church", "snapshot", activeFamilyId],
    queryFn: () => api<Snapshot>(`/church/snapshot?familyId=${activeFamilyId}`),
    enabled: Boolean(activeFamilyId),
    retry: false,
  });

  const localQ = useQuery({
    queryKey: ["funds", activeFamilyId],
    queryFn: () => api<{ funds: LocalFund[] }>(`/funds?familyId=${activeFamilyId}`),
    enabled: Boolean(activeFamilyId),
  });

  const settle = useMutation({
    mutationFn: (slug: string) =>
      api("/church/settle", {
        method: "POST",
        body: JSON.stringify({
          familyId: activeFamilyId,
          fundSlug: slug,
          periodKey,
          note: note.trim() || null,
        }),
      }),
    onSuccess: async () => {
      setNote("");
      setFormError(null);
      await qc.invalidateQueries({ queryKey: ["church"] });
    },
    onError: (e: unknown) => {
      setFormError(
        e instanceof ApiError || e instanceof Error ? e.message : "Could not settle.",
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
            description="You need a family before you can settle church funds."
          />
        </Page>
      </>
    );
  }

  const snap = snapQ.data;
  const funds = snap?.funds ?? [];
  const purchases = (snap?.purchases ?? []).filter((p) => p.status === "Active");
  const settlements = snap?.settlements ?? [];
  const selected = funds.find((f) => f.slug === fundSlug) ?? funds[0];
  const effectiveSlug = fundSlug || selected?.slug || "";

  return (
    <>
      <AppBar title="Funds" />
      <Page width="list" className="space-y-4 pb-24">
        <MoneySubNav />

        <Card className="p-4">
          <p className="text-sm text-fg-muted">
            Collection and purchase totals come from the church contributions
            app. Record a monthly settlement here after you reconcile the bank
            — no need to re-enter every contribution.
          </p>
        </Card>

        {snapQ.isLoading ? (
          <Card className="space-y-3 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </Card>
        ) : snapQ.isError ? (
          <Card className="space-y-2 p-4">
            <p className="text-sm font-semibold text-fg">Church data isn’t connected yet</p>
            <p className="text-sm text-fg-muted">
              {snapQ.error instanceof Error ? snapQ.error.message : "church_not_configured"}
              . Set CONTRIBUTIONS_API_TOKEN on the Worker to pull live fund and purchase totals.
            </p>
          </Card>
        ) : funds.length === 0 ? (
          <EmptyState
            icon={HandCoins}
            title="No church funds found"
            description="Once funds exist on the contributions site, they’ll show here automatically."
          />
        ) : (
          funds.map((f) => (
            <Card key={f.slug} className="space-y-2 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold text-fg">{f.name}</h2>
                <span className="text-xs text-fg-subtle">{f.slug}</span>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <dt className="text-[11px] text-fg-subtle">Collected</dt>
                  <dd className="text-sm font-semibold tabular-nums text-emerald-300">
                    {rupees(f.totalCollected)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-fg-subtle">Purchases</dt>
                  <dd className="text-sm font-semibold tabular-nums text-orange-300">
                    {rupees(f.spentOnProducts)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-fg-subtle">Available</dt>
                  <dd className="text-sm font-semibold tabular-nums text-sky-300">
                    {rupees(f.availableBalance)}
                  </dd>
                </div>
              </dl>
            </Card>
          ))
        )}

        {purchases.length > 0 && (
          <section className="space-y-2">
            <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              Recent purchases
            </h3>
            <Card className="divide-y divide-line overflow-hidden">
              {purchases.slice(0, 8).map((p) => (
                <div key={p.id} className="flex items-baseline justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-fg">{p.name}</p>
                    <p className="text-xs text-fg-subtle">
                      {p.date} · {p.fund}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-fg">
                    {rupees(p.amount)}
                  </span>
                </div>
              ))}
            </Card>
          </section>
        )}

        {funds.length > 0 && (
          <Card className="space-y-3 p-4">
            <h3 className="text-sm font-semibold text-fg">Record a settlement</h3>
            <label className="text-xs font-medium text-fg-subtle" htmlFor="fundSlug">
              Fund
            </label>
            <select
              id="fundSlug"
              value={effectiveSlug}
              onChange={(e) => setFundSlug(e.target.value)}
              className={inputClass}
            >
              {funds.map((f) => (
                <option key={f.slug} value={f.slug}>
                  {f.name}
                </option>
              ))}
            </select>
            <label className="text-xs font-medium text-fg-subtle" htmlFor="period">
              Month
            </label>
            <input
              id="period"
              type="month"
              value={periodKey}
              onChange={(e) => setPeriodKey(e.target.value)}
              className={inputClass}
            />
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note (e.g. transferred to church account)"
              rows={2}
              className={inputClass + " resize-none"}
            />
            {formError && (
              <p role="alert" className="text-sm text-danger">
                {formError}
              </p>
            )}
            <Button
              fullWidth
              loading={settle.isPending}
              onClick={() => {
                if (!effectiveSlug) {
                  setFormError("Pick a fund.");
                  return;
                }
                settle.mutate(effectiveSlug);
              }}
            >
              Settle this month
            </Button>
          </Card>
        )}

        {settlements.length > 0 && (
          <section className="space-y-2">
            <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              Settlements
            </h3>
            <Card className="divide-y divide-line overflow-hidden">
              {settlements.map((s) => (
                <div key={s.id} className="px-4 py-3">
                  <p className="text-sm font-medium text-fg">
                    {s.fundSlug} · {s.periodKey}
                  </p>
                  <p className="text-xs text-fg-subtle">
                    Remaining {formatMoney(s.remainingMinor, "INR")}
                    {s.note ? ` · ${s.note}` : ""}
                  </p>
                </div>
              ))}
            </Card>
          </section>
        )}

        {(localQ.data?.funds.length ?? 0) > 0 && (
          <section className="space-y-2">
            <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              Manual ledgers
            </h3>
            <Card className="divide-y divide-line overflow-hidden">
              {localQ.data!.funds.map((f) => (
                <Link
                  key={f.id}
                  to={`/money/funds/${f.id}`}
                  className="block px-4 py-3 text-sm text-fg hover:bg-white/5"
                >
                  {f.name}
                </Link>
              ))}
            </Card>
          </section>
        )}
      </Page>
    </>
  );
}
