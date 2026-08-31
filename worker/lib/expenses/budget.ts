/**
 * Budget leftover + short spend-advice copy for expense summaries.
 */

export type BudgetInputs = {
  monthlyIncomeMinor: number;
  tithePercent: number;
  childrenGivingMinor: number;
  savingsGoalMinor: number;
  /** Actual spend in the summary window (usually the month). */
  spentMinor: number;
  /** Sum of active recurring amounts normalized to a monthly figure. */
  recurringMonthlyMinor: number;
};

export type BudgetBreakdown = {
  incomeMinor: number;
  titheDueMinor: number;
  childrenGivingMinor: number;
  savingsGoalMinor: number;
  spentMinor: number;
  recurringMonthlyMinor: number;
  leftoverMinor: number;
};

export function computeBudget(input: BudgetInputs): BudgetBreakdown {
  const income = Math.max(0, input.monthlyIncomeMinor);
  const tithePct = Math.min(100, Math.max(0, input.tithePercent));
  const titheDueMinor = Math.round((income * tithePct) / 100);
  const children = Math.max(0, input.childrenGivingMinor);
  const savings = Math.max(0, input.savingsGoalMinor);
  const spent = Math.max(0, input.spentMinor);
  const recurring = Math.max(0, input.recurringMonthlyMinor);
  const leftoverMinor =
    income - spent - recurring - titheDueMinor - children - savings;
  return {
    incomeMinor: income,
    titheDueMinor,
    childrenGivingMinor: children,
    savingsGoalMinor: savings,
    spentMinor: spent,
    recurringMonthlyMinor: recurring,
    leftoverMinor,
  };
}

/** Human-readable one-liner for the summary payload. */
export function spendAdvice(budget: BudgetBreakdown, currency: string): string {
  const fmt = (minor: number) =>
    `${(minor / 100).toFixed(2)} ${currency}`;

  if (budget.incomeMinor <= 0) {
    return "Set your monthly income in the money plan to get budget guidance.";
  }
  if (budget.leftoverMinor < 0) {
    return `You're over budget by ${fmt(-budget.leftoverMinor)}. Trim discretionary spend or adjust tithe/savings goals.`;
  }
  if (budget.leftoverMinor === 0) {
    return "You're exactly on plan — every unit of income is allocated.";
  }
  const bufferPct =
    budget.incomeMinor > 0
      ? Math.round((budget.leftoverMinor / budget.incomeMinor) * 100)
      : 0;
  if (bufferPct < 5) {
    return `Thin buffer (${fmt(budget.leftoverMinor)} left). Watch unplanned purchases this month.`;
  }
  return `On track with ${fmt(budget.leftoverMinor)} leftover after tithe, giving, savings, and recurring commitments.`;
}

/** Normalize a recurring interval amount to a monthly figure. */
export function toMonthlyMinor(
  amountMinor: number,
  interval: "monthly" | "weekly" | "yearly",
): number {
  switch (interval) {
    case "weekly":
      return Math.round((amountMinor * 52) / 12);
    case "yearly":
      return Math.round(amountMinor / 12);
    default:
      return amountMinor;
  }
}
