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
import { formatEventTime, eventTypeColor } from "../lib/eventTime";

interface Attendee {
  memberId: string;
  userId: string;
  name: string | null;
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
  attendees: Attendee[];
  createdAt: number;
  updatedAt: number;
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

  const { data, isLoading } = useQuery({
    queryKey: ["events", id],
    queryFn: () => api<{ event: EventDetail }>(`/events/${id}`),
    enabled: Boolean(id),
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

  const colors = eventTypeColor(ev.type);

  return (
    <>
      <AppBar
        title={TYPE_LABELS[ev.type] ?? "Event"}
        back
        trailing={
          ev.status === "active" ? (
            <button
              onClick={() => navigate(`/calendar/events/${id}/edit`)}
              className="flex size-9 items-center justify-center rounded-xl text-fg-muted hover:text-fg"
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
              className={`flex size-10 items-center justify-center rounded-xl ${colors.bg} ${colors.text} shrink-0`}
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

        {/* Attendees */}
        {ev.attendees.length > 0 && (
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              <Users className="size-3.5" />
              Attendees ({ev.attendees.length})
            </h3>
            <Card className="p-3">
              <div className="flex flex-wrap gap-3">
                {ev.attendees.map((a) => (
                  <div key={a.memberId} className="flex items-center gap-2">
                    <Avatar
                      name={a.name}
                      email={a.email}
                      src={a.picture}
                      className="size-8"
                    />
                    <span className="text-sm text-fg">{a.name ?? a.email ?? "Member"}</span>
                  </div>
                ))}
              </div>
            </Card>
          </section>
        )}

        {/* Actions */}
        <a
          href={`/api/events/${ev.id}/ics`}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface-2 px-4 text-sm font-medium text-fg hover:border-line-strong"
        >
          <CalendarPlus className="size-4" />
          Add to my calendar
        </a>

        {ev.status === "active" && (
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
