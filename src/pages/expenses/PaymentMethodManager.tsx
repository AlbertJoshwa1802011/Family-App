import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Wallet,
} from "lucide-react";
import { AppBar } from "../../components/ui/AppBar";
import { Page } from "../../components/ui/Page";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Fab } from "../../components/ui/Fab";
import { Sheet } from "../../components/ui/Sheet";
import { Skeleton } from "../../components/ui/Skeleton";
import { EmptyState } from "../../components/ui/EmptyState";
import { Chip, ChipGroup, Field, inputClass } from "../../components/ui/Field";
import { EmojiPicker } from "../../components/expenses/EmojiPicker";
import { useAuth } from "../../context/AuthContext";
import { api, ApiError } from "../../lib/api";
import { cn } from "../../lib/cn";
import {
  PAYMENT_KINDS,
  useEnsureExpenseSetup,
  type PaymentKind,
  type PaymentMethod,
} from "../../lib/expenses";

const kindLabel = (kind: PaymentKind) =>
  PAYMENT_KINDS.find((k) => k.value === kind)?.label ?? kind;

export function PaymentMethodManager() {
  const qc = useQueryClient();
  const { activeFamily } = useAuth();
  const [params, setParams] = useSearchParams();
  const showArchived = params.get("view") === "archived";
  const [editing, setEditing] = useState<PaymentMethod | "new" | null>(null);
  // Reorder is a mode, not a permanent pair of arrows in every row: four 44px
  // actions per row left no width for a name like "Bank Transfer" on a phone.
  const [reordering, setReordering] = useState(false);

  const familyId = activeFamily?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["expense-payment-methods", familyId, "all"],
    queryFn: () =>
      api<{ paymentMethods: PaymentMethod[] }>(
        `/expense-payment-methods?familyId=${familyId}&includeArchived=1`,
      ),
    enabled: Boolean(familyId),
  });

  const { isSettingUp } = useEnsureExpenseSetup(
    familyId,
    Boolean(data) && data!.paymentMethods.length === 0,
  );

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["expense-payment-methods"] });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "archived" }) =>
      api(`/expense-payment-methods/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/expense-payment-methods/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const reorder = useMutation({
    mutationFn: (items: { id: string; sortOrder: number }[]) =>
      api("/expense-payment-methods/reorder", {
        method: "POST",
        body: JSON.stringify({ familyId, items }),
      }),
    onSuccess: invalidate,
  });

  const methods = (data?.paymentMethods ?? []).filter((m) =>
    showArchived ? m.status === "archived" : m.status === "active",
  );

  const move = (index: number, direction: -1 | 1) => {
    const next = [...methods];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorder.mutate(next.map((m, i) => ({ id: m.id, sortOrder: i * 10 })));
  };

  const mutationError =
    (setStatus.error as ApiError | null)?.message ??
    (remove.error as ApiError | null)?.message ??
    (reorder.error as ApiError | null)?.message;

  return (
    <>
      <AppBar title="Payment methods" back />
      <Page className="space-y-4">
        <div
          role="tablist"
          aria-label="Payment method status"
          className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-1"
        >
          {[
            { key: "active", label: "Active" },
            { key: "archived", label: "Archived" },
          ].map((tab) => {
            const selected = (tab.key === "archived") === showArchived;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={selected}
                onClick={() =>
                  setParams(tab.key === "archived" ? { view: "archived" } : {})
                }
                className={cn(
                  "min-h-11 rounded-lg text-sm font-medium transition-colors",
                  selected
                    ? "bg-vault-500/15 text-vault-300"
                    : "text-fg-muted hover:bg-white/5",
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {mutationError && (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {mutationError}
          </p>
        )}

        {isLoading || isSettingUp ? (
          <Card className="divide-y divide-line" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex min-h-14 items-center gap-3 px-4 py-3">
                <Skeleton className="size-9 rounded-xl" />
                <Skeleton className="h-3.5 w-1/3" />
              </div>
            ))}
          </Card>
        ) : methods.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title={showArchived ? "Nothing archived" : "No payment methods"}
            description={
              showArchived
                ? "Archived methods stay here so past expenses keep resolving."
                : "Add how you pay — cash, cards, UPI, wallets."
            }
            action={
              showArchived ? undefined : (
                <Button
                  leadingIcon={<Plus className="size-4" />}
                  onClick={() => setEditing("new")}
                >
                  Add payment method
                </Button>
              )
            }
          />
        ) : (
          <>
          {!showArchived && methods.length > 1 && (
            <div className="flex justify-end">
              <Button
                size="md"
                variant={reordering ? "primary" : "ghost"}
                leadingIcon={<ArrowUpDown className="size-4" />}
                onClick={() => setReordering((r) => !r)}
              >
                {reordering ? "Done" : "Reorder"}
              </Button>
            </div>
          )}
          <Card className="divide-y divide-line overflow-hidden">
            {methods.map((method, index) => (
              <div key={method.id} className="flex min-h-14 items-center gap-2 px-3 py-2.5">
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/5 text-lg"
                >
                  {method.emoji ?? "💳"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-fg">
                    {method.name}
                  </div>
                  {/* Only worth a second line when it adds information —
                      "Cash / Cash" is noise. */}
                  {kindLabel(method.kind).toLowerCase() !==
                    method.name.toLowerCase() && (
                    <div className="mt-0.5 text-xs text-fg-muted">
                      {kindLabel(method.kind)}
                    </div>
                  )}
                </div>

                {method.status === "archived" && <Badge tone="neutral">Archived</Badge>}

                {reordering && !showArchived ? (
                  <>
                    <button
                      onClick={() => move(index, -1)}
                      disabled={index === 0 || reorder.isPending}
                      aria-label={`Move ${method.name} up`}
                      className="flex size-11 items-center justify-center rounded-full border border-line text-fg-muted disabled:opacity-30"
                    >
                      <ArrowUp className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => move(index, 1)}
                      disabled={index === methods.length - 1 || reorder.isPending}
                      aria-label={`Move ${method.name} down`}
                      className="flex size-11 items-center justify-center rounded-full border border-line text-fg-muted disabled:opacity-30"
                    >
                      <ArrowDown className="size-4" aria-hidden="true" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setEditing(method)}
                      aria-label={`Edit ${method.name}`}
                      className="flex size-11 items-center justify-center rounded-full text-fg-subtle hover:bg-white/5"
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      onClick={() =>
                        setStatus.mutate({
                          id: method.id,
                          status: method.status === "archived" ? "active" : "archived",
                        })
                      }
                      aria-label={
                        method.status === "archived"
                          ? `Restore ${method.name}`
                          : `Archive ${method.name}`
                      }
                      className="flex size-11 items-center justify-center rounded-full text-fg-subtle hover:bg-white/5"
                    >
                      {method.status === "archived" ? (
                        <RotateCcw className="size-4" aria-hidden="true" />
                      ) : (
                        <Archive className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  </>
                )}
              </div>
            ))}
          </Card>
          </>
        )}

        <p className="px-1 text-xs text-fg-subtle">
          Archive a method you've stopped using — expenses already paid with it
          keep their record.
        </p>
      </Page>

      {!showArchived && (
        <Fab icon={Plus} label="Add payment method" onClick={() => setEditing("new")} />
      )}

      {editing && familyId && (
        <PaymentMethodEditor
          key={editing === "new" ? "new" : editing.id}
          method={editing === "new" ? null : editing}
          familyId={familyId}
          onClose={() => setEditing(null)}
          onDelete={(id) => {
            remove.mutate(id);
            setEditing(null);
          }}
          deleting={remove.isPending}
        />
      )}
    </>
  );
}

function PaymentMethodEditor({
  method,
  familyId,
  onClose,
  onDelete,
  deleting,
}: {
  method: PaymentMethod | null;
  familyId: string;
  onClose: () => void;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(method?.name ?? "");
  const [emoji, setEmoji] = useState<string | null>(method?.emoji ?? null);
  const [kind, setKind] = useState<PaymentKind>(method?.kind ?? "other");
  const [error, setError] = useState<string | null>(null);
  // Two-tap confirm instead of a nested dialog — the server still refuses to
  // delete anything an expense references, so this only guards a slip.
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), emoji, kind };
      return method
        ? api(`/expense-payment-methods/${method.id}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          })
        : api("/expense-payment-methods", {
            method: "POST",
            body: JSON.stringify({ familyId, ...body }),
          });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["expense-payment-methods"] });
      onClose();
    },
    onError: (e) => setError((e as ApiError).message),
  });

  const submit = () => {
    setError(null);
    if (name.trim() === "") {
      setError("Give the payment method a name.");
      return;
    }
    save.mutate();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={method ? "Edit payment method" : "New payment method"}
      footer={
        <Button fullWidth size="lg" loading={save.isPending} onClick={submit}>
          {method ? "Save changes" : "Add"}
        </Button>
      }
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/5 text-2xl"
        >
          {emoji ?? "💳"}
        </span>
        <div className="min-w-0 flex-1">
          <Field label="Name" required error={error ?? undefined}>
            {(props) => (
              <input
                {...props}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. HDFC Credit Card"
                maxLength={60}
                className={inputClass}
              />
            )}
          </Field>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold text-fg-muted">Type</p>
        <ChipGroup label="Payment type">
          {PAYMENT_KINDS.map((k) => (
            <Chip
              key={k.value}
              selected={kind === k.value}
              onClick={() => setKind(k.value)}
            >
              {k.label}
            </Chip>
          ))}
        </ChipGroup>
        <p className="mt-1 text-xs text-fg-subtle">
          Used to group spending by how you paid — rename the method freely, the
          type keeps reporting consistent.
        </p>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold text-fg-muted">Icon</p>
        <EmojiPicker value={emoji} onChange={setEmoji} />
      </div>

      {method && !method.isSystem && (
        <div className="border-t border-line pt-4">
          <Button
            variant="danger"
            fullWidth
            loading={deleting}
            leadingIcon={<Trash2 className="size-4" />}
            onClick={() =>
              confirmDelete ? onDelete(method.id) : setConfirmDelete(true)
            }
          >
            {confirmDelete ? "Tap again to delete" : "Delete"}
          </Button>
          <p className="mt-1 text-xs text-fg-subtle">
            Only possible while no expense uses it — otherwise archive it.
          </p>
        </div>
      )}
    </Sheet>
  );
}
