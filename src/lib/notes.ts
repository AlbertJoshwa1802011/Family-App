/** Shared note types + tiny display helpers for the Notebook UI. */

export const NOTE_KINDS = ["general", "bible", "journal", "meeting", "other"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export interface Notebook {
  id: string;
  familyId: string;
  name: string;
  sortOrder: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: string;
  familyId: string;
  notebookId: string | null;
  eventId: string | null;
  ownerUserId: string;
  title: string;
  body: string;
  kind: NoteKind;
  noteDate: string | null;
  visibility: "family" | "private";
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export const KIND_LABELS: Record<NoteKind, string> = {
  general: "General",
  bible: "Bible",
  journal: "Journal",
  meeting: "Meeting",
  other: "Other",
};

/** First non-empty line of body, trimmed for list preview. */
export function notePreview(body: string, max = 100): string {
  const line =
    body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1)}…`;
}

/** Display title: explicit title, else first line of body, else "New note". */
export function noteDisplayTitle(note: {
  title: string;
  body: string;
}): string {
  const t = note.title.trim();
  if (t) return t;
  const preview = notePreview(note.body, 60);
  return preview || "New note";
}

/** Format an updatedAt stamp. Pass `nowMs` (stable snapshot) for relative "today" times. */
export function formatNoteStamp(seconds: number, nowMs: number): string {
  const d = new Date(seconds * 1000);
  const now = new Date(nowMs);
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
