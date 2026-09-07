import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Church,
  HandCoins,
  Plus,
  Receipt,
  UserRound,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { Fab } from "../components/ui/Fab";
import { Chip } from "../components/ui/Chip";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { Sheet } from "../components/ui/Sheet";
import { inputCls } from "../lib/fieldCls";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

type MoneyTab = "expenses" | "settlements";

interface ExpenseSummary {
  id: string;
  amount: number;
  amountCents: number;
  currency: string;
  category: string;
  note: string | null;
  spentOn: string;
}

interface Destination {
  id: string;
  name: string;
  kind: "person" | "organization" | "other";
  settled: number;
  settledCents: number;
  archivedAt: number | null;
}

interface Movement {
  id: string;
  type: "received" | "settled";
  destinationId: string | null;
  destinationName: string | null;
  amount: number;
  amountCents: number;
  currency: string;
  note: string | null;
  movedOn: string;
  createdByName: string | null;
}

interface MoneySummary {
  currency: string;
  available: number;
  settled: number;
  inHand: number;
  availableCents: number;
  settledCents: number;
  inHandCents: number;
  destinations: Destination[];
  movements: Movement[];
}

function formatMoney(amount: number, currency: string): string {
  const formatted = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  if (currency === "INR") return `₹${formatted}`;
  if (currency === "USD") return `$${formatted}`;
  if (currency === "EUR") return `€${formatted}`;
  if (currency === "GBP") return `£${formatted}`;
  return `${formatted} ${currency}`;
}

const CATEGORIES = [
  "food",
  "groceries",
  "transport",
  "household",
  "medical",
  "education",
  "entertainment",
  "travel",
  "other",
] as const;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function Expenses() {
  const { activeFamily } = useAuth();
  const [tab, setTab] = useState<MoneyTab>("settlements");

  return (
    <>
      <AppBar title="Money" back />
      <Page className="space-y-4">
        <SegmentedControl
          label="Money section"
          value={tab}
          onChange={setTab}
          options={[
            { value: "settlements", label: "Settlements" },
            { value: "expenses", label: "Expenses" },
          ]}
        />
        {tab === "settlements" ? (
          <SettlementsPanel familyId={activeFamily?.id} />
        ) : (
          <ExpensesPanel familyId={activeFamily?.id} />
        )}
      </Page>
    </>
  );
}

function ExpensesPanel({ familyId }: { familyId: string | undefined }) {
  const [composerOpen, setComposerOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["expenses", familyId],
    queryFn: () =>
      api<{ expenses: ExpenseSummary[]; total: number }>(
        `/expenses?familyId=${familyId}`,
      ),
    enabled: Boolean(familyId),
  });

  const expenses = data?.expenses ?? [];
  const total = data?.total ?? 0;
  const currency = expenses[0]?.currency ?? "INR";

  return (
    <>
      {isLoading ? (
        <ListSkeleton />
      ) : expenses.length === 0 && !composerOpen ? (
        <EmptyState
          icon={Wallet}
          title="No expenses yet"
          description="Log snacks, groceries, and bills — or just tell the assistant “add 100 for outside snacks”."
          action={
            <Button
              leadingIcon={<Plus className="size-4" />}
              onClick={() => setComposerOpen(true)}
            >
              Add expense
            </Button>
          }
        />
      ) : (
        <>
          <Card className="p-4">
            <div className="text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              All time
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-white">
              {formatMoney(total, currency)}
            </div>
            <div className="mt-0.5 text-xs text-fg-muted">
              {expenses.length} {expenses.length === 1 ? "entry" : "entries"}
            </div>
          </Card>
          <Card className="divide-y divide-white/8 overflow-hidden">
            {expenses.map((e) => (
              <div key={e.id} className="flex min-h-14 items-center gap-3 px-4 py-3">
                <span className="lq lq-flat lq-tint flex size-10 items-center justify-center rounded-full text-vault-300 [--lq-tint:var(--color-vault-400)]">
                  <Receipt className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-fg">
                    {e.note?.trim() || e.category}
                  </div>
                  <div className="mt-0.5 text-xs text-fg-muted">
                    {e.spentOn} · {e.category}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums text-fg">
                    {formatMoney(e.amount, e.currency)}
                  </div>
                  <Badge tone="neutral">{e.category}</Badge>
                </div>
              </div>
            ))}
          </Card>
        </>
      )}

      {composerOpen && familyId && (
        <ExpenseComposer familyId={familyId} onClose={() => setComposerOpen(false)} />
      )}
      <Fab icon={Plus} label="Add expense" onClick={() => setComposerOpen(true)} />
    </>
  );
}

