"use client";

import { usePaymentDrawer } from "@/components/Payments/PaymentDrawer";
import { StatusBadge } from "@/components/Payments/StatusBadge";
import type { UpcomingPayment } from "@/lib/payments/upcoming";

/**
 * The payments still to make, soonest first. Each row opens the payment drawer,
 * which has the clause and the Pay button, so the list stays quiet.
 */
export function UpcomingPayments({ payments }: { payments: UpcomingPayment[] }) {
  const drawer = usePaymentDrawer();

  if (payments.length === 0) return <p className="text-sm text-muted">No payments left to make.</p>;

  return (
    <ul aria-label="Upcoming payments" className="card divide-y divide-line overflow-hidden">
      {payments.map((payment) => (
        <li key={payment.paymentId}>
          <button
            type="button"
            onClick={() => drawer?.openPayment(payment.paymentId)}
            className="group grid w-full grid-cols-[minmax(0,1fr)_auto_7rem_auto] items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-canvas focus-visible:bg-canvas"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium text-ink">{payment.label}</span>
              <span className="block truncate text-sm text-muted">
                {payment.vendorName} · due {payment.dueDateLabel}
              </span>
            </span>
            <StatusBadge status={payment.status} label={payment.statusLabel} />
            <span className="text-right font-serif text-lg tabular-nums text-ink">{payment.amountLabel}</span>
            <span aria-hidden className="text-sm font-medium text-accent opacity-60 transition-opacity group-hover:opacity-100">
              Details →
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
