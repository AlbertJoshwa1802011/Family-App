import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CalendarPlus,
  MapPin,
  Pencil,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { formatEventTime, eventTypeColor } from "../lib/eventTime";

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

const TYPE_LABELS: Record<string, string> = {
  gathering: "Gathering",
  appointment: "Appointment",
  milestone: "Milestone",
  other: "Event",
};

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["events", id],
    queryFn: () => api<EventDetailResponse>(`/events/${id}`),
    enabled: Boolean(id),
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
  // Which row is mine? Only a real user account can answer for itself.
  const me = attendees.find((a) => a.userId === user?.id);

  const colors = eventTypeColor(ev.type);

  return (
    <>
      <AppBar
        title={TYPE_LABELS[ev.type] ?? "Event"}
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
              <CalendarDays className="size-5" />
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

        {/* Actions */}
        <a
          href={`/api/events/${ev.id}/ics`}
          className="lq lq-press flex min-h-11 w-full items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold text-fg"
        >
          <CalendarPlus className="size-4" />
          Add to my calendar
        </a>

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