function SettlementsPanel({ familyId }: { familyId: string | undefined }) {
  const [destFilter, setDestFilter] = useState<string>("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<"received" | "settled">("settled");
  const [sheetKey, setSheetKey] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["money-summary", familyId],
    queryFn: () =>
      api<MoneySummary>(`/money/summary?familyId=${familyId}`),
    enabled: Boolean(familyId),
  });

  const currency = data?.currency ?? "INR";
  const destinations = data?.destinations ?? [];
  const movements = (data?.movements ?? []).filter((m) => {
    if (destFilter === "all") return true;
    if (destFilter === "received") return m.type === "received";
    return m.destinationId === destFilter;
  });

  const empty =
    !isLoading &&
    (data?.movements.length ?? 0) === 0 &&
    destinations.length === 0;

  function openSheet(mode: "received" | "settled") {
    setSheetMode(mode);
    setSheetKey((k) => k + 1);
    setSheetOpen(true);
  }

  return (
    <>
      {isLoading ? (
        <ListSkeleton />
      ) : empty ? (
        <EmptyState
          icon={HandCoins}
          title="Track settlements here"
          description="Record fund you received, then log what you settled to Mom, Church, or any destination — all on this page."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                leadingIcon={<ArrowDownLeft className="size-4" />}
                onClick={() => openSheet("received")}
              >
                Add received
              </Button>
              <Button
                variant="secondary"
                leadingIcon={<ArrowUpRight className="size-4" />}
                onClick={() => openSheet("settled")}
              >
                Add settlement
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <Card className="lq-raised space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold tracking-wide text-fg-subtle uppercase">
                  In hand
                </div>
                <div
                  className={`mt-1 text-3xl font-bold tabular-nums ${
                    (data?.inHandCents ?? 0) < 0 ? "text-danger" : "text-white"
                  }`}
                >
                  {formatMoney(data?.inHand ?? 0, currency)}
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<ArrowDownLeft className="size-3.5" />}
                onClick={() => openSheet("received")}
              >
                Received
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
                  Available
                </div>
                <div className="mt-0.5 text-base font-semibold tabular-nums text-fg">
                  {formatMoney(data?.available ?? 0, currency)}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
                  Settled
                </div>
                <div className="mt-0.5 text-base font-semibold tabular-nums text-fg">
                  {formatMoney(data?.settled ?? 0, currency)}
                </div>
              </div>
            </div>
            <p className="text-xs text-fg-muted">
              Available mirrors the full fund. Settlements reduce what you still hold.
            </p>
          </Card>

          <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Chip
              selected={destFilter === "all"}
              onClick={() => setDestFilter("all")}
            >
              All
            </Chip>
            <Chip
              selected={destFilter === "received"}
              onClick={() => setDestFilter("received")}
            >
              Received
            </Chip>
            {destinations.map((d) => (
              <Chip
                key={d.id}
                selected={destFilter === d.id}
                onClick={() => setDestFilter(d.id)}
              >
                {d.name} · {formatMoney(d.settled, currency)}
              </Chip>
            ))}
          </div>

          {movements.length === 0 ? (
            <EmptyState
              icon={HandCoins}
              title="Nothing in this track yet"
              description="Add a settlement or switch back to All."
            />
          ) : (
            <Card className="divide-y divide-white/8 overflow-hidden">
              {movements.map((m) => (
                <MovementRow key={m.id} movement={m} currency={currency} />
              ))}
            </Card>
          )}
        </>
      )}

      {familyId && (
        <SettlementSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          familyId={familyId}
          initialMode={sheetMode}
          destinations={destinations}
          formKey={sheetKey}
        />
      )}

      <Fab
        icon={Plus}
        label="Add settlement"
        onClick={() => openSheet("settled")}
      />
    </>
  );
}

function MovementRow({
  movement,
  currency,
}: {
  movement: Movement;
  currency: string;
}) {
  const isReceived = movement.type === "received";
  const Icon = isReceived
    ? ArrowDownLeft
    : movement.destinationName?.toLowerCase().includes("church")
      ? Church
      : UserRound;

  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3">
      <span
        className={`lq lq-flat lq-tint flex size-10 items-center justify-center rounded-full ${
          isReceived
            ? "text-success [--lq-tint:var(--color-success)]"
            : "text-vault-300 [--lq-tint:var(--color-vault-400)]"
        }`}
      >
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-fg">
          {isReceived
            ? movement.note?.trim() || "Received into fund"
            : `Settled to ${movement.destinationName ?? "destination"}`}
        </div>
        <div className="mt-0.5 text-xs text-fg-muted">
          {movement.movedOn}
          {!isReceived && movement.note?.trim()
            ? ` · ${movement.note.trim()}`
            : ""}
          {movement.createdByName ? ` · ${movement.createdByName}` : ""}
        </div>
      </div>
      <div className="text-right">
        <div
          className={`text-sm font-semibold tabular-nums ${
            isReceived ? "text-success" : "text-fg"
          }`}
        >
          {isReceived ? "+" : "−"}
          {formatMoney(movement.amount, currency)}
        </div>
        <Badge tone={isReceived ? "success" : "neutral"}>
          {isReceived ? "received" : "settled"}
        </Badge>
      </div>
    </div>
  );
}

function SettlementSheet({
  open,
  onClose,
  familyId,
  initialMode,
  destinations,
  formKey,
}: {
  open: boolean;
  onClose: () => void;
  familyId: string;
  initialMode: "received" | "settled";
  destinations: Destination[];
  formKey: number;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Log money">
      {open ? (
        <SettlementForm
          key={formKey}
          familyId={familyId}
          initialMode={initialMode}
          destinations={destinations}
          onClose={onClose}
        />
      ) : null}
    </Sheet>
  );
}

