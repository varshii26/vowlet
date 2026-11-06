"use client";

import { useState } from "react";
import { PayButton, type PaySettled } from "@/components/Payments/PayButton";
import type { UpcomingPayment } from "@/lib/payments/upcoming";
import type { DisplayStatus } from "@/lib/schedule";

const BADGE: Record<DisplayStatus, string> = {
  overdue: "bg-red-100 text-red-800",
  due_soon: "bg-amber-100 text-amber-800",
  scheduled: "bg-slate-100 text-slate-700",
  paid: "bg-green-100 text-green-800",
  refund_requested: "bg-purple-100 text-purple-800",
  refunded: "bg-teal-100 text-teal-800",
  void: "bg-stone-100 text-stone-600",
};

/**
 * The payments still to make, each with a Pay button. A paid payment drops off
 * the list when the page refreshes, so a confirmation stays up until dismissed.
 */
export function UpcomingPayments({ payments }: { payments: UpcomingPayment[] }) {
  const [confirmation, setConfirmation] = useState<string | null>(null);

  function settled(payment: UpcomingPayment, outcome: PaySettled) {
    setConfirmation(
      outcome.state === "pending"
        ? `${payment.vendorName}, ${payment.label}: ${outcome.message}`
        : `Paid ${payment.amountLabel} to ${payment.vendorName} (${payment.label}).`,
    );
  }

  return (
    <section aria-labelledby="upcoming-heading" className="space-y-3">
      <h2 id="upcoming-heading" className="text-xl font-semibold">
        Upcoming payments
      </h2>

      {confirmation && (
        <div role="status" className="flex items-start justify-between gap-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          <span>{confirmation}</span>
          <button type="button" onClick={() => setConfirmation(null)} className="font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {payments.length === 0 ? (
        <p className="text-neutral-600">No payments left to make.</p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
          {payments.map((payment) => (
            <li key={payment.paymentId} className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="min-w-56 space-y-1">
                <p className="font-medium">{payment.label}</p>
                <p className="text-sm text-neutral-600">
                  {payment.vendorName} · due {payment.dueDateLabel}
                </p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE[payment.status]}`}>
                {payment.statusLabel}
              </span>
              <p className="w-24 text-right text-lg font-semibold">{payment.amountLabel}</p>
              <PayButton paymentId={payment.paymentId} onSettled={(outcome) => settled(payment, outcome)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
