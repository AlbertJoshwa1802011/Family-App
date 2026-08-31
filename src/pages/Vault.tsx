/**
 * Vault page — enterprise-grade encrypted credentials manager.
 *
 * States:
 *  - unchecked / loading  → skeleton
 *  - not_initialized      → setup wizard (create master passphrase)
 *  - locked               → passphrase unlock prompt
 *  - unlocked             → item list + search
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ChevronRight,
  Eye,
  EyeOff,
  Key,
  Lock,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  Unlock,
  Wifi,
  CreditCard,
  Landmark,
  FileText,
  StickyNote,
  Hash,
  RefreshCw,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useVault } from "../context/VaultContext";
import { cn } from "../lib/cn";
import type { LucideIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VaultItemType =
  | "login"
  | "wifi"
  | "bank"
  | "card"
  | "pin"
  | "note"
  | "totp_seed"
  | "other";

interface VaultItem {
  id: string;
  type: VaultItemType;
  visibility: "family" | "private";
  cipher: string;
  iv: string;
  blindTitle?: string | null;
  blindAccount?: string | null;
  blindIssuer?: string | null;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Type icon/label map
// ---------------------------------------------------------------------------

export const VAULT_TYPE_META: Record<
  VaultItemType,
  { label: string; icon: LucideIcon; color: string }
> = {
  login: { label: "Login", icon: Key, color: "text-vault-300 bg-vault-500/15" },
  wifi: { label: "Wi-Fi", icon: Wifi, color: "text-info bg-info/15" },
  bank: { label: "Bank", icon: Landmark, color: "text-success bg-success/15" },
  card: { label: "Card", icon: CreditCard, color: "text-warning bg-warning/15" },
  pin: { label: "PIN", icon: Hash, color: "text-danger bg-danger/15" },
  note: { label: "Note", icon: StickyNote, color: "text-fg-muted bg-white/5" },
  totp_seed: { label: "TOTP", icon: RefreshCw, color: "text-vault-400 bg-vault-600/15" },
  other: { label: "Other", icon: FileText, color: "text-fg-muted bg-white/5" },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function VaultItemRow({ item }: { item: VaultItem }) {
  const { icon: Icon, label, color } = VAULT_TYPE_META[item.type] ?? VAULT_TYPE_META.other;
  return (
    <Link
      to={`/vault/${item.id}`}
      className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-white/5 active:bg-white/10"
    >
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", color)}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-fg">
          {item.blindTitle ? (
            <span className="font-mono text-xs text-fg-muted tracking-tight">[encrypted]</span>
          ) : (
            <span className="italic text-fg-subtle">Unnamed credential</span>
          )}
        </p>
        <p className="text-xs text-fg-muted">{label}</p>
      </div>
      <div className="flex items-center gap-2">
        {item.visibility === "private" && (
          <Badge tone="vault">Private</Badge>
        )}
        <ChevronRight className="size-4 shrink-0 text-fg-subtle" />
      </div>
    </Link>
  );
}

function VaultSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-full rounded-xl" />
      <Card className="divide-y divide-line overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-10 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Passphrase input (show/hide toggle)
// ---------------------------------------------------------------------------

function PassphraseInput({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Enter your vault passphrase"}
        autoFocus={autoFocus}
        autoComplete="current-password"
        className="w-full rounded-xl bg-ink-950 px-3.5 py-3 pr-10 text-sm text-fg placeholder:text-fg-subtle border border-line focus:border-vault-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide passphrase" : "Show passphrase"}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg-muted"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup wizard (first-time initialization)
// ---------------------------------------------------------------------------

function VaultSetupWizard({ familyId }: { familyId: string }) {
  const { initVault, error, clearError, isWorking } = useVault();
  const [step, setStep] = useState<"intro" | "create">("intro");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localErr, setLocalErr] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLocalErr("");
    clearError();
    if (passphrase.length < 10) {
      setLocalErr("Passphrase must be at least 10 characters.");
      return;
    }
    if (passphrase !== confirm) {
      setLocalErr("Passphrases do not match.");
      return;
    }
    try {
      await initVault(familyId, passphrase);
    } catch {
      // error is set in VaultContext
    }
  }

  if (step === "intro") {
    return (
      <div className="flex flex-col items-center py-12 text-center gap-6">
        <div className="flex size-20 items-center justify-center rounded-3xl bg-vault-500/15">
          <Shield className="size-10 text-vault-400" />
        </div>
        <div className="space-y-2 max-w-sm">
          <h2 className="text-xl font-bold text-fg">Your family vault</h2>
          <p className="text-sm text-fg-muted leading-relaxed">
            Store passwords, Wi-Fi credentials, bank details, and secrets — encrypted in your
            browser. Only you and your family can ever decrypt them.
          </p>
        </div>
        <Card className="w-full max-w-sm text-left p-4 space-y-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="size-5 shrink-0 mt-0.5 text-success" />
            <div>
              <p className="text-sm font-semibold text-fg">AES-256 client-side encryption</p>
              <p className="text-xs text-fg-muted">Data is encrypted before leaving your device</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Lock className="size-5 shrink-0 mt-0.5 text-vault-400" />
            <div>
              <p className="text-sm font-semibold text-fg">Zero-knowledge server</p>
              <p className="text-xs text-fg-muted">The server stores only ciphertext — never your passphrase or keys</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Key className="size-5 shrink-0 mt-0.5 text-warning" />
            <div>
              <p className="text-sm font-semibold text-fg">Remember your passphrase</p>
              <p className="text-xs text-fg-muted">There is no "forgot passphrase" — it cannot be recovered by anyone</p>
            </div>
          </div>
        </Card>
        <Button onClick={() => setStep("create")} size="lg">
          Set up my vault
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleCreate} className="space-y-4 max-w-sm mx-auto pt-8">
      <div className="text-center mb-6">
        <h2 className="text-lg font-bold text-fg">Create a vault passphrase</h2>
        <p className="text-sm text-fg-muted mt-1">
          This passphrase encrypts all your credentials. Write it down somewhere safe.
        </p>
      </div>

      <Card className="p-4 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-fg-muted mb-1.5">
            Vault passphrase <span className="text-danger">*</span>
          </label>
          <PassphraseInput
            value={passphrase}
            onChange={setPassphrase}
            placeholder="At least 10 characters"
            autoFocus
          />
          {passphrase.length > 0 && passphrase.length < 10 && (
            <p className="mt-1 text-xs text-warning">
              {10 - passphrase.length} more characters needed
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-semibold text-fg-muted mb-1.5">
            Confirm passphrase <span className="text-danger">*</span>
          </label>
          <PassphraseInput
            value={confirm}
            onChange={setConfirm}
            placeholder="Type it again"
          />
        </div>
      </Card>

      {(localErr || error) && (
        <p className="text-sm text-danger px-1">{localErr || error}</p>
      )}

      <Button type="submit" fullWidth loading={isWorking} size="lg">
        Create vault
      </Button>
      <button
        type="button"
        onClick={() => setStep("intro")}
        className="w-full text-sm text-fg-muted hover:text-fg text-center"
      >
        ← Back
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Unlock form (vault exists but is locked)
// ---------------------------------------------------------------------------

function VaultUnlockForm({ familyId }: { familyId: string }) {
  const { unlock, error, clearError, isWorking } = useVault();
  const [passphrase, setPassphrase] = useState("");

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    clearError();
    if (!passphrase) return;
    try {
      await unlock(familyId, passphrase);
    } catch {
      // error is shown from context
    }
  }

  return (
    <div className="flex flex-col items-center py-12 gap-6">
      <div className="flex size-20 items-center justify-center rounded-3xl bg-vault-500/15">
        <Lock className="size-10 text-vault-400" />
      </div>
      <div className="text-center max-w-xs">
        <h2 className="text-lg font-bold text-fg">Vault is locked</h2>
        <p className="text-sm text-fg-muted mt-1">
          Enter your vault passphrase to decrypt and access your credentials.
        </p>
      </div>

      <form onSubmit={handleUnlock} className="w-full max-w-xs space-y-4">
        <PassphraseInput value={passphrase} onChange={setPassphrase} autoFocus />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" fullWidth loading={isWorking} size="lg">
          <Unlock className="size-4" />
          Unlock vault
        </Button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// No access — the family has a vault, but this member holds no wrapped key
// ---------------------------------------------------------------------------

function VaultNoAccess() {
  return (
    <div className="flex flex-col items-center py-12 text-center gap-6">
      <div className="flex size-20 items-center justify-center rounded-3xl bg-warning/15">
        <Lock className="size-10 text-warning" />
      </div>
      <div className="space-y-2 max-w-sm">
        <h2 className="text-xl font-bold text-fg">You don't have vault access yet</h2>
        <p className="text-sm text-fg-muted leading-relaxed">
          Your family's vault was set up by someone else. Because it is encrypted on
          the device, no passphrase of yours can open it until an existing member
          grants you a key from their unlocked vault.
        </p>
      </div>
      <Card className="w-full max-w-sm text-left p-4">
        <p className="text-sm font-semibold text-fg">How to get in</p>
        <p className="mt-1 text-xs text-fg-muted leading-relaxed">
          Ask a family member who can already open the vault to go to Family →
          Vault access and grant it to you. They'll need their own passphrase to do it.
        </p>
      </Card>
      <Button variant="secondary" onClick={() => window.location.reload()}>
        I've been granted access — check again
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unlocked vault — item list + search
// ---------------------------------------------------------------------------

function UnlockedVault({ familyId }: { familyId: string }) {
  const { lock } = useVault();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["vault-items", familyId],
    queryFn: () =>
      api<{ items: VaultItem[] }>(`/vault/items?familyId=${encodeURIComponent(familyId)}`),
  });

  const items = data?.items ?? [];

  // Client-side filter on blind fields (they're hashed so we can only do type/visibility filter)
  // Real search goes through /vault/search with computed blind tags
  const filtered = search.trim()
    ? items.filter((it) =>
        it.type.toLowerCase().includes(search.toLowerCase()) ||
        (VAULT_TYPE_META[it.type]?.label ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : items;

  // Group by type
  const groups = filtered.reduce<Record<string, VaultItem[]>>((acc, item) => {
    const label = VAULT_TYPE_META[item.type]?.label ?? "Other";
    if (!acc[label]) acc[label] = [];
    acc[label].push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      {/* Status bar */}
      <div className="flex items-center gap-2 rounded-2xl border border-vault-500/25 bg-vault-500/8 px-4 py-2.5">
        <ShieldCheck className="size-4 shrink-0 text-vault-400" />
        <span className="flex-1 text-sm font-medium text-vault-300">
          Vault unlocked — {items.length} credential{items.length !== 1 ? "s" : ""}
        </span>
        <button
          onClick={lock}
          className="text-xs text-fg-subtle hover:text-fg-muted transition-colors font-medium"
        >
          Lock
        </button>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
        <input
          ref={searchInputRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by type…"
          className="w-full rounded-xl bg-surface border border-line pl-9 pr-4 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
        />
      </div>

      {isLoading ? (
        <VaultSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Key}
          title="No credentials yet"
          description="Store passwords, Wi-Fi credentials, bank details, and secrets here — encrypted with your passphrase."
          action={
            <Button
              leadingIcon={<Plus className="size-4" />}
              onClick={() => navigate("/vault/new")}
            >
              Add first credential
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-muted">No results for "{search}"</p>
      ) : (
        <div className="space-y-4">
          {Object.entries(groups).map(([groupLabel, groupItems]) => (
            <div key={groupLabel}>
              <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                {groupLabel}
              </h3>
              <Card className="divide-y divide-line overflow-hidden">
                {groupItems.map((item) => (
                  <VaultItemRow key={item.id} item={item} />
                ))}
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Vault page
// ---------------------------------------------------------------------------

export function Vault() {
  const { activeFamilyId } = useAuth();
  const { state, setVaultState } = useVault();
  const navigate = useNavigate();
  const [statusError, setStatusError] = useState<string | null>(null);

  // Check vault status on mount. Three distinct outcomes, and none of them may
  // fall back to "locked": prompting for a passphrase the user never set (or
  // cannot have) is a dead end with no way forward.
  useEffect(() => {
    if (!activeFamilyId || state === "unlocked") return;

    let cancelled = false;
    api<{ initialized: boolean; hasKey: boolean; vaultId?: string }>(
      `/vault/status?familyId=${encodeURIComponent(activeFamilyId)}`,
    )
      .then((res) => {
        if (cancelled) return;
        setStatusError(null);
        if (!res.initialized) {
          setVaultState("not_initialized");
        } else if (res.hasKey) {
          setVaultState("locked", res.vaultId);
        } else {
          setVaultState("no_access", res.vaultId);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setStatusError(
          e instanceof Error ? e.message : "Could not reach the vault service.",
        );
        setVaultState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [activeFamilyId, state, setVaultState]);

  if (!activeFamilyId) {
    return (
      <>
        <AppBar title="Vault" />
        <Page>
          <EmptyState
            icon={Shield}
            title="No family found"
            description="You need to be part of a family to use the vault."
          />
        </Page>
      </>
    );
  }

  return (
    <>
      <AppBar
        title="Vault"
        trailing={
          state === "unlocked" ? (
            <Button
              size="md"
              leadingIcon={<Plus className="size-4" />}
              onClick={() => navigate("/vault/new")}
            >
              Add
            </Button>
          ) : undefined
        }
      />
      <Page width="list" className="space-y-6">
        {(state === "unchecked") && (
          <VaultSkeleton />
        )}
        {state === "not_initialized" && (
          <VaultSetupWizard familyId={activeFamilyId} />
        )}
        {state === "locked" && (
          <VaultUnlockForm familyId={activeFamilyId} />
        )}
        {state === "no_access" && <VaultNoAccess />}
        {state === "error" && (
          <EmptyState
            icon={Shield}
            title="Couldn't open the vault"
            description={statusError ?? "Something went wrong. Please try again."}
          />
        )}
        {state === "unlocked" && (
          <UnlockedVault familyId={activeFamilyId} />
        )}
      </Page>
    </>
  );
}
