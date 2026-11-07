/**
 * Budget totals, shared by the dashboard's summary bar and the agent's
 * `get_wedding` tool so the page and the assistant always agree. Integer cents.
 *
 * - paid: payments with status `paid`.
 * - scheduled: payments still to make (`scheduled` or `due`) to vendors who haven't cancelled.
 * - remaining: budget minus paid minus scheduled. Negative means over budget.
 * Payments with a refund requested, refunded or void count in neither total.
 */

export type BudgetPayment = { amountCents: number; status: string; vendorActive: boolean };

export type BudgetSummary = {
  budgetCents: number;
  paidCents: number;
  scheduledCents: number;
  remainingCents: number;
  /** How many payments are still to make. */
  unpaidCount: number;
};

const UNPAID = new Set(["scheduled", "due"]);

export function summarizeBudget(budgetCents: number, payments: readonly BudgetPayment[]): BudgetSummary {
  const paidCents = payments.filter((p) => p.status === "paid").reduce((sum, p) => sum + p.amountCents, 0);
  const unpaid = payments.filter((p) => UNPAID.has(p.status) && p.vendorActive);
  const scheduledCents = unpaid.reduce((sum, p) => sum + p.amountCents, 0);
  return { budgetCents, paidCents, scheduledCents, remainingCents: budgetCents - paidCents - scheduledCents, unpaidCount: unpaid.length };
}

export type BudgetBar = {
  /** Shares of the bar, in percent, adding up to 100. */
  paid: number;
  scheduled: number;
  left: number;
  overBudget: boolean;
};

/**
 * How to draw the bar. Within budget, the bar is the budget. Over budget, the bar
 * is everything committed (paid + scheduled), so the parts still add up to 100%.
 */
export function budgetBar(s: BudgetSummary): BudgetBar {
  const overBudget = s.remainingCents < 0;
  const whole = overBudget ? s.paidCents + s.scheduledCents : s.budgetCents;
  if (whole <= 0) return { paid: 0, scheduled: 0, left: 100, overBudget };
  const paid = (s.paidCents / whole) * 100;
  const scheduled = (s.scheduledCents / whole) * 100;
  return { paid, scheduled, left: Math.max(0, 100 - paid - scheduled), overBudget };
}
