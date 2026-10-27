import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Church, HandCoins, RefreshCw, UserRound, Wallet } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { Sheet } from "../../components/ui/Sheet";
import { Field, Input, Select, Textarea } from "../../components/ui/Field";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { api, ApiError } from "../../lib/api";
import { formatMoney } from "../../lib/money";
import { cn } from "../../lib/cn";

/**
 * Church funds: website payment → with you → settled to someone (Mom) →
 * handed to church. Every figure is recomputed by the server from live
 * contributions-site totals on each fetch (see worker/lib/churchLedger.ts).
 */

interface ChurchFund {
  slug: string;
  name: string;
  collectedMinor: number;
  purchasesMinor: number;
  settledMinor: number;
  withYouMinor: number;
  overSettledMinor: number;
  lastSettledAt: number | null;
}

interface Holder {
  recipientId: string | null;
  name: string;
  receivedMinor: number;
  handedOverMinor: number;
  holdingMinor: number;
  openCount: number;
  lastSettledAt: number | null;
  byFund: { fundSlug: string; fundName: string; holdingMinor: number; receivedMinor: number }[];
}

interface Recipient {
  id: string;
  name: string;
}

interface Settlement {
  id: string;
  fundSlug: string;
  fundName: string;
  paidMinor: number;
  settledAt: number;
  recipientId: string | null;
  recipientName: string | null;
  handedOverAt: number | null;
  settledByName: string | null;
  note: string | null;
}

interface Snapshot {
  fetchedAt: number;
  totals: {
    collectedMinor: number;
    settledMinor: number;
    withYouMinor: number;
    withRecipientsMinor: number;
    givenToChurchMinor: number;
  };
  funds: ChurchFund[];
  holders: Holder[];
  recipients: Recipient[];
  settlements: Settlement[];
  purchases: { id: string; name: string; amount: number; date: string; fund: string; status: string }[];
}

const NEW_RECIPIENT = "__new__";
const inr = (minor: number) => formatMoney(minor, "INR");

const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });

function formatInstant(unixSeconds: number): string {
  return dateTimeFmt.format(new Date(unixSeconds * 1000));
}

/** unix seconds → a datetime-local field value, in the device’s zone. */
function toLocalInput(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value (device-local wall time) → unix seconds. */
function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function parseRupees(raw: string): number | null {
  const cleaned = raw.replace(/[,₹\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function errorText(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.code === "recipient_archived") return "That person was removed. Pick someone else.";
    if (e.code === "invalid_recipient_id") return "Pick who you gave the money to.";
    if (e.code === "nothing_to_hand_over") return "Nothing left to hand over.";
    return e.message || fallback;
  }
  return e instanceof Error ? e.message : fallback;
}

export function ChurchSettlementsPanel({
  familyId,
  isPlatformAdmin,
}: {
  familyId: string;
  isPlatformAdmin: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Settlement | null>(null);
  const [handoverFor, setHandoverFor] = useState<Holder | null>(null);

  const snapQ = useQuery({
    queryKey: ["church", "snapshot", familyId],
    queryFn: () => api<Snapshot>(`/church/snapshot?familyId=${familyId}`),
    retry: false,
    // Payments land on the website at any time — keep the figures live.
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["church"] });

  if (snapQ.isLoading) {
    return (
      <Card className="space-y-3 p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-2/3" />
      </Card>
    );
  }

  if (snapQ.isError || !snapQ.data) {
    const code = snapQ.error instanceof ApiError ? snapQ.error.code : null;
    return (
      <Card className="space-y-2 p-4">
        <p className="text-sm font-semibold text-fg">
          {code === "church_auth_failed"
            ? "Church token was rejected"
            : code === "church_unreachable"
              ? "Church site unreachable"
              : "Church data isn’t connected yet"}
        </p>
        <p className="text-sm text-fg-muted">
          {snapQ.error instanceof ApiError && snapQ.error.message
            ? snapQ.error.message
            : "Live totals come from the contributions site (CONTRIBUTIONS_API_URL)."}
        </p>
        <Button variant="secondary" fullWidth onClick={() => void snapQ.refetch()}>
          Try again
        </Button>
      </Card>
    );
  }

  const snap = snapQ.data;
  if (snap.funds.length === 0) {
    return (
      <EmptyState
        icon={HandCoins}
        title="No church funds found"
        description="Once funds exist on the contributions site, they’ll show here automatically."
      />
    );
  }

  const legacy = snap.holders.find((h) => h.recipientId === null && h.receivedMinor > 0);
  const people = snap.holders.filter((h) => h.recipientId !== null && h.receivedMinor > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-xs text-fg-subtle">
          Live from the church site · updated {timeFmt.format(new Date(snap.fetchedAt * 1000))}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void snapQ.refetch()}
          aria-label="Refresh live totals"
        >
          <RefreshCw className={cn("size-4", snapQ.isFetching && "animate-spin")} aria-hidden />
          Refresh
        </Button>
      </div>

      <FlowSummary snap={snap} />

      {people.map((h) => (
        <HolderCard key={h.recipientId} holder={h} onHandover={() => setHandoverFor(h)} />
      ))}

      {legacy && (
        <Card className="space-y-1 p-4">
          <p className="text-sm font-semibold text-amber-200">
            {inr(legacy.holdingMinor)} settled without a name
          </p>
          <p className="text-xs text-fg-muted">
            {legacy.openCount} older {legacy.openCount === 1 ? "entry was" : "entries were"} recorded
            before you could pick who received it. Tap each one under History and set the person
            (e.g. Mom) so their total is right.
          </p>
        </Card>
      )}

      <section className="space-y-2">
        <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
          Funds
        </h3>
        {isPlatformAdmin && (
          <p className="px-1 text-xs text-fg-subtle">
            Tech Fund and Contribution Fund are visible only to you as super admin.
          </p>
        )}
        {snap.funds.map((f) => (
          <FundCard key={f.slug} fund={f} />
        ))}
      </section>

      <SettleForm snap={snap} familyId={familyId} onDone={invalidate} />

      <History settlements={snap.settlements} onSelect={setEditing} />

      {editing && (
        <EditSheet
          key={editing.id}
          settlement={editing}
          recipients={snap.recipients}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            await invalidate();
          }}
        />
      )}

      {handoverFor && (
        <HandoverSheet
          familyId={familyId}
          holder={handoverFor}
          onClose={() => setHandoverFor(null)}
          onDone={async () => {
            setHandoverFor(null);
            await invalidate();
          }}
        />
      )}
    </div>
  );
}

