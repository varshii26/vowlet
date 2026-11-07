import { describe, expect, it } from "vitest";
import { budgetBar, summarizeBudget, type BudgetPayment } from "@/lib/budget";

const pay = (amountCents: number, status: string, vendorActive = true): BudgetPayment => ({ amountCents, status, vendorActive });

describe("summarizeBudget", () => {
  it("splits payments into paid, still to pay and left in the budget", () => {
    expect(summarizeBudget(10_000, [pay(3_000, "paid"), pay(2_000, "scheduled"), pay(1_000, "due")])).toEqual({
      budgetCents: 10_000,
      paidCents: 3_000,
      scheduledCents: 3_000,
      remainingCents: 4_000,
      unpaidCount: 2,
    });
  });

  it("leaves out refunds, void payments and a cancelled vendor's unpaid payments", () => {
    const s = summarizeBudget(10_000, [pay(1_000, "refund_requested"), pay(1_000, "refunded"), pay(1_000, "void"), pay(2_000, "scheduled", false), pay(500, "paid", false)]);
    expect(s).toMatchObject({ paidCents: 500, scheduledCents: 0, remainingCents: 9_500, unpaidCount: 0 });
  });

  it("goes negative when over budget", () => {
    expect(summarizeBudget(1_000, [pay(800, "paid"), pay(700, "scheduled")]).remainingCents).toBe(-500);
  });

  it("handles no payments", () => {
    expect(summarizeBudget(5_000, [])).toEqual({ budgetCents: 5_000, paidCents: 0, scheduledCents: 0, remainingCents: 5_000, unpaidCount: 0 });
  });
});

describe("budgetBar", () => {
  it("shows shares of the budget when within it", () => {
    expect(budgetBar(summarizeBudget(10_000, [pay(2_500, "paid"), pay(5_000, "scheduled")]))).toEqual({ paid: 25, scheduled: 50, left: 25, overBudget: false });
  });

  it("shows shares of what is committed when over budget, still adding up to 100", () => {
    const bar = budgetBar(summarizeBudget(1_000, [pay(500, "paid"), pay(1_500, "scheduled")]));
    expect(bar).toEqual({ paid: 25, scheduled: 75, left: 0, overBudget: true });
  });

  it("is all 'left' for an empty or zero budget", () => {
    expect(budgetBar(summarizeBudget(0, []))).toEqual({ paid: 0, scheduled: 0, left: 100, overBudget: false });
  });
});
