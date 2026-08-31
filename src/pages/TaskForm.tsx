import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Plus,
  X,
  Trash2,
  GripVertical,
  Link2,
  Bell,
  Calendar,
  User,
  FileText,
  CheckCircle2,
  Circle,
  ChevronDown,
  AlertCircle,
  ListChecks,
} from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Button } from "../components/ui/Button";
import { Skeleton } from "../components/ui/Skeleton";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

/* ── Types ───────────────────────────────────────────────────────────────────── */

interface Member {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  picture: string | null;
}

interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

interface TaskDetail {
  id: string;
  familyId: string;
  title: string;
  notes?: string | null;
  assignedToMemberId?: string | null;
  dueDate?: string | null;
  status: "open" | "done" | "archived";
  referredTaskId?: string | null;
  subtasksJson?: string | null;
  reminderDate?: string | null;
  remindMemberId?: string | null;
}

interface TaskListItem {
  id: string;
  title: string;
  status: string;
}

interface FormState {
  title: string;
  notes: string;
  assignedToMemberId: string;
  dueDate: string;
  referredTaskId: string;
  reminderDate: string;
  remindMemberId: string;
}

/* ── Premium Form Input ──────────────────────────────────────────────────────── */

function FormSection({
  label,
  required,
  icon: Icon,
  children,
  error,
}: {
  label: string;
  required?: boolean;
  icon: typeof FileText;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <div className="card-premium p-4 space-y-2">
      <label className="flex items-center gap-2 text-xs font-semibold text-fg-muted">
        <Icon className="size-3.5" />
        {label}
        {required && <span className="text-danger">*</span>}
      </label>
      {children}
      {error && (
        <p className="flex items-center gap-1 text-xs text-danger">
          <AlertCircle className="size-3" />
          {error}
        </p>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-xl bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle border border-line focus:border-vault-500 focus:outline-none transition-colors";

const selectCls =
  "w-full rounded-xl bg-ink-950 px-3.5 py-3 text-sm text-fg border border-line focus:border-vault-500 focus:outline-none transition-colors appearance-none";

/* ── Subtask Builder ─────────────────────────────────────────────────────────── */

function SubtaskBuilder({
  subtasks,
  onChange,
}: {
  subtasks: Subtask[];
  onChange: (s: Subtask[]) => void;
}) {
  const [newTitle, setNewTitle] = useState("");

  function addSubtask() {
    const title = newTitle.trim();
    if (!title) return;
    onChange([...subtasks, { id: crypto.randomUUID(), title, done: false }]);
    setNewTitle("");
  }

  function removeSubtask(id: string) {
    onChange(subtasks.filter((s) => s.id !== id));
  }

  function toggleSubtask(id: string) {
    onChange(
      subtasks.map((s) => (s.id === id ? { ...s, done: !s.done } : s)),
    );
  }

  function updateTitle(id: string, title: string) {
    onChange(subtasks.map((s) => (s.id === id ? { ...s, title } : s)));
  }

  const doneCount = subtasks.filter((s) => s.done).length;
  const pct = subtasks.length > 0 ? Math.round((doneCount / subtasks.length) * 100) : 0;

  return (
    <div className="card-premium p-4 space-y-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs font-semibold text-fg-muted">
          <ListChecks className="size-3.5" />
          Subtasks
        </label>
        {subtasks.length > 0 && (
          <span className="text-[11px] font-medium text-fg-subtle">
            {doneCount}/{subtasks.length} done
          </span>
        )}
      </div>

      {/* Progress bar */}
      {subtasks.length > 0 && (
        <div className="h-1.5 rounded-full bg-line overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-vault-500 to-vault-300 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Subtask list */}
      {subtasks.length > 0 && (
        <div className="space-y-1">
          {subtasks.map((st) => (
            <div
              key={st.id}
              className="group flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white/[0.03] transition-colors"
            >
              <GripVertical className="size-3.5 text-fg-subtle opacity-0 group-hover:opacity-50 cursor-grab shrink-0" />
              <button
                type="button"
                onClick={() => toggleSubtask(st.id)}
                className="shrink-0 checkbox-bounce"
              >
                {st.done ? (
                  <CheckCircle2 className="size-[18px] text-vault-400" />
                ) : (
                  <Circle className="size-[18px] text-fg-subtle" />
                )}
              </button>
              <input
                type="text"
                value={st.title}
                onChange={(e) => updateTitle(st.id, e.target.value)}
                className={`flex-1 bg-transparent text-sm text-fg outline-none ${
                  st.done ? "line-through text-fg-subtle" : ""
                }`}
              />
              <button
                type="button"
                onClick={() => removeSubtask(st.id)}
                className="shrink-0 size-6 flex items-center justify-center rounded-full text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-m3-red-bg transition-all"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add subtask */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={addSubtask}
          disabled={!newTitle.trim()}
          className="shrink-0 size-7 flex items-center justify-center rounded-full bg-vault-500/10 text-vault-400 hover:bg-vault-500/20 transition-colors disabled:opacity-40"
        >
          <Plus className="size-4" />
        </button>
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addSubtask();
            }
          }}
          placeholder="Add a subtask…"
          className="flex-1 bg-transparent text-sm text-fg placeholder:text-fg-subtle outline-none"
        />
      </div>

      {subtasks.length >= 20 && (
        <p className="text-[11px] text-fg-subtle">Maximum 20 subtasks</p>
      )}
    </div>
  );
}

/* ── Collapsible Section ─────────────────────────────────────────────────────── */

function CollapsibleSection({
  label,
  icon: Icon,
  children,
  defaultOpen = false,
}: {
  label: string;
  icon: typeof Link2;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="card-premium overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex w-full items-center gap-2 p-4 text-xs font-semibold text-fg-muted tappable"
      >
        <Icon className="size-3.5" />
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown
          className={`size-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 animate-[fadeIn_150ms_ease-out]">
          {children}
        </div>
      )}
    </div>
  );
}

/* ── Main Form ───────────────────────────────────────────────────────────────── */

/**
 * Loader shell: resolves the task being edited, then mounts the fields with
 * their initial values already known. Seeding state from props (rather than
 * syncing it in an effect) keeps a single render pass.
 */
export function TaskForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);

  const { data: taskData, isLoading: isLoadingTask } = useQuery({
    queryKey: ["task", id],
    queryFn: () => api<{ task: TaskDetail }>(`/tasks/${id}`),
    enabled: isEdit,
  });

  if (isEdit && isLoadingTask) {
    return (
      <>
        <AppBar title="Edit task" back />
        <Page className="space-y-4 py-6">
          <Skeleton className="h-20 rounded-3xl" />
          <Skeleton className="h-14 rounded-3xl" />
          <Skeleton className="h-14 rounded-3xl" />
          <Skeleton className="h-32 rounded-3xl" />
        </Page>
      </>
    );
  }

  const task = taskData?.task ?? null;
  return <TaskFormFields key={task?.id ?? "new"} id={id} task={task} />;
}

function TaskFormFields({ id, task }: { id?: string; task: TaskDetail | null }) {
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeFamilyId } = useAuth();

  const [form, setForm] = useState<FormState>(() => ({
    title: task?.title ?? "",
    notes: task?.notes ?? "",
    assignedToMemberId: task?.assignedToMemberId ?? "",
    dueDate: task?.dueDate ?? "",
    referredTaskId: task?.referredTaskId ?? "",
    reminderDate: task?.reminderDate ?? "",
    remindMemberId: task?.remindMemberId ?? "",
  }));
  const [subtasks, setSubtasks] = useState<Subtask[]>(() => {
    if (!task?.subtasksJson) return [];
    try {
      return JSON.parse(task.subtasksJson) as Subtask[];
    } catch {
      return [];
    }
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fetch family members for assignee / reminder-member pickers
  const { data: membersData } = useQuery({
    queryKey: ["family-members"],
    queryFn: () => api<{ members: Member[] }>("/families/me/members"),
  });
  const members = membersData?.members ?? [];

  // Fetch all tasks for the "referred task" picker
  const { data: tasksData } = useQuery({
    queryKey: ["tasks", activeFamilyId],
    queryFn: () =>
      api<{ tasks: TaskListItem[] }>(
        activeFamilyId ? `/tasks?familyId=${activeFamilyId}` : "/tasks",
      ),
  });
  const allTasks = (tasksData?.tasks ?? []).filter((t) => t.id !== id);

  const mutation = useMutation({
    mutationFn: (payload: object) =>
      isEdit
        ? api(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : api("/tasks", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      if (isEdit) {
        void qc.invalidateQueries({ queryKey: ["task", id] });
      }
      navigate("/tasks", { replace: true });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api(`/tasks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      navigate("/tasks", { replace: true });
    },
  });

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.title.trim()) errs.title = "Title is required";
    if (form.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.dueDate)) {
      errs.dueDate = "Due date must be in YYYY-MM-DD format";
    }
    if (form.reminderDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.reminderDate)) {
      errs.reminderDate = "Reminder date must be in YYYY-MM-DD format";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const targetFamilyId = activeFamilyId;
    if (!targetFamilyId && !isEdit) {
      setErrors((prev) => ({ ...prev, title: "No active family found." }));
      return;
    }

    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      notes: form.notes.trim() || null,
      assignedToMemberId: form.assignedToMemberId || null,
      dueDate: form.dueDate || undefined,
      referredTaskId: form.referredTaskId || null,
      subtasks: subtasks.length > 0 ? subtasks : undefined,
      reminderDate: form.reminderDate || null,
      remindMemberId: form.remindMemberId || null,
    };

    if (!isEdit) {
      payload.familyId = targetFamilyId;
    }

    mutation.mutate(payload);
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: "" }));
  }

  /* ── Render ────────────────────────────────────────────────────────────────── */

  // Determine if advanced sections should auto-open
  const hasReferredTask = Boolean(form.referredTaskId);
  const hasReminder = Boolean(form.reminderDate || form.remindMemberId);

  return (
    <>
      <AppBar title={isEdit ? "Edit task" : "New task"} back />
      <Page className="pb-24">
        <form onSubmit={handleSubmit} noValidate className="space-y-3">
          {/* ── Title ──────────────────────────────────────────────────────── */}
          <FormSection label="Title" required icon={FileText} error={errors.title}>
            <input
              type="text"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Renew passports"
              className={inputCls}
              autoFocus={!isEdit}
            />
          </FormSection>

          {/* ── Assignee + Due Date (two-column on desktop) ────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Assignee */}
            <FormSection label="Assign to" icon={User}>
              <div className="relative">
                <select
                  value={form.assignedToMemberId}
                  onChange={(e) => set("assignedToMemberId", e.target.value)}
                  className={selectCls}
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name ?? m.email ?? "Member"}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-fg-subtle pointer-events-none" />
              </div>
            </FormSection>

            {/* Due Date */}
            <FormSection label="Due date" icon={Calendar} error={errors.dueDate}>
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => set("dueDate", e.target.value)}
                className={inputCls}
              />
            </FormSection>
          </div>

          {/* ── Notes ──────────────────────────────────────────────────────── */}
          <FormSection label="Notes" icon={FileText}>
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Any extra details…"
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </FormSection>

          {/* ── Subtasks ───────────────────────────────────────────────────── */}
          <SubtaskBuilder subtasks={subtasks} onChange={setSubtasks} />

          {/* ── Link to Another Task ───────────────────────────────────────── */}
          <CollapsibleSection
            label="Link to another task"
            icon={Link2}
            defaultOpen={hasReferredTask}
          >
            <div className="relative">
              <select
                value={form.referredTaskId}
                onChange={(e) => set("referredTaskId", e.target.value)}
                className={selectCls}
              >
                <option value="">No linked task</option>
                {allTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.status === "done" ? "✓ " : "○ "}
                    {t.title}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-fg-subtle pointer-events-none" />
            </div>
            {form.referredTaskId && (
              <button
                type="button"
                onClick={() => set("referredTaskId", "")}
                className="text-xs text-m3-red hover:underline"
              >
                Remove link
              </button>
            )}
          </CollapsibleSection>

          {/* ── Reminder ───────────────────────────────────────────────────── */}
          <CollapsibleSection
            label="Set a reminder"
            icon={Bell}
            defaultOpen={hasReminder}
          >
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] text-fg-subtle mb-1">
                  Remind on
                </label>
                <input
                  type="date"
                  value={form.reminderDate}
                  onChange={(e) => set("reminderDate", e.target.value)}
                  className={inputCls}
                />
                {errors.reminderDate && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-danger">
                    <AlertCircle className="size-3" />
                    {errors.reminderDate}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-[11px] text-fg-subtle mb-1">
                  Remind who
                </label>
                <div className="relative">
                  <select
                    value={form.remindMemberId}
                    onChange={(e) => set("remindMemberId", e.target.value)}
                    className={selectCls}
                  >
                    <option value="">Everyone</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name ?? m.email ?? "Member"}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-fg-subtle pointer-events-none" />
                </div>
              </div>
              {(form.reminderDate || form.remindMemberId) && (
                <button
                  type="button"
                  onClick={() => {
                    set("reminderDate", "");
                    set("remindMemberId", "");
                  }}
                  className="text-xs text-m3-red hover:underline"
                >
                  Clear reminder
                </button>
              )}
            </div>
          </CollapsibleSection>

          {/* ── Error Banner ───────────────────────────────────────────────── */}
          {mutation.isError && (
            <div className="flex items-center gap-2 rounded-2xl bg-m3-red-bg border border-m3-red/20 px-4 py-3">
              <AlertCircle className="size-4 text-m3-red shrink-0" />
              <p className="text-sm text-m3-red">
                {(mutation.error as Error).message}
              </p>
            </div>
          )}

          {/* ── Action Buttons ─────────────────────────────────────────────── */}
          <div className="flex flex-col gap-2.5 pt-2">
            <Button
              type="submit"
              variant="primary"
              fullWidth
              loading={mutation.isPending}
            >
              {isEdit ? "Save changes" : "Create task"}
            </Button>

            {isEdit && (
              <Button
                type="button"
                variant="danger"
                fullWidth
                loading={deleteMutation.isPending}
                leadingIcon={<Trash2 className="size-4" />}
                onClick={() => {
                  if (confirm("Are you sure you want to delete this task?")) {
                    deleteMutation.mutate();
                  }
                }}
              >
                Delete task
              </Button>
            )}
          </div>
        </form>
      </Page>
    </>
  );
}
