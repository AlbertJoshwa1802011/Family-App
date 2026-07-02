import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Lock, Users } from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

const CATEGORIES = [
  { value: "identity", label: "Identity" },
  { value: "insurance", label: "Insurance" },
  { value: "medical", label: "Medical" },
  { value: "vehicle", label: "Vehicle" },
  { value: "finance", label: "Finance" },
  { value: "warranty", label: "Warranty" },
  { value: "education", label: "Education" },
  { value: "other", label: "Other" },
];

interface DocumentPayload {
  id: string;
  title: string;
  category: string;
  description: string | null;
  expiryDate: string | null;
  issuedDate: string | null;
  visibility: "family" | "private";
}

interface FormState {
  title: string;
  category: string;
  description: string;
  expiryDate: string;
  issuedDate: string;
  visibility: "family" | "private";
}

const inputCls =
  "w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none";

export function DocumentForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeFamily } = useAuth();

  const [form, setForm] = useState<FormState>({
    title: "",
    category: "other",
    description: "",
    expiryDate: "",
    issuedDate: "",
    visibility: "family",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  // Edit mode: hydrate the form once from the existing document.
  useQuery({
    queryKey: ["document", id],
    queryFn: async () => {
      const res = await api<{ document: DocumentPayload }>(`/documents/${id}`);
      if (!loaded) {
        const d = res.document;
        setForm({
          title: d.title,
          category: d.category,
          description: d.description ?? "",
          expiryDate: d.expiryDate ?? "",
          issuedDate: d.issuedDate ?? "",
          visibility: d.visibility,
        });
        setLoaded(true);
      }
      return res;
    },
    enabled: isEdit,
  });

  const mutation = useMutation({
    mutationFn: (payload: object) =>
      isEdit
        ? api<{ document: DocumentPayload }>(`/documents/${id}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : api<{ document: DocumentPayload }>("/documents", {
            method: "POST",
            body: JSON.stringify(payload),
          }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["documents"] });
      void qc.invalidateQueries({ queryKey: ["document", id] });
      navigate(`/documents/${res.document.id}`, { replace: true });
    },
  });

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: "" }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.title.trim()) errs.title = "Title is required";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    mutation.mutate({
      ...(isEdit ? {} : { familyId: activeFamily!.id }),
      title: form.title.trim(),
      category: form.category,
      description: form.description.trim() || (isEdit ? null : undefined),
      expiryDate: form.expiryDate || undefined,
      issuedDate: form.issuedDate || undefined,
      visibility: form.visibility,
    });
  }

  return (
    <>
      <AppBar title={isEdit ? "Edit document" : "Add document"} back />
      <Page className="space-y-4">
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <Card className="p-4">
            <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
              Title <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Mum's passport"
              className={inputCls}
            />
            {errors.title && (
              <p className="mt-1 text-xs text-danger">{errors.title}</p>
            )}
          </Card>

          <Card className="p-4">
            <p className="mb-2 text-xs font-semibold text-fg-muted">Category</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => set("category", value)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    form.category === value
                      ? "bg-vault-600 text-white"
                      : "bg-white/5 text-fg-muted hover:bg-white/10"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Card>

          <Card className="space-y-3 p-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
                Expiry date (for reminders)
              </label>
              <input
                type="date"
                value={form.expiryDate}
                onChange={(e) => set("expiryDate", e.target.value)}
                className={inputCls}
              />
              <p className="mt-1 text-xs text-fg-subtle">
                We'll remind everyone before this date.
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
                Issued date (optional)
              </label>
              <input
                type="date"
                value={form.issuedDate}
                onChange={(e) => set("issuedDate", e.target.value)}
                className={inputCls}
              />
            </div>
          </Card>

          <Card className="p-4">
            <p className="mb-2 text-xs font-semibold text-fg-muted">
              Who can see this?
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => set("visibility", "family")}
                className={`flex items-center gap-2 rounded-xl border px-3.5 py-3 text-sm transition-colors ${
                  form.visibility === "family"
                    ? "border-vault-500/50 bg-vault-500/10 text-vault-300"
                    : "border-line text-fg-muted hover:bg-white/5"
                }`}
              >
                <Users className="size-4 shrink-0" />
                Whole family
              </button>
              <button
                type="button"
                onClick={() => set("visibility", "private")}
                className={`flex items-center gap-2 rounded-xl border px-3.5 py-3 text-sm transition-colors ${
                  form.visibility === "private"
                    ? "border-vault-500/50 bg-vault-500/10 text-vault-300"
                    : "border-line text-fg-muted hover:bg-white/5"
                }`}
              >
                <Lock className="size-4 shrink-0" />
                Only me
              </button>
            </div>
          </Card>

          <Card className="p-4">
            <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
              Notes (optional)
            </label>
            <textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Policy number, renewal steps, anything useful…"
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </Card>

          {mutation.isError && (
            <p className="px-1 text-sm text-danger">
              {(mutation.error as Error).message}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            fullWidth
            loading={mutation.isPending}
          >
            {isEdit ? "Save changes" : "Add document"}
          </Button>
        </form>
      </Page>
    </>
  );
}
