import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
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
  parentExpenseId?: string | null;
  nestDepth?: number;
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
  const [searchParams] = useSearchParams();

  const parentId = !isEdit ? searchParams.get("parentId") : null;

  const [today] = useState(() => todayIsoDate());
  // One id per form instance makes a double-submit idempotent server-side.
  const [clientRequestId] = useState(() => crypto.randomUUID());

  const settingsQ = useQuery({
    queryKey: ["finance", "settings", activeFamilyId],
    queryFn: () =>
      api<{ currency: string }>(`/finance/settings?familyId=${activeFamilyId}`),
    enabled: Boolean(activeFamilyId) && !existing,
  });

  const parentQ = useQuery({
    queryKey: ["expenses", "detail", parentId],
    queryFn: () => api<{ expense: ExpenseDetail }>(`/expenses/${parentId}`),
    enabled: Boolean(parentId),
  });

  const currency = existing?.currency ?? settingsQ.data?.currency ?? "USD";

  const [amount, setAmount] = useState(() => {
    if (existing) return formatMajorFromMinor(existing.amountMinor, existing.currency);
    const fromQuery = searchParams.get("amount");
    return fromQuery && /^\d+(\.\d+)?$/.test(fromQuery) ? fromQuery : "";
  });
  const [expenseDate, setExpenseDate] = useState(() => existing?.expenseDate ?? today);
  const [merchant, setMerchant] = useState(
    () => existing?.merchant ?? searchParams.get("merchant") ?? "",
  );
  const [description, setDescription] = useState(() => existing?.description ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(
    () => existing?.categoryId ?? searchParams.get("categoryId") ?? null,
  );
  const [visibility, setVisibility] = useState<"family" | "private">(
    () => existing?.visibility ?? "private",
  );
  const [paidBySelection, setPaidBySelection] = useState<string | null>(
    () => existing?.paidByMemberId ?? null,
  );
  const [formError, setFormError] = useState<string | null>(null);

  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryUnderRoot, setNewCategoryUnderRoot] = useState(true);
  const [categoryCreateError, setCategoryCreateError] = useState<string | null>(null);

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

  const createCategory = useMutation({
    mutationFn: async () => {
      const name = newCategoryName.trim();
      if (!name) throw new Error("Enter a category name.");
      if (!activeFamilyId) throw new Error("Select a family first.");
      const selected = categoryId
        ? (categoriesQ.data?.categories ?? []).find((c) => c.id === categoryId)
        : null;
      const rootId = selected
        ? (selected.parentCategoryId ?? selected.id)
        : null;
      return api<{ category: Category }>("/expenses/categories", {
        method: "POST",
        body: JSON.stringify({
          familyId: activeFamilyId,
          name,
          parentCategoryId:
            newCategoryUnderRoot && rootId ? rootId : null,
        }),
      });
    },
    onSuccess: async (data) => {
      setCategoryId(data.category.id);
      setShowNewCategory(false);
      setNewCategoryName("");
      setCategoryCreateError(null);
      await qc.invalidateQueries({ queryKey: ["expenses", "categories"] });
    },
    onError: (e: unknown) => {
      setCategoryCreateError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : "Could not create category.",
      );
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!activeFamilyId && !isEdit) {
        throw new Error("Select a family before adding an expense.");
      }
      const amountMinor = parseMajorToMinor(amount, currency);
      if (amountMinor === null || amountMinor < 0) {
        throw new Error(
          `Enter an amount with at most ${currencyExponent(currency)} decimal places.`,
        );
      }
      // Sub-expense under a container may be $0 only when intentionally empty —
      // still require a real amount for normal leaves (allow 0 for containers).
      if (amountMinor === 0 && !parentId && !merchant.trim()) {
        // Allow 0 for named container parents (e.g. "Google Pay").
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
        body: JSON.stringify({
          ...body,
          familyId: activeFamilyId,
          clientRequestId,
          parentExpenseId: parentId || null,
        }),
      });
    },
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: ["expenses"] });
      if (parentId) {
        navigate(`/money/expenses/${parentId}`, { replace: true });
      } else if (data.expense?.id && !isEdit) {
        navigate(`/money/expenses/${data.expense.id}`, { replace: true });
      } else {
        navigate("/money/expenses", { replace: true });
      }
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

  const parentLabel =
    parentQ.data?.expense.merchant ||
    parentQ.data?.expense.description ||
    "parent expense";

  if (!activeFamilyId && !isEdit) {
    return (
      <>
        <AppBar title="New expense" back />
        <Page>
          <Card className="p-4">
            <p className="text-sm text-fg">No family selected</p>
            <p className="mt-1 text-xs text-fg-muted">
              Pick an active family in Settings before adding expenses.
            </p>
          </Card>
        </Page>
      </>
    );
  }

  return (
    <>
      <AppBar title={isEdit ? "Edit expense" : parentId ? "Sub-expense" : "New expense"} back />
      <Page className="pb-24">
        <form onSubmit={submit} className="space-y-4">
          {parentId && (
            <Card className="border-vault-500/30 bg-vault-500/10 p-3">
              <p className="text-xs font-medium text-vault-300">Adding under</p>
              <p className="mt-0.5 text-sm text-fg">
                {parentQ.isLoading ? "…" : parentLabel}
              </p>
            </Card>
          )}

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
            <p className="mt-1 text-xs text-fg-subtle">
              {currency}
              {!parentId && (
                <span className="text-fg-subtle">
                  {" "}
                  · use 0 for a container (e.g. Google Pay) and add sub-expenses
                </span>
              )}
            </p>
          </Card>

          {/* Category — always prominent; roots + subcats + inline create. */}
          <Card className="space-y-3 p-4">
            <p className="text-sm font-semibold text-fg">Category</p>
            {!activeFamilyId ? (
              <p className="text-sm text-danger">Select a family to load categories.</p>
            ) : categoriesQ.isLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : categoriesQ.isError ? (
              <div className="space-y-2">
                <p className="text-sm text-danger">
                  Couldn&apos;t load categories
                  {categoriesQ.error instanceof Error
                    ? `: ${categoriesQ.error.message}`
                    : "."}
                </p>
                <p className="text-xs text-fg-subtle">
                  You can still add the expense without a category, then tag it later.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void categoriesQ.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <>
                <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
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
                          ? "text-white"
                          : "border-line text-fg-muted hover:bg-white/5",
                      )}
                      style={
                        isRootSelected(cat.id)
                          ? {
                              backgroundColor: cat.color ?? "#6366f1",
                              borderColor: cat.color ?? "#6366f1",
                            }
                          : cat.color
                            ? { borderColor: `${cat.color}66` }
                            : undefined
                      }
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

                {!showNewCategory ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowNewCategory(true)}
                  >
                    + New category
                  </Button>
                ) : (
                  <div className="space-y-2 rounded-xl border border-line p-3">
                    <label htmlFor="newCat" className="text-xs font-medium text-fg-subtle">
                      New category name
                    </label>
                    <input
                      id="newCat"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      placeholder="e.g. School fees"
                      maxLength={80}
                      className={inputClass}
                    />
                    {activeRootId && (
                      <label className="flex items-center gap-2 text-xs text-fg-muted">
                        <input
                          type="checkbox"
                          checked={newCategoryUnderRoot}
                          onChange={(e) => setNewCategoryUnderRoot(e.target.checked)}
                        />
                        Under selected root
                      </label>
                    )}
                    {categoryCreateError && (
                      <p role="alert" className="text-xs text-danger">
                        {categoryCreateError}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setShowNewCategory(false);
                          setCategoryCreateError(null);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        loading={createCategory.isPending}
                        onClick={() => createCategory.mutate()}
                      >
                        Create
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
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
