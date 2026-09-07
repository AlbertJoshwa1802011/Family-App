import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Pin, RotateCcw, Trash2, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Button } from "../components/ui/Button";
import { Skeleton } from "../components/ui/Skeleton";
import { Chip } from "../components/ui/Chip";
import { inputCls } from "../lib/fieldCls";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/cn";
import {
  KIND_LABELS,
  NOTE_KINDS,
  noteDisplayTitle,
  type Note,
  type NoteKind,
  type Notebook,
} from "../lib/notes";

type Draft = {
  title: string;
  body: string;
  kind: NoteKind;
  noteDate: string;
  visibility: "family" | "private";
  pinned: boolean;
  notebookId: string | null;
};

function draftFromNote(note: Note): Draft {
  return {
    title: note.title,
    body: note.body,
    kind: note.kind,
    noteDate: note.noteDate ?? "",
    visibility: note.visibility,
    pinned: note.pinned,
    notebookId: note.notebookId,
  };
}

function draftsEqual(a: Draft, b: Draft): boolean {
  return (
    a.title === b.title &&
    a.body === b.body &&
    a.kind === b.kind &&
    a.noteDate === b.noteDate &&
    a.visibility === b.visibility &&
    a.pinned === b.pinned &&
    a.notebookId === b.notebookId
  );
}

export function NoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { activeFamily } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["notes", id],
    queryFn: () => api<{ note: Note }>(`/notes/${id}`),
    enabled: Boolean(id),
  });

  const { data: notebooksData } = useQuery({
    queryKey: ["notebooks", activeFamily?.id],
    queryFn: () =>
      api<{ notebooks: Notebook[] }>(
        `/notes/notebooks?familyId=${activeFamily!.id}`,
      ),
    enabled: Boolean(activeFamily),
  });

  if (isLoading) {
    return (
      <>
        <AppBar title="Note" back />
        <Page>
          <Skeleton className="mb-3 h-10 w-3/4 rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </Page>
      </>
    );
  }

  if (error || !data?.note) {
    return (
      <>
        <AppBar title="Note" back />
        <Page>
          <p className="text-sm text-fg-muted">
            {(error as Error)?.message ?? "Note not found."}
          </p>
        </Page>
      </>
    );
  }

  // Remount editor when navigating between notes so draft state re-inits cleanly.
  return (
    <NoteEditor
      key={data.note.id}
      note={data.note}
      notebooks={notebooksData?.notebooks ?? []}
    />
  );
}

