import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Mail, Phone, Plus, Contact as ContactIcon } from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { Fab } from "../components/ui/Fab";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

interface ContactSummary {
  id: string;
  name: string;
  relationship?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

function ContactSkeleton() {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3">
      <Skeleton className="size-10 rounded-xl" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

export function Contacts() {
  const { activeFamily } = useAuth();
  const [composerOpen, setComposerOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["contacts", activeFamily?.id],
    queryFn: () =>
      api<{ contacts: ContactSummary[] }>(
        `/contacts?familyId=${activeFamily!.id}`,
      ),
    enabled: Boolean(activeFamily),
  });

  const contacts = data?.contacts ?? [];

  return (
    <>
      <AppBar title="Emergency contacts" back />
      <Page>
        {isLoading ? (
          <Card className="divide-y divide-line" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <ContactSkeleton key={i} />
            ))}
          </Card>
        ) : contacts.length === 0 && !composerOpen ? (
          <EmptyState
            icon={ContactIcon}
            title="No contacts yet"
            description="Keep doctors, schools, and trusted helpers handy — the numbers you need in an emergency."
            action={
              <Button
                leadingIcon={<Plus className="size-4" />}
                onClick={() => setComposerOpen(true)}
              >
                Add contact
              </Button>
            }
          />
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {contacts.map((c) => (
              <div key={c.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-vault-500/10 text-vault-300">
                    <ContactIcon className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-fg">
                      {c.name}
                    </div>
                    {c.relationship && (
                      <div className="truncate text-xs text-fg-muted">
                        {c.relationship}
                      </div>
                    )}
                  </div>
                </div>
                {(c.phone || c.email) && (
                  <div className="mt-2 ml-13 flex flex-col gap-1.5">
                    {c.phone && (
                      <a
                        href={`tel:${c.phone}`}
                        className="flex items-center gap-2 text-sm text-vault-300"
                      >
                        <Phone className="size-4 shrink-0" />
                        {c.phone}
                      </a>
                    )}
                    {c.email && (
                      <a
                        href={`mailto:${c.email}`}
                        className="flex items-center gap-2 text-sm text-vault-300"
                      >
                        <Mail className="size-4 shrink-0" />
                        {c.email}
                      </a>
                    )}
                  </div>
                )}
              </div>
            ))}
          </Card>
        )}

        {composerOpen && activeFamily && (
          <ContactComposer
            familyId={activeFamily.id}
            onClose={() => setComposerOpen(false)}
          />
        )}
      </Page>
      <Fab
        icon={Plus}
        label="Add contact"
        onClick={() => setComposerOpen(true)}
      />
    </>
  );
}

const fieldCls =
  "w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none";

function ContactComposer({
  familyId,
  onClose,
}: {
  familyId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    relationship: "",
    phone: "",
    email: "",
  });
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api("/contacts", {
        method: "POST",
        body: JSON.stringify({
          familyId,
          name: form.name.trim(),
          relationship: form.relationship.trim() || undefined,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["contacts"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    setError("");
    create.mutate();
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4">
      <Card className="space-y-3 p-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
            Name <span className="text-danger">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Dr. Rivera"
            autoFocus
            className={fieldCls}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
            Relationship
          </label>
          <input
            type="text"
            value={form.relationship}
            onChange={(e) =>
              setForm((f) => ({ ...f, relationship: e.target.value }))
            }
            placeholder="e.g. Pediatrician"
            className={fieldCls}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
              Phone
            </label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="+1 555 010 2000"
              className={fieldCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
              Email
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="name@example.com"
              className={fieldCls}
            />
          </div>
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={create.isPending} className="flex-1">
            Add contact
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </Card>
    </form>
  );
}
