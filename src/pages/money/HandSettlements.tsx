import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  HandCoins,
  Plus,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { inputCls as inputClass } from "../../lib/fieldCls";
import { api, ApiError } from "../../lib/api";
import { formatMoney } from "../../lib/money";
import { cn } from "../../lib/cn";

function SelectChip({
  selected,
  onClick,
  children,
}: {
  selected?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "liquid-pill-track inline-flex min-h-8 items-center rounded-full px-3 text-xs font-semibold whitespace-nowrap",
        selected ? "text-white" : "text-fg-muted",
      )}
      style={
        selected
          ? { background: "color-mix(in oklab, var(--color-success, #34d399) 75%, transparent)" }
          : undefined
      }
    >
      {children}
    </button>
  );
}

interface Destination {
  id: string;
  name: string;
  kind: "person" | "organization" | "other";
  settled: number;
  settledCents: number;
}

interface Movement {
  id: string;
  type: "received" | "settled";
  destinationId: string | null;
  destinationName: string | null;
  amount: number;
  currency: string;
  note: string | null;
  movedOn: string;
  createdByName: string | null;
}

interface Summary {
  currency: string;
  available: number;
  settled: number;
  inHand: number;
  inHandCents: number;
  destinations: Destination[];
  movements: Movement[];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function inferKind(name: string): Destination["kind"] {
  const n = name.trim().toLowerCase();
  if (n.includes("church") || n.includes("temple") || n.includes("mosque")) {
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

/**
 * Personal hand ledger on the Funds page — received into the pot, settled out
 * to Mom / Church / any destination. Same page as church fund settle; not a
 * separate route.
 */
export function HandSettlementsPanel({ familyId }: { familyId: string }) {
  const qc = useQueryClient();
  const [destFilter, setDestFilter] = useState("all");
  const [mode, setMode] = useState<"received" | "settled">("settled");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [movedOn, setMovedOn] = useState(todayIso);
  const [destinationId, setDestinationId] = useState("");
  const [newDestName, setNewDestName] = useState("");
  const [addingDest, setAddingDest] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summaryQ = useQuery({
    queryKey: ["settlements", "summary", familyId],
    queryFn: () =>
      api<Summary>(`/settlements/summary?familyId=${familyId}`),
  });

  const currency = summaryQ.data?.currency ?? "INR";
  const destinations = summaryQ.data?.destinations ?? [];
  const movements = (summaryQ.data?.movements ?? []).filter((m) => {
    if (destFilter === "all") return true;
    if (destFilter === "received") return m.type === "received";
    return m.destinationId === destFilter;
  });

  const create = useMutation({
    mutationFn: async () => {
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error("Enter an amount greater than zero.");
      }
      let destId = destinationId;
      if (mode === "settled") {
        if (addingDest || !destId) {
          const name = newDestName.trim();
          if (!name) throw new Error("Enter who you settled to (e.g. Mom).");
          const created = await api<{ destination: Destination }>(
            "/settlements/destinations",
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
      }
      return api("/settlements/movements", {
        method: "POST",
        body: JSON.stringify({
          familyId,
          type: mode,
          amount: n,
          note: note.trim() || undefined,
          movedOn,
          ...(mode === "settled" ? { destinationId: destId } : {}),
        }),
      });
    },
    onSuccess: async () => {
      setAmount("");
      setNote("");
      setNewDestName("");
      setAddingDest(false);
      setFormOpen(false);
      setError(null);
      await qc.invalidateQueries({ queryKey: ["settlements"] });
    },
    onError: (e: unknown) => {
      setError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : "Could not save.",
      );
    },
  });

  if (summaryQ.isLoading) {
    return (
      <Card className="space-y-3 p-4" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-2/3" />
      </Card>
    );
  }

  const empty =
    (summaryQ.data?.movements.length ?? 0) === 0 && destinations.length === 0;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-sm text-fg-muted">
          Track money you hold and what you have already settled — to Mom,
          Church, the pastor, or anyone else. Received is the full fund logged
          here; settlements reduce what you still have in hand.
        </p>
      </Card>

      {empty && !formOpen ? (
        <EmptyState
          icon={HandCoins}
          title="No hand settlements yet"
          description="Log fund you received, then record when you give it to Mom or Church."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                leadingIcon={<ArrowDownLeft className="size-4" />}
                onClick={() => {
                  setMode("received");
                  setFormOpen(true);
                }}
              >
                Add received
              </Button>
              <Button
                variant="secondary"
                leadingIcon={<ArrowUpRight className="size-4" />}
                onClick={() => {
                  setMode("settled");
                  setAddingDest(true);
                  setFormOpen(true);
                }}
              >
                Add settlement
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <Card className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
                  In hand
                </div>
                <div
                  className={`mt-1 text-3xl font-bold tabular-nums ${
                    (summaryQ.data?.inHandCents ?? 0) < 0
                      ? "text-danger"
                      : "text-fg"
                  }`}
                >
                  {formatMoney(
                    Math.round((summaryQ.data?.inHand ?? 0) * 100),
                    currency,
                  )}
                </div>
              </div>
              <Button
                variant="secondary"
                leadingIcon={<Plus className="size-3.5" />}
                onClick={() => setFormOpen(true)}
              >
                Log
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
                  Received
                </div>
                <div className="mt-0.5 text-base font-semibold tabular-nums text-fg">
                  {formatMoney(
                    Math.round((summaryQ.data?.available ?? 0) * 100),
                    currency,
                  )}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
                  Settled
                </div>
                <div className="mt-0.5 text-base font-semibold tabular-nums text-fg">
                  {formatMoney(
                    Math.round((summaryQ.data?.settled ?? 0) * 100),
                    currency,
                  )}
                </div>
              </div>
            </div>
          </Card>

          <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <SelectChip
              selected={destFilter === "all"}
              onClick={() => setDestFilter("all")}
            >
              All
            </SelectChip>
            <SelectChip
              selected={destFilter === "received"}
              onClick={() => setDestFilter("received")}
            >
              Received
            </SelectChip>
            {destinations.map((d) => (
              <SelectChip
                key={d.id}
                selected={destFilter === d.id}
                onClick={() => setDestFilter(d.id)}
              >
                {d.name} ·{" "}
                {formatMoney(Math.round(d.settled * 100), currency)}
              </SelectChip>
            ))}
          </div>

          {movements.length === 0 ? (
            <EmptyState
              icon={HandCoins}
              title="Nothing in this track yet"
              description="Add a settlement or switch back to All."
            />
          ) : (
            <Card className="divide-y divide-line overflow-hidden">
              {movements.map((m) => {
                const isReceived = m.type === "received";
                return (
                  <div
                    key={m.id}
                    className="flex min-h-14 items-center gap-3 px-4 py-3"
                  >
                    <span className="flex size-10 items-center justify-center rounded-full bg-white/6 text-fg-muted">
                      {isReceived ? (
                        <ArrowDownLeft className="size-5 text-emerald-300" />
                      ) : (
                        <UserRound className="size-5" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-fg">
                        {isReceived
                          ? m.note?.trim() || "Received into fund"
                          : `Settled to ${m.destinationName ?? "destination"}`}
                      </div>
                      <div className="mt-0.5 text-xs text-fg-muted">
                        {m.movedOn}
                        {!isReceived && m.note?.trim()
                          ? ` · ${m.note.trim()}`
                          : ""}
                        {m.createdByName ? ` · ${m.createdByName}` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`text-sm font-semibold tabular-nums ${
                          isReceived ? "text-emerald-300" : "text-fg"
                        }`}
                      >
                        {isReceived ? "+" : "−"}
                        {formatMoney(Math.round(m.amount * 100), m.currency)}
                      </div>
                      <Badge tone={isReceived ? "success" : "neutral"}>
                        {isReceived ? "received" : "settled"}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </Card>
          )}
        </>
      )}

      {formOpen && (
        <Card className="space-y-3 p-4">
          <div className="flex gap-2">
            <SelectChip
              selected={mode === "settled"}
              onClick={() => setMode("settled")}
            >
              Settled
            </SelectChip>
            <SelectChip
              selected={mode === "received"}
              onClick={() => setMode("received")}
            >
              Received
            </SelectChip>
          </div>
          <label className="text-xs font-medium text-fg-subtle">
            Amount (₹)
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
            className={inputClass}
          />
          {mode === "settled" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-fg-subtle">
                  Settled to
                </label>
                <button
                  type="button"
                  className="text-xs font-semibold text-emerald-300"
                  onClick={() => setAddingDest((v) => !v)}
                >
                  {addingDest ? "Pick existing" : "New destination"}
                </button>
              </div>
              {addingDest || destinations.length === 0 ? (
                <input
                  type="text"
                  value={newDestName}
                  onChange={(e) => {
                    setNewDestName(e.target.value);
                    setAddingDest(true);
                  }}
                  placeholder="e.g. Mom, Church, Pastor"
                  className={inputClass}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {destinations.map((d) => (
                    <SelectChip
                      key={d.id}
                      selected={destinationId === d.id}
                      onClick={() => setDestinationId(d.id)}
                    >
                      {d.name}
                    </SelectChip>
                  ))}
                </div>
              )}
            </div>
          )}
          <label className="text-xs font-medium text-fg-subtle">Date</label>
          <input
            type="date"
            value={movedOn}
            onChange={(e) => setMovedOn(e.target.value)}
            className={inputClass}
          />
          <label className="text-xs font-medium text-fg-subtle">Note</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              mode === "received"
                ? "e.g. August fund from site"
                : "e.g. August support"
            }
            className={inputClass}
          />
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              className="flex-1"
              loading={create.isPending}
              onClick={() => create.mutate()}
            >
              {mode === "received" ? "Save received" : "Save settlement"}
            </Button>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
