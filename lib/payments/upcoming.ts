import { formatCents } from "@/lib/money";
import { computeDueDate, getDisplayStatus, toIsoDate, type DisplayStatus } from "@/lib/schedule";
import { STATUS_LABEL, type TimelineInput } from "@/lib/timeline";

/** A payment the couple can still make, ready to show in a list. */
export type UpcomingPayment = {
  paymentId: string;
  vendorName: string;
  label: string;
  amountCents: number;
  amountLabel: string;
  /** `YYYY-MM-DD`. */
  dueDate: string;
  dueDateLabel: string;
  status: DisplayStatus;
  statusLabel: string;
};

const longDate = (date: Date) =>
  date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

/**
 * The payments still to make, soonest first. Only unpaid payments to active
 * vendors are included: those are the ones the Pay button can act on.
 */
export function selectUpcomingPayments(input: TimelineInput, today: Date, limit = 8): UpcomingPayment[] {
  return input.vendors
    .filter((vendor) => vendor.status === "active")
    .flatMap((vendor) =>
      vendor.payments
        .filter((payment) => payment.status === "scheduled" || payment.status === "due")
        .map((payment) => {
          const due = computeDueDate(payment, { weddingDate: input.wedding.date, signingDate: vendor.signingDate });
          const status = getDisplayStatus(payment.status, due, today);
          const upcoming: UpcomingPayment = {
            paymentId: payment.id,
            vendorName: vendor.name,
            label: payment.label,
            amountCents: payment.amountCents,
            amountLabel: formatCents(payment.amountCents),
            dueDate: toIsoDate(due),
            dueDateLabel: longDate(due),
            status,
            statusLabel: STATUS_LABEL[status],
          };
          return { upcoming, dueTime: due.getTime() };
        }),
    )
    .sort(
      (a, b) =>
        a.dueTime - b.dueTime ||
        a.upcoming.vendorName.localeCompare(b.upcoming.vendorName) ||
        a.upcoming.label.localeCompare(b.upcoming.label),
    )
    .slice(0, limit)
    .map((entry) => entry.upcoming);
}
