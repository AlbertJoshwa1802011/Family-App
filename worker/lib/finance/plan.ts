/**
 * The money plan: turns income, commitments and actual spending into the
 * numbers the overview screen shows.
 *
 * Pure and DB-free so the arithmetic can be tested exhaustively — the routes
 * fetch rows, this decides what they mean.
 *
 * The central identity:
 *
 *     spendable = income − committed − savingsTarget
 *     remaining = spendable − discretionary spend
 *
 * "Committed" is money already promised (EMIs, insurance, SIPs, tithe). It is
 * deliberately excluded from discretionary spend so that auto-logged commitment
 * expenses are never counted twice.
 */

import {
  type Cadence,
  type Cycle,
  type IncomeCadence,
  daysBetween,
  dueDatesBetween,
  incomeMonthlyEquivalent,
  remainingInstallments,
  toUtc,
  weeksIn,
} from "./periods";

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

export interface IncomeInput {
  id: string;
  label: string;
  amountMinor: number;
  cadence: IncomeCadence;
  startDate: string;
  endDate?: string | null;
  active: boolean;
}

export interface CommitmentInput {
  id: string;
  name: string;
  kind: CommitmentKind;
  amountKind: "fixed" | "percent_of_income";
  amountMinor?: number | null;
  percentBp?: number | null;
  cadence: Cadence;
  dayOfMonth?: number | null;
  dayOfWeek?: number | null;
  startDate: string;
  endDate?: string | null;
  totalInstallments?: number | null;
  status: "active" | "paused" | "completed";
  categoryId?: string | null;
}

export interface ExpenseInput {
  id: string;
  amountMinor: number;
  expenseDate: string;
  categoryId: string | null;
}

export interface SettingsInput {
  savingsTargetKind: "none" | "amount" | "percent";
  savingsTargetMinor?: number | null;
  savingsTargetPercentBp?: number | null;
}

export interface DueCommitment {
  id: string;
  name: string;
  kind: CommitmentKind;
  amountMinor: number;
  dueDates: string[];
  /** Null for open-ended commitments; otherwise installments left after the cycle. */
  remaining: number | null;
  totalInstallments: number | null;
}

export interface WeekSpend {
  index: number;
  from: string;
  to: string;
  spentMinor: number;
}

export type PlanStatus = "on_track" | "tight" | "over" | "unplanned";

export interface Plan {
  cycle: Cycle;
  incomeMinor: number;
  committedMinor: number;
  givingMinor: number;
  savingsTargetMinor: number;
  spendableMinor: number;
  spentMinor: number;
  remainingMinor: number;
  /** What you'd actually save if spending stopped here: income − committed − spent. */
  projectedSavingsMinor: number;
  /** Remaining spread over the days left in the cycle; null once the cycle is over. */
  dailyAllowanceMinor: number | null;
  daysLeft: number;
  dueCommitments: DueCommitment[];
  committedByKind: { kind: CommitmentKind; totalMinor: number }[];
  weeks: WeekSpend[];
  byCategory: { categoryId: string | null; totalMinor: number; count: number }[];
  status: PlanStatus;
}

function isActiveInCycle(
  startDate: string,
  endDate: string | null | undefined,
  cycle: Cycle,
): boolean {
  if (toUtc(startDate) > toUtc(cycle.to)) return false;
  if (endDate && toUtc(endDate) < toUtc(cycle.from)) return false;
  return true;
}

/** Recurring income normalised to one cycle, plus any one-off landing inside it. */
export function incomeForCycle(incomes: IncomeInput[], cycle: Cycle): number {
  let total = 0;
  for (const inc of incomes) {
    if (!inc.active) continue;
    if (!isActiveInCycle(inc.startDate, inc.endDate, cycle)) continue;

    if (inc.cadence === "one_off") {
      // A one-off counts only in the cycle it actually lands in.
      if (
        toUtc(inc.startDate) >= toUtc(cycle.from) &&
        toUtc(inc.startDate) <= toUtc(cycle.to)
      ) {
        total += inc.amountMinor;
      }
      continue;
    }
    total += incomeMonthlyEquivalent(inc.amountMinor, inc.cadence);
  }
  return total;
}

/**
 * Commitments falling due inside the cycle.
 *
 * `percent_of_income` amounts (tithe, sponsorship) resolve against the cycle's
 * income, so giving scales with what was actually earned.
 */
export function commitmentsForCycle(
  commitments: CommitmentInput[],
  cycle: Cycle,
  incomeMinor: number,
): DueCommitment[] {
  const out: DueCommitment[] = [];

  for (const c of commitments) {
    if (c.status !== "active") continue;
    if (!isActiveInCycle(c.startDate, c.endDate, cycle)) continue;

    const spec = {
      cadence: c.cadence,
      startDate: c.startDate,
      endDate: c.endDate,
      dayOfMonth: c.dayOfMonth,
      dayOfWeek: c.dayOfWeek,
      totalInstallments: c.totalInstallments,
    };
    const dueDates = dueDatesBetween(spec, cycle.from, cycle.to);
    if (dueDates.length === 0) continue;

    const perOccurrence =
      c.amountKind === "percent_of_income"
        ? Math.round((incomeMinor * (c.percentBp ?? 0)) / 10000)
        : (c.amountMinor ?? 0);

    out.push({
      id: c.id,
      name: c.name,
      kind: c.kind,
      amountMinor: perOccurrence * dueDates.length,
      dueDates,
      remaining: remainingInstallments(spec, cycle.to),
      totalInstallments: c.totalInstallments ?? null,
    });
  }

  return out;
}

