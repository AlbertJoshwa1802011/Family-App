import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Church, HandCoins } from "lucide-react";
import { AppBar } from "../../components/ui/AppBar";
import { Page } from "../../components/ui/Page";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { LiquidPillTabs } from "../../components/ui/LiquidPillTabs";
import { MoneySubNav } from "../../components/money/MoneySubNav";
import { useAuth } from "../../context/AuthContext";
import { api, ApiError } from "../../lib/api";
import { formatMoney } from "../../lib/money";
import { inputCls as inputClass } from "../../lib/fieldCls";
import { HandSettlementsPanel } from "./HandSettlements";

interface ChurchFund {
  slug: string;
  name: string;
  goalAmount: number;
  totalCollected: number;
  spentOnProducts: number;
  availableBalance: number;
  status: string;
  outstandingMinor: number;
  suggestedDueMinor: number;
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
  dueMinor: number;
  paidMinor: number;
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

function rupees(n: number): string {
  return formatMoney(Math.round(n * 100), "INR");
}

function parseRupees(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export function Funds() {
  const { activeFamilyId } = useAuth();
  const qc = useQueryClient();
  const [view, setView] = useState<"church" | "hand">("church");
  const [today] = useState(() => new Date().toISOString().slice(0, 7));
  const [fundSlug, setFundSlug] = useState("");
  const [periodKey, setPeriodKey] = useState(today);
  const [dueRupees, setDueRupees] = useState("");
  const [paidRupees, setPaidRupees] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [dueTouched, setDueTouched] = useState(false);

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

  const funds = snapQ.data?.funds ?? [];
  const selected = funds.find((f) => f.slug === fundSlug) ?? funds[0];
  const effectiveSlug = fundSlug || selected?.slug || "";
  const suggestedDueRupees =
    selected && (selected.suggestedDueMinor ?? 0) > 0
      ? String((selected.suggestedDueMinor ?? 0) / 100)
      : "";
  const dueRupeesValue = dueTouched ? dueRupees : suggestedDueRupees;

  const dueMinor = parseRupees(dueRupeesValue);
  const paidMinor = parseRupees(paidRupees);
  const carryMinor =
    dueMinor != null && paidMinor != null && paidMinor <= dueMinor
      ? dueMinor - paidMinor
      : null;

  const settle = useMutation({
    mutationFn: (slug: string) => {
      if (dueMinor == null || paidMinor == null) {
        throw new Error("Enter amount due and how much you are paying now.");
      }
      if (paidMinor > dueMinor) {
        throw new Error("Paid amount cannot be more than the amount due.");
      }
      return api("/church/settle", {
        method: "POST",
        body: JSON.stringify({
          familyId: activeFamilyId,
          fundSlug: slug,
          periodKey,
          dueMinor,
          paidMinor,
          note: note.trim() || null,
        }),
      });
    },
    onSuccess: async () => {
      setNote("");
      setPaidRupees("");
      setDueTouched(false);
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
  const purchases = (snap?.purchases ?? []).filter((p) => p.status === "Active");
  const settlements = snap?.settlements ?? [];

  return (
    <>
      <AppBar title="Funds" />
      <Page width="list" className="space-y-4 pb-24 md:pb-10">
        <MoneySubNav />

        <LiquidPillTabs
          ariaLabel="Fund settlement views"
          value={view}
          onChange={setView}
          items={[
            { id: "church", label: "Church", icon: Church },
            { id: "hand", label: "In hand", icon: HandCoins },
          ]}
        />

        {view === "hand" ? (
          <HandSettlementsPanel familyId={activeFamilyId} />
        ) : (
          <>
        <Card className="p-4">
          <p className="text-sm text-fg-muted">
            Live collection and purchase totals come from the church contributions
            site. Settlements here track what you actually transferred — you can
            pay part of the amount due and carry the rest to next month.
          </p>
        </Card>

        {snapQ.isLoading ? (
          <Card className="space-y-3 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </Card>
        ) : snapQ.isError ? (
          <Card className="space-y-2 p-4">
            <p className="text-sm font-semibold text-fg">
              {snapQ.error instanceof ApiError && snapQ.error.code === "church_auth_failed"
                ? "Church token was rejected"
                : snapQ.error instanceof ApiError && snapQ.error.code === "church_unreachable"
                  ? "Church site unreachable"
                  : "Church data isn’t connected yet"}
            </p>
            <p className="text-sm text-fg-muted">
              {snapQ.error instanceof ApiError && snapQ.error.message
                ? snapQ.error.message
                : "Live totals come from the contributions site. After the latest deploy, Money → Funds should load automatically from CONTRIBUTIONS_API_URL. Optional: set Worker secret CONTRIBUTIONS_API_TOKEN on fam if that site requires ADMIN_API_TOKEN."}
            </p>
            <Button
              variant="secondary"
              fullWidth
              onClick={() => void snapQ.refetch()}
            >
              Try again
            </Button>
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
              {(f.outstandingMinor ?? 0) > 0 && (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-200">
                  Still to settle: {formatMoney(f.outstandingMinor, "INR")}
                </p>
              )}
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
            <p className="text-xs text-fg-muted">
              Example: due ₹5,320, pay ₹3,000 now — ₹2,320 carries to next month.
            </p>
            <label className="text-xs font-medium text-fg-subtle" htmlFor="fundSlug">
              Fund
            </label>
            <select
              id="fundSlug"
              value={effectiveSlug}
              onChange={(e) => {
                setFundSlug(e.target.value);
                setDueTouched(false);
              }}
              className={inputClass}
            >
              {funds.map((f) => (
                <option key={f.slug} value={f.slug}>
                  {f.name}
                  {(f.outstandingMinor ?? 0) > 0
                    ? ` · still ${formatMoney(f.outstandingMinor, "INR")}`
                    : ""}
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
            <label className="text-xs font-medium text-fg-subtle" htmlFor="dueAmount">
              Amount due (₹)
            </label>
            <input
              id="dueAmount"
              inputMode="decimal"
              value={dueRupeesValue}
              onChange={(e) => {
                setDueTouched(true);
                setDueRupees(e.target.value);
              }}
              placeholder="5320"
              className={inputClass}
            />
            <label className="text-xs font-medium text-fg-subtle" htmlFor="paidAmount">
              Paying now (₹)
            </label>
            <input
              id="paidAmount"
              inputMode="decimal"
              value={paidRupees}
              onChange={(e) => setPaidRupees(e.target.value)}
              placeholder="3000"
              className={inputClass}
            />
            {carryMinor != null && carryMinor > 0 && (
              <p className="text-xs text-amber-200">
                Carry forward to next time: {formatMoney(carryMinor, "INR")}
              </p>
            )}
            {carryMinor === 0 && paidMinor != null && (
              <p className="text-xs text-emerald-300">Fully settled for this entry.</p>
            )}
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
              {carryMinor != null && carryMinor > 0
                ? "Record partial settlement"
                : "Record settlement"}
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
                    Paid {formatMoney(s.paidMinor ?? 0, "INR")} of{" "}
                    {formatMoney(s.dueMinor ?? s.remainingMinor, "INR")}
                    {(s.remainingMinor ?? 0) > 0
                      ? ` · carry ${formatMoney(s.remainingMinor, "INR")}`
                      : " · cleared"}
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
          </>
        )}
      </Page>
    </>
  );
}
