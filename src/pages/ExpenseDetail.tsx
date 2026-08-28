import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Pencil, Trash2, Users } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Page } from "../components/ui/Page";
import { Skeleton } from "../components/ui/Skeleton";
import { useAuth } from "../context/AuthContext";
import { api, ApiError } from "../lib/api";
import { formatMoney } from "../lib/money";
import type { ExpenseSummary } from "./Expenses";

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="text-right text-sm font-medium text-fg">{value}</dd>
    </div>
  );
}

export function ExpenseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeFamily, user } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["expense", id],
    queryFn: () => api<{ expense: ExpenseSummary & { createdByUserId: string } }>(`/expenses/${id}`),
    enabled: Boolean(id),
  });

  const trash = useMutation({
    mutationFn: () => api(`/expenses/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["expenses"] });
      navigate("/expenses", { replace: true });
    },
  });

  if (isLoading) {
    return (
      <>
        <AppBar title="Expense" back />
        <Page className="space-y-4">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-4 w-24" />
          <Card className="space-y-3 p-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </Card>
        </Page>
      </>
    );
  }

  if (error || !data?.expense) {
    const msg =
      error instanceof ApiError ? error.message : "That expense could not be found.";
    return (
      <>
        <AppBar title="Expense" back />
        <Page>
          <EmptyState
            icon={Lock}
            title="Expense unavailable"
            description={msg}
            action={
              <Button variant="secondary" onClick={() => navigate("/expenses")}>
                Back to expenses
              </Button>
            }
          />
        </Page>
      </>
    );
  }

  const e = data.expense;
  const canMutate =
    e.createdByUserId === user?.id ||
    activeFamily?.role === "owner" ||
    activeFamily?.role === "admin";

  return (
    <>
      <AppBar title="Expense" back />
      <Page className="space-y-5">
        <div>
          <div className="text-3xl font-bold tabular-nums text-fg">
            {formatMoney(e.amountMinor, e.currency)}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{e.category?.name ?? "Uncategorized"}</Badge>
            <Badge tone={e.scope === "personal" ? "info" : "warning"}>
              {e.scope === "personal" ? "Personal" : "Shared"}
            </Badge>
            {e.visibility === "private" ? (
              <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                <Lock className="size-3.5" /> Private
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                <Users className="size-3.5" /> Family
              </span>
            )}
          </div>
        </div>

        <Card className="divide-y divide-line px-4">
          <dl>
            <DetailRow label="Date" value={e.expenseDate} />
            <DetailRow label="Merchant" value={e.merchant} />
            <DetailRow label="Notes" value={e.description} />
            <DetailRow
              label="Visibility"
              value={e.visibility === "private" ? "Private" : "Family"}
            />
          </dl>
        </Card>

        {canMutate && (
          <div className="space-y-3">
            <Button
              variant="secondary"
              fullWidth
              leadingIcon={<Pencil className="size-4" />}
              onClick={() => navigate(`/expenses/${e.id}/edit`)}
            >
              Edit expense
            </Button>
            <Button
              variant="danger"
              fullWidth
              loading={trash.isPending}
              leadingIcon={<Trash2 className="size-4" />}
              onClick={() => {
                if (confirm("Delete this expense? It will be moved to trash.")) {
                  trash.mutate();
                }
              }}
            >
              Delete expense
            </Button>
          </div>
        )}
      </Page>
    </>
  );
}
