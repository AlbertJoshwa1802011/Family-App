import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Avatar } from "../components/ui/Avatar";
import { TypePicker } from "../components/ui/TypePicker";
import { inputCls } from "../lib/fieldCls";
import { api } from "../lib/api";
import { downloadEventIcs } from "../lib/downloadEventIcs";
import { useAuth } from "../context/AuthContext";

interface Member {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  picture: string | null;
}

interface FormState {
  title: string;
  type: string;
  date: string; // yyyy-mm-dd
  allDay: boolean;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  location: string;
  travelBufferMins: string; // minutes as string for input; empty = unset
  description: string;
  attendeeMemberIds: string[];
  documentIds: string[];
  /** Default on — push to Google Calendar on save. */
  syncGoogleCalendar: boolean;
  /** Default on — email .ics + open Add-to-Calendar for Apple. */
  syncAppleCalendar: boolean;
}

interface ScheduleConflict {
  eventId: string;
  title: string;
  startAt: number;
  endAt: number | null;
  allDay: boolean;
  memberIds: string[];
}

interface DocOption {
  id: string;
  title: string;
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
    travelBufferMins: "",
    description: "",
    attendeeMemberIds: [],
    documentIds: [],
    syncGoogleCalendar: true,
    syncAppleCalendar: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  // Stable across retries so a double-submit / back-button retry cannot
  // insert a second event after the first POST already succeeded.
  const [clientRequestId] = useState(() => crypto.randomUUID());

