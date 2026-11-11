import type { ReactNode } from "react";
import { NextPayment } from "@/components/Dashboard/NextPayment";
import { budgetBar, type BudgetSummary } from "@/lib/budget";
import { formatCents } from "@/lib/money";
import type { UpcomingPayment } from "@/lib/payments/upcoming";

export type SummaryBarProps = {
  coupleNames: string;
  weddingDateLabel: string;
  daysToGo: number;
  summary: BudgetSummary;
  next: UpcomingPayment | null;
  /** Page actions shown top right (upload, reset demo). */
  actions?: ReactNode;
};

const pct = (n: number) => `${n.toFixed(2)}%`;

function Legend({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span aria-hidden className={`size-2.5 shrink-0 translate-y-[-1px] self-center rounded-full ${swatch}`} />
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

/**
 * The header strip: who and when, the countdown, where the budget stands, and
 * the one payment due next. A server component (the Pay button inside is a
 * client island), so it re-renders from the database whenever the page refreshes.
 */
export function SummaryBar({ coupleNames, weddingDateLabel, daysToGo, summary, next, actions }: SummaryBarProps) {
  const bar = budgetBar(summary);
  const over = summary.remainingCents < 0;
  const days =
    daysToGo === 0 ? "It's the wedding day" : daysToGo > 0 ? `${daysToGo} day${daysToGo === 1 ? "" : "s"} to go` : `${-daysToGo} days ago`;
  const barLabel = over
    ? `Over budget: ${formatCents(summary.paidCents)} paid and ${formatCents(summary.scheduledCents)} still to pay, against a ${formatCents(summary.budgetCents)} budget.`
    : `${formatCents(summary.paidCents)} paid, ${formatCents(summary.scheduledCents)} still to pay and ${formatCents(summary.remainingCents)} left of a ${formatCents(summary.budgetCents)} budget.`;

  return (
    <header aria-label="Summary" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Vowlet</p>
          <h1 className="mt-1 text-3xl text-ink">{coupleNames}</h1>
          <p className="mt-1 text-sm text-muted">
            <span className="font-medium text-ink">{weddingDateLabel}</span>
            <span aria-hidden> · </span>
            <span className="inline-block rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-strong">{days}</span>
          </p>
        </div>
        {actions}
      </div>

      <div className="card grid items-center gap-x-8 gap-y-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-2.5">
          <div role="img" aria-label={barLabel} className="flex h-2.5 w-full overflow-hidden rounded-full bg-sunken">
            <div className="h-full bg-emerald-500 transition-[width] duration-700" style={{ width: pct(bar.paid) }} />
            <div className={`h-full transition-[width] duration-700 ${over ? "bg-red-400" : "bg-accent/70"}`} style={{ width: pct(bar.scheduled) }} />
          </div>
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <Legend swatch="bg-emerald-500" label="Paid" value={formatCents(summary.paidCents)} />
            <Legend
              swatch={over ? "bg-red-400" : "bg-accent/70"}
              label="Still to pay"
              value={`${formatCents(summary.scheduledCents)} (${summary.unpaidCount} payment${summary.unpaidCount === 1 ? "" : "s"})`}
            />
            {over ? (
              <Legend swatch="bg-red-600" label="Over budget by" value={formatCents(-summary.remainingCents)} />
            ) : (
              <Legend swatch="bg-sunken border border-line" label="Left" value={`${formatCents(summary.remainingCents)} of ${formatCents(summary.budgetCents)}`} />
            )}
          </dl>
        </div>
        <div className="border-line lg:border-l lg:pl-8">
          <NextPayment next={next} />
        </div>
      </div>
    </header>
  );
}
