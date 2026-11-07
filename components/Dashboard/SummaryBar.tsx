import Link from "next/link";
import { budgetBar, type BudgetSummary } from "@/lib/budget";
import { formatCents } from "@/lib/money";
import type { UpcomingPayment } from "@/lib/payments/upcoming";

export type SummaryBarProps = {
  weddingDateLabel: string;
  daysToGo: number;
  summary: BudgetSummary;
  next: UpcomingPayment | null;
  vendors: Array<{ id: string; name: string; cancelled: boolean }>;
};

const pct = (n: number) => `${n.toFixed(2)}%`;

function Stat({ label, value, note, tone = "text-neutral-900" }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</dd>
      {note ? <dd className="mt-0.5 text-xs text-neutral-500">{note}</dd> : null}
    </div>
  );
}

/**
 * The top of the dashboard: the wedding date, where the budget stands, and the
 * next payment. A server component, so it re-renders from the database whenever
 * the page refreshes (after a payment, a reschedule or an approval).
 */
export function SummaryBar({ weddingDateLabel, daysToGo, summary, next, vendors }: SummaryBarProps) {
  const bar = budgetBar(summary);
  const over = summary.remainingCents < 0;
  const days = daysToGo === 0 ? "It's the wedding day" : daysToGo > 0 ? `${daysToGo} day${daysToGo === 1 ? "" : "s"} to go` : `${-daysToGo} days ago`;
  const barLabel = over
    ? `Over budget: ${formatCents(summary.paidCents)} paid and ${formatCents(summary.scheduledCents)} still to pay, against a ${formatCents(summary.budgetCents)} budget.`
    : `${formatCents(summary.paidCents)} paid, ${formatCents(summary.scheduledCents)} still to pay and ${formatCents(summary.remainingCents)} left of a ${formatCents(summary.budgetCents)} budget.`;

  return (
    <section aria-label="Summary" className="space-y-5 rounded-lg border border-neutral-200 p-5">
      <dl className="grid grid-cols-2 gap-5 md:grid-cols-4">
        <Stat label="Wedding" value={weddingDateLabel} note={days} />
        <Stat label="Paid" value={formatCents(summary.paidCents)} tone="text-emerald-700" />
        <Stat label="Still to pay" value={formatCents(summary.scheduledCents)} note={`${summary.unpaidCount} payment${summary.unpaidCount === 1 ? "" : "s"}`} />
        <Stat
          label={over ? "Over budget by" : "Left in budget"}
          value={formatCents(Math.abs(summary.remainingCents))}
          note={`of ${formatCents(summary.budgetCents)}`}
          tone={over ? "text-rose-700" : "text-neutral-900"}
        />
      </dl>

      <div>
        <div role="img" aria-label={barLabel} className="flex h-3 w-full overflow-hidden rounded-full bg-neutral-200">
          <div className="h-full bg-emerald-500" style={{ width: pct(bar.paid) }} />
          <div className={`h-full ${over ? "bg-rose-400" : "bg-indigo-400"}`} style={{ width: pct(bar.scheduled) }} />
        </div>
        <ul aria-hidden className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-emerald-500" /> Paid
          </li>
          <li className="flex items-center gap-1.5">
            <span className={`size-2.5 rounded-full ${over ? "bg-rose-400" : "bg-indigo-400"}`} /> Still to pay
          </li>
          {!over ? (
            <li className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-neutral-200" /> Left
            </li>
          ) : null}
        </ul>
      </div>

      <p className="text-sm text-neutral-700">
        {next ? (
          <>
            <span className="font-medium">Next payment:</span> {next.amountLabel} to {next.vendorName} ({next.label}), due {next.dueDateLabel}.
          </>
        ) : (
          "Nothing left to pay."
        )}
      </p>

      {vendors.length > 0 ? (
        <nav aria-label="Vendor contracts" className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-4 text-sm">
          <span className="text-neutral-500">Contracts:</span>
          {vendors.map((v) => (
            <Link
              key={v.id}
              href={`/vendors/${v.id}`}
              className={`rounded-full border px-2.5 py-0.5 hover:bg-neutral-50 ${v.cancelled ? "border-neutral-200 text-neutral-400 line-through" : "border-neutral-300 text-neutral-700"}`}
            >
              {v.name}
            </Link>
          ))}
        </nav>
      ) : null}
    </section>
  );
}
