import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckSquare,
  FileText,
  Link2,
  MapPin,
  NotebookPen,
  Pencil,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { inputCls } from "../lib/fieldCls";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { formatEventTime, eventTypeColor } from "../lib/eventTime";
import { useLabels } from "../lib/useLabels";

type Rsvp = "invited" | "accepted" | "declined" | "tentative";

interface Attendee {
  memberId: string;
  userId: string;
  name: string | null;
  displayName: string | null;
  memberType: "user" | "dependent";
  rsvp: Rsvp;
  picture: string | null;
  email: string | null;
}

interface EventDetail {
  id: string;
  familyId: string;
  title: string;
  description: string | null;
  type: string;
  location: string | null;
  travelBufferMins: number | null;
  startAt: number;
  endAt: number | null;
  allDay: boolean;
  status: "active" | "cancelled" | "trashed";
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * The API returns attendees as a SIBLING of event, not nested inside it.
 * This page used to type them onto EventDetail and read `ev.attendees`, which
 * is always undefined at runtime — `undefined.length` white-screened the whole
 * page. api<T>() is an unchecked cast, so TypeScript could not catch it and no
 * test rendered the component. Model the envelope exactly instead.
 */
interface EventDetailResponse {
  event: EventDetail;
  attendees: Attendee[];
  rsvpSummary: Record<Rsvp, number>;
  canEdit: boolean;
  documents: { id: string; title: string; category: string }[];
}

const RSVP_LABEL: Record<Rsvp, string> = {
  accepted: "Going",
  declined: "Not going",
  tentative: "Maybe",
  invited: "No reply",
};

const RSVP_TONE: Record<Rsvp, "success" | "danger" | "warning" | "neutral"> = {
  accepted: "success",
  declined: "danger",
  tentative: "warning",
  invited: "neutral",
};

function attendeeLabel(a: Attendee): string {
  return a.name ?? a.displayName ?? a.email ?? "Member";
}

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, activeFamily } = useAuth();
  const { format: formatType, find: findType } = useLabels(
    activeFamily?.id,
    "event_type",
  );
  const [actionDraft, setActionDraft] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["events", id],
    queryFn: () => api<EventDetailResponse>(`/events/${id}`),
    enabled: Boolean(id),
  });

  const { data: notesData } = useQuery({
    queryKey: ["notes", "event", id, activeFamily?.id],
    queryFn: () =>
      api<{ notes: { id: string; title: string; body: string }[] }>(
        `/notes?familyId=${activeFamily!.id}&eventId=${id}`,
      ),
    enabled: Boolean(id && activeFamily),
  });

  const { data: linksData } = useQuery({
    queryKey: ["links", "event", id, activeFamily?.id],
    queryFn: () =>
      api<{
        links: {
          id: string;
          kind: string;
          url: string | null;
          title: string | null;
        }[];
      }>(
        `/links?familyId=${activeFamily!.id}&targetType=event&targetId=${id}`,
      ),
    enabled: Boolean(id && activeFamily),
  });

  // Answering an invitation is always the attendee's own right, so this is not
  // gated on canEdit — a member who may not move the event can still say
  // whether they are coming.
  const rsvpMutation = useMutation({
    mutationFn: (status: Rsvp) =>
      api(`/events/${id}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["events"] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => api(`/events/${id}/cancel`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["events"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api(`/events/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["events"] });
      navigate("/calendar", { replace: true });
    },
  });

  const actionItemsMutation = useMutation({
    mutationFn: (titles: string[]) =>
      api(`/events/${id}/action-items`, {
        method: "POST",
        body: JSON.stringify({ titles }),
      }),
    onSuccess: () => {
      setActionDraft("");
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const followUpMutation = useMutation({
    mutationFn: () =>
      api(`/events/${id}/follow-up`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
  });

  const meetingNoteMutation = useMutation({
    mutationFn: () =>
      api<{ note: { id: string } }>("/notes", {
        method: "POST",
        body: JSON.stringify({
          familyId: activeFamily!.id,
          kind: "meeting",
          eventId: id,
          title: `Notes: ${data?.event.title ?? "Meeting"}`,
          visibility: "family",
          body: "",
        }),
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["notes"] });
      if (res.note?.id) navigate(`/notes/${res.note.id}`);
    },
  });

  const addLinkMutation = useMutation({
    mutationFn: () =>
      api("/links", {
        method: "POST",
        body: JSON.stringify({
          familyId: activeFamily!.id,
          kind: linkUrl.includes("youtu") ? "youtube" : "url",
          targetType: "event",
          targetId: id,
          url: linkUrl.trim(),
          title: linkTitle.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      setLinkUrl("");
      setLinkTitle("");
      void qc.invalidateQueries({ queryKey: ["links"] });
    },
  });

  if (isLoading) {
    return (
      <>
        <AppBar title="Event" back />
        <Page className="space-y-4">
          <Card className="space-y-3 p-4">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </Card>
        </Page>
      </>
    );
  }

  const ev = data?.event;
  if (!ev) return null;

  const attendees = data?.attendees ?? [];
  const summary = data?.rsvpSummary;
  const canEdit = data?.canEdit ?? false;
  const documents = data?.documents ?? [];
  const meetingNotes = notesData?.notes ?? [];
  const links = linksData?.links ?? [];
  // Which row is mine? Only a real user account can answer for itself.
  const me = attendees.find((a) => a.userId === user?.id);

  const colors = eventTypeColor(ev.type);
  const typeMeta = findType(ev.type);

  return (
    <>
      <AppBar
        title={formatType(ev.type) || "Event"}
        back
        trailing={
          ev.status === "active" && canEdit ? (
            <button
              onClick={() => navigate(`/calendar/events/${id}/edit`)}
              className="lq-press flex size-10 items-center justify-center rounded-full text-fg-muted hover:bg-white/8 hover:text-fg"
              aria-label="Edit event"
            >
              <Pencil className="size-4" />
            </button>
          ) : null
        }
      />
      <Page className="space-y-4">
        {/* Hero card */}
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <div
              className={`lq lq-flat lq-tint flex size-10 shrink-0 items-center justify-center rounded-full ${colors.text}`}
              style={{ ["--lq-tint" as string]: colors.tint }}
            >
              {typeMeta ? (
                <span className="text-lg" aria-hidden="true">
                  {typeMeta.emoji}
                </span>
              ) : (
                <CalendarDays className="size-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <h2 className="flex-1 text-base font-semibold text-white leading-snug">
                  {ev.title}
                </h2>
                {ev.status === "cancelled" && (
                  <Badge tone="danger">Cancelled</Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-fg-muted">
                {formatEventTime(ev.startAt, ev.endAt, ev.allDay)}
              </p>
            </div>
          </div>

          {ev.location && (
            <div className="mt-3 flex items-center gap-2 text-sm text-fg-muted">
              <MapPin className="size-4 shrink-0 text-fg-subtle" />
              {ev.location}
            </div>
          )}

          {ev.travelBufferMins != null && ev.travelBufferMins > 0 && (
            <p className="mt-2 text-xs text-fg-subtle">
              Leave ~{ev.travelBufferMins} min early
            </p>
          )}

          {ev.description && (
            <p className="mt-3 text-sm text-fg-muted leading-relaxed">
              {ev.description}
            </p>
          )}
        </Card>

        {/* Your invitation — shown only if you are actually on the guest list */}
        {me && ev.status === "active" && (
          <section className="space-y-2">
            <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              Are you going?
            </h3>
            <Card className="p-3">
              <div className="flex gap-2">
                {(["accepted", "tentative", "declined"] as const).map((s) => (
                  <Button
                    key={s}
                    variant={me.rsvp === s ? "primary" : "ghost"}
                    fullWidth
                    disabled={rsvpMutation.isPending}
                    onClick={() => rsvpMutation.mutate(s)}
                  >
                    {RSVP_LABEL[s]}
                  </Button>
                ))}
              </div>
              {me.rsvp === "invited" && (
                <p className="mt-2 text-xs text-fg-subtle">
                  You have not replied yet.
                </p>
              )}
            </Card>
          </section>
        )}

        {/* Attendees */}
        {attendees.length > 0 && (
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              <Users className="size-3.5" />
              Attendees ({attendees.length})
              {summary && summary.accepted > 0 && (
                <span className="font-normal normal-case">
                  · {summary.accepted} going
                </span>
              )}
            </h3>
            <Card className="p-3">
              <div className="flex flex-col gap-2.5">
                {attendees.map((a) => (
                  <div key={a.memberId} className="flex items-center gap-2">
                    <Avatar
                      name={attendeeLabel(a)}
                      email={a.email}
                      src={a.picture}
                      className="size-8"
                    />
                    <span className="flex-1 truncate text-sm text-fg">
                      {attendeeLabel(a)}
                    </span>
                    <Badge tone={RSVP_TONE[a.rsvp]}>{RSVP_LABEL[a.rsvp]}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          </section>
        )}

        {/* Linked documents */}
        {documents.length > 0 && (
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              <FileText className="size-3.5" />
              Documents
            </h3>
            <Card className="divide-y divide-white/5 p-1">
              {documents.map((d) => (
                <Link
                  key={d.id}
                  to={`/documents/${d.id}`}
                  className="lq-press flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-fg"
                >
                  <span className="truncate flex-1">{d.title}</span>
                  <Badge tone="neutral">{d.category}</Badge>
                </Link>
              ))}
            </Card>
          </section>
        )}

        {/* Meeting notes */}
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            <NotebookPen className="size-3.5" />
            Meeting notes
          </h3>
          <Card className="space-y-2 p-3">
            {meetingNotes.length === 0 ? (
              <p className="text-xs text-fg-subtle">No notes yet.</p>
            ) : (
              meetingNotes.map((n) => (
                <Link
                  key={n.id}
                  to={`/notes/${n.id}`}
                  className="block text-sm text-fg underline-offset-2 hover:underline"
                >
                  {n.title.trim() || "Untitled note"}
                </Link>
              ))
            )}
            {activeFamily && (
              <Button
                variant="ghost"
                fullWidth
                leadingIcon={<NotebookPen className="size-4" />}
                loading={meetingNoteMutation.isPending}
                onClick={() => meetingNoteMutation.mutate()}
              >
                New meeting note
              </Button>
            )}
          </Card>
        </section>

        {/* Action items → tasks */}
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            <CheckSquare className="size-3.5" />
            Action items
          </h3>
          <Card className="space-y-2 p-3">
            <textarea
              value={actionDraft}
              onChange={(e) => setActionDraft(e.target.value)}
              placeholder={"One task per line\ne.g. Book follow-up\nShare report"}
              rows={3}
              className={`${inputCls} resize-none`}
            />
            <Button
              variant="secondary"
              fullWidth
              loading={actionItemsMutation.isPending}
              onClick={() => {
                const titles = actionDraft
                  .split(/\r?\n/)
                  .map((l) => l.trim())
                  .filter(Boolean);
                if (titles.length) actionItemsMutation.mutate(titles);
              }}
            >
              Convert to tasks
            </Button>
            {actionItemsMutation.isSuccess && (
              <p className="text-xs text-success">Tasks created and linked.</p>
            )}
          </Card>
        </section>

        {/* Links / YouTube */}
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            <Link2 className="size-3.5" />
            Links &amp; videos
          </h3>
          <Card className="space-y-2 p-3">
            {links.map((l) => (
              <a
                key={l.id}
                href={l.url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-sm text-vault-300"
              >
                {l.title || l.url}
              </a>
            ))}
            <input
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://…"
              className={inputCls}
            />
            <input
              type="text"
              value={linkTitle}
              onChange={(e) => setLinkTitle(e.target.value)}
              placeholder="Label (optional)"
              className={inputCls}
            />
            <Button
              variant="ghost"
              fullWidth
              disabled={!linkUrl.trim()}
              loading={addLinkMutation.isPending}
              onClick={() => addLinkMutation.mutate()}
            >
              Save link
            </Button>
          </Card>
        </section>

        {/* Actions — calendars are opted in on create (default-checked). */}

        <Button
          variant="ghost"
          fullWidth
          loading={followUpMutation.isPending}
          onClick={() => followUpMutation.mutate()}
        >
          Send follow-up to attendees
        </Button>
        {followUpMutation.isSuccess && (
          <p className="px-1 text-xs text-success">Follow-up sent.</p>
        )}

        {ev.status === "active" && canEdit && (
          <section className="space-y-2 pt-2">
            <Button
              variant="ghost"
              fullWidth
              leadingIcon={<XCircle className="size-4" />}
              onClick={() => cancelMutation.mutate()}
              loading={cancelMutation.isPending}
            >
              Cancel event
            </Button>
            <Button
              variant="danger"
              fullWidth
              leadingIcon={<Trash2 className="size-4" />}
              onClick={() => {
                if (confirm("Delete this event? This cannot be undone.")) {
                  deleteMutation.mutate();
                }
              }}
              loading={deleteMutation.isPending}
            >
              Delete event
            </Button>
          </section>
        )}
      </Page>
    </>
  );
}
