import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Pencil,
  Plus,
  RotateCcw,
  Shapes,
  Trash2,
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
  CATEGORY_COLORS,
  categoryColorClasses,
  useEnsureExpenseSetup,
  type ExpenseCategory,
} from "../../lib/expenses";

interface EditorState {
  mode: "create-category" | "create-subcategory" | "edit";
  category?: ExpenseCategory;
  parent?: ExpenseCategory;
}

function CategorySkeleton() {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3">
      <Skeleton className="size-9 rounded-xl" />
      <Skeleton className="h-3.5 w-1/3" />
    </div>
  );
}

/** Emoji tile shared by rows and the editor preview. */
function CategoryIcon({
  emoji,
  color,
  className,
}: {
  emoji: string | null;
  color: string | null;
  className?: string;
}) {
  const colors = categoryColorClasses(color);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl text-lg",
        colors.bg,
        className,
      )}
    >
      {emoji ?? "•"}
    </span>
  );
}

export function CategoryManager() {
  const qc = useQueryClient();
  const { activeFamily } = useAuth();
  const [params, setParams] = useSearchParams();
  const showArchived = params.get("view") === "archived";

  const [expanded, setExpanded] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);

  const familyId = activeFamily?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["expense-categories", familyId, "all"],
    queryFn: () =>
      api<{ categories: ExpenseCategory[] }>(
        `/expense-categories?familyId=${familyId}&includeArchived=1`,
      ),
    enabled: Boolean(familyId),
  });

  // First visit to the module installs the defaults (idempotent server-side).
  const { isSettingUp } = useEnsureExpenseSetup(
    familyId,
    Boolean(data) && data!.categories.length === 0,
  );

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["expense-categories"] });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "archived" }) =>
      api(`/expense-categories/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/expense-categories/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const reorder = useMutation({
    mutationFn: (items: { id: string; sortOrder: number }[]) =>
      api("/expense-categories/reorder", {
        method: "POST",
        body: JSON.stringify({ familyId, items }),
      }),
    onSuccess: invalidate,
  });

  const all = data?.categories ?? [];
  const visible = all
    .map((c) => ({
      ...c,
      children: c.children.filter((ch) =>
        showArchived ? ch.status === "archived" : ch.status === "active",
      ),
    }))
    .filter((c) => (showArchived ? c.status === "archived" : c.status === "active"));

  /**
   * Move a category one slot within its siblings. Renumbering the whole visible
   * list (rather than swapping two values) is self-healing: any duplicate or
   * gapped sort order left by an older client gets normalised on the next move.
   */
  const move = (index: number, direction: -1 | 1) => {
    const siblings = [...visible];
    const target = index + direction;
    if (target < 0 || target >= siblings.length) return;
    [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
    reorder.mutate(siblings.map((c, i) => ({ id: c.id, sortOrder: i * 10 })));
  };

  const mutationError =
    (setStatus.error as ApiError | null)?.message ??
    (remove.error as ApiError | null)?.message ??
    (reorder.error as ApiError | null)?.message;

  return (
    <>
      <AppBar title="Categories" back />
      <Page className="space-y-4">
        <div
          role="tablist"
          aria-label="Category status"
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
            {Array.from({ length: 6 }).map((_, i) => (
              <CategorySkeleton key={i} />
            ))}
          </Card>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Shapes}
            title={showArchived ? "Nothing archived" : "No categories yet"}
            description={
              showArchived
                ? "Categories you archive stay here — their past expenses keep working."
                : "Add a category to start organising your spending."
            }
            action={
              showArchived ? undefined : (
                <Button
                  leadingIcon={<Plus className="size-4" />}
                  onClick={() => setEditor({ mode: "create-category" })}
                >
                  Add category
                </Button>
              )
            }
          />
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {visible.map((category, index) => {
              const isOpen = expanded === category.id;
              return (
                <div key={category.id}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : category.id)}
                    aria-expanded={isOpen}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5"
                  >
                    <CategoryIcon emoji={category.emoji} color={category.color} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">
                        {category.name}
                      </span>
                      {category.children.length > 0 && (
                        <span className="mt-0.5 block text-xs text-fg-muted">
                          {category.children.length} subcategories
                        </span>
                      )}
                    </span>
                    {category.status === "archived" && (
                      <Badge tone="neutral">Archived</Badge>
                    )}
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        "size-5 shrink-0 text-fg-subtle transition-transform",
                        isOpen && "rotate-180",
                      )}
                    />
                  </button>

                  {isOpen && (
                    <div className="space-y-3 bg-ink-950/40 px-4 pt-1 pb-4">
                      {category.children.length > 0 && (
                        <ul className="space-y-1">
                          {category.children.map((child) => (
                            <li
                              key={child.id}
                              className="flex min-h-11 items-center gap-2 rounded-lg px-1"
                            >
                              <span aria-hidden="true" className="w-6 text-center">
                                {child.emoji ?? "•"}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">
                                {child.name}
                              </span>
                              <button
                                onClick={() =>
                                  setEditor({
                                    mode: "edit",
                                    category: child,
                                    parent: category,
                                  })
                                }
                                aria-label={`Edit ${child.name}`}
                                className="flex size-11 items-center justify-center rounded-full text-fg-subtle hover:bg-white/5"
                              >
                                <Pencil className="size-4" aria-hidden="true" />
                              </button>
                              <button
                                onClick={() =>
                                  setStatus.mutate({
                                    id: child.id,
                                    status:
                                      child.status === "archived" ? "active" : "archived",
                                  })
                                }
                                aria-label={
                                  child.status === "archived"
                                    ? `Restore ${child.name}`
                                    : `Archive ${child.name}`
                                }
                                className="flex size-11 items-center justify-center rounded-full text-fg-subtle hover:bg-white/5"
                              >
                                {child.status === "archived" ? (
                                  <RotateCcw className="size-4" aria-hidden="true" />
                                ) : (
                                  <Archive className="size-4" aria-hidden="true" />
                                )}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="md"
                          variant="secondary"
                          leadingIcon={<Pencil className="size-4" />}
                          onClick={() => setEditor({ mode: "edit", category })}
                        >
                          Edit
                        </Button>
                        {category.status === "active" && (
                          <Button
                            size="md"
                            variant="secondary"
                            leadingIcon={<Plus className="size-4" />}
                            onClick={() =>
                              setEditor({ mode: "create-subcategory", parent: category })
                            }
                          >
                            Subcategory
                          </Button>
                        )}
                        <Button
                          size="md"
                          variant="secondary"
                          leadingIcon={
                            category.status === "archived" ? (
                              <RotateCcw className="size-4" />
                            ) : (
                              <Archive className="size-4" />
                            )
                          }
                          loading={setStatus.isPending}
                          onClick={() =>
                            setStatus.mutate({
                              id: category.id,
                              status:
                                category.status === "archived" ? "active" : "archived",
                            })
                          }
                        >
                          {category.status === "archived" ? "Restore" : "Archive"}
                        </Button>
                        {!category.isSystem && category.children.length === 0 && (
                          <Button
                            size="md"
                            variant="danger"
                            leadingIcon={<Trash2 className="size-4" />}
                            loading={remove.isPending}
                            onClick={() => remove.mutate(category.id)}
                          >
                            Delete
                          </Button>
                        )}
                      </div>

                      {!showArchived && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-fg-subtle">Order</span>
                          <button
                            onClick={() => move(index, -1)}
                            disabled={index === 0 || reorder.isPending}
                            aria-label={`Move ${category.name} up`}
                            className="flex size-11 items-center justify-center rounded-full border border-line text-fg-muted disabled:opacity-40"
                          >
                            <ArrowUp className="size-4" aria-hidden="true" />
                          </button>
                          <button
                            onClick={() => move(index, 1)}
                            disabled={index === visible.length - 1 || reorder.isPending}
                            aria-label={`Move ${category.name} down`}
                            className="flex size-11 items-center justify-center rounded-full border border-line text-fg-muted disabled:opacity-40"
                          >
                            <ArrowDown className="size-4" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        )}

        <p className="px-1 text-xs text-fg-subtle">
          Archiving keeps a category out of new expenses while every past expense
          it holds stays intact and reportable.
        </p>
      </Page>

      {!showArchived && (
        <Fab
          icon={Plus}
          label="Add category"
          onClick={() => setEditor({ mode: "create-category" })}
        />
      )}

      {editor && familyId && (
        <CategoryEditor
          key={`${editor.mode}-${editor.category?.id ?? editor.parent?.id ?? "new"}`}
          state={editor}
          familyId={familyId}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}

function CategoryEditor({
  state,
  familyId,
  onClose,
}: {
  state: EditorState;
  familyId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = state.mode === "edit";
  const isSubcategory =
    state.mode === "create-subcategory" || Boolean(state.category?.parentId);

  const [name, setName] = useState(state.category?.name ?? "");
  const [emoji, setEmoji] = useState<string | null>(state.category?.emoji ?? null);
  const [color, setColor] = useState<string | null>(state.category?.color ?? null);
  const [error, setError] = useState<string | null>(null);

  const parent = state.parent;

  const save = useMutation({
    mutationFn: () => {
      const trimmed = name.trim();
      if (isEdit) {
        return api(`/expense-categories/${state.category!.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: trimmed,
            emoji,
            // Subcategories inherit their parent's colour.
            ...(isSubcategory ? {} : { color }),
          }),
        });
      }
      return api("/expense-categories", {
        method: "POST",
        body: JSON.stringify({
          familyId,
          name: trimmed,
          ...(emoji ? { emoji } : {}),
          ...(!isSubcategory && color ? { color } : {}),
          ...(parent ? { parentId: parent.id } : {}),
        }),
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["expense-categories"] });
      onClose();
    },
    onError: (e) => setError((e as ApiError).message),
  });

  const submit = () => {
    setError(null);
    if (name.trim() === "") {
      setError("Give the category a name.");
      return;
    }
    save.mutate();
  };

  const title = isEdit
    ? "Edit category"
    : isSubcategory
      ? "New subcategory"
      : "New category";

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      description={parent ? `In ${parent.name}` : undefined}
      footer={
        <Button fullWidth size="lg" loading={save.isPending} onClick={submit}>
          {isEdit ? "Save changes" : "Add"}
        </Button>
      }
    >
      <div className="flex items-center gap-3">
        <CategoryIcon
          emoji={emoji}
          color={isSubcategory ? (parent?.color ?? null) : color}
          className="size-12 text-2xl"
        />
        <div className="min-w-0 flex-1">
          <Field label="Name" required error={error ?? undefined}>
            {(props) => (
              <input
                {...props}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={isSubcategory ? "e.g. Groceries" : "e.g. Food"}
                maxLength={60}
                className={inputClass}
              />
            )}
          </Field>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold text-fg-muted">Icon</p>
        <EmojiPicker value={emoji} onChange={setEmoji} />
      </div>

      {!isSubcategory && (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-fg-muted">Colour</p>
          <ChipGroup label="Category colour">
            {CATEGORY_COLORS.map((c) => {
              const classes = categoryColorClasses(c);
              return (
                <Chip
                  key={c}
                  selected={color === c}
                  onClick={() => setColor(c)}
                  label={c}
                  className={cn("size-11 px-0", color === c && "ring-2 ring-vault-400")}
                >
                  <span
                    aria-hidden="true"
                    className={cn("mx-auto block size-5 rounded-full", classes.bg, classes.text)}
                  >
                    <span className="block size-full rounded-full bg-current opacity-70" />
                  </span>
                </Chip>
              );
            })}
          </ChipGroup>
          <p className="mt-1 text-xs text-fg-subtle">
            Subcategories inherit this colour.
          </p>
        </div>
      )}
    </Sheet>
  );
}
