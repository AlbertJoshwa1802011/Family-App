import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Users } from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Skeleton } from "../components/ui/Skeleton";
import { useAuth } from "../context/AuthContext";
import { api, ApiError } from "../lib/api";
import {
  currencyExponent,
  formatMajorFromMinor,
  parseMajorToMinor,
  todayIsoDate,
} from "../lib/money";
import { cn } from "../lib/cn";

interface Category {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  parentCategoryId: string | null;
}

interface ExpenseDetail {
  id: string;
  amountMinor: number;
  currency: string;
  expenseDate: string;
  merchant: string | null;
  description: string | null;
  categoryId: string | null;
  paidByMemberId: string;
  visibility: "family" | "private";
}

interface FamilyMember {
  id: string;
  userId: string | null;
  displayName: string | null;
  name: string | null;
  email: string | null;
  memberType: string;
  status: string;
}

/** Members may be dependents (no user row), so fall back through the name sources. */
function memberLabel(m: FamilyMember): string {
  return m.displayName || m.name || m.email || "Member";
}

const inputClass =
  "w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none";

/**
 * Outer shell: resolves the expense being edited, then mounts the form with its
 * initial values already known. Seeding state from props (rather than syncing it
 * in an effect) keeps a single render pass and avoids cascading updates.
 */
export function ExpenseForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);

  const existingQ = useQuery({
    queryKey: ["expenses", "detail", id],
    queryFn: () => api<{ expense: ExpenseDetail }>(`/expenses/${id}`),
    enabled: isEdit,
  });

  if (isEdit && existingQ.isLoading) {
    return (
      <>
        <AppBar title="Edit expense" back />
        <Page>
          <Card className="space-y-3 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </Card>
        </Page>
      </>
    );
  }

  const existing = existingQ.data?.expense ?? null;
  return <ExpenseFormFields key={existing?.id ?? "new"} id={id} existing={existing} />;
}

