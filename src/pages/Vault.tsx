import { useQuery } from "@tanstack/react-query";
import { Shield, Plus, Key } from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { ListItem } from "../components/ui/ListItem";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

interface VaultItem {
  id: string;
  type: "login" | "wifi" | "bank" | "card" | "pin" | "note" | "totp_seed" | "other";
  visibility: "family" | "private";
  cipher: string;
  iv: string;
  blindTitle?: string | null;
  blindAccount?: string | null;
  blindIssuer?: string | null;
  createdAt: number;
}

export function Vault() {
  const { families } = useAuth();
  const activeFamilyId = families[0]?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["vault-items", activeFamilyId],
    queryFn: () => {
      if (!activeFamilyId) return { items: [] };
      return api<{ items: VaultItem[] }>(`/vault/items?familyId=${activeFamilyId}`);
    },
    enabled: Boolean(activeFamilyId),
  });

  const items = data?.items ?? [];

  return (
    <>
      <AppBar
        title="Encrypted Vault"
        trailing={
          <Button
            size="md"
            leadingIcon={<Plus className="size-4" />}
            onClick={() => alert("Secrets Vault Add Credential form is under construction for Phase 1. Complete details: docs/PLAN.md.")}
          >
            Add Item
          </Button>
        }
      />
      <Page className="space-y-6">
        <div className="rounded-2xl border border-line bg-surface p-4 text-sm text-fg-muted">
          <p className="flex items-center gap-2 font-medium text-white mb-1">
            <Shield className="size-4 text-vault-400" />
            Client-Side Encrypted
          </p>
          All items are encrypted in your browser before upload. The server only stores ciphertext.
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="h-16 animate-pulse bg-white/5" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Key}
            title="Secure family passwords & keys"
            description="Store passwords, WiFi credentials, bank details, and secrets securely. Shared with family or kept entirely private."
            action={
              <Button
                leadingIcon={<Plus className="size-4" />}
                onClick={() => alert("Secrets Vault Add Credential form is under construction for Phase 1. Complete details: docs/PLAN.md.")}
              >
                Add your first credential
              </Button>
            }
          />
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {items.map((item) => (
              <ListItem
                key={item.id}
                title={item.blindTitle || "Encrypted Item"}
                subtitle={`${item.type.toUpperCase()} · ${item.visibility}`}
                leading={
                  <span className="flex size-9 items-center justify-center rounded-xl bg-vault-500/15 text-vault-300">
                    <Shield className="size-4" />
                  </span>
                }
              />
            ))}
          </Card>
        )}
      </Page>
    </>
  );
}
