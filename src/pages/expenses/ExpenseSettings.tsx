import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Archive,
  CalendarDays,
  CalendarRange,
  Coins,
  Shapes,
  Wallet,
} from "lucide-react";
import { AppBar } from "../../components/ui/AppBar";
import { Page } from "../../components/ui/Page";
import { Card } from "../../components/ui/Card";
import { ListItem } from "../../components/ui/ListItem";
import { Sheet } from "../../components/ui/Sheet";
import { Skeleton } from "../../components/ui/Skeleton";
import { useAuth } from "../../context/AuthContext";
import { api, ApiError } from "../../lib/api";
import { cn } from "../../lib/cn";
import {
  WEEKDAYS,
  ordinal,
  useEnsureExpenseSetup,
  type ExpenseSettingsResponse,
} from "../../lib/expenses";
import { CURRENCIES, SUPPORTED_CURRENCY_CODES } from "../../../shared/money";

type Editing = "currency" | "weekStartsOn" | "monthStartDay" | null;

export function ExpenseSettingsPage() {
  const qc = useQueryClient();
  const { activeFamily } = useAuth();
  const familyId = activeFamily?.id;
  const [editing, setEditing] = useState<Editing>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["expense-settings", familyId],
    queryFn: () =>
      api<ExpenseSettingsResponse>(`/expense-settings?familyId=${familyId}`),
    enabled: Boolean(familyId),
  });

  // Opening expense settings for the first time installs the family defaults.
  const { isSettingUp } = useEnsureExpenseSetup(
    familyId,
    Boolean(data) && !data!.initialized,
  );

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api<ExpenseSettingsResponse>("/expense-settings", {
        method: "PATCH",
        body: JSON.stringify({ familyId, ...patch }),
      }),
    onSuccess: (res) => {
      qc.setQueryData(["expense-settings", familyId], res);
      setEditing(null);
    },
  });

  const settings = data?.settings;
  const canEdit = data?.canEdit ?? false;

  if (isLoading || isSettingUp || !settings) {
    return (
      <>
        <AppBar title="Expense settings" back />
        <Page className="space-y-4">
          <Card className="space-y-3 p-4" aria-busy="true">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-2/5" />
          </Card>
          <Card className="space-y-3 p-4">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </Card>
        </Page>
      </>
    );
  }

  const currency = CURRENCIES[settings.defaultCurrency as keyof typeof CURRENCIES];

  const row = (
    key: Exclude<Editing, null>,
    icon: React.ReactNode,
    title: string,
    value: string,
  ) => (
    <ListItem
      leading={icon}
      title={title}
      trailing={
        <button
          onClick={() => canEdit && setEditing(key)}
          disabled={!canEdit}
          aria-label={`Change ${title.toLowerCase()}`}
          className={cn(
            "min-h-11 rounded-lg px-2 text-sm font-medium",
            canEdit ? "text-vault-300 hover:bg-white/5" : "text-fg-muted",
          )}
        >
          {value}
        </button>
      }
    />
  );

  return (
    <>
      <AppBar title="Expense settings" back />
      <Page className="space-y-6">
        <section className="space-y-2">
          <h2 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            Money
          </h2>
          <Card className="divide-y divide-line overflow-hidden">
            {row(
              "currency",
              <Coins className="size-5 text-fg-muted" aria-hidden="true" />,
              "Currency",
              `${settings.defaultCurrency} ${currency?.symbol ?? ""}`.trim(),
            )}
            {row(
              "weekStartsOn",
              <CalendarDays className="size-5 text-fg-muted" aria-hidden="true" />,
              "Week starts",
              WEEKDAYS[settings.weekStartsOn] ?? "Monday",
            )}
            {row(
              "monthStartDay",
              <CalendarRange className="size-5 text-fg-muted" aria-hidden="true" />,
              "Month starts",
              ordinal(settings.monthStartDay),
            )}
          </Card>
          <p className="px-1 text-xs text-fg-subtle">
            {canEdit
              ? "The currency applies to new expenses. Existing expenses keep the currency they were recorded in."
              : "Only family owners and admins can change these."}
          </p>
          {save.isError && (
            <p role="alert" className="px-1 text-xs text-danger">
              {(save.error as ApiError).message}
            </p>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            Organise
          </h2>
          <Card className="divide-y divide-line overflow-hidden">
            <ListItem
              to="/expenses/settings/categories"
              leading={<Shapes className="size-5 text-fg-muted" aria-hidden="true" />}
              title="Categories"
              subtitle="Categories and subcategories"
            />
            <ListItem
              to="/expenses/settings/payment-methods"
              leading={<Wallet className="size-5 text-fg-muted" aria-hidden="true" />}
              title="Payment methods"
              subtitle="Cash, cards, UPI, wallets"
            />
          </Card>
        </section>

        <section className="space-y-2">
          <h2 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            Archived
          </h2>
          <Card className="divide-y divide-line overflow-hidden">
            <ListItem
              to="/expenses/settings/categories?view=archived"
              leading={<Archive className="size-5 text-fg-muted" aria-hidden="true" />}
              title="Archived categories"
            />
            <ListItem
              to="/expenses/settings/payment-methods?view=archived"
              leading={<Archive className="size-5 text-fg-muted" aria-hidden="true" />}
              title="Archived payment methods"
            />
          </Card>
          <p className="px-1 text-xs text-fg-subtle">
            Archived items can't be picked for new expenses, but past expenses
            that use them stay complete.
          </p>
        </section>
      </Page>

      <Sheet
        open={editing === "currency"}
        onClose={() => setEditing(null)}
        title="Default currency"
        description="Used for new expenses. No conversion is applied."
      >
        <OptionList
          options={SUPPORTED_CURRENCY_CODES.map((code) => ({
            value: code,
            label: `${CURRENCIES[code].name} (${CURRENCIES[code].symbol})`,
            hint: code,
          }))}
          selected={settings.defaultCurrency}
          pending={save.isPending}
          onSelect={(value) => save.mutate({ defaultCurrency: value })}
        />
      </Sheet>

      <Sheet
        open={editing === "weekStartsOn"}
        onClose={() => setEditing(null)}
        title="Week starts on"
      >
        <OptionList
          options={WEEKDAYS.map((day, i) => ({ value: String(i), label: day }))}
          selected={String(settings.weekStartsOn)}
          pending={save.isPending}
          onSelect={(value) => save.mutate({ weekStartsOn: Number(value) })}
        />
      </Sheet>

      <Sheet
        open={editing === "monthStartDay"}
        onClose={() => setEditing(null)}
        title="Month starts on"
        description="Set this to your salary date to track spending by pay cycle."
      >
        <div className="grid grid-cols-6 gap-2">
          {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
            <button
              key={day}
              disabled={save.isPending}
              aria-pressed={settings.monthStartDay === day}
              onClick={() => save.mutate({ monthStartDay: day })}
              className={cn(
                "flex min-h-11 items-center justify-center rounded-xl border text-sm font-medium transition-colors disabled:opacity-50",
                settings.monthStartDay === day
                  ? "border-vault-500/40 bg-vault-500/15 text-vault-300"
                  : "border-line text-fg-muted hover:bg-white/5",
              )}
            >
              {day}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}

function OptionList({
  options,
  selected,
  pending,
  onSelect,
}: {
  options: { value: string; label: string; hint?: string }[];
  selected: string;
  pending: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <div role="radiogroup" className="space-y-1">
      {options.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={selected === option.value}
          disabled={pending}
          onClick={() => onSelect(option.value)}
          className={cn(
            "flex min-h-12 w-full items-center gap-3 rounded-xl border px-3.5 text-left text-sm transition-colors disabled:opacity-50",
            selected === option.value
              ? "border-vault-500/40 bg-vault-500/15 text-vault-300"
              : "border-line text-fg hover:bg-white/5",
          )}
        >
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          {option.hint && (
            <span className="shrink-0 text-xs text-fg-subtle">{option.hint}</span>
          )}
        </button>
      ))}
    </div>
  );
}
