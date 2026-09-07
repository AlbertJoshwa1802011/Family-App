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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isTrashed = Boolean(note.deletedAt);
  const canEdit =
    Boolean(user && !isTrashed) &&
    (note.ownerUserId === user!.id ||
      activeFamily?.role === "owner" ||
      activeFamily?.role === "admin");

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

  // Debounced autosave when draft diverges from the last saved baseline.
  useEffect(() => {
    if (isTrashed || !canEdit) return;
    if (draftsEqual(draft, baselineRef.current)) return;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    const body: Record<string, unknown> = {
      title: draft.title,
      body: draft.body,
      kind: draft.kind,
      visibility: draft.visibility,
      pinned: draft.pinned,
      notebookId: draft.notebookId,
      noteDate: draft.noteDate.trim() ? draft.noteDate.trim() : null,
    };
    saveTimer.current = setTimeout(() => {
      patch.mutate(body);
    }, 600);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // patch.mutate is stable enough for debounce; including `patch` retriggers saves.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [draft, isTrashed, canEdit]);

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
            {isTrashed ? (
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
            {canEdit || isTrashed ? (
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
        {isTrashed && (
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
