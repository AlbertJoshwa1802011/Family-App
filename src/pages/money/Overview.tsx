import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowUpRight,
  HandCoins,
  PiggyBank,
  Plus,
  Repeat,
  Settings2,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { AppBar } from "../../components/ui/AppBar";
import { Page } from "../../components/ui/Page";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Skeleton";
import { EmptyState } from "../../components/ui/EmptyState";
import { MoneySubNav } from "../../components/money/MoneySubNav";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";
import { formatMoney, todayIsoDate } from "../../lib/money";
import {
  KIND_LABEL,
  formatDayMonth,
  formatMonth,
  statusMeta,
  type Overview as OverviewData,
} from "../../lib/finance";
import { cn } from "../../lib/cn";

// ---------------------------------------------------------------------------
// A labelled figure. Headline numbers are stat tiles, not charts.
// ---------------------------------------------------------------------------

function Figure({
  label,
  amountMinor,
  currency,
  tone = "default",
  icon: Icon,
  sub,
}: {
  label: string;
  amountMinor: number;
  currency: string;
  tone?: "default" | "positive" | "negative" | "muted";
  icon?: typeof Wallet;
  sub?: string;
}) {
  return (
    <Card className="rounded-[28px] border-white/15 bg-white/8 p-4 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.45)] backdrop-blur-xl">
      <div className="flex items-center gap-1.5 text-fg-subtle">
        {Icon && <Icon className="size-3.5" aria-hidden="true" />}
        <p className="text-[11px] font-medium uppercase tracking-wide">{label}</p>
      </div>
      <p
        className={cn(
          "mt-1 text-xl font-bold tabular-nums",
          tone === "positive" && "text-success",
          tone === "negative" && "text-danger",
          tone === "muted" && "text-fg-muted",
          tone === "default" && "text-fg",
        )}
      >
        {formatMoney(amountMinor, currency)}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-fg-subtle">{sub}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Where the money goes: one bar split into committed / saved / spent / left.
// ---------------------------------------------------------------------------

function AllocationBar({ data, currency }: { data: OverviewData; currency: string }) {
  const { plan } = data;
  if (plan.incomeMinor <= 0) return null;

  const spent = Math.max(plan.spentMinor, 0);
  const left = Math.max(plan.remainingMinor, 0);
  const segments = [
    { key: "committed", label: "Committed", value: plan.committedMinor, className: "bg-m3-purple" },
    { key: "saving", label: "Saving", value: plan.savingsTargetMinor, className: "bg-m3-blue" },
    { key: "spent", label: "Spent", value: spent, className: "bg-warning" },
    { key: "left", label: "Left", value: left, className: "bg-vault-500" },
  ].filter((s) => s.value > 0);

  const total = segments.reduce((s, x) => s + x.value, 0) || 1;

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-fg">Where this month's money goes</h2>
      <div className="mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full">
        {segments.map((s) => (
          <span
            key={s.key}
            className={cn("h-full first:rounded-l-full last:rounded-r-full", s.className)}
            style={{ width: `${(s.value / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span className={cn("size-2 shrink-0 rounded-full", s.className)} aria-hidden="true" />
              <span className="text-xs text-fg-muted">{s.label}</span>
            </span>
            <span className="text-xs font-semibold tabular-nums text-fg">
              {formatMoney(s.value, currency)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function WeeklyBars({
  weeks,
  currency,
  paceMinor,
}: {
  weeks: OverviewData["plan"]["weeks"];
  currency: string;
  paceMinor: number | null;
}) {
  const max = Math.max(...weeks.map((w) => w.spentMinor), paceMinor ?? 0, 1);

  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-fg">Week by week</h2>
        {paceMinor !== null && (
          <span className="text-[11px] text-fg-subtle">
            pace {formatMoney(paceMinor, currency)}/wk
          </span>
        )}
      </div>
      <ul className="mt-3 space-y-2.5">
        {weeks.map((w) => {
          const over = paceMinor !== null && w.spentMinor > paceMinor;
          return (
            <li key={w.index}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-fg-muted">
                  Week {w.index}
                  <span className="ml-1.5 text-fg-subtle">
                    {formatDayMonth(w.from)}–{formatDayMonth(w.to)}
                  </span>
                </span>
                <span
                  className={cn(
                    "text-xs font-semibold tabular-nums",
                    over ? "text-warning" : "text-fg",
                  )}
                >
                  {formatMoney(w.spentMinor, currency)}
                </span>
              </div>
              <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-white/5">
                <div
                  className={cn("h-full rounded-full", over ? "bg-warning" : "bg-vault-500")}
                  style={{ width: `${Math.max((w.spentMinor / max) * 100, w.spentMinor > 0 ? 2 : 0)}%` }}
                />
                {paceMinor !== null && paceMinor > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 w-px bg-fg-subtle/60"
                    style={{ left: `${Math.min((paceMinor / max) * 100, 100)}%` }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function TrendChart({
  trend,
  currency,
}: {
  trend: OverviewData["trend"];
  currency: string;
}) {
  if (trend.length < 2) return null;
  const max = Math.max(...trend.flatMap((t) => [t.incomeMinor, t.spentMinor]), 1);

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-fg">Income vs spending</h2>
      <div className="mt-3 flex items-end justify-between gap-2">
        {trend.map((t) => (
          <div key={t.key} className="flex flex-1 flex-col items-center gap-1.5">
            <span className="flex h-24 w-full items-end justify-center gap-0.5">
              <span
                className="w-full max-w-3 rounded-t-[4px] bg-vault-500/40"
                style={{ height: `${Math.max((t.incomeMinor / max) * 100, 2)}%` }}
                title={`Income ${formatMoney(t.incomeMinor, currency)}`}
              />
              <span
                className="w-full max-w-3 rounded-t-[4px] bg-warning"
                style={{ height: `${Math.max((t.spentMinor / max) * 100, 2)}%` }}
                title={`Spent ${formatMoney(t.spentMinor, currency)}`}
              />
            </span>
            <span className="text-[10px] text-fg-subtle">{formatMonth(t.key)}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4">
        <span className="flex items-center gap-1.5 text-[11px] text-fg-muted">
          <span className="size-2 rounded-full bg-vault-500/40" aria-hidden="true" /> Income
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-fg-muted">
          <span className="size-2 rounded-full bg-warning" aria-hidden="true" /> Spent
        </span>
      </div>
    </Card>
  );
}

const glassBubble =
  "rounded-[28px] border border-white/15 bg-white/8 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.45)] backdrop-blur-xl";

interface Suggestion {
  label: string;
  merchant: string | null;
  categoryId: string | null;
  amountMinor: number;
}

function LikelyThisWeek({
  familyId,
  currency,
}: {
  familyId: string;
  currency: string;
}) {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["expenses", "suggestions", familyId],
    queryFn: () =>
      api<{ suggestions: Suggestion[]; basedOn: string }>(
        `/expenses/suggestions?familyId=${familyId}`,
      ),
  });

  if (q.isLoading) {
    return (
      <div className={cn(glassBubble, "p-4")}>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-3 h-10 w-full" />
      </div>
    );
  }

  const suggestions = q.data?.suggestions ?? [];
  if (suggestions.length === 0) return null;

  return (
    <div className={cn(glassBubble, "overflow-hidden")}>
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold text-fg">Likely this week</h2>
        <p className="text-xs text-fg-muted">Based on your past months</p>
      </div>
      <ul className="divide-y divide-white/10">
        {suggestions.map((s) => {
          const params = new URLSearchParams();
          params.set("amount", String(s.amountMinor / 100));
          if (s.merchant) params.set("merchant", s.merchant);
          if (s.categoryId) params.set("categoryId", s.categoryId);
          return (
            <li key={s.label} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{s.label}</p>
                <p className="text-xs text-fg-subtle">
                  {formatMoney(s.amountMinor, currency)}
                </p>
              </div>
              <Button
                size="md"
                variant="secondary"
                onClick={() => navigate(`/money/expenses/new?${params.toString()}`)}
              >
                Add
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PrimaryCtas({
  thisWeekMinor,
  currency,
}: {
  thisWeekMinor: number | null;
  currency: string;
}) {
  const navigate = useNavigate();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => navigate("/money/expenses/new")}
          className={cn(
            glassBubble,
            "flex min-h-[72px] flex-col items-start justify-center gap-1 px-4 py-4 text-left transition-transform active:scale-[0.98]",
          )}
        >
          <span className="flex size-10 items-center justify-center rounded-2xl bg-vault-500/20 text-vault-300">
            <Plus className="size-5" aria-hidden="true" />
          </span>
          <span className="mt-1 text-base font-semibold text-fg">Add expense</span>
          <span className="text-[11px] text-fg-muted">Log what you spent</span>
        </button>
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("family-vault:open-assistant"))
          }
          className={cn(
            glassBubble,
            "flex min-h-[72px] flex-col items-start justify-center gap-1 px-4 py-4 text-left transition-transform active:scale-[0.98]",
          )}
        >
          <span className="flex size-10 items-center justify-center rounded-2xl bg-vault-500/20 text-vault-300">
            <Sparkles className="size-5" aria-hidden="true" />
          </span>
          <span className="mt-1 text-base font-semibold text-fg">Ask AI</span>
          <span className="text-[11px] text-fg-muted">Capture by chat</span>
        </button>
      </div>

      {thisWeekMinor !== null && (
        <Link
          to="/money/expenses"
          className={cn(
            glassBubble,
            "flex min-h-11 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-white/10",
          )}
        >
          <span className="text-sm text-fg-muted">This week</span>
          <span className="text-sm font-semibold tabular-nums text-fg">
            {formatMoney(thisWeekMinor, currency)}
          </span>
        </Link>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function MoneyOverview() {
  const { activeFamilyId } = useAuth();
  const [today] = useState(() => todayIsoDate());

  const { data, isLoading } = useQuery({
    queryKey: ["finance", "overview", activeFamilyId, today],
    queryFn: () =>
      api<OverviewData>(`/finance/overview?familyId=${activeFamilyId}&date=${today}&months=6`),
    enabled: Boolean(activeFamilyId),
  });

  const currency = data?.currency ?? "USD";
  const plan = data?.plan;
  const status = plan ? statusMeta(plan.status) : null;

  const paceMinor =
    plan && plan.spendableMinor > 0 && plan.weeks.length > 0
      ? Math.round(plan.spendableMinor / plan.weeks.length)
      : null;

  const thisWeekMinor = useMemo(() => {
    if (!plan?.weeks?.length) return null;
    const week = plan.weeks.find((w) => today >= w.from && today <= w.to);
    return week?.spentMinor ?? plan.weeks[plan.weeks.length - 1]?.spentMinor ?? null;
  }, [plan, today]);

  if (!activeFamilyId) {
    return (
      <>
        <AppBar title="Money" />
        <Page width="list">
          <EmptyState icon={Wallet} title="No family yet" description="You need a family to plan money." />
        </Page>
      </>
    );
  }

  return (
    <>
      <AppBar
        title="Money"
        trailing={
          <Link
            to="/money/settings"
            aria-label="Money settings"
            className="flex size-11 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-white/5 active:scale-95"
          >
            <Settings2 className="size-5" aria-hidden="true" />
          </Link>
        }
      />
      <Page width="list" className="space-y-4 pb-24">
        <MoneySubNav />

        {isLoading || !plan ? (
          <>
            <Card className="p-5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-9 w-44" />
            </Card>
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className={cn(glassBubble, "p-4")}>
                  <Skeleton className="h-10 w-10 rounded-2xl" />
                  <Skeleton className="mt-3 h-4 w-24" />
                </div>
              ))}
            </div>
          </>
        ) : plan.incomeMinor === 0 ? (
          <>
            <PrimaryCtas thisWeekMinor={thisWeekMinor} currency={currency} />
            <EmptyState
              icon={Wallet}
              title="Add your income to see the plan"
              description="Once Family Vault knows what comes in, it can show what's committed, what you can spend, and what's left."
              action={
                <Button onClick={() => (window.location.href = "/money/settings")}>
                  Set up my money
                </Button>
              }
            />
            <LikelyThisWeek familyId={activeFamilyId} currency={currency} />
          </>
        ) : (
          <>
            <Card className="relative overflow-hidden rounded-[28px] border-white/15 bg-white/8 p-5 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -right-8 -top-10 size-40 rounded-full bg-vault-500/25 blur-3xl"
              />
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                    Left to spend
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-3xl font-bold tabular-nums",
                      plan.remainingMinor < 0 ? "text-danger" : "text-fg",
                    )}
                  >
                    {formatMoney(plan.remainingMinor, currency)}
                  </p>
                  <p className="mt-1 text-xs text-fg-muted">
                    of {formatMoney(plan.spendableMinor, currency)} spendable ·{" "}
                    {plan.daysLeft} day{plan.daysLeft === 1 ? "" : "s"} left
                  </p>
                </div>
                {status && <Badge tone={status.tone}>{status.label}</Badge>}
              </div>

              {plan.dailyAllowanceMinor !== null && plan.daysLeft > 0 && (
                <div className="mt-4 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5">
                  <p className="text-xs text-fg-muted">
                    You can spend{" "}
                    <span className="font-semibold text-vault-300">
                      {formatMoney(plan.dailyAllowanceMinor, currency)}
                    </span>{" "}
                    a day and still save{" "}
                    <span className="font-semibold text-fg">
                      {formatMoney(plan.savingsTargetMinor, currency)}
                    </span>
                    .
                  </p>
                </div>
              )}
            </Card>

            <PrimaryCtas thisWeekMinor={thisWeekMinor} currency={currency} />

            <LikelyThisWeek familyId={activeFamilyId} currency={currency} />

            <div className="grid grid-cols-2 gap-3">
              <Figure label="Income" amountMinor={plan.incomeMinor} currency={currency} icon={ArrowUpRight} tone="positive" />
              <Figure label="Committed" amountMinor={plan.committedMinor} currency={currency} icon={Repeat} />
              <Figure label="Spent" amountMinor={plan.spentMinor} currency={currency} icon={ArrowDownRight} />
              <Figure
                label="On track to save"
                amountMinor={plan.projectedSavingsMinor}
                currency={currency}
                icon={PiggyBank}
                tone={plan.projectedSavingsMinor >= 0 ? "positive" : "negative"}
                sub={
                  data?.insights.savingsRateBp !== null && data?.insights.savingsRateBp !== undefined
                    ? `${(data.insights.savingsRateBp / 100).toFixed(0)}% of income`
                    : undefined
                }
              />
            </div>

            {plan.givingMinor > 0 && (
              <Card className="flex items-center gap-3 p-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-m3-purple-bg text-m3-purple">
                  <HandCoins className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">Giving this month</p>
                  <p className="text-xs text-fg-muted">Tithe and sponsorships, set aside first</p>
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-fg">
                  {formatMoney(plan.givingMinor, currency)}
                </p>
              </Card>
            )}

            {data && <AllocationBar data={data} currency={currency} />}

            <WeeklyBars weeks={plan.weeks} currency={currency} paceMinor={paceMinor} />

            {data && data.insights.vsAverageMinor !== null && (
              <Card className="flex items-start gap-3 p-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-m3-blue-bg text-m3-blue">
                  <TrendingUp className="size-5" aria-hidden="true" />
                </span>
                <p className="text-sm text-fg-muted">
                  {data.insights.vsAverageMinor > 0 ? (
                    <>
                      You've spent{" "}
                      <span className="font-semibold text-warning">
                        {formatMoney(data.insights.vsAverageMinor, currency)} more
                      </span>{" "}
                      than your recent monthly average.
                    </>
                  ) : (
                    <>
                      You're{" "}
                      <span className="font-semibold text-success">
                        {formatMoney(Math.abs(data.insights.vsAverageMinor), currency)} under
                      </span>{" "}
                      your recent monthly average. Good month.
                    </>
                  )}
                </p>
              </Card>
            )}

            {data && <TrendChart trend={data.trend} currency={currency} />}

            {plan.dueCommitments.length > 0 && (
              <Card className="overflow-hidden">
                <div className="flex items-center justify-between px-4 pt-4 pb-2">
                  <h2 className="text-sm font-semibold text-fg">Due this cycle</h2>
                  <Link to="/money/commitments" className="text-xs font-medium text-vault-300">
                    Manage
                  </Link>
                </div>
                <ul className="divide-y divide-line">
                  {plan.dueCommitments.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-fg">{c.name}</p>
                        <p className="text-xs text-fg-muted">
                          {KIND_LABEL[c.kind]}
                          {c.dueDates[0] ? ` · due ${formatDayMonth(c.dueDates[0])}` : ""}
                          {c.remaining !== null && c.totalInstallments
                            ? ` · ${c.totalInstallments - c.remaining}/${c.totalInstallments}`
                            : ""}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold tabular-nums text-fg">
                        {formatMoney(c.amountMinor, currency)}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}
      </Page>
    </>
  );
}
