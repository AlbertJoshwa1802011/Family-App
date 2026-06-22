import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Skeleton } from "../components/ui/Skeleton";
import { Avatar } from "../components/ui/Avatar";
import { cn } from "../lib/cn";
import { api } from "../lib/api";
import { OCCASION_TYPES, type OccasionType } from "../lib/occasions";
import { useAuth } from "../context/AuthContext";

interface Member {
  id: string;
  name?: string | null;
  displayName?: string | null;
  picture?: string | null;
}

interface Occasion {
  id: string;
  type: OccasionType;
  title: string;
  date: string;
  recurring: boolean;
  subjectMemberId?: string | null;
  notes?: string | null;
  recipientMemberIds: string[];
}

interface Initial {
  type: OccasionType;
  title: string;
  date: string;
  recurring: boolean;
  subjectMemberId: string;
  notes: string;
  recipientMemberIds: string[];
}

const EMPTY: Initial = {
  type: "birthday",
  title: "",
  date: "",
  recurring: true,
  subjectMemberId: "",
  notes: "",
  recipientMemberIds: [],
};

const inputCls =
  "w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-vault-500/60 focus:ring-2 focus:ring-vault-400/30";
const labelCls = "mb-1.5 block text-xs font-semibold tracking-wide text-fg-subtle uppercase";

export function OccasionForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);

  const { data: membersData } = useQuery({
    queryKey: ["family-members"],
    queryFn: () => api<{ members: Member[] }>("/families/me/members"),
  });

  const { data: existing, isLoading } = useQuery({
    queryKey: ["occasion", id],
    queryFn: () => api<{ occasion: Occasion }>(`/occasions/${id}`),
    enabled: isEdit,
  });

  if (isEdit && isLoading) {
    return (
      <>
        <AppBar title="Edit occasion" back />
        <Page className="space-y-4">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </Page>
      </>
    );
  }

  const o = existing?.occasion;
  const initial: Initial = o
    ? {
        type: o.type,
        title: o.title,
        date: o.date,
        recurring: o.recurring,
        subjectMemberId: o.subjectMemberId ?? "",
        notes: o.notes ?? "",
        recipientMemberIds: o.recipientMemberIds ?? [],
      }
    : EMPTY;

  return (
    <FormFields
      key={id ?? "new"}
      occId={id}
      isEdit={isEdit}
      initial={initial}
      members={membersData?.members ?? []}
    />
  );
}

function FormFields({
  occId,
  isEdit,
  initial,
  members,
}: {
  occId?: string;
  isEdit: boolean;
  initial: Initial;
  members: Member[];
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { families } = useAuth();
  const familyId = families[0]?.id;

  const [type, setType] = useState<OccasionType>(initial.type);
  const [title, setTitle] = useState(initial.title);
  const [date, setDate] = useState(initial.date);
  const [recurring, setRecurring] = useState(initial.recurring);
  const [notes, setNotes] = useState(initial.notes);
  const [subjectMemberId, setSubjectMemberId] = useState(initial.subjectMemberId);
  const [recipients, setRecipients] = useState<string[]>(initial.recipientMemberIds);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleRecipient(memberId: string) {
    setRecipients((cur) =>
      cur.includes(memberId)
        ? cur.filter((m) => m !== memberId)
        : [...cur, memberId],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !date) {
      setError("Please add a title and a date.");
      return;
    }
    if (!familyId) {
      setError("No family found.");
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      familyId,
      type,
      title: title.trim(),
      date,
      recurring,
      subjectMemberId: subjectMemberId || undefined,
      notes: notes.trim() || undefined,
      recipientMemberIds: recipients,
    };

    try {
      if (isEdit && occId) {
        await api(`/occasions/${occId}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await api("/occasions", { method: "POST", body: JSON.stringify(payload) });
      }
      await qc.invalidateQueries({ queryKey: ["occasions"] });
      navigate("/occasions", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!occId || !confirm("Delete this occasion?")) return;
    setDeleting(true);
    try {
      await api(`/occasions/${occId}`, { method: "DELETE" });
      await qc.invalidateQueries({ queryKey: ["occasions"] });
      navigate("/occasions", { replace: true });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <AppBar title={isEdit ? "Edit occasion" : "Add occasion"} back />
      <Page>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Type selector */}
          <div className="grid grid-cols-3 gap-2">
            {OCCASION_TYPES.map((t) => {
              const Icon = t.icon;
              const active = type === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setType(t.id)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-2xl border py-3 text-xs font-medium transition-all active:scale-[0.97]",
                    active
                      ? "border-vault-500/60 bg-vault-500/10 text-vault-300"
                      : "border-line text-fg-muted hover:border-line-strong",
                  )}
                >
                  <Icon className="size-5" />
                  {t.label}
                </button>
              );
            })}
          </div>

          <div>
            <label className={labelCls} htmlFor="occ-title">
              Title
            </label>
            <input
              id="occ-title"
              className={inputCls}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                type === "birthday" ? "e.g. Dad's birthday" : "e.g. Wedding anniversary"
              }
              autoFocus={!isEdit}
            />
          </div>

          <div>
            <label className={labelCls} htmlFor="occ-date">
              Date
            </label>
            <input
              id="occ-date"
              type="date"
              className={inputCls}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <Card className="flex items-center justify-between p-4">
            <div>
              <div className="text-sm font-medium text-fg">Repeats every year</div>
              <div className="text-xs text-fg-muted">
                Ideal for birthdays &amp; anniversaries
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={recurring}
              aria-label="Toggle yearly repeat"
              onClick={() => setRecurring((v) => !v)}
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                recurring ? "bg-vault-600" : "bg-white/10",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-5 rounded-full bg-white transition-transform",
                  recurring ? "translate-x-5" : "translate-x-0.5",
                )}
              />
            </button>
          </Card>

          {members.length > 0 && (
            <div>
              <label className={labelCls} htmlFor="occ-subject">
                Who is this for?
              </label>
              <select
                id="occ-subject"
                className={inputCls}
                value={subjectMemberId}
                onChange={(e) => setSubjectMemberId(e.target.value)}
              >
                <option value="">Not specified</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name ?? m.displayName ?? "Member"}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Tag who to remind */}
          {members.length > 0 && (
            <div>
              <label className={labelCls}>Remind these people</label>
              <p className="mb-2 -mt-1 text-xs text-fg-muted">
                Leave empty to remind everyone in the family.
              </p>
              <div className="flex flex-wrap gap-2">
                {members.map((m) => {
                  const name = m.name ?? m.displayName ?? "Member";
                  const on = recipients.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleRecipient(m.id)}
                      className={cn(
                        "flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-xs font-medium transition-colors",
                        on
                          ? "border-vault-500/50 bg-vault-500/15 text-vault-200"
                          : "border-line text-fg-muted hover:bg-white/5",
                      )}
                    >
                      <Avatar name={name} src={m.picture} className="size-6" />
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label className={labelCls} htmlFor="occ-notes">
              Notes
            </label>
            <textarea
              id="occ-notes"
              className={cn(inputCls, "min-h-16 resize-y")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional (gift ideas, plans…)"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
              {error}
            </div>
          )}

          <Button type="submit" fullWidth size="lg" loading={saving}>
            {isEdit ? "Save changes" : "Add occasion"}
          </Button>

          {isEdit && (
            <Button
              type="button"
              variant="danger"
              fullWidth
              leadingIcon={<Trash2 className="size-4" />}
              loading={deleting}
              onClick={handleDelete}
            >
              Delete occasion
            </Button>
          )}
        </form>
      </Page>
    </>
  );
}
