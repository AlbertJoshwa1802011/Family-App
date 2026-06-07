import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { ListItem } from "../components/ui/ListItem";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { Fab } from "../components/ui/Fab";
import { api } from "../lib/api";
import {
  formatEventTime,
  formatMonthYear,
  eventMonthKey,
  eventTypeColor,
} from "../lib/eventTime";

export interface EventSummary {
  id: string;
  title: string;
  type: string;
  startAt: number;
  endAt?: number | null;
  allDay: boolean;
  status: "active" | "cancelled" | "trashed";
  attendeeCount: number;
}

function EventSkeleton() {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3">
      <Skeleton className="size-2.5 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

function EventRow({ event }: { event: EventSummary }) {
  const colors = eventTypeColor(event.type);
  return (
    <ListItem
      to={`/calendar/events/${event.id}`}
      leading={
        <span
          className={`mt-0.5 size-2.5 shrink-0 self-start rounded-full ${colors.dot}`}
          aria-hidden="true"
        />
      }
      title={
        <span
          className={
            event.status === "cancelled"
              ? "text-fg-subtle line-through"
              : undefined
          }
        >
          {event.title}
        </span>
      }
      subtitle={formatEventTime(event.startAt, event.endAt, event.allDay)}
      trailing={
        event.status === "cancelled" ? (
          <Badge tone="danger">Cancelled</Badge>
        ) : event.attendeeCount > 0 ? (
          <Badge tone="vault">{event.attendeeCount}</Badge>
        ) : null
      }
    />
  );
}

export function CalendarPage() {
  const navigate = useNavigate();

  // Stable reference: computed once on mount so re-renders don't shift the query window.
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const sixMonths = now + 6 * 30 * 24 * 3600;

  const { data, isLoading } = useQuery({
    queryKey: ["events", { from: now, to: sixMonths }],
    queryFn: () =>
      api<{ events: EventSummary[] }>(`/events?from=${now}&to=${sixMonths}`),
  });

  const events = (data?.events ?? []).filter((e) => e.status !== "trashed");

  // Group events by month
  const grouped = events.reduce<Map<string, EventSummary[]>>((acc, ev) => {
    const key = eventMonthKey(ev.startAt);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key)!.push(ev);
    return acc;
  }, new Map());

  return (
    <>
      <AppBar title="Calendar" />
      <Page className="space-y-6">
        {isLoading ? (
          <Card className="divide-y divide-line" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <EventSkeleton key={i} />
            ))}
          </Card>
        ) : grouped.size === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="No upcoming events"
            description="Add family gatherings, appointments, or milestones so everyone stays in the loop."
            action={
              <button
                onClick={() => navigate("/calendar/events/new")}
                className="inline-flex items-center gap-2 rounded-full bg-vault-600 px-5 py-2.5 text-sm font-semibold text-white"
              >
                <Plus className="size-4" />
                Add event
              </button>
            }
          />
        ) : (
          Array.from(grouped.entries()).map(([key, monthEvents]) => (
            <section key={key} className="space-y-2">
              <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
                {formatMonthYear(monthEvents[0].startAt)}
              </h3>
              <Card className="divide-y divide-line overflow-hidden">
                {monthEvents.map((ev) => (
                  <EventRow key={ev.id} event={ev} />
                ))}
              </Card>
            </section>
          ))
        )}
      </Page>
      <Fab icon={Plus} label="Add event" onClick={() => navigate("/calendar/events/new")} />
    </>
  );
}
