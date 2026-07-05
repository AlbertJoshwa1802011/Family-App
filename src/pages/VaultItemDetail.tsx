/**
 * VaultItemDetail — decrypt and display a vault credential.
 *
 * Decryption flow:
 * 1. Fetch the item (GET /vault/items/:id) — returns cipher (metadata) and blind fields.
 * 2. Decrypt cipher using VaultSession.decrypt() → parse JSON → display fields.
 * 3. "Reveal secret" button → POST /vault/items/:id/reveal → decrypt secretCipher.
 * 4. Trash → PATCH status=trashed → navigate back.
 */
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Eye,
  EyeOff,
  Lock,
  Pencil,
  Shield,
  Trash2,
} from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Skeleton } from "../components/ui/Skeleton";
import { api, ApiError } from "../lib/api";
import { useVault } from "../context/VaultContext";
import { VAULT_TYPE_META, type VaultItemType } from "./Vault";
import { cn } from "../lib/cn";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VaultItemFull {
  id: string;
  type: VaultItemType;
  visibility: "family" | "private";
  cipher: string;
  iv: string;
  blindTitle: string | null;
  blindAccount: string | null;
  createdAt: number;
  updatedAt: number;
  status: string;
}

interface DecryptedMeta {
  type?: string;
  title?: string;
  username?: string;
  url?: string;
  notes?: string;
  network?: string;
  security?: string;
  bankName?: string;
  accountType?: string;
  cardName?: string;
  lastFour?: string;
  expiry?: string;
  label?: string;
  context?: string;
  issuer?: string;
  account?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function MetaRow({ label, value, copiable }: { label: string; value?: string; copiable?: boolean }) {
  const [copied, setCopied] = useState(false);

  if (!value) return null;

  async function copy() {
    await navigator.clipboard.writeText(value!);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-fg-muted">{label}</p>
        <p className="mt-0.5 text-sm text-fg break-words">{value}</p>
      </div>
      {copiable && (
        <button
          onClick={copy}
          aria-label={`Copy ${label}`}
          className={cn(
            "mt-0.5 shrink-0 rounded-lg p-1.5 text-xs transition-all",
            copied
              ? "text-success bg-success/10"
              : "text-fg-subtle hover:text-fg-muted hover:bg-white/5",
          )}
        >
          {copied ? "Copied!" : <Copy className="size-4" />}
        </button>
      )}
    </div>
  );
}

function SecretRevealField({ itemId }: { itemId: string }) {
  const { session } = useVault();
  const [revealed, setRevealed] = useState(false);
  const [secretText, setSecretText] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function reveal() {
    if (!session) return;
    setIsLoading(true);
    setError("");
    try {
      const res = await api<{ secretCipher: string | null; secretIv: string | null }>(
        `/vault/items/${itemId}/reveal`,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (!res.secretCipher || !res.secretIv) {
        setSecretText("(no secret stored)");
      } else {
        const plain = await session.decryptSecret({
          cipher: res.secretCipher,
          iv: res.secretIv,
        });
        setSecretText(plain);
      }
      setRevealed(true);
      setShowText(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to reveal secret");
    } finally {
      setIsLoading(false);
    }
  }

  async function copy() {
    if (!secretText) return;
    await navigator.clipboard.writeText(secretText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs text-fg-muted">Secret value</p>
        {revealed && secretText && (
          <button
            onClick={copy}
            className={cn(
              "text-xs rounded-lg px-2 py-1 transition-all",
              copied ? "text-success bg-success/10" : "text-fg-subtle hover:text-fg-muted hover:bg-white/5",
            )}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        )}
      </div>
      {!revealed ? (
        <Button
          variant="secondary"
          fullWidth
          loading={isLoading}
          onClick={reveal}
          leadingIcon={<Eye className="size-4" />}
        >
          Reveal secret
        </Button>
      ) : (
        <div className="relative rounded-xl border border-danger/30 bg-danger/5 px-3.5 py-3">
          <div className={cn("font-mono text-sm text-fg break-all", !showText && "blur-sm select-none")}>
            {secretText}
          </div>
          <button
            onClick={() => setShowText((s) => !s)}
            aria-label={showText ? "Hide secret" : "Show secret"}
            className="absolute right-3 top-3 text-fg-subtle hover:text-fg-muted"
          >
            {showText ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function VaultItemDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { session, state } = useVault();

  const [decryptedMeta, setDecryptedMeta] = useState<DecryptedMeta | null>(null);
  const [decryptError, setDecryptError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["vault-item", id],
    queryFn: () => api<{ item: VaultItemFull }>(`/vault/items/${id}`),
    enabled: Boolean(id),
    select: (d) => d.item,
  });

  const item = data;

  // Decrypt metadata once item is loaded and vault is unlocked
  const [didDecrypt, setDidDecrypt] = useState(false);

  if (item && session && !didDecrypt && !decryptError) {
    setDidDecrypt(true);
    session
      .decrypt({ cipher: item.cipher, iv: item.iv })
      .then((plain) => {
        try {
          setDecryptedMeta(JSON.parse(plain) as DecryptedMeta);
        } catch {
          setDecryptedMeta({ title: plain });
        }
      })
      .catch(() => setDecryptError("Could not decrypt this item."));
  }

  const trashMutation = useMutation({
    mutationFn: () =>
      api(`/vault/items/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "trashed" }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["vault-items"] });
      navigate("/vault", { replace: true });
    },
  });

  function handleTrash() {
    if (!confirm("Move this credential to trash? You can restore it later.")) return;
    trashMutation.mutate();
  }

  if (state !== "unlocked") {
    return (
      <>
        <AppBar title="Credential" back />
        <Page>
          <div className="flex flex-col items-center py-12 gap-4 text-center">
            <Lock className="size-12 text-fg-subtle" />
            <p className="text-sm text-fg-muted">Unlock your vault to view this credential.</p>
            <Button onClick={() => navigate("/vault")}>Go to Vault</Button>
          </div>
        </Page>
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <AppBar title="Credential" back />
        <Page className="space-y-4">
          <Card className="p-4">
            <Skeleton className="h-12 w-12 rounded-2xl" />
            <div className="mt-3 space-y-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          </Card>
          <Card className="p-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </Card>
        </Page>
      </>
    );
  }

  if (!item) {
    return (
      <>
        <AppBar title="Credential" back />
        <Page>
          <p className="text-center text-sm text-fg-muted py-12">Credential not found.</p>
        </Page>
      </>
    );
  }

  const { label, icon: Icon, color } = VAULT_TYPE_META[item.type] ?? VAULT_TYPE_META.other;
  const title = decryptedMeta?.title ?? decryptedMeta?.network ?? decryptedMeta?.bankName ??
    decryptedMeta?.cardName ?? decryptedMeta?.label ?? decryptedMeta?.issuer ?? label;

  // Build display rows based on type
  function getRows() {
    if (!decryptedMeta) return [];
    const rows: { label: string; value?: string; copiable?: boolean }[] = [];
    const m = decryptedMeta;
    switch (item!.type) {
      case "login":
        if (m.username) rows.push({ label: "Username / Email", value: m.username, copiable: true });
        if (m.url) rows.push({ label: "URL", value: m.url });
        if (m.notes) rows.push({ label: "Notes", value: m.notes });
        break;
      case "wifi":
        if (m.network) rows.push({ label: "Network (SSID)", value: m.network, copiable: true });
        if (m.security) rows.push({ label: "Security", value: m.security });
        break;
      case "bank":
        if (m.bankName) rows.push({ label: "Bank", value: m.bankName });
        if (m.accountType) rows.push({ label: "Account type", value: m.accountType });
        break;
      case "card":
        if (m.cardName) rows.push({ label: "Card name", value: m.cardName });
        if (m.lastFour) rows.push({ label: "Last 4 digits", value: m.lastFour });
        if (m.expiry) rows.push({ label: "Expiry", value: m.expiry });
        break;
      case "pin":
        if (m.context) rows.push({ label: "Context", value: m.context });
        break;
      case "totp_seed":
        if (m.account) rows.push({ label: "Account", value: m.account, copiable: true });
        break;
      case "note":
        if (m.notes) rows.push({ label: "Notes", value: m.notes });
        break;
      default:
        if (m.notes) rows.push({ label: "Notes", value: m.notes });
    }
    return rows;
  }

  const metaRows = getRows();
  const createdDate = new Date(item.createdAt * 1000).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });

  return (
    <>
      <AppBar
        title="Credential"
        back
        trailing={
          <Button
            variant="ghost"
            size="md"
            leadingIcon={<Pencil className="size-4" />}
            onClick={() => navigate(`/vault/${id}/edit`)}
          >
            Edit
          </Button>
        }
      />
      <Page width="list" className="space-y-4">
        {/* Header card */}
        <Card className="p-5">
          <div className="flex items-start gap-4">
            <span className={cn("flex size-14 shrink-0 items-center justify-center rounded-2xl", color)}>
              <Icon className="size-7" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-fg truncate">
                {decryptError ? (
                  <span className="text-danger text-sm">{decryptError}</span>
                ) : decryptedMeta ? (
                  title
                ) : (
                  <Skeleton className="h-5 w-40 inline-block" />
                )}
              </h2>
              <div className="mt-1 flex items-center gap-2">
                <Badge tone="vault">{label}</Badge>
                {item.visibility === "private" && <Badge tone="neutral">Private</Badge>}
              </div>
            </div>
          </div>
        </Card>

        {/* Security banner */}
        <div className="flex items-center gap-2 rounded-xl border border-vault-500/20 bg-vault-500/6 px-3 py-2 text-xs text-vault-300">
          <Shield className="size-4 shrink-0" />
          Decrypted locally — the server never stored your secret in plaintext.
        </div>

        {/* Metadata fields */}
        {(decryptedMeta && metaRows.length > 0) && (
          <Card className="px-4 divide-y divide-line">
            {metaRows.map(({ label: l, value: v, copiable }) => (
              <MetaRow key={l} label={l} value={v} copiable={copiable} />
            ))}
          </Card>
        )}

        {/* Secret reveal */}
        <Card className="p-4">
          <SecretRevealField itemId={id!} />
        </Card>

        {/* Metadata */}
        <Card className="px-4 divide-y divide-line">
          <MetaRow label="Type" value={label} />
          <MetaRow label="Visibility" value={item.visibility === "family" ? "Shared with family" : "Private to you"} />
          <MetaRow label="Added" value={createdDate} />
        </Card>

        {/* Danger zone */}
        <Button
          variant="danger"
          fullWidth
          leadingIcon={<Trash2 className="size-4" />}
          loading={trashMutation.isPending}
          onClick={handleTrash}
        >
          Move to trash
        </Button>
      </Page>
    </>
  );
}
