import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

/** Shapes returned by the expense config endpoints. */

export interface ExpenseCategory {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  emoji: string | null;
  color: string | null;
  sortOrder: number;
  isSystem: boolean;
  status: "active" | "archived";
  children: ExpenseCategory[];
}

export interface PaymentMethod {
  id: string;
  name: string;
  slug: string;
  kind: PaymentKind;
  emoji: string | null;
  sortOrder: number;
  isSystem: boolean;
  status: "active" | "archived";
}

export type PaymentKind = "cash" | "card" | "bank" | "upi" | "wallet" | "other";

export const PAYMENT_KINDS: { value: PaymentKind; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank" },
  { value: "upi", label: "UPI" },
  { value: "wallet", label: "Wallet" },
  { value: "other", label: "Other" },
];

export interface ExpenseSettings {
  familyId: string;
  defaultCurrency: string;
  weekStartsOn: number;
  monthStartDay: number;
}

export interface ExpenseSettingsResponse {
  settings: ExpenseSettings;
  initialized: boolean;
  canEdit: boolean;
}

/**
 * Category colours are stored as palette SLUGS, never raw hex, so a re-theme
 * never needs a data migration. The classes are spelled out in full because
 * Tailwind only generates what it can see literally in the source.
 */
export const CATEGORY_COLOR_CLASSES: Record<string, { bg: string; text: string }> = {
  amber: { bg: "bg-amber-500/15", text: "text-amber-300" },
  orange: { bg: "bg-orange-500/15", text: "text-orange-300" },
  rose: { bg: "bg-rose-500/15", text: "text-rose-300" },
  pink: { bg: "bg-pink-500/15", text: "text-pink-300" },
  violet: { bg: "bg-violet-500/15", text: "text-violet-300" },
  indigo: { bg: "bg-indigo-500/15", text: "text-indigo-300" },
  blue: { bg: "bg-blue-500/15", text: "text-blue-300" },
  sky: { bg: "bg-sky-500/15", text: "text-sky-300" },
  cyan: { bg: "bg-cyan-500/15", text: "text-cyan-300" },
  teal: { bg: "bg-teal-500/15", text: "text-teal-300" },
  emerald: { bg: "bg-emerald-500/15", text: "text-emerald-300" },
  lime: { bg: "bg-lime-500/15", text: "text-lime-300" },
  slate: { bg: "bg-slate-500/15", text: "text-slate-300" },
};

export const CATEGORY_COLORS = Object.keys(CATEGORY_COLOR_CLASSES);

const FALLBACK_COLOR = { bg: "bg-white/5", text: "text-fg-muted" };

export function categoryColorClasses(color: string | null | undefined) {
  if (!color) return FALLBACK_COLOR;
  return CATEGORY_COLOR_CLASSES[color] ?? FALLBACK_COLOR;
}

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** 1 → "1st", 2 → "2nd", 22 → "22nd" */
export function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * Installs the family's default categories, payment methods and settings the
 * first time someone opens the expense module.
 *
 * The endpoint is idempotent, so this is safe to fire on mount; the ref just
 * keeps a re-render from queueing a second identical request. Bootstrapping is
 * a POST — a GET is never allowed to create data — but the user shouldn't have
 * to press a "set up" button to get defaults everyone wants anyway.
 */
export function useEnsureExpenseSetup(
  familyId: string | undefined,
  needsSetup: boolean,
) {
  const qc = useQueryClient();
  const attempted = useRef<string | null>(null);

  const bootstrap = useMutation({
    mutationFn: (id: string) =>
      api<{ setup: unknown }>("/expense-settings/bootstrap", {
        method: "POST",
        body: JSON.stringify({ familyId: id }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["expense-categories"] });
      void qc.invalidateQueries({ queryKey: ["expense-payment-methods"] });
      void qc.invalidateQueries({ queryKey: ["expense-settings"] });
    },
  });

  const run = bootstrap.mutate;

  useEffect(() => {
    if (!familyId || !needsSetup) return;
    if (attempted.current === familyId) return;
    attempted.current = familyId;
    run(familyId);
  }, [familyId, needsSetup, run]);

  return { isSettingUp: bootstrap.isPending };
}
