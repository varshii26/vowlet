/**
 * Due-date computation. Due dates are never stored: every payment keeps an
 * anchor plus an offset, and this module derives the date. Moving the wedding
 * date therefore reflows every `wedding_date` payment and nothing else.
 *
 * All dates are UTC calendar days (midnight UTC). No local time zone or
 * daylight-saving rule can shift a result.
 */

export type PaymentAnchor = "wedding_date" | "signing_date" | "fixed";

export type PaymentStatus =
  | "scheduled"
  | "due"
  | "paid"
  | "refund_requested"
  | "refunded"
  | "void";

/** The fields of a payment that decide its due date. */
export type ScheduleInput = {
  anchor: PaymentAnchor;
  offsetDays: number;
  fixedDate?: Date | null;
};

/** The dates a payment can be anchored to. */
export type ScheduleAnchors = {
  weddingDate: Date;
  /** The vendor's contract signing date. */
  signingDate: Date;
};

/** What the UI shows, derived from the stored status plus the due date. */
export type DisplayStatus =
  | "paid"
  | "refund_requested"
  | "refunded"
  | "void"
  | "overdue"
  | "due_soon"
  | "scheduled";

/** Payments due within this many days (today included) count as "due soon". */
export const DUE_SOON_DAYS = 14;

const MS_PER_DAY = 86_400_000;

function assertValid(date: Date, name: string): void {
  if (Number.isNaN(date.getTime())) throw new RangeError(`${name} is not a valid date`);
}

/** Midnight UTC of the calendar day the given instant falls on. */
export function startOfUtcDay(date: Date): Date {
  assertValid(date, "date");
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Add whole calendar days (negative to subtract) to a UTC day. */
export function addDaysUtc(date: Date, days: number): Date {
  if (!Number.isInteger(days)) throw new RangeError("days must be an integer");
  return new Date(startOfUtcDay(date).getTime() + days * MS_PER_DAY);
}

/** Whole calendar days from `from` to `to` (positive when `to` is later). */
export function daysBetweenUtc(from: Date, to: Date): number {
  return Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / MS_PER_DAY);
}

/** `YYYY-MM-DD` for a UTC day. */
export function toIsoDate(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

/**
 * The date a payment is due, from its anchor and offset.
 * - `wedding_date`: wedding date + offset
 * - `signing_date`: vendor signing date + offset
 * - `fixed`: the fixed date + offset (the offset is normally 0)
 */
export function computeDueDate(payment: ScheduleInput, anchors: ScheduleAnchors): Date {
  switch (payment.anchor) {
    case "wedding_date":
      return addDaysUtc(anchors.weddingDate, payment.offsetDays);
    case "signing_date":
      return addDaysUtc(anchors.signingDate, payment.offsetDays);
    case "fixed":
      if (!payment.fixedDate) throw new Error("A fixed-anchor payment needs a fixedDate");
      return addDaysUtc(payment.fixedDate, payment.offsetDays);
  }
}

/**
 * How a payment should be presented as of `today`. Settled states (paid,
 * refunded, void, refund requested) win over timing. Otherwise a payment due
 * before today is overdue, one due from today through `dueSoonDays` days out is
 * due soon, and the rest are scheduled. Due today counts as due soon, not overdue.
 */
export function getDisplayStatus(
  status: PaymentStatus,
  dueDate: Date,
  today: Date,
  dueSoonDays: number = DUE_SOON_DAYS,
): DisplayStatus {
  if (status === "paid" || status === "refund_requested" || status === "refunded" || status === "void") {
    return status;
  }
  const daysUntilDue = daysBetweenUtc(today, dueDate);
  if (daysUntilDue < 0) return "overdue";
  if (daysUntilDue <= dueSoonDays) return "due_soon";
  return "scheduled";
}
