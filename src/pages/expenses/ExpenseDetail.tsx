import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Calendar,
  Clock,
  CreditCard,
  Lock,
  Pencil,
  RotateCcw,
  StickyNote,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { AppBar } from "../../components/ui/AppBar";
import { Page } from "../../components/ui/Page";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { ListItem } from "../../components/ui/ListItem";
import { Skeleton } from "../../components/ui/Skeleton";
import { EmptyState } from "../../components/ui/EmptyState";
import { AddExpenseSheet } from "../../components/expenses/AddExpenseSheet";
import { ApiError } from "../../lib/api";
import { cn } from "../../lib/cn";
import { useAuth } from "../../context/AuthContext";
import {
  categoryColorClasses,
  relativeDayLabel,
  useDeleteExpense,
  useExpense,
  useRestoreExpense,
} from "../../lib/expenses";
import { formatMoney } from "../../../shared/money";

function payerLabel(expense: {
  payerMemberId: string | null;
  payerMemberType: "user" | "dependent" | null;
  payerDisplayName: string | null;
  payerName: string | null;
}): string | null {
  if (!expense.payerMemberId) return null;
  return (expense.payerMemberType === "dependent" ? expense.payerDisplayName : expense.payerName) ?? null;
}

export function ExpenseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeFamily } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, isError } = useExpense(id);
  const del = useDeleteExpense(activeFamily?.id);
  const restore = useRestoreExpense(activeFamily?.id);

  if (isLoading) {
    return (
      <>
        <AppBar title="Expense" back />
        <Page className="space-y-4">
          <Card className="space-y-3 p-6" aria-busy="true">
            <Skeleton className="mx-auto h-10 w-32" />
            <Skeleton className="mx-auto h-4 w-24" />
          </Card>
          <Card className="divide-y divide-line">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex min-h-14 items-center gap-3 px-4 py-3">
                <Skeleton className="size-9 rounded-xl" />
                <Skeleton className="h-3.5 w-1/2" />
              </div>
            ))}
          </Card>
        </Page>
      </>
    );
  }

  if (isError || !data?.expense) {
    return (
      <>
        <AppBar title="Expense" back />
        <Page>
          <EmptyState
            icon={StickyNote}
            title="Expense not found"
            description="It may have been deleted, or you don't have access to it."
          />
        </Page>
      </>
    );
  }

  const expense = data.expense;
  const colors = categoryColorClasses(expense.categoryColor);
  const payer = payerLabel(expense);

  if (deleted) {
    return (
      <>
        <AppBar title="Expense" back />
        <Page>
          <EmptyState
            icon={Trash2}
            title="Expense deleted"
            description={`${formatMoney(expense.amountMinor, expense.currency)} to ${
              expense.categoryName ?? "an expense"
            } was removed.`}
            action={
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  leadingIcon={<RotateCcw className="size-4" />}
                  loading={restore.isPending}
                  onClick={async () => {
                    try {
                      await restore.mutateAsync(expense.id);
                      setDeleted(false);
                    } catch (e) {
                      setActionError((e as ApiError).message);
                    }
                  }}
                >
                  Undo
                </Button>
                <Button onClick={() => navigate("/expenses")}>Back to expenses</Button>
              </div>
            }
          />
          {actionError && (
            <p role="alert" className="mt-3 text-center text-xs text-danger">
              {actionError}
            </p>
          )}
        </Page>
      </>
    );
  }

  return (
    <>
      <AppBar title="Expense" back />
      <Page className="space-y-4">
        {actionError && (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {actionError}
          </p>
        )}

        <Card className="flex flex-col items-center gap-2 p-6 text-center">
          <span aria-hidden="true" className={cn("flex size-14 items-center justify-center rounded-2xl text-2xl", colors.bg)}>
            {expense.subcategoryEmoji ?? expense.categoryEmoji ?? "📌"}
          </span>
          <div className="text-3xl font-bold tabular-nums text-white">
            {formatMoney(expense.amountMinor, expense.currency)}
          </div>
          {/* Only worth a line when it adds information beyond the category
              badge below — no merchant means there's nothing else to say. */}
          {expense.merchant && <div className="text-sm text-fg-muted">{expense.merchant}</div>}
          <div className="flex items-center gap-1.5">
            <Badge tone="vault">
              {expense.categoryEmoji} {expense.categoryName}
            </Badge>
            {expense.subcategoryName && (
              <Badge tone="neutral">
                {expense.subcategoryEmoji} {expense.subcategoryName}
              </Badge>
            )}
            {expense.visibility === "private" && (
              <Badge tone="warning">
                <Lock className="size-3" aria-hidden="true" /> Private
              </Badge>
            )}
          </div>
        </Card>

        <Card className="divide-y divide-line overflow-hidden">
          <ListItem
            leading={<Calendar className="size-5 text-fg-muted" aria-hidden="true" />}
            title={relativeDayLabel(expense.spentOn)}
            subtitle={expense.spentTime ?? undefined}
            showChevron={false}
          />
          {expense.paymentMethodName && (
            <ListItem
              leading={<CreditCard className="size-5 text-fg-muted" aria-hidden="true" />}
              title={expense.paymentMethodName}
              subtitle="Payment method"
              showChevron={false}
            />
          )}
          {payer && (
            <ListItem
              leading={<User className="size-5 text-fg-muted" aria-hidden="true" />}
              title={payer}
              subtitle="Paid by"
              showChevron={false}
            />
          )}
          {expense.notes && (
            <ListItem
              leading={<StickyNote className="size-5 text-fg-muted" aria-hidden="true" />}
              title={expense.notes}
              subtitle="Notes"
              showChevron={false}
            />
          )}
          <ListItem
            leading={<Clock className="size-5 text-fg-muted" aria-hidden="true" />}
            title={new Date(expense.createdAt * 1000).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            subtitle={`Added by ${expense.creatorName ?? "a family member"}`}
            showChevron={false}
          />
          {expense.visibility === "family" && (
            <ListItem
              leading={<Users className="size-5 text-fg-muted" aria-hidden="true" />}
              title="Visible to the whole family"
              showChevron={false}
            />
          )}
        </Card>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            fullWidth
            leadingIcon={<Pencil className="size-4" />}
            onClick={() => setEditOpen(true)}
          >
            Edit
          </Button>
          <Button
            variant="danger"
            fullWidth
            leadingIcon={<Trash2 className="size-4" />}
            loading={del.isPending}
            onClick={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              setActionError(null);
              try {
                await del.mutateAsync(expense.id);
                setDeleted(true);
              } catch (e) {
                setActionError((e as ApiError).message);
              }
            }}
          >
            {confirmDelete ? "Tap again to delete" : "Delete"}
          </Button>
        </div>
      </Page>

      {editOpen && activeFamily && (
        <AddExpenseSheet familyId={activeFamily.id} expense={expense} onClose={() => setEditOpen(false)} />
      )}
    </>
  );
}
