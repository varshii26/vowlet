"use client";

import { PayButton, type PaySettled } from "@/components/Payments/PayButton";
import { usePaymentDrawer } from "@/components/Payments/PaymentDrawer";
import { useToast } from "@/components/ui/Toast";
import type { UpcomingPayment } from "@/lib/payments/upcoming";

/** The one payment due next, with the dashboard's only always-visible Pay button. */
export function NextPayment({ next }: { next: UpcomingPayment | null }) {
  const drawer = usePaymentDrawer();
  const { toast, celebrate } = useToast();

  if (!next) return <p className="text-sm text-muted">Nothing left to pay.</p>;

  function settled(outcome: PaySettled) {
    if (!next) return;
    if (outcome.state === "pending") return toast(`${next.vendorName}, ${next.label}: ${outcome.message}`, "info");
    celebrate();
    toast(`Paid ${next.amountLabel} to ${next.vendorName} (${next.label}).`);
  }

  return (
    <div className="flex items-center gap-4">
      <div className="min-w-0 text-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Next payment</p>
        <p className="mt-0.5 truncate text-ink">
          <span className="font-serif text-lg font-semibold tabular-nums">{next.amountLabel}</span> {next.vendorName}
          <span className="text-muted"> · {next.dueDateLabel}</span>
        </p>
        {drawer && (
          <button type="button" onClick={() => drawer.openPayment(next.paymentId)} className="text-xs font-medium text-accent underline-offset-2 hover:underline">
            {next.label}: see the clause
          </button>
        )}
      </div>
      <div className="w-44 shrink-0">
        <PayButton key={next.paymentId} paymentId={next.paymentId} onSettled={settled} />
      </div>
    </div>
  );
}
