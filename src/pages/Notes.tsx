import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookMarked,
  FolderPlus,
  Lock,
  NotebookPen,
  Pin,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { ListItem } from "../components/ui/ListItem";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { Fab } from "../components/ui/Fab";
import { Chip } from "../components/ui/Chip";
import { Sheet } from "../components/ui/Sheet";
import { inputCls } from "../lib/fieldCls";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/cn";
import {
  formatNoteStamp,
  noteDisplayTitle,
  notePreview,
  type Note,
  type Notebook,
} from "../lib/notes";
import { useLabels } from "../lib/useLabels";

type FolderFilter = "all" | "none" | "trash" | string; // string = notebook id
type KindFilter = "all" | string;

function NoteSkeleton() {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3">
      <Skeleton className="size-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

export function Notes() {
  const { activeFamily } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [folder, setFolder] = useState<FolderFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [folderSheet, setFolderSheet] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [nowMs] = useState(() => Date.now());
  const { labels: kindLabels, format: formatKind, find: findKind } = useLabels(
    activeFamily?.id,
    "note_kind",
  );

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const trashed = folder === "trash";

  const { data: notebooksData } = useQuery({
    queryKey: ["notebooks", activeFamily?.id],
    queryFn: () =>
      api<{ notebooks: Notebook[] }>(
        `/notes/notebooks?familyId=${activeFamily!.id}`,
      ),
    enabled: Boolean(activeFamily),
  });

  const notebooks = notebooksData?.notebooks ?? [];

  const notesQueryKey = [
    "notes",
    activeFamily?.id,
    folder,
    kind,
    debounced,
    trashed,
  ] as const;

  const { data, isLoading } = useQuery({
    queryKey: notesQueryKey,
    queryFn: () => {
      const params = new URLSearchParams({ familyId: activeFamily!.id });
      if (trashed) params.set("trashed", "1");
      if (folder === "none") params.set("notebookId", "none");
      else if (folder !== "all" && folder !== "trash") {
        params.set("notebookId", folder);
      }
      if (kind !== "all") params.set("kind", kind);
      if (debounced) params.set("q", debounced);
      return api<{ notes: Note[] }>(`/notes?${params}`);
    },
    enabled: Boolean(activeFamily),
  });

  const notes = data?.notes ?? [];

  const createNote = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        familyId: activeFamily!.id,
        visibility: "private",
      };
      if (kind !== "all") body.kind = kind;
      if (folder !== "all" && folder !== "trash" && folder !== "none") {
        body.notebookId = folder;
      }
      return api<{ note: Note }>("/notes", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["notes"] });
      navigate(`/notes/${res.note.id}`);
    },
  });

  const createFolder = useMutation({
    mutationFn: (name: string) =>
      api<{ notebook: Notebook }>("/notes/notebooks", {
        method: "POST",
        body: JSON.stringify({ familyId: activeFamily!.id, name }),
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["notebooks"] });
      setFolderSheet(false);
      setNewFolderName("");
      setFolder(res.notebook.id);
    },
  });

  const searching = debounced.length > 0;
  const emptyTitle = trashed
    ? "Recently Deleted is empty"
    : searching
      ? "No matching notes"
      : "No notes yet";
  const emptyDesc = trashed
    ? "Notes you delete stay here until you remove them for good."
    : searching
      ? `Nothing found for "${debounced}".`
      : "Jot daily thoughts, Bible study, or anything worth keeping — like Apple Notes, for your family.";

  return (
    <>
      <AppBar title="Notebook" back />
      <Page>
        <div className="relative mb-3">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 z-1 size-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden="true"
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search notes"
            className={cn(inputCls, "pr-10 pl-10")}
            aria-label="Search notes"
          />
          {q && (
            <button
              type="button"
              className="absolute top-1/2 right-3 z-1 -translate-y-1/2 text-fg-subtle"
              onClick={() => setQ("")}
              aria-label="Clear search"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Chip selected={folder === "all"} onClick={() => setFolder("all")}>
            All Notes
          </Chip>
          <Chip selected={folder === "none"} onClick={() => setFolder("none")}>
            Unfiled
          </Chip>
          {notebooks.map((nb) => (
            <Chip
              key={nb.id}
              selected={folder === nb.id}
              onClick={() => setFolder(nb.id)}
            >
              {nb.name}
            </Chip>
          ))}
          <Chip
            selected={folder === "trash"}
            onClick={() => setFolder("trash")}
          >
            Recently Deleted
          </Chip>
          <Chip
            selected={false}
            onClick={() => setFolderSheet(true)}
            aria-label="New folder"
          >
            <span className="inline-flex items-center gap-1">
              <FolderPlus className="size-3.5" aria-hidden="true" />
              Folder
            </span>
          </Chip>
        </div>

        <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Chip selected={kind === "all"} onClick={() => setKind("all")}>
            Any kind
          </Chip>
          {kindLabels.map((k) => (
            <Chip
              key={k.slug}
              selected={kind === k.slug}
              onClick={() => setKind(k.slug)}
            >
              <span aria-hidden="true" className="mr-1">
                {k.emoji}
              </span>
              {k.label}
            </Chip>
          ))}
        </div>

        {isLoading ? (
          <Card className="divide-y divide-white/8" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <NoteSkeleton key={i} />
            ))}
          </Card>
        ) : notes.length === 0 ? (
          <EmptyState
            icon={trashed ? Trash2 : NotebookPen}
            title={emptyTitle}
            description={emptyDesc}
            action={
              !trashed ? (
                <Button
                  leadingIcon={<Plus className="size-4" />}
                  loading={createNote.isPending}
                  onClick={() => createNote.mutate()}
                >
                  New note
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Card className="divide-y divide-white/8 overflow-hidden">
            {notes.map((note) => {
              const title = noteDisplayTitle(note);
              const preview = notePreview(note.body);
              const kindMeta = findKind(note.kind);
              const subtitleParts = [
                formatNoteStamp(note.updatedAt, nowMs),
                formatKind(note.kind),
                note.noteDate,
                preview && preview !== title ? preview : null,
              ].filter(Boolean);
              return (
                <ListItem
                  key={note.id}
                  to={`/notes/${note.id}`}
                  leading={
                    <span
                      className={cn(
                        "lq lq-flat lq-tint flex size-10 items-center justify-center rounded-full",
                        note.kind === "bible"
                          ? "[--lq-tint:var(--color-warning)]"
                          : "[--lq-tint:var(--color-vault-400)]",
                      )}
                    >
                      {kindMeta ? (
                        <span className="text-lg" aria-hidden="true">
                          {kindMeta.emoji}
                        </span>
                      ) : note.kind === "bible" ? (
                        <BookMarked className="size-5 text-warning" />
                      ) : (
                        <NotebookPen className="size-5 text-vault-300" />
                      )}
                    </span>
                  }
                  title={title}
                  subtitle={subtitleParts.join(" · ")}
                  trailing={
                    <span className="flex items-center gap-1.5">
                      {note.pinned && (
                        <Pin
                          className="size-3.5 text-vault-300"
                          aria-label="Pinned"
                        />
                      )}
                      {note.visibility === "private" ? (
                        <Lock
                          className="size-3.5 text-fg-subtle"
                          aria-label="Private"
                        />
                      ) : (
                        <Users
                          className="size-3.5 text-fg-subtle"
                          aria-label="Shared with family"
                        />
                      )}
                      {note.kind === "bible" && (
                        <Badge tone="warning">Bible</Badge>
                      )}
                    </span>
                  }
                />
              );
            })}
          </Card>
        )}
      </Page>

      {!trashed && (
        <Fab
          icon={Plus}
          label="New note"
          onClick={() => createNote.mutate()}
          disabled={createNote.isPending}
        />
      )}

      <Sheet
        open={folderSheet}
        onClose={() => setFolderSheet(false)}
        title="New folder"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newFolderName.trim();
            if (!name) return;
            createFolder.mutate(name);
          }}
        >
          <input
            className={inputCls}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="e.g. Bible Study, Daily Journal"
            maxLength={100}
            autoFocus
            aria-label="Folder name"
          />
          <Button
            type="submit"
            className="w-full"
            loading={createFolder.isPending}
            disabled={!newFolderName.trim()}
          >
            Create folder
          </Button>
        </form>
      </Sheet>
    </>
  );
}
