import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Mail, Phone, Plus, Contact as ContactIcon, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { Fab } from "../components/ui/Fab";
import { api, ApiError } from "../lib/api";
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
  const navigate = useNavigate();
  const { activeFamilyId } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["contacts", activeFamilyId],
    queryFn: () =>
      api<{ contacts: ContactSummary[] }>(
        activeFamilyId ? `/contacts?familyId=${activeFamilyId}` : "/contacts"
      ),
  });

  const googleStatus = useQuery({
    queryKey: ["google-status"],
    queryFn: () =>
      api<{ contacts: boolean; gmail: boolean; calendar: boolean }>("/auth/google/status"),
  });

  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const sync = useMutation({
    mutationFn: () =>
      api<{ pulled: number; created: number; updated: number; pushed: number }>(
        `/contacts/sync?familyId=${activeFamilyId}`,
        { method: "POST" },
      ),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["contacts"] });
      setSyncMsg(
        `Synced: ${res.created} new from Google, ${res.pushed} sent to your phone.`,
      );
    },
    onError: (e: unknown) => {
      const code = e instanceof ApiError ? e.code : "";
      if (code === "contacts_not_connected") {
        setSyncMsg("Google Contacts is not connected for this login. Tap Connect Google Contacts, accept Contacts permission, then sync again.");
        return;
      }
      if (code === "google_sync_failed") {
        setSyncMsg(
          e instanceof Error
            ? e.message
            : "Google blocked Contacts sync. Enable the People API on the Cloud project and complete app verification (Contacts is a restricted scope).",
        );
        return;
      }
      setSyncMsg(e instanceof Error ? e.message : "Sync failed.");
    },
  });

  const contacts = data?.contacts ?? [];

  return (
    <>
      <AppBar title="Emergency contacts" back />
      <Page className="space-y-3">
        <Card className="space-y-3 p-4">
          <p className="text-sm text-fg-muted">
            Contacts you add here sync to Google Contacts on your phone, and
            contacts already in Google (including ones the phone backed up)
            sync here. iPhone: Settings → Contacts → Accounts → Google.
          </p>
          {googleStatus.data?.contacts ? (
            <Button
              variant="secondary"
              fullWidth
              loading={sync.isPending}
              leadingIcon={<RefreshCw className="size-4" />}
              onClick={() => {
                setSyncMsg(null);
                sync.mutate();
              }}
              disabled={!activeFamilyId}
            >
              Sync with Google Contacts
            </Button>
          ) : (
            <Button
              variant="secondary"
              fullWidth
              onClick={() => {
                window.location.href = `/api/auth/google/start?connect=contacts&returnTo=${encodeURIComponent("/contacts")}`;
              }}
            >
              Connect Google Contacts
            </Button>
          )}
          {syncMsg && (
            <p className="text-xs text-fg-muted" role="status">
              {syncMsg}
            </p>
          )}
        </Card>
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
              <Button
                leadingIcon={<Plus className="size-4" />}
                onClick={() => navigate("/contacts/new")}
              >
                Add contact
              </Button>
            }
          />
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {contacts.map((c) => (
              <div key={c.id} className="px-4 py-3">
                <div
                  className="flex items-center gap-3 cursor-pointer"
                  onClick={() => navigate(`/contacts/${c.id}/edit`)}
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-vault-500/10 text-vault-300">
                    <ContactIcon className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-fg hover:text-vault-300 transition-colors">
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
      <Fab
        icon={Plus}
        label="Add contact"
        onClick={() => navigate("/contacts/new")}
      />
    </>
  );
}
