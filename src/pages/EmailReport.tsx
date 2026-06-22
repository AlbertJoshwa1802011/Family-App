import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Eye, Mail, RotateCcw } from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Skeleton } from "../components/ui/Skeleton";
import { cn } from "../lib/cn";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

interface TemplateResponse {
  template: { html: string; subject?: string | null } | null;
  default: string;
}

const VARS = ["heading", "body", "ctaLabel", "ctaUrl", "year"] as const;

const SAMPLE: Record<string, string> = {
  heading: "Expiring soon: Maya's Passport",
  body: "Maya's passport expires in 7 days. Tap below to review and renew it in time.",
  ctaLabel: "View document",
  ctaUrl: "#",
  year: String(new Date().getFullYear()),
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Client mirror of the worker's renderTemplate (values escaped, template trusted). */
function renderPreview(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) =>
    vars[key] === undefined ? "" : escapeHtml(vars[key]),
  );
}

export function EmailReport() {
  const { families } = useAuth();
  const family = families[0];
  const familyId = family?.id;
  const isAdmin = family?.role === "owner" || family?.role === "admin";
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["email-template", familyId],
    queryFn: () => api<TemplateResponse>(`/families/${familyId}/email-template`),
    enabled: Boolean(familyId),
  });

  if (isLoading || !data) {
    return (
      <>
        <AppBar title="Email report" back />
        <Page className="space-y-4">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </Page>
      </>
    );
  }

  return (
    <Editor
      key={familyId}
      familyId={familyId!}
      isAdmin={isAdmin}
      initialHtml={data.template?.html ?? data.default}
      defaultHtml={data.default}
      onSaved={() =>
        qc.invalidateQueries({ queryKey: ["email-template", familyId] })
      }
    />
  );
}

function Editor({
  familyId,
  isAdmin,
  initialHtml,
  defaultHtml,
  onSaved,
}: {
  familyId: string;
  isAdmin: boolean;
  initialHtml: string;
  defaultHtml: string;
  onSaved: () => void;
}) {
  const [html, setHtml] = useState(initialHtml);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      await api(`/families/${familyId}/email-template`, {
        method: "PUT",
        body: JSON.stringify({ html }),
      });
      setNote("Saved — reminder emails now use your template.");
      onSaved();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!confirm("Reset to the built-in default template?")) return;
    setBusy(true);
    setNote(null);
    try {
      await api(`/families/${familyId}/email-template`, { method: "DELETE" });
      setHtml(defaultHtml);
      setNote("Reverted to the default template.");
      onSaved();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not reset.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppBar title="Email report" back />
      <Page className="space-y-4">
        <Card className="flex items-start gap-3 p-4">
          <span className="flex size-9 items-center justify-center rounded-xl bg-vault-500/15 text-vault-300">
            <Mail className="size-5" />
          </span>
          <p className="text-sm text-fg-muted">
            Customize the HTML of your family's reminder emails. The reminder text
            is injected where you place these tokens:
          </p>
        </Card>

        <div className="flex flex-wrap gap-2">
          {VARS.map((v) => (
            <code
              key={v}
              className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs text-vault-300"
            >{`{{${v}}}`}</code>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          <TabBtn active={tab === "edit"} onClick={() => setTab("edit")}>
            Edit HTML
          </TabBtn>
          <TabBtn active={tab === "preview"} onClick={() => setTab("preview")}>
            <Eye className="size-3.5" /> Preview
          </TabBtn>
        </div>

        {tab === "edit" ? (
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            spellCheck={false}
            readOnly={!isAdmin}
            className="h-72 w-full rounded-2xl border border-line bg-surface-2 p-3 font-mono text-xs leading-relaxed text-fg outline-none focus:border-vault-500/60"
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-white">
            <iframe
              title="Email preview"
              className="h-72 w-full"
              sandbox=""
              srcDoc={renderPreview(html, SAMPLE)}
            />
          </div>
        )}

        {note && (
          <div className="rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-fg-muted">
            {note}
          </div>
        )}

        {isAdmin ? (
          <div className="flex gap-2">
            <Button fullWidth loading={busy} onClick={save}>
              Save template
            </Button>
            <Button
              variant="secondary"
              leadingIcon={<RotateCcw className="size-4" />}
              onClick={reset}
              disabled={busy}
            >
              Reset
            </Button>
          </div>
        ) : (
          <p className="text-center text-xs text-fg-subtle">
            Only family admins can edit the email template.
          </p>
        )}
      </Page>
    </>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-vault-500/40 bg-vault-500/15 text-vault-300"
          : "border-line text-fg-muted hover:bg-white/5",
      )}
    >
      {children}
    </button>
  );
}
