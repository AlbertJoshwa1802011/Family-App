import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Users } from "lucide-react";
import { AppBar } from "../../components/ui/AppBar";
import { Page } from "../../components/ui/Page";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Skeleton";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";
import { formatMajorFromMinor, parseMajorToMinor, todayIsoDate } from "../../lib/money";
import { CADENCES, COMMITMENT_KINDS, type Cadence, type Commitment, type CommitmentKind } from "../../lib/finance";
import { cn } from "../../lib/cn";

const inputClass =
  "w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none";

export function CommitmentForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const { activeFamilyId } = useAuth();

  const existingQ = useQuery({
    queryKey: ["finance", "commitments", activeFamilyId],
    queryFn: () => api<{ commitments: Commitment[] }>(`/finance/commitments?familyId=${activeFamilyId}`),
    enabled: Boolean(activeFamilyId) && isEdit,
  });

  if (isEdit && existingQ.isLoading) {
    return (
      <>
        <AppBar title="Edit commitment" back />
        <Page>
          <Card className="space-y-3 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </Card>
        </Page>
      </>
    );
  }

  const existing = existingQ.data?.commitments.find((c) => c.id === id) ?? null;
  return <Fields key={existing?.id ?? "new"} id={id} existing={existing} />;
}

function Fields({ id, existing }: { id?: string; existing: Commitment | null }) {
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeFamilyId } = useAuth();
  const [today] = useState(() => todayIsoDate());

  const settingsQ = useQuery({
    queryKey: ["finance", "settings", activeFamilyId],
    queryFn: () => api<{ currency: string }>(`/finance/settings?familyId=${activeFamilyId}`),
    enabled: Boolean(activeFamilyId),
  });
  const currency = existing?.currency ?? settingsQ.data?.currency ?? "USD";

  const [kind, setKind] = useState<CommitmentKind>(() => existing?.kind ?? "emi");
  const [name, setName] = useState(() => existing?.name ?? "");
  const [amountKind, setAmountKind] = useState<"fixed" | "percent_of_income">(
    () => existing?.amountKind ?? "fixed",
  );
  const [amount, setAmount] = useState(() =>
    existing?.amountMinor != null ? formatMajorFromMinor(existing.amountMinor, currency) : "",
  );
  const [percent, setPercent] = useState(() =>
    existing?.percentBp != null ? String(existing.percentBp / 100) : "10",
  );
  const [cadence, setCadence] = useState<Cadence>(() => existing?.cadence ?? "monthly");
  const [dayOfMonth, setDayOfMonth] = useState(() => String(existing?.dayOfMonth ?? 1));
  const [startDate, setStartDate] = useState(() => existing?.startDate ?? today);
  const [totalInstallments, setTotalInstallments] = useState(() =>
    existing?.totalInstallments != null ? String(existing.totalInstallments) : "",
  );
  const [autoLog, setAutoLog] = useState(() => existing?.autoLog ?? false);
  const [remindDaysBefore, setRemindDaysBefore] = useState(() =>
    String(existing?.remindDaysBefore ?? 3),
  );
  const [visibility, setVisibility] = useState<"family" | "private">(
    () => existing?.visibility ?? "private",
  );
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Give this commitment a name.");

      const body: Record<string, unknown> = {
        kind,
        name: name.trim(),
        amountKind,
        currency,
        cadence,
        dayOfMonth: Number(dayOfMonth) || 1,
        startDate,
        totalInstallments: totalInstallments ? Number(totalInstallments) : null,
        autoLog,
        remindDaysBefore: Number(remindDaysBefore) || 0,
        visibility,
      };

      if (amountKind === "fixed") {
        const minor = parseMajorToMinor(amount, currency);
        if (minor === null || minor <= 0) throw new Error("Enter a valid amount.");
        body.amountMinor = minor;
      } else {
        const pct = Number(percent);
        if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
          throw new Error("Enter a percentage between 0 and 100.");
        }
        body.percentBp = Math.round(pct * 100);
      }

      if (isEdit) {
        return api(`/finance/commitments/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      }
      return api("/finance/commitments", {
        method: "POST",
        body: JSON.stringify({ ...body, familyId: activeFamilyId }),
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["finance"] });
      navigate("/money/commitments", { replace: true });
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Could not save this commitment."),
  });

  const kindMeta = COMMITMENT_KINDS.find((k) => k.value === kind);

  return (
    <>
      <AppBar title={isEdit ? "Edit commitment" : "New commitment"} back />
      <Page className="pb-24">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            save.mutate();
          }}
          className="space-y-4"
        >
          {/* Kind */}
          <Card className="p-4">
            <p className="text-xs font-medium text-fg-subtle">What kind of commitment?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {COMMITMENT_KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setKind(k.value)}
                  aria-pressed={kind === k.value}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    kind === k.value
                      ? "border-vault-500/40 bg-vault-500/15 text-vault-300"
                      : "border-line text-fg-muted hover:bg-white/5",
                  )}
                >
                  {k.label}
                </button>
              ))}
            </div>
            {kindMeta && <p className="mt-2 text-[11px] text-fg-subtle">{kindMeta.hint}</p>}
          </Card>

          <Card className="space-y-4 p-4">
            <div>
              <label htmlFor="name" className="text-xs font-medium text-fg-subtle">
                Name
              </label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={kind === "giving" ? "Tithe" : "Home loan EMI"}
                maxLength={120}
                autoFocus={!isEdit}
                className={cn(inputClass, "mt-1")}
              />
            </div>

            {/* Fixed vs percentage — giving is usually a share of income. */}
            <div>
              <p className="text-xs font-medium text-fg-subtle">Amount</p>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAmountKind("fixed")}
                  aria-pressed={amountKind === "fixed"}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-xs font-medium transition-colors",
                    amountKind === "fixed"
                      ? "border-vault-500/40 bg-vault-500/10 text-vault-300"
                      : "border-line text-fg-muted hover:bg-white/5",
                  )}
                >
                  Fixed amount
                </button>
                <button
                  type="button"
                  onClick={() => setAmountKind("percent_of_income")}
                  aria-pressed={amountKind === "percent_of_income"}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-xs font-medium transition-colors",
                    amountKind === "percent_of_income"
                      ? "border-vault-500/40 bg-vault-500/10 text-vault-300"
                      : "border-line text-fg-muted hover:bg-white/5",
                  )}
                >
                  % of income
                </button>
              </div>

              {amountKind === "fixed" ? (
                <div className="mt-2">
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    aria-label={`Amount in ${currency}`}
                    className={cn(inputClass, "text-lg font-semibold tabular-nums")}
                  />
                  <p className="mt-1 text-[11px] text-fg-subtle">{currency}</p>
                </div>
              ) : (
                <div className="mt-2">
                  <input
                    inputMode="decimal"
                    value={percent}
                    onChange={(e) => setPercent(e.target.value)}
                    placeholder="10"
                    aria-label="Percentage of income"
                    className={cn(inputClass, "text-lg font-semibold tabular-nums")}
                  />
                  <p className="mt-1 text-[11px] text-fg-subtle">
                    % of the income recorded for each cycle
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="cadence" className="text-xs font-medium text-fg-subtle">
                  How often
                </label>
                <select
                  id="cadence"
                  value={cadence}
                  onChange={(e) => setCadence(e.target.value as Cadence)}
                  className={cn(inputClass, "mt-1")}
                >
                  {CADENCES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="dom" className="text-xs font-medium text-fg-subtle">
                  Day of month
                </label>
                <input
                  id="dom"
                  inputMode="numeric"
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(e.target.value)}
                  className={cn(inputClass, "mt-1")}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="start" className="text-xs font-medium text-fg-subtle">
                  Starts
                </label>
                <input
                  id="start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={cn(inputClass, "mt-1")}
                />
              </div>
              <div>
                <label htmlFor="inst" className="text-xs font-medium text-fg-subtle">
                  Instalments
                </label>
                <input
                  id="inst"
                  inputMode="numeric"
                  value={totalInstallments}
                  onChange={(e) => setTotalInstallments(e.target.value)}
                  placeholder="e.g. 60"
                  className={cn(inputClass, "mt-1")}
                />
                <p className="mt-1 text-[11px] text-fg-subtle">Leave blank if ongoing</p>
              </div>
            </div>
          </Card>

          <Card className="space-y-4 p-4">
            <div>
              <label htmlFor="remind" className="text-xs font-medium text-fg-subtle">
                Remind me this many days before
              </label>
              <input
                id="remind"
                inputMode="numeric"
                value={remindDaysBefore}
                onChange={(e) => setRemindDaysBefore(e.target.value)}
                className={cn(inputClass, "mt-1")}
              />
              <p className="mt-1 text-[11px] text-fg-subtle">
                Sent by email and in-app, on schedule — you don't need to open the app.
              </p>
            </div>

            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={autoLog}
                onChange={(e) => setAutoLog(e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--color-vault-500)]"
              />
              <span>
                <span className="block text-sm font-medium text-fg">Record it automatically</span>
                <span className="block text-[11px] text-fg-subtle">
                  Add the expense on the due date without asking. Only for fixed amounts.
                </span>
              </span>
            </label>
          </Card>

          <Card className="p-4">
            <p className="text-xs font-medium text-fg-subtle">Who can see this</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {([
                { key: "private" as const, label: "Only me", icon: Lock },
                { key: "family" as const, label: "My family", icon: Users },
              ]).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setVisibility(key)}
                  aria-pressed={visibility === key}
                  className={cn(
                    "flex items-center gap-1.5 rounded-xl border p-3 transition-colors",
                    visibility === key
                      ? "border-vault-500/40 bg-vault-500/10 text-vault-300"
                      : "border-line text-fg hover:bg-white/5",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  <span className="text-sm font-medium">{label}</span>
                </button>
              ))}
            </div>
          </Card>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="secondary" fullWidth onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" fullWidth loading={save.isPending}>
              {isEdit ? "Save changes" : "Add commitment"}
            </Button>
          </div>
        </form>
      </Page>
    </>
  );
}
