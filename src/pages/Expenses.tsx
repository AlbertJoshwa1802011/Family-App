import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Search, Wallet } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { Fab } from "../components/ui/Fab";
import { Sheet } from "../components/ui/Sheet";
import { inputCls } from "../lib/fieldCls";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/cn";

interface ExpenseSummary {
  id: string;
  amount: number;
  amountCents: number;
  currency: string;
  category: string;
  categoryId: string | null;
  categoryName: string;
  categoryEmoji: string;
  parentCategoryName: string | null;
  parentCategoryEmoji: string | null;
  note: string | null;
  spentOn: string;
}

interface CategoryNode {
  id: string;
  name: string;
  emoji: string;
  slug: string | null;
  parentId: string | null;
  sortOrder: number;
  children: CategoryNode[];
}

interface Suggestion {
  note: string;
  amount: number;
  currency: string;
  category: string;
  categoryId: string | null;
  categoryName: string;
  categoryEmoji: string;
  parentCategoryName: string | null;
  count: number;
  lastSpentOn: string;
}

function formatMoney(amount: number, currency: string): string {
  const formatted = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  if (currency === "INR") return `₹${formatted}`;
  if (currency === "USD") return `$${formatted}`;
  if (currency === "EUR") return `€${formatted}`;
  if (currency === "GBP") return `£${formatted}`;
  return `${formatted} ${currency}`;
}

const QUICK_EMOJIS = [
  "🍔", "🛒", "🚗", "🏠", "💊", "📚", "🎬", "✈️", "🛍️", "📦",
  "☕", "🍿", "⛽", "🚕", "💡", "🎁", "📱", "🎮", "🍜", "🔖",
];

