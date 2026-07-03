import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Avatar } from "../components/ui/Avatar";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

type EventType = "gathering" | "appointment" | "milestone" | "other";

const EVENT_TYPES: { value: EventType; label: string }[] = [
  { value: "gathering", label: "Gathering" },
  { value: "appointment", label: "Appointment" },
  { value: "milestone", label: "Milestone" },
  { value: "other", label: "Other" },
];

interface Member {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  picture: string | null;
}

interface FormState {
  title: string;
  type: EventType;
  date: string; // yyyy-mm-dd
  allDay: boolean;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  location: string;
  description: string;
  attendeeMemberIds: string[];
}

function toUnixSeconds(date: string, time: string): number {
  return Math.floor(new Date(`${date}T${time || "00:00"}`).getTime() / 1000);
}

export function EventForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeFamily } = useAuth();

  const [form, setForm] = useState<FormState>({
    title: "",
    type: "other",
    date: new Date().toISOString().slice(0, 10),
    allDay: false,
    startTime: "09:00",
    endTime: "10:00",
    location: "",
    description: "",
    attendeeMemberIds: [],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);

  // Edit mode: hydrate the form once from the existing event.
  useQuery({
    queryKey: ["event", id, "form"],
    queryFn: async () => {
      const res = await api<{
        event: {
          title: string;
          type: EventType;
          startAt: number;
          endAt: number | null;
          allDay: boolean;
          location: string | null;
          description: string | null;
        };
        attendees: { memberId: string }[];
      }>(`/events/${id}`);
      if (!hydrated) {
        const ev = res.event;
        const start = new Date(ev.startAt * 1000);
        const end = ev.endAt ? new Date(ev.endAt * 1000) : null;
        const pad = (n: number) => String(n).padStart(2, "0");
        setForm({
          title: ev.title,
          type: ev.type,
          date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
          allDay: ev.allDay,
          startTime: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
          endTime: end
            ? `${pad(end.getHours())}:${pad(end.getMinutes())}`
            : "10:00",
          location: ev.location ?? "",
          description: ev.description ?? "",
          attendeeMemberIds: res.attendees.map((a) => a.memberId),
        });
        setHydrated(true);
      }
      return res;
    },
    enabled: isEdit,
  });

  // Fetch family members for attendee picker
  const { data: membersData } = useQuery({
    queryKey: ["family-members"],
    queryFn: () => api<{ members: Member[] }>("/families/me/members"),
  });
  const members = membersData?.members ?? [];

  const mutation = useMutation({
    mutationFn: (payload: object) =>
      isEdit
        ? api(`/events/${id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : api("/events", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (data: unknown) => {
      void qc.invalidateQueries({ queryKey: ["events"] });
      const ev = (data as { event?: { id?: string } })?.event;
      navigate(ev?.id ? `/calendar/events/${ev.id}` : "/calendar", {
        replace: true,
      });
    },
  });

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.title.trim()) errs.title = "Title is required";
    if (!form.date) errs.date = "Date is required";
    if (!form.allDay && form.endTime < form.startTime) {
      errs.endTime = "End time must be after start time";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const startAt = toUnixSeconds(form.date, form.allDay ? "00:00" : form.startTime);
    const endAt = form.allDay
      ? undefined
      : toUnixSeconds(form.date, form.endTime);

    mutation.mutate({
      // POST /events requires familyId (server-side membership check).
      ...(isEdit ? {} : { familyId: activeFamily!.id }),
      title: form.title.trim(),
      type: form.type,
      startAt,
      endAt,
      allDay: form.allDay,
      location: form.location.trim() || undefined,
      description: form.description.trim() || undefined,
      attendeeMemberIds: form.attendeeMemberIds,
    });
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: "" }));
  }

  function toggleAttendee(memberId: string) {
    set(
      "attendeeMemberIds",
      form.attendeeMemberIds.includes(memberId)
        ? form.attendeeMemberIds.filter((id) => id !== memberId)
        : [...form.attendeeMemberIds, memberId],
    );
  }

  return (
    <>
      <AppBar title={isEdit ? "Edit event" : "New event"} back />
      <Page className="space-y-4">
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Title */}
          <Card className="p-4">
            <label className="block text-xs font-semibold text-fg-muted mb-1.5">
              Title <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Dad's doctor appointment"
              className="w-full rounded-xl bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle border border-line focus:border-vault-500 focus:outline-none"
            />
            {errors.title && (
              <p className="mt-1 text-xs text-danger">{errors.title}</p>
            )}
          </Card>

          {/* Type */}
          <Card className="p-4">
            <p className="text-xs font-semibold text-fg-muted mb-2">Type</p>
            <div className="flex flex-wrap gap-2">
              {EVENT_TYPES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => set("type", value)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    form.type === value
                      ? "bg-vault-600 text-white"
                      : "bg-white/5 text-fg-muted hover:bg-white/10"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Card>

          {/* Date & Time */}
          <Card className="p-4 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-fg-muted mb-1.5">
                Date <span className="text-danger">*</span>
              </label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
                className="w-full rounded-xl bg-ink-950 px-3.5 py-3 text-sm text-fg border border-line focus:border-vault-500 focus:outline-none"
              />
              {errors.date && (
                <p className="mt-1 text-xs text-danger">{errors.date}</p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="all-day"
                checked={form.allDay}
                onChange={(e) => set("allDay", e.target.checked)}
                className="size-4 rounded accent-vault-500"
              />
              <label htmlFor="all-day" className="text-sm text-fg">
                All day
              </label>
            </div>

            {!form.allDay && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-fg-muted mb-1.5">
                    Start time
                  </label>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(e) => set("startTime", e.target.value)}
                    className="w-full rounded-xl bg-ink-950 px-3.5 py-3 text-sm text-fg border border-line focus:border-vault-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-fg-muted mb-1.5">
                    End time
                  </label>
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={(e) => set("endTime", e.target.value)}
                    className="w-full rounded-xl bg-ink-950 px-3.5 py-3 text-sm text-fg border border-line focus:border-vault-500 focus:outline-none"
                  />
                  {errors.endTime && (
                    <p className="mt-1 text-xs text-danger">{errors.endTime}</p>
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* Location */}
          <Card className="p-4">
            <label className="block text-xs font-semibold text-fg-muted mb-1.5">
              Location (optional)
            </label>
            <input
              type="text"
              value={form.location}
              onChange={(e) => set("location", e.target.value)}
              placeholder="e.g. City Hospital, Room 4"
              className="w-full rounded-xl bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle border border-line focus:border-vault-500 focus:outline-none"
            />
          </Card>

          {/* Description */}
          <Card className="p-4">
            <label className="block text-xs font-semibold text-fg-muted mb-1.5">
              Notes (optional)
            </label>
            <textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Any extra details…"
              rows={3}
              className="w-full resize-none rounded-xl bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle border border-line focus:border-vault-500 focus:outline-none"
            />
          </Card>

          {/* Attendees */}
          {members.length > 0 && (
            <Card className="p-4">
              <p className="text-xs font-semibold text-fg-muted mb-3">
                Tag family members
              </p>
              <div className="space-y-2">
                {members.map((m) => (
                  <label
                    key={m.id}
                    className="flex items-center gap-3 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={form.attendeeMemberIds.includes(m.id)}
                      onChange={() => toggleAttendee(m.id)}
                      className="size-4 rounded accent-vault-500"
                    />
                    <Avatar
                      name={m.name}
                      email={m.email}
                      src={m.picture}
                      className="size-8"
                    />
                    <span className="text-sm text-fg">
                      {m.name ?? m.email ?? "Member"}
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-fg-subtle">
                Tagged members will be notified when the event is created.
              </p>
            </Card>
          )}

          {mutation.isError && (
            <p className="px-1 text-sm text-danger">
              {(mutation.error as Error).message}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            fullWidth
            loading={mutation.isPending}
          >
            {isEdit ? "Save changes" : "Create event"}
          </Button>
        </form>
      </Page>
    </>
  );
}