function SettlementForm({
  familyId,
  initialMode,
  destinations,
  onClose,
}: {
  familyId: string;
  initialMode: "received" | "settled";
  destinations: Destination[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"received" | "settled">(initialMode);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [movedOn, setMovedOn] = useState(todayIso);
  const [destinationId, setDestinationId] = useState(
    () => destinations[0]?.id ?? "",
  );
  const [newDestName, setNewDestName] = useState("");
  const [addingDest, setAddingDest] = useState(
    () => destinations.length === 0 && initialMode === "settled",
  );
  const [error, setError] = useState("");

  const createMovement = useMutation({
    mutationFn: async () => {
      let destId = destinationId;
      if (mode === "settled" && addingDest) {
        const name = newDestName.trim();
        if (!name) throw new Error("Enter a destination name.");
        const created = await api<{ destination: Destination }>(
          "/money/destinations",
          {
            method: "POST",
            body: JSON.stringify({
              familyId,
              name,
              kind: inferKind(name),
            }),
          },
        );
        destId = created.destination.id;
      }

      return api("/money/movements", {
        method: "POST",
        body: JSON.stringify({
          familyId,
          type: mode,
          amount: Number(amount),
          note: note.trim() || undefined,
          movedOn,
          ...(mode === "settled" ? { destinationId: destId } : {}),
        }),
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["money-summary"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (mode === "settled") {
      if (addingDest) {
        if (!newDestName.trim()) {
          setError("Enter a destination name.");
          return;
        }
      } else if (!destinationId) {
        setError("Pick or add who you settled to.");
        return;
      }
    }
    setError("");
    createMovement.mutate();
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3 pb-2">
      <SegmentedControl
        label="Entry type"
        value={mode}
        onChange={setMode}
        options={[
          { value: "settled", label: "Settled" },
          { value: "received", label: "Received" },
        ]}
      />

      <div>
        <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
          Amount <span className="text-danger">*</span>
        </label>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="15000"
          autoFocus
          className={inputCls}
        />
      </div>

      {mode === "settled" && (
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="text-xs font-semibold text-fg-muted">
              Settled to <span className="text-danger">*</span>
            </label>
            <button
              type="button"
              className="text-xs font-semibold text-vault-300"
              onClick={() => {
                setAddingDest((v) => !v);
                setError("");
              }}
            >
              {addingDest ? "Pick existing" : "New destination"}
            </button>
          </div>
          {addingDest ? (
            <input
              type="text"
              value={newDestName}
              onChange={(e) => setNewDestName(e.target.value)}
              placeholder="e.g. Mom, Church, Pastor"
              className={inputCls}
            />
          ) : destinations.length === 0 ? (
            <p className="text-xs text-fg-muted">
              No destinations yet — tap “New destination” to add Mom, Church, or anyone else.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {destinations.map((d) => (
                <Chip
                  key={d.id}
                  selected={destinationId === d.id}
                  onClick={() => setDestinationId(d.id)}
                >
                  {d.name}
                </Chip>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
          Date
        </label>
        <input
          type="date"
          value={movedOn}
          onChange={(e) => setMovedOn(e.target.value)}
          className={inputCls}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
          Note
        </label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            mode === "received"
              ? "e.g. August fund from site"
              : "e.g. August support"
          }
          className={inputCls}
        />
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex gap-2 pt-1">
        <Button
          type="submit"
          variant="primary"
          loading={createMovement.isPending}
          className="flex-1"
        >
          {mode === "received" ? "Save received" : "Save settlement"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function inferKind(name: string): "person" | "organization" | "other" {
  const n = name.trim().toLowerCase();
  if (
    n.includes("church") ||
    n.includes("temple") ||
    n.includes("mosque") ||
    n.includes("org")
  ) {
    return "organization";
  }
  if (
    n.includes("mom") ||
    n.includes("dad") ||
    n.includes("pastor") ||
    n.includes("amma") ||
    n.includes("appa")
  ) {
    return "person";
  }
  return "other";
}

function ListSkeleton() {
  return (
    <Card className="divide-y divide-white/8" aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex min-h-14 items-center gap-3 px-4 py-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </Card>
  );
}

function ExpenseComposer({
  familyId,
  onClose,
}: {
  familyId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("food");
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api("/expenses", {
        method: "POST",
        body: JSON.stringify({
          familyId,
          amount: Number(amount),
          category,
          note: note.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["expenses"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setError("");
    create.mutate();
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4">
      <Card className="space-y-3 p-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
            Amount <span className="text-danger">*</span>
          </label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="100"
            autoFocus
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
            What for
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. outside snacks"
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
            Category
          </label>
          <select
            value={category}
            onChange={(e) =>
              setCategory(e.target.value as (typeof CATEGORIES)[number])
            }
            className={inputCls}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={create.isPending} className="flex-1">
            Add expense
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </Card>
    </form>
  );
}