export function Expenses() {
  const { activeFamily } = useAuth();
  const [composerOpen, setComposerOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["expenses", activeFamily?.id],
    queryFn: () =>
      api<{ expenses: ExpenseSummary[]; total: number }>(
        `/expenses?familyId=${activeFamily!.id}`,
      ),
    enabled: Boolean(activeFamily),
  });

  const expenses = data?.expenses ?? [];
  const total = data?.total ?? 0;
  const currency = expenses[0]?.currency ?? "INR";

  return (
    <>
      <AppBar title="Expenses" back />
      <Page className="space-y-4">
        {isLoading ? (
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
              {expenses.map((e) => {
                const label = e.note?.trim() || e.categoryName;
                const catLabel = e.parentCategoryName
                  ? `${e.parentCategoryName} · ${e.categoryName}`
                  : e.categoryName;
                return (
                  <div key={e.id} className="flex min-h-14 items-center gap-3 px-4 py-3">
                    <span
                      className="lq lq-flat flex size-10 items-center justify-center rounded-full text-lg"
                      aria-hidden="true"
                    >
                      {e.categoryEmoji || "📦"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-fg">{label}</div>
                      <div className="mt-0.5 truncate text-xs text-fg-muted">
                        {e.spentOn} · {catLabel}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold tabular-nums text-fg">
                        {formatMoney(e.amount, e.currency)}
                      </div>
                      <Badge tone="neutral">
                        {e.categoryEmoji} {e.categoryName}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </Card>
          </>
        )}

        {composerOpen && activeFamily && (
          <ExpenseComposer
            familyId={activeFamily.id}
            onClose={() => setComposerOpen(false)}
          />
        )}
      </Page>
      <Fab icon={Plus} label="Add expense" onClick={() => setComposerOpen(true)} />
    </>
  );
}

function defaultCategoryPick(categories: CategoryNode[]): {
  id: string;
  emoji: string;
  label: string;
} | null {
  if (!categories.length) return null;
  const food = categories.find((c) => c.slug === "food") ?? categories[0]!;
  const snacks =
    food.children.find((c) => c.slug === "food-snacks") ?? food.children[0];
  if (snacks) {
    return {
      id: snacks.id,
      emoji: snacks.emoji,
      label: `${food.name} · ${snacks.name}`,
    };
  }
  return { id: food.id, emoji: food.emoji, label: food.name };
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
  const [picked, setPicked] = useState<{
    id: string;
    emoji: string;
    label: string;
  } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [error, setError] = useState("");
  const noteWrapRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const { data: catData } = useQuery({
    queryKey: ["expense-categories", familyId],
    queryFn: () =>
      api<{ categories: CategoryNode[] }>(
        `/expenses/categories?familyId=${familyId}`,
      ),
  });

  const selection =
    picked ?? defaultCategoryPick(catData?.categories ?? []) ?? {
      id: "",
      emoji: "🍔",
      label: "Food & Dining",
    };
  const categoryId = selection.id || null;
  const categoryLabel = selection.label;
  const categoryEmoji = selection.emoji;

  const { data: suggestData } = useQuery({
    queryKey: ["expense-suggestions", familyId, note.trim()],
    queryFn: () => {
      const q = note.trim();
      const qs = new URLSearchParams({ familyId });
      if (q) qs.set("q", q);
      return api<{ suggestions: Suggestion[] }>(`/expenses/suggestions?${qs}`);
    },
    enabled: suggestOpen,
    placeholderData: (prev) => prev,
  });

  const suggestions = suggestData?.suggestions ?? [];

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!noteWrapRef.current?.contains(e.target as Node)) {
        setSuggestOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const create = useMutation({
    mutationFn: () =>
      api("/expenses", {
        method: "POST",
        body: JSON.stringify({
          familyId,
          amount: Number(amount),
          categoryId: categoryId ?? undefined,
          note: note.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["expenses"] });
      void qc.invalidateQueries({ queryKey: ["expense-suggestions"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function applySuggestion(s: Suggestion) {
    setNote(s.note);
    setAmount(String(s.amount));
    if (s.categoryId) {
      setPicked({
        id: s.categoryId,
        emoji: s.categoryEmoji,
        label: s.parentCategoryName
          ? `${s.parentCategoryName} · ${s.categoryName}`
          : s.categoryName,
      });
    }
    setSuggestOpen(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (!categoryId) {
      setError("Pick a category.");
      return;
    }
    setError("");
    create.mutate();
  }

  return (
    <>
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

          <div ref={noteWrapRef} className="relative">
            <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
              What for
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 z-1 size-4 -translate-y-1/2 text-fg-subtle"
                aria-hidden="true"
              />
              <input
                type="text"
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setSuggestOpen(true);
                }}
                onFocus={() => setSuggestOpen(true)}
                placeholder="e.g. outside snacks"
                className={cn(inputCls, "pl-10")}
                role="combobox"
                aria-expanded={suggestOpen && suggestions.length > 0}
                aria-controls={listboxId}
                aria-autocomplete="list"
                autoComplete="off"
              />
            </div>
            {suggestOpen && suggestions.length > 0 && (
              <ul
                id={listboxId}
                role="listbox"
                className="lq lq-chrome absolute inset-x-0 top-[calc(100%+0.35rem)] z-20 max-h-56 overflow-y-auto rounded-2xl py-1 shadow-lg"
              >
                {suggestions.map((s) => (
                  <li key={`${s.note}-${s.lastSpentOn}`}>
                    <button
                      type="button"
                      role="option"
                      className="lq-press flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/6"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => applySuggestion(s)}
                    >
                      <span className="text-lg" aria-hidden="true">
                        {s.categoryEmoji}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">
                          {s.note}
                        </span>
                        <span className="block truncate text-xs text-fg-muted">
                          {s.categoryName}
                          {s.count > 1 ? ` · ${s.count}×` : ""}
                          {" · last "}
                          {s.lastSpentOn}
                        </span>
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-fg">
                        {formatMoney(s.amount, s.currency)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
              Category
            </label>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className={cn(
                inputCls,
                "lq-press flex items-center gap-2 text-left",
              )}
            >
              <span className="text-lg" aria-hidden="true">
                {categoryEmoji}
              </span>
              <span className="min-w-0 flex-1 truncate text-fg">
                {categoryLabel}
              </span>
              <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
            </button>
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

      <CategoryPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        familyId={familyId}
        categories={catData?.categories ?? []}
        selectedId={categoryId}
        onSelect={(node, parent) => {
          setPicked({
            id: node.id,
            emoji: node.emoji,
            label: parent ? `${parent.name} · ${node.name}` : node.name,
          });
          setPickerOpen(false);
        }}
      />
    </>
  );
}

function CategoryPickerSheet({
  open,
  onClose,
  familyId,
  categories,
  selectedId,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  familyId: string;
  categories: CategoryNode[];
  selectedId: string | null;
  onSelect: (node: CategoryNode, parent: CategoryNode | null) => void;
}) {
  const qc = useQueryClient();
  const [parent, setParent] = useState<CategoryNode | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("📦");
  const [createError, setCreateError] = useState("");

  function dismiss() {
    setParent(null);
    setCreating(false);
    setNewName("");
    setCreateError("");
    onClose();
  }

  const createCat = useMutation({
    mutationFn: () =>
      api<{ category: CategoryNode }>("/expenses/categories", {
        method: "POST",
        body: JSON.stringify({
          familyId,
          name: newName.trim(),
          emoji: newEmoji,
          parentId: parent?.id ?? null,
        }),
      }),
    onSuccess: (body) => {
      void qc.invalidateQueries({ queryKey: ["expense-categories", familyId] });
      const created = body.category;
      onSelect(
        { ...created, children: created.children ?? [] },
        parent,
      );
      setCreating(false);
      setNewName("");
      setParent(null);
      setCreateError("");
    },
    onError: (e: Error) => setCreateError(e.message),
  });

  const title = creating
    ? parent
      ? `New under ${parent.emoji} ${parent.name}`
      : "New category"
    : parent
      ? `${parent.emoji} ${parent.name}`
      : "Category";

  return (
    <Sheet open={open} onClose={dismiss} title={title}>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {creating ? (
          <div className="space-y-3 pt-1">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
                Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={parent ? "e.g. Office lunch" : "e.g. Pets"}
                className={inputCls}
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
                Emoji
              </label>
              <div className="flex flex-wrap gap-2">
                {QUICK_EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    aria-pressed={newEmoji === em}
                    onClick={() => setNewEmoji(em)}
                    className={cn(
                      "lq lq-flat lq-press flex size-10 items-center justify-center rounded-xl text-lg",
                      newEmoji === em && "lq-primary text-white",
                    )}
                  >
                    {em}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={newEmoji}
                onChange={(e) => setNewEmoji(e.target.value.slice(0, 8))}
                aria-label="Custom emoji"
                className={cn(inputCls, "mt-2")}
              />
            </div>
            {createError && <p className="text-xs text-danger">{createError}</p>}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="primary"
                className="flex-1"
                loading={createCat.isPending}
                disabled={!newName.trim()}
                onClick={() => {
                  if (!newName.trim()) {
                    setCreateError("Enter a name.");
                    return;
                  }
                  setCreateError("");
                  createCat.mutate();
                }}
              >
                Create & select
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Back
              </Button>
            </div>
          </div>
        ) : parent ? (
          <div className="space-y-1 pt-1">
            <button
              type="button"
              className="lq-press mb-2 flex items-center gap-1 text-sm text-fg-muted"
              onClick={() => setParent(null)}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              All categories
            </button>
            <button
              type="button"
              onClick={() => onSelect(parent, null)}
              className={cn(
                "lq lq-flat lq-press flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left",
                selectedId === parent.id && "lq-primary text-white",
              )}
            >
              <span className="text-xl" aria-hidden="true">
                {parent.emoji}
              </span>
              <span className="flex-1 text-sm font-medium">
                {parent.name} <span className="text-fg-muted">(all)</span>
              </span>
            </button>
            {parent.children.map((child) => (
              <button
                key={child.id}
                type="button"
                onClick={() => onSelect(child, parent)}
                className={cn(
                  "lq lq-flat lq-press flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left",
                  selectedId === child.id && "lq-primary text-white",
                )}
              >
                <span className="text-xl" aria-hidden="true">
                  {child.emoji}
                </span>
                <span className="flex-1 text-sm font-medium">{child.name}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setNewEmoji(parent.emoji);
                setCreating(true);
              }}
              className="lq-press mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 px-3 py-3 text-sm font-medium text-fg-muted"
            >
              <Plus className="size-4" aria-hidden="true" />
              New subcategory
            </button>
          </div>
        ) : (
          <div className="pt-1">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    if (cat.children.length > 0) setParent(cat);
                    else onSelect(cat, null);
                  }}
                  className={cn(
                    "lq lq-flat lq-press flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-center",
                    selectedId === cat.id && "lq-primary text-white",
                  )}
                >
                  <span className="text-2xl" aria-hidden="true">
                    {cat.emoji}
                  </span>
                  <span className="line-clamp-2 text-[11px] leading-tight font-semibold">
                    {cat.name}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setNewEmoji("📦");
                setCreating(true);
              }}
              className="lq-press mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 px-3 py-3 text-sm font-medium text-fg-muted"
            >
              <Plus className="size-4" aria-hidden="true" />
              New category
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