function FlowSummary({ snap }: { snap: Snapshot }) {
  const { totals } = snap;
  const holderLabel =
    snap.holders.filter((h) => h.recipientId !== null).length === 1
      ? `With ${snap.holders.find((h) => h.recipientId !== null)!.name}`
      : "With others";
  const steps = [
    { label: "With you", sub: "to settle", value: totals.withYouMinor, icon: Wallet, tone: "text-amber-200" },
    { label: holderLabel, sub: "not yet at church", value: totals.withRecipientsMinor, icon: UserRound, tone: "text-sky-300" },
    { label: "Given to church", sub: "done", value: totals.givenToChurchMinor, icon: Church, tone: "text-emerald-300" },
  ];
  return (
    <Card className="p-4">
      <p className="mb-3 text-xs text-fg-muted">
        Collected on the website: <span className="font-semibold text-fg tabular-nums">{inr(totals.collectedMinor)}</span>
      </p>
      <ol className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-start gap-1.5 text-center">
        {steps.map((s, i) => (
          <li key={s.label} className="contents">
            {i > 0 && <ArrowRight className="mt-6 size-3.5 text-fg-subtle" aria-hidden />}
            <div className="min-w-0">
              <s.icon className={cn("mx-auto size-4", s.tone)} aria-hidden />
              <p className="mt-1 truncate text-[11px] text-fg-subtle">{s.label}</p>
              <p className={cn("text-sm font-semibold tabular-nums", s.tone)}>{inr(s.value)}</p>
              <p className="text-[10px] text-fg-subtle">{s.sub}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function HolderCard({ holder, onHandover }: { holder: Holder; onHandover: () => void }) {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs text-fg-subtle">{holder.name} is holding</p>
          <p className="text-2xl font-semibold tabular-nums text-sky-300">{inr(holder.holdingMinor)}</p>
        </div>
        <div className="shrink-0 text-right text-[11px] text-fg-subtle">
          <p>Received {inr(holder.receivedMinor)}</p>
          <p>Gave church {inr(holder.handedOverMinor)}</p>
        </div>
      </div>
      {holder.byFund.some((f) => f.holdingMinor > 0) && (
        <ul className="space-y-1 text-xs">
          {holder.byFund
            .filter((f) => f.holdingMinor > 0)
            .map((f) => (
              <li key={f.fundSlug} className="flex justify-between gap-3">
                <span className="truncate text-fg-muted">{f.fundName}</span>
                <span className="tabular-nums text-fg">{inr(f.holdingMinor)}</span>
              </li>
            ))}
        </ul>
      )}
      {holder.holdingMinor > 0 && (
        <Button variant="secondary" size="sm" fullWidth onClick={onHandover}>
          <Church className="size-4" aria-hidden />
          {holder.name} gave it to church
        </Button>
      )}
    </Card>
  );
}

function FundCard({ fund }: { fund: ChurchFund }) {
  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="truncate text-sm font-semibold text-fg">{fund.name}</h4>
        <p className="shrink-0 text-xs text-fg-subtle">
          {fund.lastSettledAt ? `Last settled ${formatInstant(fund.lastSettledAt)}` : "Never settled"}
        </p>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-fg-muted">With you now</span>
        <span
          className={cn(
            "text-xl font-semibold tabular-nums",
            fund.withYouMinor > 0 ? "text-amber-200" : "text-emerald-300",
          )}
        >
          {inr(fund.withYouMinor)}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-fg-subtle">Collected (live)</dt>
          <dd className="tabular-nums text-fg">{inr(fund.collectedMinor)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-fg-subtle">Settled by you</dt>
          <dd className="tabular-nums text-fg">{inr(fund.settledMinor)}</dd>
        </div>
      </dl>
      {fund.purchasesMinor > 0 && (
        <p className="text-[11px] text-fg-subtle">
          Church purchases from this fund: {inr(fund.purchasesMinor)} (doesn’t change what you hold)
        </p>
      )}
      {fund.overSettledMinor > 0 && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
          You’ve settled {inr(fund.overSettledMinor)} more than the website shows collected. Check
          the History entries for a typo.
        </p>
      )}
    </Card>
  );
}

function SettleForm({
  snap,
  familyId,
  onDone,
}: {
  snap: Snapshot;
  familyId: string;
  onDone: () => Promise<unknown>;
}) {
  const [fundSlug, setFundSlug] = useState(
    () => snap.funds.find((f) => f.withYouMinor > 0)?.slug ?? snap.funds[0].slug,
  );
  const [recipientChoice, setRecipientChoice] = useState("");
  const [newName, setNewName] = useState("");
  const [amount, setAmount] = useState<string | null>(null);
  const [when, setWhen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [nowSec] = useState(() => Math.floor(Date.now() / 1000));

  const fund = snap.funds.find((f) => f.slug === fundSlug) ?? snap.funds[0];
  // Untouched amount follows the live figure, so a fresh website payment
  // updates the suggestion without the user retyping anything.
  const amountValue = amount ?? (fund.withYouMinor > 0 ? String(fund.withYouMinor / 100) : "");
  const paidMinor = parseRupees(amountValue);
  const recipientId =
    recipientChoice || (snap.recipients.length === 1 ? snap.recipients[0].id : "");
  const recipient = snap.recipients.find((r) => r.id === recipientId);
  const holdingNow = snap.holders.find((h) => h.recipientId === recipientId)?.holdingMinor ?? 0;

  const settle = useMutation({
    mutationFn: async () => {
      if (paidMinor == null) throw new Error("Enter how much you gave.");
      let rid = recipientId;
      let rname = recipient?.name ?? "";
      if (recipientChoice === NEW_RECIPIENT) {
        const name = newName.trim();
        if (!name) throw new Error("Type the person’s name.");
        const created = await api<{ destination: Recipient }>("/settlements/destinations", {
          method: "POST",
          body: JSON.stringify({ familyId, name, kind: "person" }),
        }).catch(async (e: unknown) => {
          // Already exists → reuse it.
          if (e instanceof ApiError && e.code === "destination_exists") {
            const existing = snap.recipients.find((r) => r.name.toLowerCase() === name.toLowerCase());
            if (existing) return { destination: existing };
          }
          throw e;
        });
        rid = created.destination.id;
        rname = created.destination.name;
      }
      if (!rid) throw new Error("Pick who you gave the money to.");
      const settledAt = when ? fromLocalInput(when) : undefined;
      if (when && settledAt == null) throw new Error("Pick a valid date and time.");
      await api("/church/settle", {
        method: "POST",
        body: JSON.stringify({
          familyId,
          fundSlug: fund.slug,
          paidMinor,
          recipientId: rid,
          settledAt,
          note: note.trim() || null,
        }),
      });
      return rname;
    },
    onSuccess: async (rname) => {
      setSaved(`Saved: ${inr(paidMinor ?? 0)} from ${fund.name} to ${rname}.`);
      setAmount(null);
      setWhen(null);
      setNote("");
      setNewName("");
      if (recipientChoice === NEW_RECIPIENT) setRecipientChoice("");
      setError(null);
      await onDone();
    },
    onError: (e) => {
      setSaved(null);
      setError(errorText(e, "Could not save the settlement."));
    },
  });

  const over = paidMinor != null && paidMinor > fund.withYouMinor;
  const nameForPreview =
    recipientChoice === NEW_RECIPIENT ? newName.trim() || "them" : (recipient?.name ?? "them");

  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-semibold text-fg">Record a settlement</h3>

      <Field label="Fund">
        <Select
          value={fund.slug}
          onChange={(e) => {
            setFundSlug(e.target.value);
            setAmount(null);
          }}
        >
          {snap.funds.map((f) => (
            <option key={f.slug} value={f.slug}>
              {f.name} · {inr(f.withYouMinor)} with you
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Given to">
        <Select value={recipientChoice || recipientId} onChange={(e) => setRecipientChoice(e.target.value)}>
          {!recipientId && recipientChoice !== NEW_RECIPIENT && (
            <option value="" disabled>
              Choose a person…
            </option>
          )}
          {snap.recipients.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
          <option value={NEW_RECIPIENT}>+ Someone new…</option>
        </Select>
      </Field>
      {recipientChoice === NEW_RECIPIENT && (
        <Field label="Name">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Mom" />
        </Field>
      )}

      <Field label="Amount (₹)">
        <div className="flex gap-2">
          <Input
            inputMode="decimal"
            value={amountValue}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="2500"
            className="flex-1"
          />
          {fund.withYouMinor > 0 && amount !== null && (
            <Button variant="secondary" size="sm" onClick={() => setAmount(null)}>
              All {inr(fund.withYouMinor)}
            </Button>
          )}
        </div>
      </Field>

      <Field label="When">
        <Input
          type="datetime-local"
          value={when ?? ""}
          onChange={(e) => setWhen(e.target.value || null)}
          max={toLocalInput(nowSec)}
        />
        {!when && <p className="mt-1 text-[11px] text-fg-subtle">Leave empty for right now.</p>}
      </Field>

      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note (e.g. cash, GPay ref)"
        rows={2}
      />

      {paidMinor != null && (
        <p className="rounded-lg bg-white/5 px-3 py-2 text-xs text-fg-muted">
          After this: with you{" "}
          <span className="font-semibold text-fg tabular-nums">
            {inr(Math.max(fund.withYouMinor - paidMinor, 0))}
          </span>{" "}
          in {fund.name} · {nameForPreview} holds{" "}
          <span className="font-semibold text-fg tabular-nums">{inr(holdingNow + paidMinor)}</span>
        </p>
      )}
      {over && (
        <p className="text-xs text-amber-200">
          That’s more than the {inr(fund.withYouMinor)} the website shows with you for this fund.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="text-sm text-emerald-300">
          {saved}
        </p>
      )}

      <Button fullWidth loading={settle.isPending} onClick={() => settle.mutate()}>
        Save settlement
      </Button>
    </Card>
  );
}

function History({
  settlements,
  onSelect,
}: {
  settlements: Settlement[];
  onSelect: (s: Settlement) => void;
}) {
  if (settlements.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
        History
      </h3>
      <Card className="divide-y divide-line overflow-hidden">
        {settlements.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s)}
            className="lq-press block w-full px-4 py-3 text-left hover:bg-white/5"
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-medium text-fg">
                {s.fundName} → {s.recipientName ?? "who? (tap to set)"}
              </p>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-fg">
                {inr(s.paidMinor)}
              </span>
            </div>
            <p className="text-xs text-fg-subtle">
              {formatInstant(s.settledAt)}
              {s.settledByName ? ` · by ${s.settledByName}` : ""}
            </p>
            <p
              className={cn(
                "text-xs",
                s.recipientId === null
                  ? "text-amber-200"
                  : s.handedOverAt
                    ? "text-emerald-300"
                    : "text-sky-300",
              )}
            >
              {s.recipientId === null
                ? "Recipient not set"
                : s.handedOverAt
                  ? `Given to church · ${formatInstant(s.handedOverAt)}`
                  : `With ${s.recipientName}`}
              {s.note ? <span className="text-fg-subtle"> · {s.note}</span> : null}
            </p>
          </button>
        ))}
      </Card>
    </section>
  );
}

function EditSheet({
  settlement,
  recipients,
  onClose,
  onDone,
}: {
  settlement: Settlement;
  recipients: Recipient[];
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const [recipientId, setRecipientId] = useState(settlement.recipientId ?? "");
  const [amount, setAmount] = useState(String(settlement.paidMinor / 100));
  const [when, setWhen] = useState(toLocalInput(settlement.settledAt));
  const [note, setNote] = useState(settlement.note ?? "");
  const [handedOver, setHandedOver] = useState(settlement.handedOverAt !== null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const paidMinor = parseRupees(amount);
      if (paidMinor == null) throw new Error("Enter a valid amount.");
      const settledAt = fromLocalInput(when);
      if (settledAt == null) throw new Error("Pick a valid date and time.");
      if (!recipientId) throw new Error("Pick who received it.");
      const body: Record<string, unknown> = {};
      if (recipientId !== settlement.recipientId) body.recipientId = recipientId;
      if (paidMinor !== settlement.paidMinor) body.paidMinor = paidMinor;
      if (settledAt !== settlement.settledAt) body.settledAt = settledAt;
      if (note.trim() !== (settlement.note ?? "")) body.note = note.trim() || null;
      if (handedOver !== (settlement.handedOverAt !== null)) body.handedOver = handedOver;
      return api(`/church/settlements/${settlement.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onSuccess: onDone,
    onError: (e) => setError(errorText(e, "Could not save.")),
  });

  const remove = useMutation({
    mutationFn: () => api(`/church/settlements/${settlement.id}`, { method: "DELETE" }),
    onSuccess: onDone,
    onError: (e) => setError(errorText(e, "Could not delete.")),
  });

  return (
    <Sheet open onClose={onClose} title={`${settlement.fundName} settlement`}>
      <div className="space-y-3">
        <Field label="Given to">
          <Select value={recipientId} onChange={(e) => setRecipientId(e.target.value)}>
            {!recipientId && (
              <option value="" disabled>
                Choose a person…
              </option>
            )}
            {recipients.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Amount (₹)">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="When">
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <Field label="Note">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>
        <SegmentedControl
          label="Where is it now?"
          value={handedOver ? "church" : "holder"}
          onChange={(v) => setHandedOver(v === "church")}
          options={[
            {
              value: "holder",
              label: `With ${recipients.find((r) => r.id === recipientId)?.name ?? "them"}`,
            },
            { value: "church", label: "Given to church" },
          ]}
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button fullWidth loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
        <Button
          variant="danger"
          fullWidth
          loading={remove.isPending}
          onClick={() => {
            if (window.confirm("Delete this settlement? The amount goes back to “with you”.")) {
              remove.mutate();
            }
          }}
        >
          Delete
        </Button>
      </div>
    </Sheet>
  );
}

function HandoverSheet({
  familyId,
  holder,
  onClose,
  onDone,
}: {
  familyId: string;
  holder: Holder;
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const [when, setWhen] = useState("");
  const [error, setError] = useState<string | null>(null);
  const funds = useMemo(() => holder.byFund.filter((f) => f.holdingMinor > 0), [holder]);

  const handover = useMutation({
    mutationFn: () => {
      const handedOverAt = when ? fromLocalInput(when) : undefined;
      if (when && handedOverAt == null) throw new Error("Pick a valid date and time.");
      return api("/church/handover", {
        method: "POST",
        body: JSON.stringify({ familyId, recipientId: holder.recipientId, handedOverAt }),
      });
    },
    onSuccess: onDone,
    onError: (e) => setError(errorText(e, "Could not save.")),
  });

  return (
    <Sheet open onClose={onClose} title={`${holder.name} gave it to church`}>
      <div className="space-y-3">
        <p className="text-sm text-fg-muted">
          Marks the <span className="font-semibold text-fg">{inr(holder.holdingMinor)}</span>{" "}
          {holder.name} is holding as handed to church:
        </p>
        <ul className="space-y-1 text-sm">
          {funds.map((f) => (
            <li key={f.fundSlug} className="flex justify-between gap-3">
              <span className="text-fg-muted">{f.fundName}</span>
              <span className="tabular-nums text-fg">{inr(f.holdingMinor)}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-fg-subtle">
          Only part of it? Open the entries under History and set each one to “Given to church”
          instead.
        </p>
        <Field label="When">
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          {!when && <p className="mt-1 text-[11px] text-fg-subtle">Leave empty for right now.</p>}
        </Field>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button fullWidth loading={handover.isPending} onClick={() => handover.mutate()}>
          Confirm {inr(holder.holdingMinor)} given to church
        </Button>
      </div>
    </Sheet>
  );
}
