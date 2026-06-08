import { useQuery } from "@tanstack/react-query";
import { Mail, Phone, Plus, Contact as ContactIcon } from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { Fab } from "../components/ui/Fab";
import { api } from "../lib/api";

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
  const { data, isLoading } = useQuery({
    queryKey: ["contacts"],
    queryFn: () => api<{ contacts: ContactSummary[] }>("/contacts"),
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
        ) : contacts.length === 0 ? (
          <EmptyState
            icon={ContactIcon}
            title="No contacts yet"
            description="Keep doctors, schools, and trusted helpers handy — the numbers you need in an emergency."
            action={
              <Button leadingIcon={<Plus className="size-4" />}>
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
      </Page>
      <Fab icon={Plus} label="Add contact" />
    </>
  );
}
