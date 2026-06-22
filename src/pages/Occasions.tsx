import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { CalendarHeart, Plus } from "lucide-react";
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
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import {
  countdownLabel,
  daysUntil,
  nextOccurrence,
  occasionTypeMeta,
  shortDate,
} from "../lib/occasions";

interface Occasion {
  id: string;
  type: string;
  title: string;
  date: string;
  recurring: boolean;
}

export function Occasions() {
  const { families } = useAuth();
  const familyId = families[0]?.id;
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["occasions", familyId],
    queryFn: () => api<{ occasions: Occasion[] }>(`/occasions?familyId=${familyId}`),
    enabled: Boolean(familyId),
  });

  const sorted = useMemo(() => {
    return (data?.occasions ?? [])
      .map((o) => {
        const next = nextOccurrence(o.date, o.recurring);
        return { ...o, next, days: daysUntil(next) };
      })
      .filter((o) => o.days >= 0 || o.recurring)
      .sort((a, b) => a.days - b.days);
  }, [data]);

  return (
    <>
      <AppBar title="Occasions" />
      <Page className="space-y-4">
        <p className="text-sm text-fg-muted">
          Birthdays, anniversaries and special dates — we'll remind you (and
          anyone you tag) before they arrive.
        </p>

        {isLoading ? (
          <Card className="divide-y divide-line" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-10 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            ))}
          </Card>
        ) : sorted.length > 0 ? (
          <Card className="divide-y divide-line overflow-hidden">
            {sorted.map((o) => {
              const meta = occasionTypeMeta(o.type);
              const Icon = meta.icon;
              const soon = o.days <= 7;
              return (
                <ListItem
                  key={o.id}
                  to={`/occasions/${o.id}/edit`}
                  leading={
                    <span className="flex size-10 items-center justify-center rounded-xl bg-vault-500/10 text-vault-300">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                  }
                  title={o.title}
                  subtitle={`${meta.label} · ${shortDate(o.next)}`}
                  trailing={
                    <Badge tone={soon ? "warning" : "neutral"}>
                      {countdownLabel(o.days)}
                    </Badge>
                  }
                />
              );
            })}
          </Card>
        ) : (
          <EmptyState
            icon={CalendarHeart}
            title="No occasions yet"
            description="Add birthdays and anniversaries so nobody in the family ever forgets."
            action={
              <Button
                leadingIcon={<Plus className="size-4" />}
                onClick={() => navigate("/occasions/new")}
              >
                Add occasion
              </Button>
            }
          />
        )}
      </Page>
      <Fab icon={Plus} label="Add occasion" onClick={() => navigate("/occasions/new")} />
    </>
  );
}
