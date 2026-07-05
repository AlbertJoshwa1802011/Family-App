import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

interface ContactDetail {
  id: string;
  familyId: string;
  name: string;
  relationship?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

interface FormState {
  name: string;
  relationship: string;
  phone: string;
  email: string;
  notes: string;
}

export function ContactForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { families } = useAuth();
  const activeFamilyId = families[0]?.id;

  const [form, setForm] = useState<FormState>({
    name: "",
    relationship: "",
    phone: "",
    email: "",
    notes: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fetch contact if editing
  const { data: contactData, isLoading: isLoadingContact } = useQuery({
    queryKey: ["contact", id],
    queryFn: () => api<{ contact: ContactDetail }>(`/contacts/${id}`),
    enabled: isEdit,
  });

  useEffect(() => {
    if (contactData?.contact) {
      const contact = contactData.contact;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({
        name: contact.name,
        relationship: contact.relationship ?? "",
        phone: contact.phone ?? "",
        email: contact.email ?? "",
        notes: contact.notes ?? "",
      });
    }
  }, [contactData]);

  const mutation = useMutation({
    mutationFn: (payload: object) =>
      isEdit
        ? api(`/contacts/${id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : api("/contacts", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["contacts"] });
      if (isEdit) {
        void qc.invalidateQueries({ queryKey: ["contact", id] });
      }
      navigate("/contacts", { replace: true });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api(`/contacts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["contacts"] });
      navigate("/contacts", { replace: true });
    },
  });

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (form.phone && !/^[+\d\s\-().]*$/.test(form.phone)) {
      errs.phone = "Invalid phone number characters";
    }
    if (form.email && !/\S+@\S+\.\S+/.test(form.email)) {
      errs.email = "Invalid email format";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const targetFamilyId = activeFamilyId || families[0]?.id;
    if (!targetFamilyId && !isEdit) {
      setErrors((prev) => ({ ...prev, name: "No active family found." }));
      return;
    }

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      relationship: form.relationship.trim() || undefined,
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      notes: form.notes.trim() || undefined,
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

  if (isEdit && isLoadingContact) {
    return (
      <>
        <AppBar title="Edit contact" back />
        <Page className="flex items-center justify-center py-12 text-fg-subtle">
          Loading contact details…
        </Page>
      </>
    );
  }

  return (
    <>
      <AppBar title={isEdit ? "Edit contact" : "New contact"} back />
      <Page className="space-y-4">
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Name */}
          <Card className="p-4">
            <label className="block text-xs font-semibold text-fg-muted mb-1.5">
              Name <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Dr. Jane Smith"
              className="w-full rounded-xl bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle border border-line focus:border-vault-500 focus:outline-none"
            />
            {errors.name && (
              <p className="mt-1 text-xs text-danger">{errors.name}</p>
            )}
          </Card>

          {/* Relationship */}
          <Card className="p-4">
            <label className="block text-xs font-semibold text-fg-muted mb-1.5">
              Relationship / Role (optional)
            </label>
            <input
              type="text"
              value={form.relationship}
              onChange={(e) => set("relationship", e.target.value)}
              placeholder="e.g. Family Doctor, Landlord"
              className="w-full rounded-xl bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle border border-line focus:border-vault-500 focus:outline-none"
            />
          </Card>

          {/* Phone */}
          <Card className="p-4">
            <label className="block text-xs font-semibold text-fg-muted mb-1.5">
              Phone (optional)
            </label>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="e.g. +1 (555) 019-2834"
              className="w-full rounded-xl bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle border border-line focus:border-vault-500 focus:outline-none"
            />
            {errors.phone && (
              <p className="mt-1 text-xs text-danger">{errors.phone}</p>
            )}
          </Card>

          {/* Email */}
          <Card className="p-4">
            <label className="block text-xs font-semibold text-fg-muted mb-1.5">
              Email (optional)
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="e.g. contact@example.com"
              className="w-full rounded-xl bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle border border-line focus:border-vault-500 focus:outline-none"
            />
            {errors.email && (
              <p className="mt-1 text-xs text-danger">{errors.email}</p>
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
              placeholder="e.g. Works at City Clinic, pager number is..."
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
              {isEdit ? "Save changes" : "Create contact"}
            </Button>

            {isEdit && (
              <Button
                type="button"
                variant="danger"
                fullWidth
                loading={deleteMutation.isPending}
                onClick={() => {
                  if (confirm("Are you sure you want to delete this contact?")) {
                    deleteMutation.mutate();
                  }
                }}
              >
                Delete contact
              </Button>
            )}
          </div>
        </form>
      </Page>
    </>
  );
}
