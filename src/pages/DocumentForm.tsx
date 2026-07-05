/**
 * DocumentForm — create or edit a document record.
 *
 * On create: POST /documents → navigates to /documents/:id (for optional file upload)
 * On edit:   PATCH /documents/:id → navigates back to /documents/:id
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, FileText } from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/cn";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { value: "passport", label: "Passport" },
  { value: "national_id", label: "National ID" },
  { value: "license", label: "Driving Licence" },
  { value: "insurance", label: "Insurance" },
  { value: "medical", label: "Medical" },
  { value: "vaccination", label: "Vaccination" },
  { value: "tax", label: "Tax" },
  { value: "vehicle", label: "Vehicle" },
  { value: "property", label: "Property" },
  { value: "warranty", label: "Warranty" },
  { value: "education", label: "Education" },
  { value: "financial", label: "Financial" },
  { value: "legal", label: "Legal" },
  { value: "other", label: "Other" },
] as const;

type Category = (typeof CATEGORIES)[number]["value"];

interface FamilyMember {
  id: string;
  userId: string | null;
  memberType: string;
  displayName: string | null;
  role: string;
}

interface DocumentFull {
  id: string;
  title: string;
  category: string;
  description: string | null;
  expiryDate: string | null;
  issuedDate: string | null;
  visibility: "family" | "private";
  subjectMemberId: string | null;
  familyId: string;
}

interface FormState {
  title: string;
  category: Category;
  description: string;
  expiryDate: string;
  issuedDate: string;
  visibility: "family" | "private";
  subjectMemberId: string;
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function FormField({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-fg-muted mb-1.5">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

function inputClass(hasError?: boolean) {
  return cn(
    "w-full rounded-xl bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle border focus:outline-none transition-colors",
    hasError
      ? "border-danger focus:border-danger"
      : "border-line focus:border-vault-500",
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DocumentForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { families } = useAuth();
  const activeFamilyId = families[0]?.id;

  const [form, setForm] = useState<FormState>({
    title: "",
    category: "other",
    description: "",
    expiryDate: "",
    issuedDate: "",
    visibility: "family",
    subjectMemberId: "",
  });
  const [errors, setErrors] = useState<Partial<FormState>>({});

  // Fetch existing doc for edit
  const { data: existingDoc } = useQuery({
    queryKey: ["document", id],
    queryFn: () => api<{ document: DocumentFull }>(`/documents/${id}`),
    enabled: isEdit && Boolean(id),
    select: (d) => d.document,
  });

  useEffect(() => {
    if (existingDoc) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({
        title: existingDoc.title,
        category: (existingDoc.category as Category) || "other",
        description: existingDoc.description ?? "",
        expiryDate: existingDoc.expiryDate ?? "",
        issuedDate: existingDoc.issuedDate ?? "",
        visibility: existingDoc.visibility,
        subjectMemberId: existingDoc.subjectMemberId ?? "",
      });
    }
  }, [existingDoc]);

  // Fetch family members for subject picker
  const { data: membersData } = useQuery({
    queryKey: ["family-members"],
    queryFn: () => api<{ members: FamilyMember[] }>("/families/me/members"),
  });
  const members = membersData?.members ?? [];

  const mutation = useMutation({
    mutationFn: (payload: object) => {
      if (isEdit) {
        return api<{ document: DocumentFull }>(`/documents/${id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      return api<{ document: DocumentFull }>("/documents", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["documents"] });
      void qc.invalidateQueries({ queryKey: ["document", id] });
      navigate(`/documents/${data.document.id}`, { replace: true });
    },
  });

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validate(): boolean {
    const errs: Partial<FormState> = {};
    if (!form.title.trim()) errs.title = "Title is required";
    if (
      form.expiryDate &&
      !/^\d{4}-\d{2}-\d{2}$/.test(form.expiryDate)
    ) {
      errs.expiryDate = "Use format YYYY-MM-DD";
    }
    if (
      form.issuedDate &&
      !/^\d{4}-\d{2}-\d{2}$/.test(form.issuedDate)
    ) {
      errs.issuedDate = "Use format YYYY-MM-DD";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    
    const targetFamilyId = activeFamilyId || families[0]?.id;
    if (!targetFamilyId && !isEdit) {
      setErrors((prev) => ({ ...prev, title: "No active family found. Please create a family first." }));
      return;
    }

    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      category: form.category,
      visibility: form.visibility,
    };

    if (!isEdit) payload.familyId = targetFamilyId;
    if (form.description.trim()) payload.description = form.description.trim();
    if (form.expiryDate) payload.expiryDate = form.expiryDate;
    if (form.issuedDate) payload.issuedDate = form.issuedDate;
    if (form.subjectMemberId) payload.subjectMemberId = form.subjectMemberId;

    mutation.mutate(payload);
  }

  return (
    <>
      <AppBar title={isEdit ? "Edit document" : "Add document"} back />
      <Page width="list" className="space-y-4">
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Title */}
          <Card className="p-4">
            <FormField label="Document title" required error={errors.title}>
              <input
                type="text"
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="e.g. Dad's Passport, Car Insurance 2025"
                autoFocus
                className={inputClass(Boolean(errors.title))}
              />
            </FormField>
          </Card>

          {/* Category */}
          <Card className="p-4">
            <p className="mb-3 text-xs font-semibold text-fg-muted uppercase tracking-wider">
              Category
            </p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => set("category", value)}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-xs font-medium transition-all",
                    form.category === value
                      ? "bg-vault-600 text-white"
                      : "bg-white/5 text-fg-muted hover:bg-white/10 hover:text-fg",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Card>

          {/* Dates */}
          <Card className="p-4 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <CalendarDays className="size-4 text-fg-muted" />
              <p className="text-xs font-semibold text-fg-muted uppercase tracking-wider">
                Dates (optional)
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Issue date" error={errors.issuedDate}>
                <input
                  type="date"
                  value={form.issuedDate}
                  onChange={(e) => set("issuedDate", e.target.value)}
                  className={inputClass(Boolean(errors.issuedDate))}
                />
              </FormField>
              <FormField label="Expiry date" error={errors.expiryDate}>
                <input
                  type="date"
                  value={form.expiryDate}
                  onChange={(e) => set("expiryDate", e.target.value)}
                  className={inputClass(Boolean(errors.expiryDate))}
                />
              </FormField>
            </div>
            {form.expiryDate && (
              <p className="text-xs text-fg-muted">
                We'll remind you before this document expires.
              </p>
            )}
          </Card>

          {/* Subject member */}
          {members.length > 0 && (
            <Card className="p-4">
              <FormField label="Belongs to (optional)">
                <select
                  value={form.subjectMemberId}
                  onChange={(e) => set("subjectMemberId", e.target.value)}
                  className={inputClass()}
                >
                  <option value="">— The whole family —</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName ?? `Member ${m.id.slice(0, 6)}`}
                    </option>
                  ))}
                </select>
              </FormField>
            </Card>
          )}

          {/* Description */}
          <Card className="p-4">
            <FormField label="Description (optional)">
              <textarea
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Any notes about this document…"
                rows={3}
                className={cn(inputClass(), "resize-none")}
              />
            </FormField>
          </Card>

          {/* Visibility */}
          <Card className="p-4">
            <p className="mb-3 text-xs font-semibold text-fg-muted uppercase tracking-wider">
              Visibility
            </p>
            <div className="flex gap-3">
              {(["family", "private"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => set("visibility", v)}
                  className={cn(
                    "flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-all",
                    form.visibility === v
                      ? "bg-vault-600 text-white"
                      : "bg-white/5 text-fg-muted hover:bg-white/10",
                  )}
                >
                  {v === "family" ? "👨‍👩‍👧 Family" : "🔒 Private"}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-fg-subtle">
              {form.visibility === "family"
                ? "All family members can view this document."
                : "Only you and admins can view this document."}
            </p>
          </Card>

          {mutation.isError && (
            <p className="px-1 text-sm text-danger">
              {(mutation.error as Error).message}
            </p>
          )}

          <Button
            type="submit"
            fullWidth
            size="lg"
            loading={mutation.isPending}
            leadingIcon={<FileText className="size-4" />}
          >
            {isEdit ? "Save changes" : "Create document"}
          </Button>
        </form>
      </Page>
    </>
  );
}