  // Edit mode: hydrate the form once from the existing event.
  useQuery({
    queryKey: ["event", id, "form"],
    queryFn: async () => {
      const res = await api<{
        event: {
          title: string;
          type: string;
          startAt: number;
          endAt: number | null;
          allDay: boolean;
          location: string | null;
          travelBufferMins: number | null;
          description: string | null;
        };
        attendees: { memberId: string }[];
        documents: DocOption[];
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
          travelBufferMins:
            ev.travelBufferMins != null ? String(ev.travelBufferMins) : "",
          description: ev.description ?? "",
          attendeeMemberIds: res.attendees.map((a) => a.memberId),
          documentIds: (res.documents ?? []).map((d) => d.id),
          syncGoogleCalendar: true,
          syncAppleCalendar: true,
        });
        setHydrated(true);
      }
      return res;
    },
    enabled: isEdit,
  });

  // Fetch family members for attendee picker.
  // MUST be scoped to the active family: a user who belongs to two families was
  // previously shown the first family's members, and the create then failed
  // server-side with invalid_member_ids. familyId is in the query key too, so
  // switching families does not serve a stale picker from cache.
  const { data: membersData } = useQuery({
    queryKey: ["family-members", activeFamily?.id],
    queryFn: () =>
      api<{ members: Member[] }>(`/families/me/members?familyId=${activeFamily!.id}`),
    enabled: Boolean(activeFamily),
  });
  const members = membersData?.members ?? [];

  const { data: docsData } = useQuery({
    queryKey: ["documents", activeFamily?.id, "event-form"],
    queryFn: () =>
      api<{ documents: DocOption[] }>(
        `/documents?familyId=${activeFamily!.id}`,
      ),
    enabled: Boolean(activeFamily),
  });
  const documents = docsData?.documents ?? [];

  const mutation = useMutation({
    mutationFn: (payload: object) =>
      isEdit
        ? api<{
            event: { id: string };
            conflicts: ScheduleConflict[];
            appleCalendar?: boolean;
          }>(`/events/${id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : api<{
            event: { id: string };
            conflicts: ScheduleConflict[];
            appleCalendar?: boolean;
          }>("/events", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["events"] });
      const go = () => {
        const evId = data.event?.id;
        // Offer Apple Calendar via a credentialed blob download — never replace
        // the SPA with `/api/events/:id/ics` (that caused unauthorized JSON +
        // duplicate creates when the user hit Create again).
        if (!isEdit && data.appleCalendar && evId) {
          void downloadEventIcs(evId);
        }
        navigate(evId ? `/calendar/events/${evId}` : "/calendar", {
          replace: true,
        });
      };
      const list = data.conflicts ?? [];
      if (list.length > 0) {
        setConflicts(list);
        // Stay on the form briefly so the advisory banner is visible, then go.
        window.setTimeout(go, 1200);
        return;
      }
      go();
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

    const bufferRaw = form.travelBufferMins.trim();
    const travelBufferMins =
      bufferRaw === ""
        ? isEdit
          ? null
          : undefined
        : Math.max(0, Math.min(24 * 60, Number.parseInt(bufferRaw, 10) || 0));

    mutation.mutate({
      // POST /events requires familyId (server-side membership check).
      ...(isEdit ? {} : { familyId: activeFamily!.id }),
      title: form.title.trim(),
      type: form.type,
      startAt,
      endAt,
      allDay: form.allDay,
      location: form.location.trim() || undefined,
      travelBufferMins,
      description: form.description.trim() || undefined,
      attendeeMemberIds: form.attendeeMemberIds,
      documentIds: form.documentIds,
      ...(!isEdit
        ? {
            syncGoogleCalendar: form.syncGoogleCalendar,
            syncAppleCalendar: form.syncAppleCalendar,
            clientRequestId,
          }
        : {}),
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

  function toggleDocument(docId: string) {
    set(
      "documentIds",
      form.documentIds.includes(docId)
        ? form.documentIds.filter((id) => id !== docId)
        : [...form.documentIds, docId],
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
              className={inputCls}
            />
            {errors.title && (
              <p className="mt-1 text-xs text-danger">{errors.title}</p>
            )}
          </Card>

          {/* Type */}
          <Card className="p-4">
            <TypePicker
              domain="event_type"
              familyId={activeFamily?.id}
              value={form.type}
              onChange={(type) => set("type", type)}
              title="Type"
            />
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
                className={inputCls}
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
                    className={inputCls}
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
                    className={inputCls}
                  />
                  {errors.endTime && (
                    <p className="mt-1 text-xs text-danger">{errors.endTime}</p>
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* Location */}
          <Card className="p-4 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-fg-muted mb-1.5">
                Location (optional)
              </label>
              <input
                type="text"
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder="e.g. City Hospital, Room 4"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-fg-muted mb-1.5">
                Travel buffer (minutes)
              </label>
              <input
                type="number"
                min={0}
                max={1440}
                inputMode="numeric"
                value={form.travelBufferMins}
                onChange={(e) => set("travelBufferMins", e.target.value)}
                placeholder="e.g. 30"
                className={inputCls}
              />
              <p className="mt-1 text-xs text-fg-subtle">
                Advisory leave-by reminder — no Maps routing yet.
              </p>
            </div>
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
              className={`${inputCls} resize-none`}
            />
          </Card>

          {/* Linked documents */}
          {documents.length > 0 && (
            <Card className="p-4">
              <p className="text-xs font-semibold text-fg-muted mb-3">
                Related documents
              </p>
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {documents.map((d) => (
                  <label
                    key={d.id}
                    className="flex items-center gap-3 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={form.documentIds.includes(d.id)}
                      onChange={() => toggleDocument(d.id)}
                      className="size-4 rounded accent-vault-500"
                    />
                    <span className="text-sm text-fg truncate">{d.title}</span>
                  </label>
                ))}
              </div>
            </Card>
          )}

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
                Tagged members are notified as soon as you save, and again if
                you move or cancel the event.
              </p>
            </Card>
          )}

          {conflicts.length > 0 && (
            <Card className="border border-warning/40 p-4">
              <p className="text-sm font-semibold text-warning">
                Scheduling conflict (advisory)
              </p>
              <ul className="mt-2 space-y-1 text-xs text-fg-muted">
                {conflicts.map((c) => (
                  <li key={c.eventId}>
                    Overlaps “{c.title}” for a shared attendee
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Calendars — default checked; no separate “connect” buttons. */}
          {!isEdit && (
            <Card className="space-y-3 p-4">
              <p className="text-xs font-semibold text-fg-muted">
                Add to my calendars
              </p>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.syncGoogleCalendar}
                  onChange={(e) => set("syncGoogleCalendar", e.target.checked)}
                  className="mt-0.5 size-4 rounded accent-vault-500"
                />
                <span>
                  <span className="block text-sm text-fg">Google Calendar</span>
                  <span className="block text-xs text-fg-subtle">
                    Pushed automatically when you save
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.syncAppleCalendar}
                  onChange={(e) => set("syncAppleCalendar", e.target.checked)}
                  className="mt-0.5 size-4 rounded accent-vault-500"
                />
                <span>
                  <span className="block text-sm text-fg">Apple Calendar</span>
                  <span className="block text-xs text-fg-subtle">
                    Downloads a calendar file after save (and emails you one)
                  </span>
                </span>
              </label>
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
