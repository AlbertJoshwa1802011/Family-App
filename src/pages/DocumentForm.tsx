import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Lock, Sparkles, Users } from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { inputCls } from "../lib/fieldCls";
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
  subjectMemberId: string | null;
}

interface Member {
  id: string;
  displayName: string | null;
  name: string | null;
  email: string | null;
}

interface FormState {
  title: string;
  category: string;
  description: string;
  expiryDate: string;
  issuedDate: string;
  visibility: "family" | "private";
  subjectMemberId: string;
}

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
    subjectMemberId: "",
  });

  const { data: membersData } = useQuery({
    queryKey: ["family-members", activeFamily?.id],
    queryFn: () =>
      api<{ members: Member[] }>(`/families/${activeFamily!.id}/members`),
    enabled: Boolean(activeFamily),
  });
  const members = membersData?.members ?? [];
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const categoryTouched = useRef(false);

  // Suggest a category from the title (debounced; heuristics or AI server-side).
  // Only while the user hasn't picked a category themselves, and only on create.
  useEffect(() => {
    if (isEdit || categoryTouched.current || form.title.trim().length < 3) {
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api<{ category: string | null }>(
          "/documents/suggest-category",
          {
            method: "POST",
            body: JSON.stringify({ title: form.title.trim() }),
          },
        );
        if (res.category && res.category !== form.category) {
          setSuggestion(res.category);
        }
      } catch {
        // Suggestions are best-effort; never surface an error for them.
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.title, isEdit]);

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
          subjectMemberId: d.subjectMemberId ?? "",
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
      subjectMemberId: form.subjectMemberId || (isEdit ? null : undefined),
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
                  onClick={() => {
                    categoryTouched.current = true;
                    setSuggestion(null);
                    set("category", value);
                  }}
                  className={`lq lq-flat lq-press rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                    form.category === value
                      ? "lq-primary text-white"
                      : "text-fg-muted hover:text-fg"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {suggestion && form.category !== suggestion && (
              <button
                type="button"
                onClick={() => {
                  set("category", suggestion);
                  setSuggestion(null);
                }}
                className="lq lq-flat lq-tint lq-press mt-3 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-vault-300 [--lq-tint:var(--color-vault-400)]"
              >
                <Sparkles className="size-3.5" />
                Suggested: {CATEGORIES.find((c) => c.value === suggestion)?.label ?? suggestion} — tap to apply
              </button>
            )}
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
                className={`lq lq-flat lq-press flex items-center justify-center gap-1.5 rounded-full px-3 py-3 text-[13px] font-semibold whitespace-nowrap ${
                  form.visibility === "family"
                    ? "lq-primary text-white"
                    : "text-fg-muted hover:text-fg"
                }`}
              >
                <Users className="size-4 shrink-0" />
                Whole family
              </button>
              <button
                type="button"
                onClick={() => set("visibility", "private")}
                className={`lq lq-flat lq-press flex items-center justify-center gap-1.5 rounded-full px-3 py-3 text-[13px] font-semibold whitespace-nowrap ${
                  form.visibility === "private"
                    ? "lq-primary text-white"
                    : "text-fg-muted hover:text-fg"
                }`}
              >
                <Lock className="size-4 shrink-0" />
                Only me
              </button>
            </div>
          </Card>

          {members.length > 0 && (
            <Card className="p-4">
              <p className="mb-2 text-xs font-semibold text-fg-muted">
                Belongs to (optional)
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => set("subjectMemberId", "")}
                  className={`lq lq-flat lq-press rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                    !form.subjectMemberId
                      ? "lq-primary text-white"
                      : "text-fg-muted hover:text-fg"
                  }`}
                >
                  Whole family
                </button>
                {members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => set("subjectMemberId", m.id)}
                    className={`lq lq-flat lq-press rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                      form.subjectMemberId === m.id
                        ? "lq-primary text-white"
                        : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    {m.displayName ?? m.name ?? m.email ?? "Member"}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-fg-subtle">
                Shows on that person's profile — e.g. Ella's passport.
              </p>
            </Card>
          )}

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