function ExpenseFormFields({
  id,
  existing,
}: {
  id: string | undefined;
  existing: ExpenseDetail | null;
}) {
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeFamilyId, user } = useAuth();

  const [today] = useState(() => todayIsoDate());
  // One id per form instance makes a double-submit idempotent server-side.
  const [clientRequestId] = useState(() => crypto.randomUUID());

  const currency = existing?.currency ?? "USD";

  const [amount, setAmount] = useState(() =>
    existing ? formatMajorFromMinor(existing.amountMinor, existing.currency) : "",
  );
  const [expenseDate, setExpenseDate] = useState(() => existing?.expenseDate ?? today);
  const [merchant, setMerchant] = useState(() => existing?.merchant ?? "");
  const [description, setDescription] = useState(() => existing?.description ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(
    () => existing?.categoryId ?? null,
  );
  const [visibility, setVisibility] = useState<"family" | "private">(
    () => existing?.visibility ?? "private",
  );
  const [paidBySelection, setPaidBySelection] = useState<string | null>(
    () => existing?.paidByMemberId ?? null,
  );
  const [formError, setFormError] = useState<string | null>(null);

  const categoriesQ = useQuery({
    queryKey: ["expenses", "categories", activeFamilyId],
    queryFn: () =>
      api<{ categories: Category[] }>(`/expenses/categories?familyId=${activeFamilyId}`),
    enabled: Boolean(activeFamilyId),
  });

  const membersQ = useQuery({
    queryKey: ["family", "members", activeFamilyId],
    queryFn: () =>
      api<{ members: FamilyMember[] }>(`/families/${activeFamilyId}/members`),
    enabled: Boolean(activeFamilyId),
  });

  // The signed-in user's own membership row — the default payer.
  const myMemberId = useMemo(() => {
    const members = membersQ.data?.members ?? [];
    return members.find((m) => m.userId && m.userId === user?.id)?.id ?? null;
  }, [membersQ.data, user?.id]);

  // Derive the effective payer instead of defaulting it through an effect.
  const paidByMemberId = paidBySelection ?? myMemberId;

  const save = useMutation({
    mutationFn: async () => {
      const amountMinor = parseMajorToMinor(amount, currency);
      if (amountMinor === null || amountMinor <= 0) {
        throw new Error(
          `Enter an amount with at most ${currencyExponent(currency)} decimal places.`,
        );
      }
      if (!paidByMemberId) throw new Error("Select who paid.");

      const body = {
        categoryId,
        amountMinor,
        currency,
        expenseDate,
        merchant: merchant.trim() || null,
        description: description.trim() || null,
        visibility,
        paidByMemberId,
      };

      if (isEdit) {
        return api<{ expense: ExpenseDetail }>(`/expenses/${id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      return api<{ expense: ExpenseDetail }>("/expenses", {
        method: "POST",
        body: JSON.stringify({ ...body, familyId: activeFamilyId, clientRequestId }),
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["expenses"] });
      navigate("/money/expenses", { replace: true });
    },
    onError: (e: unknown) => {
      setFormError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : "Could not save this expense.",
      );
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    save.mutate();
  }

  const categories = categoriesQ.data?.categories ?? [];
  const rootCategories = categories.filter((c) => c.parentCategoryId == null);
  const selectedCategory = categoryId
    ? categories.find((c) => c.id === categoryId) ?? null
    : null;
  // Active root = the selected root itself, or the parent of a selected child.
  const activeRootId = selectedCategory
    ? (selectedCategory.parentCategoryId ?? selectedCategory.id)
    : null;
  const childCategories = activeRootId
    ? categories.filter((c) => c.parentCategoryId === activeRootId)
    : [];

  function isRootSelected(rootId: string): boolean {
    if (!categoryId) return false;
    if (categoryId === rootId) return true;
    return selectedCategory?.parentCategoryId === rootId;
  }

  return (
    <>
      <AppBar title={isEdit ? "Edit expense" : "New expense"} back />
      <Page className="pb-24">
        <form onSubmit={submit} className="space-y-4">
          {/* Amount — the one field worth making large on a phone. */}
          <Card className="p-4">
            <label htmlFor="amount" className="text-xs font-medium text-fg-subtle">
              Amount
            </label>
            <input
              id="amount"
              inputMode="decimal"
              autoFocus={!isEdit}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="mt-1 w-full bg-transparent text-3xl font-bold tabular-nums text-fg placeholder:text-fg-subtle focus:outline-none"
            />
            <p className="mt-1 text-xs text-fg-subtle">{currency}</p>
          </Card>

          <Card className="space-y-4 p-4">
            <div>
              <label htmlFor="date" className="text-xs font-medium text-fg-subtle">
                Date
              </label>
              <input
                id="date"
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className={cn(inputClass, "mt-1")}
              />
            </div>

            <div>
              <label htmlFor="merchant" className="text-xs font-medium text-fg-subtle">
                Merchant
              </label>
              <input
                id="merchant"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder="Where did you spend?"
                maxLength={200}
                className={cn(inputClass, "mt-1")}
              />
            </div>

            <div>
              <label htmlFor="note" className="text-xs font-medium text-fg-subtle">
                Note
              </label>
              <textarea
                id="note"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional details"
                rows={2}
                maxLength={2000}
                className={cn(inputClass, "mt-1 resize-none")}
              />
            </div>

            {membersQ.data && membersQ.data.members.length > 1 && (
              <div>
                <label htmlFor="paidBy" className="text-xs font-medium text-fg-subtle">
                  Paid by
                </label>
                <select
                  id="paidBy"
                  value={paidByMemberId ?? ""}
                  onChange={(e) => setPaidBySelection(e.target.value || null)}
                  className={cn(inputClass, "mt-1")}
                >
                  {membersQ.data.members
                    .filter((m) => m.memberType === "user" && m.status === "active")
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {memberLabel(m)}
                        {m.id === myMemberId ? " (you)" : ""}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </Card>

          {/* Category — roots first; children appear as a second row when relevant. */}
          <Card className="space-y-3 p-4">
            <p className="text-xs font-medium text-fg-subtle">Category</p>
            {categoriesQ.isLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setCategoryId(null)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      categoryId === null
                        ? "border-vault-500/40 bg-vault-500/15 text-vault-300"
                        : "border-line text-fg-muted hover:bg-white/5",
                    )}
                  >
                    None
                  </button>
                  {rootCategories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategoryId(cat.id)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                        isRootSelected(cat.id)
                          ? "border-vault-500/40 bg-vault-500/15 text-vault-300"
                          : "border-line text-fg-muted hover:bg-white/5",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="size-2 rounded-full"
                        style={{ backgroundColor: cat.color ?? "var(--color-fg-subtle)" }}
                      />
                      {cat.name}
                    </button>
                  ))}
                </div>
                {childCategories.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-fg-subtle">Subcategory</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {childCategories.map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setCategoryId(cat.id)}
                          className={cn(
                            "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                            categoryId === cat.id
                              ? "border-vault-500/40 bg-vault-500/15 text-vault-300"
                              : "border-line text-fg-muted hover:bg-white/5",
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className="size-2 rounded-full"
                            style={{
                              backgroundColor: cat.color ?? "var(--color-fg-subtle)",
                            }}
                          />
                          {cat.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>

          {/* Visibility — the privacy decision, stated plainly. */}
          <Card className="p-4">
            <p className="text-xs font-medium text-fg-subtle">Who can see this</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(
                [
                  {
                    key: "private" as const,
                    label: "Only me",
                    icon: Lock,
                    hint: "Private to your books",
                  },
                  {
                    key: "family" as const,
                    label: "My family",
                    icon: Users,
                    hint: "Visible to the household",
                  },
                ]
              ).map(({ key, label, icon: Icon, hint }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setVisibility(key)}
                  aria-pressed={visibility === key}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors",
                    visibility === key
                      ? "border-vault-500/40 bg-vault-500/10"
                      : "border-line hover:bg-white/5",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <Icon
                      className={cn(
                        "size-4",
                        visibility === key ? "text-vault-300" : "text-fg-muted",
                      )}
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        "text-sm font-medium",
                        visibility === key ? "text-vault-300" : "text-fg",
                      )}
                    >
                      {label}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-fg-subtle">{hint}</span>
                </button>
              ))}
            </div>
          </Card>

          {formError && (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              fullWidth
              onClick={() => navigate(-1)}
            >
              Cancel
            </Button>
            <Button type="submit" fullWidth loading={save.isPending}>
              {isEdit ? "Save changes" : "Add expense"}
            </Button>
          </div>
        </form>
      </Page>
    </>
  );
}