function NoteEditor({
  note,
  notebooks,
}: {
  note: Note;
  notebooks: Notebook[];
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeFamily, user } = useAuth();
  const [draft, setDraft] = useState<Draft>(() => draftFromNote(note));
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const baselineRef = useRef<Draft>(draftFromNote(note));
  const draftRef = useRef(draft);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canEditRef = useRef(false);

  const isTrashed = Boolean(note.deletedAt);
  // Edit only when this note belongs to the active family context AND the
  // caller is the owner or an admin/owner of that same family.
  const sameFamily = activeFamily?.id === note.familyId;
  const canEdit =
    Boolean(user && sameFamily && !isTrashed) &&
    (note.ownerUserId === user!.id ||
      activeFamily?.role === "owner" ||
      activeFamily?.role === "admin");
  const canManageTrash =
    Boolean(user && sameFamily && isTrashed) &&
    (note.ownerUserId === user!.id ||
      activeFamily?.role === "owner" ||
      activeFamily?.role === "admin");

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    canEditRef.current = canEdit;
  }, [canEdit]);

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<{ note: Note }>(`/notes/${note.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (res) => {
      baselineRef.current = draftFromNote(res.note);
      setSaveState("saved");
      void qc.invalidateQueries({ queryKey: ["notes"] });
      void qc.setQueryData(["notes", note.id], res);
    },
    onError: () => setSaveState("error"),
  });

  const remove = useMutation({
    mutationFn: () =>
      api<{ ok: true; permanent: boolean }>(`/notes/${note.id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notes"] });
      navigate("/notes", { replace: true });
    },
  });

  const restore = useMutation({
    mutationFn: () =>
      api<{ note: Note }>(`/notes/${note.id}/restore`, { method: "POST" }),
    onSuccess: (res) => {
      void qc.setQueryData(["notes", note.id], res);
      void qc.invalidateQueries({ queryKey: ["notes"] });
    },
  });

  function buildPatchBody(d: Draft): Record<string, unknown> {
    return {
      title: d.title,
      body: d.body,
      kind: d.kind,
      visibility: d.visibility,
      pinned: d.pinned,
      notebookId: d.notebookId,
      noteDate: d.noteDate.trim() ? d.noteDate.trim() : null,
    };
  }

  // Debounced autosave while editing.
  useEffect(() => {
    if (isTrashed || !canEdit) return;
    if (draftsEqual(draft, baselineRef.current)) {
      setSaveState((s) => (s === "saving" ? "idle" : s));
      return;
    }

    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    const body = buildPatchBody(draft);
    saveTimer.current = setTimeout(() => {
      patch.mutate(body);
    }, 600);

    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional debounce
  }, [draft, isTrashed, canEdit]);

  // Flush dirty edits only on unmount (navigate away), not on every keystroke.
  useEffect(() => {
    const noteId = note.id;
    return () => {
      if (!canEditRef.current) return;
      const latest = draftRef.current;
      if (draftsEqual(latest, baselineRef.current)) return;
      void api<{ note: Note }>(`/notes/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify(buildPatchBody(latest)),
      }).catch(() => {
        /* best-effort; next open shows last saved */
      });
    };
  }, [note.id]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? "Saved"
        : saveState === "error"
          ? "Couldn't save"
          : "";

  return (
    <>
      <AppBar
        title={isTrashed ? "Recently Deleted" : noteDisplayTitle(note)}
        back
        trailing={
          <span className="flex items-center gap-1">
            {!isTrashed && canEdit && (
              <button
                type="button"
                className={cn(
                  "lq lq-flat lq-press flex size-10 items-center justify-center rounded-full",
                  draft.pinned ? "text-vault-300" : "text-fg-subtle",
                )}
                aria-label={draft.pinned ? "Unpin" : "Pin"}
                aria-pressed={draft.pinned}
                onClick={() => update("pinned", !draft.pinned)}
              >
                <Pin className="size-5" />
              </button>
            )}
            {isTrashed && canManageTrash ? (
              <button
                type="button"
                className="lq lq-flat lq-press flex size-10 items-center justify-center rounded-full text-fg-muted"
                aria-label="Restore note"
                disabled={restore.isPending}
                onClick={() => restore.mutate()}
              >
                <RotateCcw className="size-5" />
              </button>
            ) : null}
            {canEdit || canManageTrash ? (
              <button
                type="button"
                className="lq lq-flat lq-press flex size-10 items-center justify-center rounded-full text-danger"
                aria-label={
                  isTrashed ? "Delete forever" : "Move to Recently Deleted"
                }
                disabled={remove.isPending}
                onClick={() => {
                  if (
                    isTrashed &&
                    !window.confirm(
                      "Delete this note forever? This can't be undone.",
                    )
                  ) {
                    return;
                  }
                  remove.mutate();
                }}
              >
                <Trash2 className="size-5" />
              </button>
            ) : null}
          </span>
        }
      />
      <Page>
        {isTrashed && canManageTrash && (
          <div className="lq lq-flat mb-4 rounded-2xl px-4 py-3 text-sm text-fg-muted">
            This note is in Recently Deleted. Restore it, or delete it forever.
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                loading={restore.isPending}
                onClick={() => restore.mutate()}
              >
                Restore
              </Button>
              <Button
                size="sm"
                variant="danger"
                loading={remove.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      "Delete this note forever? This can't be undone.",
                    )
                  ) {
                    remove.mutate();
                  }
                }}
              >
                Delete forever
              </Button>
            </div>
          </div>
        )}

        {isTrashed && !canManageTrash && (
          <div className="lq lq-flat mb-4 rounded-2xl px-4 py-3 text-sm text-fg-muted">
            This note is in Recently Deleted.
          </div>
        )}

        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs text-fg-subtle" aria-live="polite">
            {saveLabel || "\u00a0"}
          </p>
          {!isTrashed && canEdit && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-fg-muted"
              onClick={() =>
                update(
                  "visibility",
                  draft.visibility === "private" ? "family" : "private",
                )
              }
            >
              {draft.visibility === "private" ? (
                <>
                  <Lock className="size-3.5" /> Private
                </>
              ) : (
                <>
                  <Users className="size-3.5" /> Family
                </>
              )}
            </button>
          )}
        </div>

        <input
          className={cn(
            "mb-2 w-full bg-transparent px-4 py-2 text-xl font-semibold tracking-tight text-fg",
            "placeholder:text-fg-subtle focus:outline-none [color-scheme:dark]",
          )}
          value={draft.title}
          onChange={(e) => update("title", e.target.value)}
          placeholder="Title"
          maxLength={200}
          disabled={!canEdit || isTrashed}
          aria-label="Title"
        />

        <textarea
          className={cn(
            "min-h-[50vh] w-full resize-y rounded-2xl bg-transparent px-4 py-2",
            "text-sm leading-relaxed text-fg placeholder:text-fg-subtle",
            "focus:outline-none [color-scheme:dark]",
          )}
          value={draft.body}
          onChange={(e) => update("body", e.target.value)}
          placeholder="Start writing…"
          maxLength={100_000}
          disabled={!canEdit || isTrashed}
          aria-label="Note body"
        />

        {!isTrashed && canEdit && (
          <div className="mt-6 space-y-4 border-t border-white/8 pt-4">
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
                Kind
              </p>
              <div className="-mx-1 flex flex-wrap gap-2 px-1">
                {NOTE_KINDS.map((k) => (
                  <Chip
                    key={k}
                    selected={draft.kind === k}
                    onClick={() => update("kind", k)}
                  >
                    {KIND_LABELS[k]}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold tracking-wide text-fg-subtle uppercase">
                Date
              </label>
              <input
                type="date"
                className={inputCls}
                value={draft.noteDate}
                onChange={(e) => update("noteDate", e.target.value)}
              />
              <p className="mt-1.5 text-xs text-fg-subtle">
                Optional — useful for daily or Bible study notes.
              </p>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
                Folder
              </p>
              <div className="-mx-1 flex flex-wrap gap-2 px-1">
                <Chip
                  selected={draft.notebookId === null}
                  onClick={() => update("notebookId", null)}
                >
                  Unfiled
                </Chip>
                {notebooks.map((nb) => (
                  <Chip
                    key={nb.id}
                    selected={draft.notebookId === nb.id}
                    onClick={() => update("notebookId", nb.id)}
                  >
                    {nb.name}
                  </Chip>
                ))}
              </div>
            </div>
          </div>
        )}
      </Page>
    </>
  );
}
