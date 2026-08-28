import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Page } from "../components/ui/Page";
import { Skeleton } from "../components/ui/Skeleton";
import { useAuth } from "../context/AuthContext";
import { api, ApiError } from "../lib/api";
import {
  formatMajorFromMinor,
  formatMoney,
  parseMajorToMinor,
  todayIsoDate,
} from "../lib/money";

interface ExpenseCategory {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  builtin: boolean;
}

interface ExpenseDetailPayload {
  id: string;
  amountMinor: number;
  currency: string;
  expenseDate: string;
  merchant: string | null;
  description: string | null;
  paymentMethod: string | null;
  visibility: "private" | "family";
  categoryId: string | null;
  paidByMemberId: string;
  createdByUserId: string;
}

/**
 * Fast personal-expense entry (create + edit).
 *
 * Primary path: amount → category → Save.
 * Progressive disclosure for merchant, notes, visibility, payment method.
 * clientRequestId is minted once per mount so create retries stay idempotent.
 */
export function ExpenseForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeFamily, user } = useAuth();
  const amountId = useId();
  const currency = activeFamily?.defaultCurrency ?? "USD";

  const [amountText, setAmountText] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [expenseDate, setExpenseDate] = useState(() => todayIsoDate());
  const [merchant, setMerchant] = useState("");
  const [description, setDescription] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [visibility, setVisibility] = useState<"private" | "family">("private");
  const [moreOpen, setMoreOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!isEdit);
  const [existingMeta, setExistingMeta] = useState<{
    createdByUserId: string;
    paidByMemberId: string;
  } | null>(null);
  const [clientRequestId] = useState(() => crypto.randomUUID());

  const { data: catData } = useQuery({
    queryKey: ["expense-categories", activeFamily?.id],
    queryFn: () =>
      api<{ categories: ExpenseCategory[] }>(
        `/expenses/categories?familyId=${activeFamily!.id}`,
      ),
    enabled: Boolean(activeFamily),
  });
  const categories = catData?.categories ?? [];

  const { isLoading: loadingExisting } = useQuery({
    queryKey: ["expense", id],
    queryFn: async () => {
      const res = await api<{ expense: ExpenseDetailPayload }>(`/expenses/${id}`);
      if (!loaded) {
        const e = res.expense;
        setAmountText(formatMajorFromMinor(e.amountMinor, e.currency));
        setCategoryId(e.categoryId);
        setExpenseDate(e.expenseDate);
        setMerchant(e.merchant ?? "");
        setDescription(e.description ?? "");
        setPaymentMethod(e.paymentMethod ?? "");
        setVisibility(e.visibility);
        setExistingMeta({
          createdByUserId: e.createdByUserId,
          paidByMemberId: e.paidByMemberId,
        });
        setMoreOpen(
          Boolean(
            e.merchant ||
              e.description ||
              e.paymentMethod ||
              e.visibility === "family",
          ),
        );
        setLoaded(true);
      }
      return res;
    },
    enabled: isEdit && Boolean(id),
  });

  const amountMinor = parseMajorToMinor(amountText, currency);
  const canSave =
    Boolean(activeFamily?.memberId) &&
    amountMinor !== null &&
    amountMinor > 0 &&
    Boolean(categoryId) &&
    loaded;

  const canEditExisting =
    !isEdit ||
    existingMeta?.createdByUserId === user?.id ||
    activeFamily?.role === "owner" ||
    activeFamily?.role === "admin";

  const save = useMutation({
    mutationFn: async () => {
      if (!activeFamily || amountMinor === null || !categoryId) {
        throw new Error("Missing required fields");
      }
      if (isEdit) {
        return api<{ expense: { id: string } }>(`/expenses/${id}`, {
          method: "PATCH",
          body: JSON.stringify({
            paidByMemberId: existingMeta?.paidByMemberId ?? activeFamily.memberId,
            categoryId,
            amountMinor,
            currency,
            expenseDate,
            merchant: merchant.trim() || null,
            description: description.trim() || null,
            paymentMethod: paymentMethod.trim() || null,
            visibility,
            splitType: "none",
          }),
        });
      }
      return api<{ expense: { id: string } }>("/expenses", {
        method: "POST",
        body: JSON.stringify({
          familyId: activeFamily.id,
          paidByMemberId: activeFamily.memberId,
          categoryId,
          amountMinor,
          currency,
          expenseDate,
          merchant: merchant.trim() || null,
          description: description.trim() || null,
          paymentMethod: paymentMethod.trim() || null,
          visibility,
          splitType: "none",
          clientRequestId,
        }),
      });
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["expenses"] });
      await qc.invalidateQueries({ queryKey: ["expense", res.expense.id] });
      navigate(`/expenses/${res.expense.id}`, { replace: true });
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : "Could not save that expense.",
      );
    },
  });

  if (isEdit && loadingExisting && !loaded) {
    return (
      <>
        <AppBar title="Edit expense" back />
        <Page className="space-y-4">
          <Skeleton className="h-14 w-48" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </Page>
      </>
    );
  }

  if (isEdit && !canEditExisting) {
    return (
      <>
        <AppBar title="Edit expense" back />
        <Page>
          <p className="text-sm text-fg-muted">
            You do not have permission to edit this expense.
          </p>
        </Page>
      </>
    );
  }

  return (
    <>
      <AppBar title={isEdit ? "Edit expense" : "New expense"} back />
      <Page className="space-y-5">
        <div>
          <label htmlFor={amountId} className="sr-only">
            Amount
          </label>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-medium text-fg-muted">{currency}</span>
            <input
              id={amountId}
              inputMode="decimal"
              autoFocus={!isEdit}
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="0"
              aria-invalid={amountText !== "" && amountMinor === null}
              className="w-full bg-transparent text-5xl font-bold tabular-nums text-fg placeholder:text-fg-subtle focus:outline-none"
            />
          </div>
          {amountMinor !== null && amountMinor > 0 && (
            <p className="mt-1 text-sm text-fg-muted">
              {formatMoney(amountMinor, currency)}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Category
          </div>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => {
              const selected = categoryId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryId(c.id)}
                  className={`rounded-full border px-3 py-2 text-sm font-medium transition-colors ${
                    selected
                      ? "border-vault-500 bg-vault-500/15 text-vault-200"
                      : "border-line text-fg-muted hover:border-line-strong"
                  }`}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="expense-date"
            className="text-xs font-semibold tracking-wide text-fg-muted uppercase"
          >
            Date
          </label>
          <input
            id="expense-date"
            type="date"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-3 py-3 text-sm text-fg focus:border-vault-500 focus:outline-none"
          />
        </div>

        <Card className="overflow-hidden">
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-fg"
            aria-expanded={moreOpen}
          >
            More details
            {moreOpen ? (
              <ChevronUp className="size-4 text-fg-subtle" />
            ) : (
              <ChevronDown className="size-4 text-fg-subtle" />
            )}
          </button>
          {moreOpen && (
            <div className="space-y-3 border-t border-line px-4 py-3">
              <div className="space-y-1">
                <label htmlFor="merchant" className="text-xs text-fg-muted">
                  Merchant
                </label>
                <input
                  id="merchant"
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                  placeholder="e.g. Corner store"
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="notes" className="text-xs text-fg-muted">
                  Notes
                </label>
                <textarea
                  id="notes"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Optional"
                  className="w-full resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="payment" className="text-xs text-fg-muted">
                  Payment method
                </label>
                <input
                  id="payment"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  placeholder="Cash, UPI, card…"
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
                />
              </div>
              <fieldset className="space-y-2">
                <legend className="text-xs text-fg-muted">Visibility</legend>
                <label className="flex items-center gap-2 text-sm text-fg">
                  <input
                    type="radio"
                    name="visibility"
                    checked={visibility === "private"}
                    onChange={() => setVisibility("private")}
                  />
                  Private (only you + admins)
                </label>
                <label className="flex items-center gap-2 text-sm text-fg">
                  <input
                    type="radio"
                    name="visibility"
                    checked={visibility === "family"}
                    onChange={() => setVisibility("family")}
                  />
                  Family (everyone can see)
                </label>
              </fieldset>
            </div>
          )}
        </Card>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        <Button
          fullWidth
          size="lg"
          loading={save.isPending}
          disabled={!canSave || save.isPending}
          onClick={() => {
            setError(null);
            save.mutate();
          }}
        >
          {isEdit ? "Save changes" : "Save expense"}
        </Button>
      </Page>
    </>
  );
}
