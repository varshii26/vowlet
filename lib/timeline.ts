/**
 * Turns the wedding, its vendors and their payments into what the Gantt shows:
 * a "Wedding day" milestone, one row per vendor, and each payment as a
 * milestone under its vendor, linked to the wedding day. Pure data in, plain
 * JSON-safe data out, so it is tested without a browser and can cross the
 * server/client boundary.
 *
 * Due dates come from lib/schedule.ts. The Gantt never decides a date.
 */
import { formatCents } from "@/lib/money";
import {
  addDaysUtc,
  computeDueDate,
  daysBetweenUtc,
  getDisplayStatus,
  startOfUtcDay,
  toIsoDate,
  type DisplayStatus,
  type PaymentAnchor,
  type PaymentStatus,
} from "@/lib/schedule";

export type TimelinePayment = {
  id: string;
  label: string;
  amountCents: number;
  anchor: PaymentAnchor;
  offsetDays: number;
  fixedDate: Date | null;
  status: PaymentStatus;
  /** `text` is the clause as quoted in the contract, shown in the payment drawer. */
  clause: { id: string; summary: string; page: number; text?: string } | null;
};

export type TimelineVendor = {
  id: string;
  name: string;
  status: "active" | "cancelled";
  signingDate: Date;
  payments: TimelinePayment[];
};

export type TimelineInput = {
  wedding: { coupleNames: string; date: Date };
  vendors: TimelineVendor[];
};

export const WEDDING_TASK_ID = "wedding";
export const vendorTaskId = (vendorId: string) => `vendor-${vendorId}`;
export const paymentTaskId = (paymentId: string) => `payment-${paymentId}`;

/** A Gantt task. Dates are `YYYY-MM-DD`; milestones have zero duration. */
export type TimelineTask = {
  id: string;
  name: string;
  startDate?: string;
  duration?: number;
  expanded?: boolean;
  manuallyScheduled?: boolean;
  /** Only the wedding day can be dragged (to run a what-if); payment dates come from the contracts. */
  draggable: boolean;
  resizable: false;
  /**
   * Bryntum named colour. This is what recolours a milestone: it puts a
   * `b-color-*` class on the bar's wrapper, which owns the colour palette.
   */
  eventColor: string;
  /** CSS classes: the status and row kind, for the grid and tests. */
  cls: string;
  children?: TimelineTask[];
};

export type TimelineDependency = { id: string; fromTask: string; toTask: string };

/** What the tooltip and columns show for a task. */
export type TaskDetail =
  | {
      kind: "wedding";
      title: string;
      dateLabel: string;
      /** `YYYY-MM-DD`. */
      isoDate: string;
    }
  | {
      kind: "vendor";
      title: string;
      amountLabel: string;
      summary: string;
      cancelled: boolean;
    }
  | {
      kind: "payment";
      title: string;
      vendorId: string;
      vendorName: string;
      paymentId: string;
      amountLabel: string;
      dateLabel: string;
      status: DisplayStatus;
      statusLabel: string;
      clauseId: string | null;
      clauseSummary: string | null;
      clausePage: number | null;
      /** The clause as quoted in the contract. */
      clauseText: string | null;
    };

export type TimelineData = {
  tasks: TimelineTask[];
  dependencies: TimelineDependency[];
  details: Record<string, TaskDetail>;
  /** Visible range, `YYYY-MM-DD`, always containing every milestone. */
  startDate: string;
  endDate: string;
};

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  paid: "Paid",
  due_soon: "Due soon",
  overdue: "Overdue",
  scheduled: "Scheduled",
  refund_requested: "Refund requested",
  refunded: "Refunded",
  void: "Void",
};

/** Milestone colour for each status: Bryntum named colours. */
export const STATUS_COLOR: Record<DisplayStatus, string> = {
  paid: "green",
  due_soon: "amber",
  overdue: "red",
  scheduled: "blue",
  refund_requested: "deep-purple",
  refunded: "teal",
  void: "gray",
};

const WEDDING_COLOR = "pink";
const VENDOR_COLOR = "light-gray";
const CANCELLED_VENDOR_COLOR = "lighter-gray";

/** Days of padding on each side of the first and last milestone. */
const RANGE_PADDING_DAYS = 21;

const longDate = (date: Date) =>
  date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

type DatedPayment = TimelinePayment & { due: Date; display: DisplayStatus };

function datePayments(vendor: TimelineVendor, weddingDate: Date, today: Date): DatedPayment[] {
  return vendor.payments
    .map((payment) => {
      const due = computeDueDate(payment, { weddingDate, signingDate: vendor.signingDate });
      return { ...payment, due, display: getDisplayStatus(payment.status, due, today) };
    })
    .sort((a, b) => a.due.getTime() - b.due.getTime() || a.label.localeCompare(b.label));
}

