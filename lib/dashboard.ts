import { summarizeBudget, type BudgetSummary } from "@/lib/budget";
import type { UpcomingPayment } from "@/lib/payments/upcoming";
import { daysBetweenUtc } from "@/lib/schedule";
import type { TimelineInput } from "@/lib/timeline";

export type DashboardSummary = {
  weddingDateLabel: string;
  daysToGo: number;
  summary: BudgetSummary;
  next: UpcomingPayment | null;
  vendors: Array<{ id: string; name: string; cancelled: boolean }>;
};

/** Everything the summary bar shows, worked out from the same data as the timeline. */
export function dashboardSummary(input: TimelineInput, budgetCents: number, upcoming: readonly UpcomingPayment[], today: Date): DashboardSummary {
  const payments = input.vendors.flatMap((v) => v.payments.map((p) => ({ amountCents: p.amountCents, status: p.status, vendorActive: v.status === "active" })));
  return {
    weddingDateLabel: input.wedding.date.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }),
    daysToGo: daysBetweenUtc(today, input.wedding.date),
    summary: summarizeBudget(budgetCents, payments),
    next: upcoming[0] ?? null,
    vendors: input.vendors.map((v) => ({ id: v.id, name: v.name, cancelled: v.status === "cancelled" })),
  };
}
