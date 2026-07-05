import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

interface Member {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  picture: string | null;
}

interface TaskDetail {
  id: string;
  familyId: string;
  title: string;
  notes?: string | null;
  assignedToMemberId?: string | null;
  dueDate?: string | null;
  status: "open" | "done" | "archived";
}

interface FormState {
  title: string;
  notes: string;
  assignedToMemberId: string;
  dueDate: string; // yyyy-mm-dd
}

export function TaskForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { families } = useAuth();
  const activeFamilyId = families[0]?.id;

  const [form, setForm] = useState<FormState>({
    title: "",
    notes: "",
    assignedToMemberId: "",
    dueDate: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fetch family members for assignee picker
  const { data: membersData } = useQuery({
    queryKey: ["family-members"],
    queryFn: () => api<{ members: Member[] }>("/families/me/members"),
  });
  const members = membersData?.members ?? [];

  // Fetch task if editing
  const { data: taskData, isLoading: isLoadingTask } = useQuery({
    queryKey: ["task", id],
    queryFn: () => api<{ task: TaskDetail }>(`/tasks/${id}`),
    enabled: isEdit,
  });

  useEffect(() => {
    if (taskData?.task) {
      const task = taskData.task;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({
        title: task.title,
        notes: task.notes ?? "",
        assignedToMemberId: task.assignedToMemberId ?? "",
        dueDate: task.dueDate ?? "",
      });
    }
  }, [taskData]);

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
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const targetFamilyId = activeFamilyId || families[0]?.id;
    if (!targetFamilyId && !isEdit) {
      setErrors((prev) => ({ ...prev, title: "No active family found." }));
      return;
    }

    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      notes: form.notes.trim() || null,
      assignedToMemberId: form.assignedToMemberId || null,
      dueDate: form.dueDate || undefined,
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

  if (isEdit && isLoadingTask) {
    return (
      <>
        <AppBar title="Edit task" back />
        <Page className="flex items-center justify-center py-12 text-fg-subtle">
          Loading task details…
        </Page>
      </>
    );
  }

  return (
    <>
      <AppBar title={isEdit ? "Edit task" : "New task"} back />
      <Page className="space-y-4">
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Title */}
          <Card className="p-4">
            <label className="block text-xs font-semibold text-fg-muted mb-1.5">
              Title <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Renew passports"
              className="w-full rounded-xl bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle border border-line focus:border-vault-500 focus:outline-none"
            />
            {errors.title && (
              <p className="mt-1 text-xs text-danger">{errors.title}</p>
            )}
          </Card>

          {/* Assignee */}
          {members.length > 0 && (
            <Card className="p-4">
              <label className="block text-xs font-semibold text-fg-muted mb-1.5">
                Assign to (optional)
              </label>
              <select
                value={form.assignedToMemberId}
                onChange={(e) => set("assignedToMemberId", e.target.value)}
                className="w-full rounded-xl bg-ink-950 px-3.5 py-3 text-sm text-fg border border-line focus:border-vault-500 focus:outline-none"
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name ?? m.email ?? "Member"}
                  </option>
                ))}
              </select>
            </Card>
          )}

          {/* Due Date */}
          <Card className="p-4">
            <label className="block text-xs font-semibold text-fg-muted mb-1.5">
              Due Date (optional)
            </label>
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => set("dueDate", e.target.value)}
              className="w-full rounded-xl bg-ink-950 px-3.5 py-3 text-sm text-fg border border-line focus:border-vault-500 focus:outline-none"
            />
            {errors.dueDate && (
              <p className="mt-1 text-xs text-danger">{errors.dueDate}</p>
            )}
          </Card>

          {/* Notes */}
          <Card className="p-4">
            <label className="block text-xs font-semibold text-fg-muted mb-1.5">
              Notes (optional)
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Any extra details…"
              rows={4}
              className="w-full resize-none rounded-xl bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle border border-line focus:border-vault-500 focus:outline-none"
            />
          </Card>

          {mutation.isError && (
            <p className="px-1 text-sm text-danger">
              {(mutation.error as Error).message}
            </p>
          )}

          <div className="flex flex-col gap-2.5">
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