function vendorSummary(vendor: TimelineVendor, dated: DatedPayment[]): TaskDetail {
  const total = dated.reduce((sum, p) => sum + p.amountCents, 0);
  const paid = dated.filter((p) => p.status === "paid").reduce((sum, p) => sum + p.amountCents, 0);
  const count = `${dated.length} payment${dated.length === 1 ? "" : "s"}`;
  return {
    kind: "vendor",
    title: vendor.name,
    amountLabel: formatCents(total),
    summary: vendor.status === "cancelled" ? `Cancelled. ${count}.` : `${count}, ${formatCents(paid)} of ${formatCents(total)} paid.`,
    cancelled: vendor.status === "cancelled",
  };
}

/** Build the Gantt data. `today` is passed in so the result is deterministic. */
export function buildTimeline(input: TimelineInput, today: Date): TimelineData {
  const weddingDate = startOfUtcDay(input.wedding.date);
  const details: Record<string, TaskDetail> = {};
  const dependencies: TimelineDependency[] = [];
  const allDates: Date[] = [weddingDate];

  const vendors = input.vendors
    .map((vendor) => ({ vendor, dated: datePayments(vendor, weddingDate, today) }))
    // Chronological: the vendor with the earliest payment first.
    .sort((a, b) => {
      const first = (v: DatedPayment[]) => v[0]?.due.getTime() ?? Number.MAX_SAFE_INTEGER;
      return first(a.dated) - first(b.dated) || a.vendor.name.localeCompare(b.vendor.name);
    });

  const vendorTasks = vendors.map(({ vendor, dated }): TimelineTask => {
    details[vendorTaskId(vendor.id)] = vendorSummary(vendor, dated);

    const children = dated.map((payment): TimelineTask => {
      const taskId = paymentTaskId(payment.id);
      allDates.push(payment.due);
      details[taskId] = {
        kind: "payment",
        title: payment.label,
        vendorId: vendor.id,
        vendorName: vendor.name,
        paymentId: payment.id,
        amountLabel: formatCents(payment.amountCents),
        dateLabel: longDate(payment.due),
        status: payment.display,
        statusLabel: STATUS_LABEL[payment.display],
        clauseId: payment.clause?.id ?? null,
        clauseSummary: payment.clause?.summary ?? null,
        clausePage: payment.clause?.page ?? null,
        clauseText: payment.clause?.text ?? null,
      };
      // Payment before the wedding feeds into it; one after follows it. The
      // dependency lines are visual, so direction only needs to read sensibly.
      const beforeWedding = daysBetweenUtc(payment.due, weddingDate) >= 0;
      dependencies.push({
        id: `dep-${payment.id}`,
        fromTask: beforeWedding ? taskId : WEDDING_TASK_ID,
        toTask: beforeWedding ? WEDDING_TASK_ID : taskId,
      });
      return {
        id: taskId,
        name: payment.label,
        startDate: toIsoDate(payment.due),
        duration: 0,
        manuallyScheduled: true,
        draggable: false,
        resizable: false,
        eventColor: STATUS_COLOR[payment.display],
        cls: `payment payment-${payment.display}`,
      };
    });

    return {
      id: vendorTaskId(vendor.id),
      name: vendor.name,
      expanded: true,
      draggable: false,
      resizable: false,
      eventColor: vendor.status === "cancelled" ? CANCELLED_VENDOR_COLOR : VENDOR_COLOR,
      cls: vendor.status === "cancelled" ? "vendor vendor-cancelled" : "vendor",
      children,
    };
  });

  details[WEDDING_TASK_ID] = {
    kind: "wedding",
    title: `Wedding day: ${input.wedding.coupleNames}`,
    dateLabel: longDate(weddingDate),
    isoDate: toIsoDate(weddingDate),
  };

  const times = allDates.map((d) => d.getTime());
  const start = addDaysUtc(new Date(Math.min(...times)), -RANGE_PADDING_DAYS);
  const end = addDaysUtc(new Date(Math.max(...times)), RANGE_PADDING_DAYS);

  return {
    tasks: [
      {
        id: WEDDING_TASK_ID,
        name: `Wedding day: ${input.wedding.coupleNames}`,
        startDate: toIsoDate(weddingDate),
        duration: 0,
        manuallyScheduled: true,
        draggable: true,
        resizable: false,
        eventColor: WEDDING_COLOR,
        cls: "wedding",
      },
      ...vendorTasks,
    ],
    dependencies,
    details,
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
  };
}
