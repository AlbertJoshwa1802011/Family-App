import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Plus, Trash2, Wallet } from "lucide-react";
import { AppBar } from "../../components/ui/AppBar";
import { Page } from "../../components/ui/Page";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Skeleton } from "../../components/ui/Skeleton";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";
import { formatMajorFromMinor, formatMoney, parseMajorToMinor, todayIsoDate } from "../../lib/money";
import type { Income } from "../../lib/finance";
import { cn } from "../../lib/cn";

const inputClass =
  "w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none";

interface Settings {
  savingsTargetKind: "none" | "amount" | "percent";
  savingsTargetMinor: number | null;
  savingsTargetPercentBp: number | null;
  paydayDayOfMonth: number;
}

interface Prefs {
  emailEnabled: boolean;
  windows: number[];
  reminderEmail: string | null;
}

const INCOME_CADENCES = [
  { value: "monthly", label: "Every month" },
  { value: "weekly", label: "Every week" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "yearly", label: "Every year" },
  { value: "one_off", label: "One-off" },
] as const;

export function MoneySettings() {
  const { activeFamilyId } = useAuth();
  const qc = useQueryClient();
  const [today] = useState(() => todayIsoDate());
  const [addIncomeOpen, setAddIncomeOpen] = useState(false);

  const settingsQ = useQuery({
    queryKey: ["finance", "settings", activeFamilyId],
    queryFn: () =>
      api<{ settings: Settings; currency: string }>(`/finance/settings?familyId=${activeFamilyId}`),
    enabled: Boolean(activeFamilyId),
  });
  const incomesQ = useQuery({
    queryKey: ["finance", "incomes", activeFamilyId],
    queryFn: () => api<{ incomes: Income[] }>(`/finance/incomes?familyId=${activeFamilyId}`),
    enabled: Boolean(activeFamilyId),
  });
  const prefsQ = useQuery({
    queryKey: ["reminder-prefs"],
    queryFn: () => api<{ prefs: Prefs }>("/notifications/prefs"),
  });

  const currency = settingsQ.data?.currency ?? "USD";

  if (settingsQ.isLoading || !settingsQ.data) {
    return (
      <>
        <AppBar title="Money settings" back />
        <Page className="space-y-4">
          <Card className="space-y-3 p-4">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-10 w-full" />
          </Card>
        </Page>
      </>
    );
  }

  return (
    <>
      <AppBar title="Money settings" back />
      <Page className="space-y-4 pb-24">
        <CurrencySection
          currency={currency}
          familyId={activeFamilyId!}
          onSaved={() => qc.invalidateQueries({ queryKey: ["finance"] })}
        />

        <IncomeSection
          incomes={incomesQ.data?.incomes ?? []}
          currency={currency}
          loading={incomesQ.isLoading}
          onAdd={() => setAddIncomeOpen(true)}
          onDeleted={() => qc.invalidateQueries({ queryKey: ["finance"] })}
        />

        <PlanSection
          key={settingsQ.data.settings.savingsTargetKind + settingsQ.data.settings.paydayDayOfMonth}
          initial={settingsQ.data.settings}
          currency={currency}
          familyId={activeFamilyId!}
          onSaved={() => qc.invalidateQueries({ queryKey: ["finance"] })}
        />

        {prefsQ.data && (
          <ReminderSection
            key={prefsQ.data.prefs.reminderEmail ?? "none"}
            initial={prefsQ.data.prefs}
            onSaved={() => qc.invalidateQueries({ queryKey: ["reminder-prefs"] })}
          />
        )}
      </Page>

      <AddIncomeModal
        open={addIncomeOpen}
        onClose={() => setAddIncomeOpen(false)}
        familyId={activeFamilyId!}
        currency={currency}
        today={today}
        onAdded={() => {
          setAddIncomeOpen(false);
          qc.invalidateQueries({ queryKey: ["finance"] });
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "INR",
  "CAD",
  "AUD",
  "JPY",
  "SGD",
  "AED",
  "CHF",
] as const;

function CurrencySection({
  currency,
  familyId,
  onSaved,
}: {
  currency: string;
  familyId: string;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(currency);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      api(`/families/${familyId}`, {
        method: "PATCH",
        body: JSON.stringify({ defaultCurrency: value }),
      }),
    onSuccess: () => {
      setSaved(true);
      onSaved();
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Could not update currency."),
  });

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold text-fg">Currency</h2>
        <p className="text-xs text-fg-muted">
          Family default for new incomes and expenses. Existing entries keep their
          original currency — nothing is auto-converted.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {CURRENCIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              setValue(c);
              setSaved(false);
            }}
            aria-pressed={value === c}
            className={cn(
              "min-h-11 min-w-[4.5rem] rounded-xl border px-3 py-2 text-sm font-semibold transition-colors",
              value === c
                ? "border-vault-500/50 bg-vault-500/15 text-vault-300"
                : "border-line text-fg-muted hover:bg-white/5",
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {value !== "USD" && (
        <p className="text-xs text-fg-muted">
          Prefer dollars? Tap <span className="font-semibold text-fg">USD</span> above.
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <Button
        fullWidth
        loading={save.isPending}
        disabled={value === currency && saved}
        onClick={() => {
          setError(null);
          save.mutate();
        }}
      >
        {saved && value === currency ? "Saved" : `Use ${value}`}
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function IncomeSection({
  incomes,
  currency,
  loading,
  onAdd,
  onDeleted,
}: {
  incomes: Income[];
  currency: string;
  loading: boolean;
  onAdd: () => void;
  onDeleted: () => void;
}) {
  const remove = useMutation({
    mutationFn: (id: string) => api(`/finance/incomes/${id}`, { method: "DELETE" }),
    onSuccess: onDeleted,
  });

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <h2 className="text-sm font-semibold text-fg">Income</h2>
          <p className="text-xs text-fg-muted">What comes in, and how often</p>
        </div>
        <Button size="md" variant="secondary" leadingIcon={<Plus className="size-4" />} onClick={onAdd}>
          Add
        </Button>
      </div>

      {loading ? (
        <div className="px-4 pb-4">
          <Skeleton className="h-10 w-full" />
        </div>
      ) : incomes.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-fg-subtle">
          Add your salary so the plan knows what it's working with.
        </p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {incomes.map((inc) => (
            <li key={inc.id} className="flex items-center gap-3 px-4 py-3">
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-m3-green-bg text-m3-green"
                aria-hidden="true"
              >
                <Wallet className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{inc.label}</p>
                <p className="text-xs text-fg-muted">
                  {INCOME_CADENCES.find((c) => c.value === inc.cadence)?.label ?? inc.cadence}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-fg">
                {formatMoney(inc.amountMinor, currency)}
              </span>
              <button
                type="button"
                aria-label={`Delete ${inc.label}`}
                onClick={() => remove.mutate(inc.id)}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function PlanSection({
  initial,
  currency,
  familyId,
  onSaved,
}: {
  initial: Settings;
  currency: string;
  familyId: string;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState(initial.savingsTargetKind);
  const [amount, setAmount] = useState(() =>
    initial.savingsTargetMinor != null ? formatMajorFromMinor(initial.savingsTargetMinor, currency) : "",
  );
  const [percent, setPercent] = useState(() =>
    initial.savingsTargetPercentBp != null ? String(initial.savingsTargetPercentBp / 100) : "20",
  );
  const [payday, setPayday] = useState(String(initial.paydayDayOfMonth));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        familyId,
        savingsTargetKind: kind,
        paydayDayOfMonth: Math.min(Math.max(Number(payday) || 1, 1), 28),
      };
      if (kind === "amount") {
        const minor = parseMajorToMinor(amount, currency);
        if (minor === null || minor < 0) throw new Error("Enter a valid savings amount.");
        body.savingsTargetMinor = minor;
      }
      if (kind === "percent") {
        const pct = Number(percent);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
          throw new Error("Enter a percentage between 0 and 100.");
        }
        body.savingsTargetPercentBp = Math.round(pct * 100);
      }
      return api("/finance/settings", { method: "PUT", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      setSaved(true);
      onSaved();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Could not save."),
  });

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold text-fg">Savings goal</h2>
        <p className="text-xs text-fg-muted">
          What's left after this is what you can safely spend.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {([
          { value: "none", label: "No goal" },
          { value: "amount", label: "An amount" },
          { value: "percent", label: "% of income" },
        ] as const).map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => { setKind(opt.value); setSaved(false); }}
            aria-pressed={kind === opt.value}
            className={cn(
              "rounded-xl border px-2 py-2 text-xs font-medium transition-colors",
              kind === opt.value
                ? "border-vault-500/40 bg-vault-500/10 text-vault-300"
                : "border-line text-fg-muted hover:bg-white/5",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {kind === "amount" && (
        <div>
          <label htmlFor="target-amt" className="text-xs font-medium text-fg-subtle">
            Save each month ({currency})
          </label>
          <input
            id="target-amt"
            inputMode="decimal"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setSaved(false); }}
            placeholder="0.00"
            className={cn(inputClass, "mt-1 tabular-nums")}
          />
        </div>
      )}

      {kind === "percent" && (
        <div>
          <label htmlFor="target-pct" className="text-xs font-medium text-fg-subtle">
            Save this much of income (%)
          </label>
          <input
            id="target-pct"
            inputMode="decimal"
            value={percent}
            onChange={(e) => { setPercent(e.target.value); setSaved(false); }}
            className={cn(inputClass, "mt-1 tabular-nums")}
          />
        </div>
      )}

      <div>
        <label htmlFor="payday" className="text-xs font-medium text-fg-subtle">
          Payday (day of month)
        </label>
        <input
          id="payday"
          inputMode="numeric"
          value={payday}
          onChange={(e) => { setPayday(e.target.value); setSaved(false); }}
          className={cn(inputClass, "mt-1 tabular-nums")}
        />
        <p className="mt-1 text-[11px] text-fg-subtle">
          The month runs payday to payday, so "this month" means since you were last paid.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <Button
        fullWidth
        loading={save.isPending}
        onClick={() => { setError(null); save.mutate(); }}
      >
        {saved ? "Saved" : "Save plan"}
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function ReminderSection({ initial, onSaved }: { initial: Prefs; onSaved: () => void }) {
  const [email, setEmail] = useState(initial.reminderEmail ?? "");
  const [enabled, setEnabled] = useState(initial.emailEnabled);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api("/notifications/prefs", {
        method: "PUT",
        body: JSON.stringify({ reminderEmail: email.trim(), emailEnabled: enabled }),
      }),
    onSuccess: () => {
      setSaved(true);
      onSaved();
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Could not save that address."),
  });

  const testEmail = useMutation({
    mutationFn: () =>
      api<{ ok: true; to: string }>("/notifications/test-email", { method: "POST" }),
    onSuccess: (res) => setTestMsg(`Sent to ${res.to}`),
    onError: (e: unknown) =>
      setTestMsg(e instanceof Error ? e.message : "Could not send test email."),
  });

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-start gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-m3-blue-bg text-m3-blue"
          aria-hidden="true"
        >
          <Mail className="size-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-fg">Reminder emails</h2>
          <p className="text-xs text-fg-muted">
            Sent on a daily schedule by the server — you don't need to open the app.
          </p>
        </div>
      </div>

      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }}
          className="size-4 accent-[var(--color-vault-500)]"
        />
        <span className="text-sm text-fg">Email me reminders</span>
      </label>

      <div>
        <label htmlFor="reminder-email" className="text-xs font-medium text-fg-subtle">
          Send them to
        </label>
        <input
          id="reminder-email"
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setSaved(false); }}
          placeholder="you@example.com"
          className={cn(inputClass, "mt-1")}
        />
        <p className="mt-1 text-[11px] text-fg-subtle">
          Leave blank to use the address you sign in with.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <Button
        fullWidth
        variant="secondary"
        loading={save.isPending}
        onClick={() => { setError(null); save.mutate(); }}
      >
        {saved ? "Saved" : "Save reminder settings"}
      </Button>

      <Button
        fullWidth
        variant="ghost"
        loading={testEmail.isPending}
        onClick={() => {
          setTestMsg(null);
          testEmail.mutate();
        }}
      >
        Send test email
      </Button>
      {testMsg && (
        <p className="text-xs text-fg-muted" role="status">
          {testMsg}
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function AddIncomeModal({
  open,
  onClose,
  familyId,
  currency,
  today,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  familyId: string;
  currency: string;
  today: string;
  onAdded: () => void;
}) {
  const [label, setLabel] = useState("Salary");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState<(typeof INCOME_CADENCES)[number]["value"]>("monthly");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const minor = parseMajorToMinor(amount, currency);
      if (!label.trim()) throw new Error("Give this income a name.");
      if (minor === null || minor <= 0) throw new Error("Enter a valid amount.");
      return api("/finance/incomes", {
        method: "POST",
        body: JSON.stringify({
          familyId,
          label: label.trim(),
          amountMinor: minor,
          currency,
          cadence,
          startDate: today,
        }),
      });
    },
    onSuccess: () => {
      setAmount("");
      onAdded();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Could not add it."),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add income"
      footer={
        <>
          <Button variant="secondary" fullWidth onClick={onClose}>
            Cancel
          </Button>
          <Button fullWidth loading={create.isPending} onClick={() => { setError(null); create.mutate(); }}>
            Add
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label htmlFor="inc-label" className="text-xs font-medium text-fg-subtle">
            Name
          </label>
          <input
            id="inc-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={cn(inputClass, "mt-1")}
          />
        </div>
        <div>
          <label htmlFor="inc-amt" className="text-xs font-medium text-fg-subtle">
            Amount ({currency})
          </label>
          <input
            id="inc-amt"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className={cn(inputClass, "mt-1 text-lg font-semibold tabular-nums")}
          />
        </div>
        <div>
          <label htmlFor="inc-cad" className="text-xs font-medium text-fg-subtle">
            How often
          </label>
          <select
            id="inc-cad"
            value={cadence}
            onChange={(e) => setCadence(e.target.value as typeof cadence)}
            className={cn(inputClass, "mt-1")}
          >
            {INCOME_CADENCES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
