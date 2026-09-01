import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Cake, Heart } from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import {
  dismissKey,
  upcomingLifeEvents,
  weekdayLabel,
  type LifeEventCandidate,
} from "../lib/lifeEvents";

interface MemberRow {
  id: string;
  displayName: string | null;
  name: string | null;
  email: string | null;
  dateOfBirth: string | null;
  anniversaryDate: string | null;
  status: string;
}

/**
 * On app open: if a family member's birthday/anniversary is within 14 days,
 * prompt about a gift commitment. Dismiss is stored per member+kind+year.
 */
export function LifeEventPrompt() {
  const { activeFamilyId } = useAuth();
  const navigate = useNavigate();
  const [nowMs] = useState(() => Date.now());
  const [dismissedTick, setDismissedTick] = useState(0);

  const membersQ = useQuery({
    queryKey: ["family", "members", activeFamilyId],
    queryFn: () =>
      api<{ members: MemberRow[] }>(`/families/${activeFamilyId}/members`),
    enabled: Boolean(activeFamilyId),
    staleTime: 60_000,
  });

  const pending = useMemo(() => {
    void dismissedTick;
    const members = (membersQ.data?.members ?? [])
      .filter((m) => m.status === "active")
      .map((m) => ({
        id: m.id,
        name: m.displayName || m.name || m.email || "Family member",
        dateOfBirth: m.dateOfBirth,
        anniversaryDate: m.anniversaryDate,
      }));
    const events = upcomingLifeEvents(members, nowMs, 14);
    return events.find((e) => {
      try {
        return localStorage.getItem(dismissKey(e)) !== "1";
      } catch {
        return true;
      }
    }) ?? null;
  }, [membersQ.data, nowMs, dismissedTick]);

  function dismiss(event: LifeEventCandidate) {
    try {
      localStorage.setItem(dismissKey(event), "1");
    } catch {
      /* ignore */
    }
    setDismissedTick((n) => n + 1);
  }

  function remindLater(event: LifeEventCandidate) {
    // Same as dismiss for this session year — cron still emails within 7 days.
    dismiss(event);
  }

  if (!pending) return null;

  const kindLabel = pending.kind === "birthday" ? "birthday" : "anniversary";
  const when =
    pending.daysUntil === 0
      ? "today"
      : pending.daysUntil === 1
        ? "tomorrow"
        : weekdayLabel(pending.nextDate);
  const Icon = pending.kind === "birthday" ? Cake : Heart;

  return (
    <Modal
      open
      onClose={() => dismiss(pending)}
      title={
        <span className="flex items-center gap-2">
          <Icon className="size-4 text-vault-300" aria-hidden="true" />
          Upcoming {kindLabel}
        </span>
      }
      footer={
        <>
          <Button variant="ghost" fullWidth onClick={() => dismiss(pending)}>
            Dismiss
          </Button>
          <Button variant="secondary" fullWidth onClick={() => remindLater(pending)}>
            Remind me
          </Button>
          <Button
            fullWidth
            onClick={() => {
              dismiss(pending);
              navigate(
                `/money/commitments/new?name=${encodeURIComponent(`${pending.name}'s ${kindLabel} gift`)}`,
              );
            }}
          >
            Add commitment
          </Button>
        </>
      }
    >
      <p className="text-sm text-fg-muted">
        {pending.name}&apos;s {kindLabel} is {when}
        {pending.daysUntil > 1 ? ` (${pending.nextDate})` : ""} — any gift commitment?
      </p>
    </Modal>
  );
}
