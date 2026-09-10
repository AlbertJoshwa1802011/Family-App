/** Shared types + helpers for the Money screens. */

export type CommitmentKind =
  | "emi"
  | "loan"
  | "insurance"
  | "investment"
  | "subscription"
  | "giving"
  | "rent"
  | "utility"
  | "other";

export const COMMITMENT_KINDS: { value: CommitmentKind; label: string; hint: string }[] = [
  { value: "emi", label: "EMI", hint: "Loan instalments with a fixed term" },
  { value: "loan", label: "Loan", hint: "Other borrowing repayments" },
  { value: "insurance", label: "Insurance", hint: "Life, health, vehicle premiums" },
  { value: "investment", label: "Investment", hint: "SIP, recurring deposit, pension" },
  { value: "subscription", label: "Subscription", hint: "Streaming, software, memberships" },
  { value: "giving", label: "Giving", hint: "Tithe, offerings, sponsorship" },
  { value: "rent", label: "Rent", hint: "Rent or maintenance" },
  { value: "utility", label: "Utility", hint: "Recurring bills" },
  { value: "other", label: "Other", hint: "Anything else that repeats" },
];

export const KIND_LABEL: Record<CommitmentKind, string> = Object.fromEntries(
  COMMITMENT_KINDS.map((k) => [k.value, k.label]),
) as Record<CommitmentKind, string>;

export type Cadence = "weekly" | "monthly" | "quarterly" | "yearly";

export const CADENCES: { value: Cadence; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

export interface Commitment {
  id: string;
  kind: CommitmentKind;
  name: string;
  notes: string | null;
  amountKind: "fixed" | "percent_of_income";
  amountMinor: number | null;
  percentBp: number | null;
  currency: string;
  cadence: Cadence;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  startDate: string;
  endDate: string | null;
  totalInstallments: number | null;
  categoryId: string | null;
  autoLog: boolean;
  remindDaysBefore: number;
  status: "active" | "paused" | "completed";
  visibility: "family" | "private";
}

export interface Income {
  id: string;
  label: string;
  amountMinor: number;
  currency: string;
  cadence: "monthly" | "weekly" | "biweekly" | "yearly" | "one_off";
  startDate: string;
  endDate: string | null;
  active: boolean;
  visibility: "family" | "private";
}

export interface Plan {
  cycle: { from: string; to: string; key: string };
  incomeMinor: number;
  committedMinor: number;
  givingMinor: number;
  savingsTargetMinor: number;
  spendableMinor: number;
  spentMinor: number;
  remainingMinor: number;
  projectedSavingsMinor: number;
  dailyAllowanceMinor: number | null;
  daysLeft: number;
  dueCommitments: {
    id: string;
    name: string;
    kind: CommitmentKind;
    amountMinor: number;
    dueDates: string[];
    remaining: number | null;
    totalInstallments: number | null;
  }[];
  committedByKind: { kind: CommitmentKind; totalMinor: number }[];
  weeks: { index: number; from: string; to: string; spentMinor: number }[];
  byCategory: { categoryId: string | null; totalMinor: number; count: number }[];
  status: "on_track" | "tight" | "over" | "unplanned";
}

export interface Overview {
  currency: string;
  settings: {
    savingsTargetKind: "none" | "amount" | "percent";
    savingsTargetMinor: number | null;
    savingsTargetPercentBp: number | null;
    paydayDayOfMonth: number;
  };
  plan: Plan;
  trend: {
    key: string;
    from: string;
    to: string;
    incomeMinor: number;
    committedMinor: number;
    spentMinor: number;
    savedMinor: number;
  }[];
  insights: {
    averageSpendMinor: number | null;
    vsAverageMinor: number | null;
    savingsRateBp: number | null;
  };
}

/** Human label for a plan status, plus the tone the UI should use. */
export function statusMeta(status: Plan["status"]): {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
} {
  switch (status) {
    case "on_track":
      return { label: "On track", tone: "success" };
    case "tight":
      return { label: "Getting tight", tone: "warning" };
    case "over":
      return { label: "Over budget", tone: "danger" };
    default:
      return { label: "Add your income to plan", tone: "neutral" };
  }
}

export function formatMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "short" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

export function formatDayMonth(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}
