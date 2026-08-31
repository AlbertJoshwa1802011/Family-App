import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Lock, Pencil, Trash2, Users, Wallet } from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { useAuth } from "../context/AuthContext";
import { api, ApiError } from "../lib/api";
import { formatMoney } from "../lib/money";

interface ExpenseDetailResponse {
  expense: {
    id: string;
    amountMinor: number;
    currency: string;
    expenseDate: string;
    merchant: string | null;
    description: string | null;
    paymentMethod: string | null;
    visibility: "family" | "private";
    createdByUserId: string;
    createdAt: number;
    category: { id: string; name: string; color: string | null } | null;
  };
}

function fullDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function ExpenseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["expenses", "detail", id],
    queryFn: () => api<ExpenseDetailResponse>(`/expenses/${id}`),
    retry: false,
  });

  const remove = useMutation({
    mutationFn: () => api(`/expenses/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["expenses"] });
      navigate("/money/expenses", { replace: true });
    },
  });

  if (isLoading) {
    return (
      <>
        <AppBar title="Expense" back />
        <Page>
          <Card className="space-y-3 p-5">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </Card>
        </Page>
      </>
    );
  }

  if (error || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <>
        <AppBar title="Expense" back />
        <Page>
          <EmptyState
            icon={Wallet}
            title={notFound ? "Expense not found" : "Couldn't load this expense"}
            description={
              notFound
                ? "It may have been deleted, or it's private to someone else."
                : "Please try again."
            }
          />
        </Page>
      </>
    );
  }

  const e = data.expense;
  const isMine = e.createdByUserId === user?.id;

  return (
    <>
      <AppBar title="Expense" back />
      <Page className="space-y-4">
        <Card className="p-5">
          <p className="text-3xl font-bold tabular-nums text-fg">
            {formatMoney(e.amountMinor, e.currency)}
          </p>
          <p className="mt-1 text-sm text-fg-muted">
            {e.merchant || e.description || "Expense"}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {e.category && (
              <span className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-fg-muted">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: e.category.color ?? "var(--color-fg-subtle)" }}
                />
                {e.category.name}
              </span>
            )}
            {e.visibility === "private" ? (
              <Badge tone="neutral">
                <Lock className="mr-1 inline size-3" aria-hidden="true" />
                Private to you
              </Badge>
            ) : (
              <Badge tone="vault">
                <Users className="mr-1 inline size-3" aria-hidden="true" />
                Shared with family
              </Badge>
            )}
          </div>
        </Card>

        <Card className="divide-y divide-line overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <CalendarDays className="size-5 shrink-0 text-fg-subtle" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs text-fg-subtle">Date</p>
              <p className="text-sm text-fg">{fullDate(e.expenseDate)}</p>
            </div>
          </div>
          {e.description && e.merchant && (
            <div className="px-4 py-3">
              <p className="text-xs text-fg-subtle">Note</p>
              <p className="mt-0.5 text-sm whitespace-pre-wrap text-fg">{e.description}</p>
            </div>
          )}
          {e.paymentMethod && (
            <div className="px-4 py-3">
              <p className="text-xs text-fg-subtle">Paid with</p>
              <p className="mt-0.5 text-sm text-fg">{e.paymentMethod}</p>
            </div>
          )}
        </Card>

        {isMine ? (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              fullWidth
              leadingIcon={<Pencil className="size-4" />}
              onClick={() => navigate(`/money/expenses/${e.id}/edit`)}
            >
              Edit
            </Button>
            <Button
              variant="danger"
              fullWidth
              leadingIcon={<Trash2 className="size-4" />}
              onClick={() => setConfirmOpen(true)}
            >
              Delete
            </Button>
          </div>
        ) : (
          <p className="px-1 text-xs text-fg-subtle">
            Shared with you by another family member — only they can edit it.
          </p>
        )}
      </Page>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Delete this expense?"
        footer={
          <>
            <Button variant="secondary" fullWidth onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              fullWidth
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">
          {formatMoney(e.amountMinor, e.currency)}
          {e.merchant ? ` at ${e.merchant}` : ""} will be removed from your expenses.
        </p>
      </Modal>
    </>
  );
}
