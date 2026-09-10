/**
 * VaultItemForm — add or edit an encrypted credential.
 *
 * Encryption flow:
 * 1. Build a structured metadata object from form fields.
 * 2. JSON.stringify → encryptBlob(vdk, ...) → { cipher, iv }.
 * 3. Secret field → encryptSecret(vdk, ...) → { secretCipher, secretIv }.
 * 4. Compute blind tags for title + account fields.
 * 5. POST /vault/items → then POST /vault/items/:id/tags.
 * 6. On success navigate to /vault/:id.
 */
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CreditCard,
  Eye,
  EyeOff,
  FileText,
  Hash,
  Key,
  Landmark,
  RefreshCw,
  Shield,
  StickyNote,
  Wifi,
} from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useVault } from "../context/VaultContext";
import type { VaultItemType } from "./Vault";
import { cn } from "../lib/cn";

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

interface ItemMeta {
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

interface FormState {
  type: VaultItemType;
  visibility: "family" | "private";
  meta: ItemMeta;
  secret: string;
}

// ---------------------------------------------------------------------------
// Type selector
// ---------------------------------------------------------------------------

const TYPE_OPTIONS: { value: VaultItemType; label: string; icon: React.ElementType; description: string }[] = [
  { value: "login", label: "Login", icon: Key, description: "Website or app password" },
  { value: "wifi", label: "Wi-Fi", icon: Wifi, description: "Network credentials" },
  { value: "bank", label: "Bank", icon: Landmark, description: "Account details" },
  { value: "card", label: "Card", icon: CreditCard, description: "Credit or debit card" },
  { value: "pin", label: "PIN", icon: Hash, description: "ATM, device PIN" },
  { value: "note", label: "Note", icon: StickyNote, description: "Secure private note" },
  { value: "totp_seed", label: "TOTP", icon: RefreshCw, description: "Authenticator seed" },
  { value: "other", label: "Other", icon: FileText, description: "Any secret" },
];

function TypeSelector({
  value,
  onChange,
}: {
  value: VaultItemType;
  onChange: (t: VaultItemType) => void;
}) {
  return (
    <Card className="p-4">
      <p className="mb-3 text-xs font-semibold text-fg-muted uppercase tracking-wider">
        Credential type
      </p>
      <div className="grid grid-cols-4 gap-2">
        {TYPE_OPTIONS.map(({ value: v, label, icon: Icon }) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-center transition-all",
              value === v
                ? "bg-vault-600 text-white"
                : "bg-white/5 text-fg-muted hover:bg-white/10 hover:text-fg",
            )}
          >
            <Icon className="size-5" />
            <span className="text-[11px] font-medium">{label}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Secret field with reveal toggle
// ---------------------------------------------------------------------------

function SecretField({
  label,
  value,
  onChange,
  placeholder,
  isTextArea,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  isTextArea?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="block text-xs font-semibold text-fg-muted mb-1.5">
        {label} <span className="text-danger">*</span>
      </label>
      <div className="relative">
        {isTextArea ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={4}
            className="w-full resize-none rounded-xl bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle border border-danger/40 focus:border-danger focus:outline-none font-mono"
          />
        ) : (
          <input
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            autoComplete="new-password"
            className="w-full rounded-xl bg-ink-950 px-3.5 py-3 pr-10 text-sm text-fg placeholder:text-fg-subtle border border-danger/40 focus:border-danger focus:outline-none font-mono"
          />
        )}
        {!isTextArea && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide secret" : "Show secret"}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg-muted"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meta field helper
// ---------------------------------------------------------------------------

function MetaField({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-fg-muted mb-1.5">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle border border-line focus:border-vault-500 focus:outline-none"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Type-adaptive fields
// ---------------------------------------------------------------------------

function TypeFields({
  type,
  meta,
  secret,
  onMeta,
  onSecret,
}: {
  type: VaultItemType;
  meta: ItemMeta;
  secret: string;
  onMeta: (key: keyof ItemMeta, value: string) => void;
  onSecret: (v: string) => void;
}) {
  switch (type) {
    case "login":
      return (
        <Card className="p-4 space-y-4">
          <MetaField label="Title / Site name" value={meta.title ?? ""} onChange={(v) => onMeta("title", v)} placeholder="e.g. Gmail" required />
          <MetaField label="Username / Email" value={meta.username ?? ""} onChange={(v) => onMeta("username", v)} placeholder="user@example.com" />
          <MetaField label="URL (optional)" value={meta.url ?? ""} onChange={(v) => onMeta("url", v)} placeholder="https://mail.google.com" />
          <SecretField label="Password" value={secret} onChange={onSecret} placeholder="••••••••" />
          <MetaField label="Notes (optional)" value={meta.notes ?? ""} onChange={(v) => onMeta("notes", v)} placeholder="2FA app: Authenticator" />
        </Card>
      );
    case "wifi":
      return (
        <Card className="p-4 space-y-4">
          <MetaField label="Network name (SSID)" value={meta.network ?? ""} onChange={(v) => onMeta("network", v)} placeholder="HomeNetwork_5G" required />
          <MetaField label="Security type" value={meta.security ?? ""} onChange={(v) => onMeta("security", v)} placeholder="WPA2, WPA3…" />
          <SecretField label="Wi-Fi password" value={secret} onChange={onSecret} placeholder="••••••••" />
        </Card>
      );
    case "bank":
      return (
        <Card className="p-4 space-y-4">
          <MetaField label="Bank name" value={meta.bankName ?? ""} onChange={(v) => onMeta("bankName", v)} placeholder="e.g. HDFC Bank" required />
          <MetaField label="Account type" value={meta.accountType ?? ""} onChange={(v) => onMeta("accountType", v)} placeholder="Savings / Current" />
          <SecretField label="Account number + routing" value={secret} onChange={onSecret} placeholder="Account: XXXX  Routing: YYYY" isTextArea />
        </Card>
      );
    case "card":
      return (
        <Card className="p-4 space-y-4">
          <MetaField label="Card name / Label" value={meta.cardName ?? ""} onChange={(v) => onMeta("cardName", v)} placeholder="e.g. HDFC Rewards Visa" required />
          <MetaField label="Last 4 digits" value={meta.lastFour ?? ""} onChange={(v) => onMeta("lastFour", v)} placeholder="•••• 4242" />
          <MetaField label="Expiry" value={meta.expiry ?? ""} onChange={(v) => onMeta("expiry", v)} placeholder="MM/YY" />
          <SecretField label="Full card number + CVV" value={secret} onChange={onSecret} placeholder="Card: 4242...  CVV: 123" isTextArea />
        </Card>
      );
    case "pin":
      return (
        <Card className="p-4 space-y-4">
          <MetaField label="Label" value={meta.label ?? ""} onChange={(v) => onMeta("label", v)} placeholder="e.g. ATM PIN, Phone unlock" required />
          <MetaField label="Context / Notes" value={meta.context ?? ""} onChange={(v) => onMeta("context", v)} placeholder="Which card or device this is for" />
          <SecretField label="PIN" value={secret} onChange={onSecret} placeholder="••••" />
        </Card>
      );
    case "note":
      return (
        <Card className="p-4 space-y-4">
          <MetaField label="Title" value={meta.title ?? ""} onChange={(v) => onMeta("title", v)} placeholder="e.g. Emergency instructions" required />
          <SecretField label="Secure note" value={secret} onChange={onSecret} placeholder="Write your secure note here…" isTextArea />
        </Card>
      );
    case "totp_seed":
      return (
        <Card className="p-4 space-y-4">
          <MetaField label="Issuer" value={meta.issuer ?? ""} onChange={(v) => onMeta("issuer", v)} placeholder="e.g. Google, GitHub" required />
          <MetaField label="Account / Email" value={meta.account ?? ""} onChange={(v) => onMeta("account", v)} placeholder="user@example.com" />
          <SecretField label="TOTP seed (Base32)" value={secret} onChange={onSecret} placeholder="JBSWY3DPEHPK3PXP" />
        </Card>
      );
    case "other":
    default:
      return (
        <Card className="p-4 space-y-4">
          <MetaField label="Title" value={meta.title ?? ""} onChange={(v) => onMeta("title", v)} placeholder="What is this?" required />
          <MetaField label="Notes (optional)" value={meta.notes ?? ""} onChange={(v) => onMeta("notes", v)} placeholder="Any extra details" />
          <SecretField label="Secret value" value={secret} onChange={onSecret} placeholder="The sensitive value" />
        </Card>
      );
  }
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function VaultItemForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { families } = useAuth();
  const { session, state } = useVault();
  const activeFamilyId = families[0]?.id;

  const [form, setForm] = useState<FormState>({
    type: "login",
    visibility: "family",
    meta: {},
    secret: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");

  const mutation = useMutation({
    mutationFn: async (payload: object) => {
      if (isEdit) {
        return api(`/vault/items/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
      }
      return api<{ item: { id: string } }>("/vault/items", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async (data: unknown) => {
      void qc.invalidateQueries({ queryKey: ["vault-items"] });
      const newId = (data as { item?: { id?: string } })?.item?.id ?? id;
      navigate(`/vault/${newId}`, { replace: true });
    },
  });

  // Guard: vault must be unlocked to add items
  const unlockedSession = session!;
  if (state !== "unlocked" || !session) {
    return (
      <>
        <AppBar title={isEdit ? "Edit credential" : "Add credential"} back />
        <Page>
          <div className="flex flex-col items-center py-12 gap-4 text-center">
            <Shield className="size-12 text-fg-subtle" />
            <p className="text-sm text-fg-muted">
              Please unlock your vault first to add or edit credentials.
            </p>
            <Button onClick={() => navigate("/vault")}>Go to Vault</Button>
          </div>
        </Page>
      </>
    );
  }

  function setMeta(key: keyof ItemMeta, value: string) {
    setForm((f) => ({ ...f, meta: { ...f.meta, [key]: value } }));
  }

  function getTitle(): string {
    const m = form.meta;
    return m.title ?? m.network ?? m.bankName ?? m.cardName ?? m.label ?? m.issuer ?? "";
  }

  function getAccount(): string {
    const m = form.meta;
    return m.username ?? m.account ?? m.lastFour ?? "";
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    const title = getTitle();
    if (!title.trim()) errs.title = "Please fill in a name or title for this credential.";
    if (!form.secret.trim()) errs.secret = "The secret value is required.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError("");
    if (!validate()) return;
    if (!activeFamilyId) return;

    try {
      // Encrypt metadata
      const metaJson = JSON.stringify({ type: form.type, ...form.meta });
      const { cipher, iv } = await unlockedSession.encrypt(metaJson);

      // Encrypt secret separately
      const { cipher: secretCipher, iv: secretIv } = await unlockedSession.encryptSecret(form.secret);

      // Compute blind indexes
      const titleStr = getTitle();
      const accountStr = getAccount();

      const blindTitle = titleStr ? await unlockedSession.computeBlindTag(titleStr) : undefined;
      const blindAccount = accountStr ? await unlockedSession.computeBlindTag(accountStr) : undefined;

      // Compute blind tags for search
      const blindTags = titleStr
        ? await unlockedSession.computeBlindTags(titleStr)
        : [];
      if (accountStr) {
        const acctTags = await unlockedSession.computeBlindTags(accountStr);
        blindTags.push(...acctTags);
      }

      const payload = {
        familyId: activeFamilyId,
        type: form.type,
        visibility: form.visibility,
        cipher,
        iv,
        secretCipher,
        secretIv,
        blindTitle,
        blindAccount,
      };

      const result = await mutation.mutateAsync(payload);
      const newId = (result as { item?: { id?: string } })?.item?.id ?? id;

      // Store blind tags
      if (newId && blindTags.length > 0) {
        // dedupe
        const uniqueTags = [...new Set(blindTags)];
        await api(`/vault/items/${newId}/tags`, {
          method: "POST",
          body: JSON.stringify({ tags: uniqueTags.slice(0, 50) }),
        });
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Encryption failed. Please try again.";
      setSubmitError(msg);
    }
  }

  return (
    <>
      <AppBar title={isEdit ? "Edit credential" : "New credential"} back />
      <Page width="list" className="space-y-4">
        {/* Security notice */}
        <div className="flex items-center gap-2 rounded-xl border border-vault-500/20 bg-vault-500/6 px-3 py-2 text-xs text-vault-300">
          <Shield className="size-4 shrink-0" />
          Encrypted locally before saving — the server never sees your passphrase or secrets.
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Type selector */}
          {!isEdit && (
            <TypeSelector
              value={form.type}
              onChange={(t) => setForm((f) => ({ ...f, type: t, meta: {}, secret: "" }))}
            />
          )}

          {/* Dynamic fields */}
          <TypeFields
            type={form.type}
            meta={form.meta}
            secret={form.secret}
            onMeta={setMeta}
            onSecret={(v) => setForm((f) => ({ ...f, secret: v }))}
          />

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
                  onClick={() => setForm((f) => ({ ...f, visibility: v }))}
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
                ? "All family members can view this credential."
                : "Only you can view this credential."}
            </p>
          </Card>

          {/* Validation errors */}
          {Object.values(errors).map((e, i) => (
            <p key={i} className="px-1 text-sm text-danger">
              {e}
            </p>
          ))}
          {submitError && (
            <p className="px-1 text-sm text-danger">{submitError}</p>
          )}

          <Button
            type="submit"
            fullWidth
            size="lg"
            loading={mutation.isPending}
          >
            {isEdit ? "Save changes" : "Save credential"}
          </Button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex w-full items-center justify-center gap-1.5 py-2 text-sm text-fg-muted hover:text-fg"
          >
            <ArrowLeft className="size-4" />
            Cancel
          </button>
        </form>
      </Page>
    </>
  );
}