/**
 * Build the full plan for one cycle.
 *
 * `committedExpenseIds` are expenses the cron auto-logged for a commitment.
 * They are already represented in `committedMinor`, so they are filtered out of
 * discretionary spend — otherwise every auto-logged EMI would be double counted.
 */
export function buildPlan(args: {
  cycle: Cycle;
  today: string;
  incomes: IncomeInput[];
  commitments: CommitmentInput[];
  expenses: ExpenseInput[];
  committedExpenseIds?: Set<string>;
  settings: SettingsInput;
}): Plan {
  const { cycle, today, incomes, commitments, expenses, settings } = args;
  const committedIds = args.committedExpenseIds ?? new Set<string>();

  const incomeMinor = incomeForCycle(incomes, cycle);
  const dueCommitments = commitmentsForCycle(commitments, cycle, incomeMinor);
  const committedMinor = dueCommitments.reduce((s, c) => s + c.amountMinor, 0);
  const givingMinor = dueCommitments
    .filter((c) => c.kind === "giving")
    .reduce((s, c) => s + c.amountMinor, 0);

  const savingsTargetMinor =
    settings.savingsTargetKind === "amount"
      ? (settings.savingsTargetMinor ?? 0)
      : settings.savingsTargetKind === "percent"
        ? Math.round((incomeMinor * (settings.savingsTargetPercentBp ?? 0)) / 10000)
        : 0;

  // Discretionary spend: inside the cycle, excluding commitment auto-logs.
  const inCycle = expenses.filter(
    (e) =>
      !committedIds.has(e.id) &&
      toUtc(e.expenseDate) >= toUtc(cycle.from) &&
      toUtc(e.expenseDate) <= toUtc(cycle.to),
  );
  const spentMinor = inCycle.reduce((s, e) => s + e.amountMinor, 0);

  const spendableMinor = incomeMinor - committedMinor - savingsTargetMinor;
  const remainingMinor = spendableMinor - spentMinor;
  const projectedSavingsMinor = incomeMinor - committedMinor - spentMinor;

  // Days left counts today as still spendable.
  const clampedToday =
    toUtc(today) < toUtc(cycle.from)
      ? cycle.from
      : toUtc(today) > toUtc(cycle.to)
        ? cycle.to
        : today;
  const daysLeft =
    toUtc(today) > toUtc(cycle.to) ? 0 : daysBetween(clampedToday, cycle.to) + 1;

  const weeks: WeekSpend[] = weeksIn(cycle.from, cycle.to).map((w) => ({
    index: w.index,
    from: w.from,
    to: w.to,
    spentMinor: inCycle
      .filter(
        (e) => toUtc(e.expenseDate) >= toUtc(w.from) && toUtc(e.expenseDate) <= toUtc(w.to),
      )
      .reduce((s, e) => s + e.amountMinor, 0),
  }));

  const catMap = new Map<string, { categoryId: string | null; totalMinor: number; count: number }>();
  for (const e of inCycle) {
    const key = e.categoryId ?? "__none__";
    const row = catMap.get(key) ?? { categoryId: e.categoryId, totalMinor: 0, count: 0 };
    row.totalMinor += e.amountMinor;
    row.count += 1;
    catMap.set(key, row);
  }
  const byCategory = [...catMap.values()].sort((a, b) => b.totalMinor - a.totalMinor);

  const kindMap = new Map<CommitmentKind, number>();
  for (const c of dueCommitments) {
    kindMap.set(c.kind, (kindMap.get(c.kind) ?? 0) + c.amountMinor);
  }
  const committedByKind = [...kindMap.entries()]
    .map(([kind, totalMinor]) => ({ kind, totalMinor }))
    .sort((a, b) => b.totalMinor - a.totalMinor);

  // Status is only meaningful once there's an income figure to plan against.
  let status: PlanStatus = "unplanned";
  if (incomeMinor > 0) {
    if (remainingMinor < 0) status = "over";
    else if (spendableMinor > 0 && remainingMinor < spendableMinor * 0.15) status = "tight";
    else status = "on_track";
  }

  return {
    cycle,
    incomeMinor,
    committedMinor,
    givingMinor,
    savingsTargetMinor,
    spendableMinor,
    spentMinor,
    remainingMinor,
    projectedSavingsMinor,
    dailyAllowanceMinor:
      daysLeft > 0 ? Math.floor(Math.max(remainingMinor, 0) / daysLeft) : null,
    daysLeft,
    dueCommitments,
    committedByKind,
    weeks,
    byCategory,
    status,
  };
}

/**
 * Months of saving needed to afford `costMinor` at the current monthly surplus.
 * Null when nothing is being saved — "never at this rate" is the honest answer.
 */
export function monthsToAfford(
  costMinor: number,
  monthlySurplusMinor: number,
): number | null {
  if (monthlySurplusMinor <= 0) return null;
  return Math.ceil(costMinor / monthlySurplusMinor);
}
