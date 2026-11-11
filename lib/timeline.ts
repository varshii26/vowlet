/**
 * Turns the wedding, its vendors and their payments into what the Gantt shows:
 * a "Wedding day" milestone, one row per vendor, and each payment as a
 * milestone under its vendor, linked to the wedding day. Pure data in, plain
 * JSON-safe data out, so it is tested without a browser and can cross the
 * server/client boundary.
 *
 * Due dates come from lib/schedule.ts. The Gantt never decides a date.
 */
import { nextDeadlines, type Deadline, type DeadlineTerms } from "@/lib/deadlines";
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
  /** Cancellation and date-change terms, for the deadline indicators. */
  terms?: DeadlineTerms;
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
  /**
   * Payments roll up into their vendor's row (Bryntum's Rollups feature), so a
   * collapsed vendor still shows every payment diamond in its status colour.
   */
  rollup?: boolean;
  /**
   * Vendor rows: share of the contract paid, 0-100, by amount. Bryntum fills
   * that much of the summary bar, so progress reads at a glance.
   */
  percentDone?: number;
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
  /**
   * During a what-if preview: where the task was before the wedding moved
   * (Bryntum's Baselines feature draws it as a faded ghost). Absent otherwise.
   */
  baselines?: TimelineBaseline[];
  children?: TimelineTask[];
};

/** A Bryntum baseline: a milestone at the task's date before the preview. */
export type TimelineBaseline = { startDate: string; endDate: string; cls: string };

/** Where a task was before a what-if preview moved it. */
export type PreviousDate = {
  /** "Mar 18" */
  dateLabel: string;
  /** Days moved, positive when later. */
  shiftDays: number;
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
      /** Set only while a what-if preview has moved it. */
      was?: PreviousDate;
    }
  | {
      kind: "vendor";
      vendorId: string;
      title: string;
      amountLabel: string;
      summary: string;
      cancelled: boolean;
      /** Share of the contract paid, 0-100, by amount. */
      percentPaid: number;
      /** "67% paid", for the Status column. */
      progressLabel: string;
      /**
       * The next date-change and cancellation deadline (lib/deadlines.ts),
       * drawn as indicators in the vendor's row. Absent without terms.
       */
      deadlines?: Deadline[];
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
      /** Set only while a what-if preview has moved it. */
      was?: PreviousDate;
    };

export type TimelineData = {
  tasks: TimelineTask[];
  dependencies: TimelineDependency[];
  details: Record<string, TaskDetail>;
  /**
   * Cash needed per month, `YYYY-MM` -> integer cents: payments still to make
   * (scheduled or due) to active vendors, by computed due date. Paid, void and
   * refund payments are left out. Feeds the Gantt's Summary footer.
   */
  cashByMonth: Record<string, number>;
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
/**
 * Room after the wedding day: the milestone stays fully on screen and there is
 * space to drag it later for a what-if.
 */
const WEDDING_TAIL_DAYS = 45;

/** "Apr 17": month and day, for places too narrow for the year. */
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

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

/** Whole percent paid, rounded down so a vendor reads 100% only when fully paid. */
export const percentPaid = (paidCents: number, totalCents: number) => (totalCents > 0 ? Math.floor((paidCents * 100) / totalCents) : 0);

function vendorSummary(vendor: TimelineVendor, dated: DatedPayment[], weddingDate: Date, today: Date): TaskDetail {
  const total = dated.reduce((sum, p) => sum + p.amountCents, 0);
  const paid = dated.filter((p) => p.status === "paid").reduce((sum, p) => sum + p.amountCents, 0);
  const count = `${dated.length} payment${dated.length === 1 ? "" : "s"}`;
  return {
    kind: "vendor",
    vendorId: vendor.id,
    title: vendor.name,
    amountLabel: formatCents(total),
    summary: vendor.status === "cancelled" ? `Cancelled. ${count}.` : `${count}, ${formatCents(paid)} of ${formatCents(total)} paid.`,
    cancelled: vendor.status === "cancelled",
    percentPaid: percentPaid(paid, total),
    progressLabel: vendor.status === "cancelled" ? "Cancelled" : `${percentPaid(paid, total)}% paid`,
    ...(vendor.terms && vendor.status === "active"
      ? {
          deadlines: nextDeadlines({
            weddingDate,
            today,
            totalCostCents: total,
            payments: dated.map((p) => ({ amountCents: p.amountCents, status: p.status })),
            terms: vendor.terms,
          }),
        }
      : {}),
  };
}

/**
 * A vendor row's colour. A vendor with a single payment is drawn as one diamond
 * (its summary has no length), which covers that payment's rollup, so it takes
 * the payment's status colour; otherwise a neutral summary bar.
 */
function vendorColor(vendor: TimelineVendor, dated: DatedPayment[]): string {
  if (vendor.status === "cancelled") return CANCELLED_VENDOR_COLOR;
  return dated.length === 1 ? STATUS_COLOR[dated[0].display] : VENDOR_COLOR;
}

const UNPAID: ReadonlySet<PaymentStatus> = new Set(["scheduled", "due"]);

/** Add each unpaid payment of an active vendor to the month it falls due in. */
function addToCashByMonth(totals: Record<string, number>, vendor: TimelineVendor, dated: DatedPayment[]): void {
  if (vendor.status !== "active") return;
  for (const payment of dated) {
    if (!UNPAID.has(payment.status)) continue;
    const month = toIsoDate(payment.due).slice(0, 7);
    totals[month] = (totals[month] ?? 0) + payment.amountCents;
  }
}

/** Build the Gantt data. `today` is passed in so the result is deterministic. */
export function buildTimeline(input: TimelineInput, today: Date): TimelineData {
  const weddingDate = startOfUtcDay(input.wedding.date);
  const details: Record<string, TaskDetail> = {};
  const dependencies: TimelineDependency[] = [];
  const cashByMonth: Record<string, number> = {};
  const allDates: Date[] = [weddingDate];

  const vendors = input.vendors
    .map((vendor) => ({ vendor, dated: datePayments(vendor, weddingDate, today) }))
    // Chronological: the vendor with the earliest payment first.
    .sort((a, b) => {
      const first = (v: DatedPayment[]) => v[0]?.due.getTime() ?? Number.MAX_SAFE_INTEGER;
      return first(a.dated) - first(b.dated) || a.vendor.name.localeCompare(b.vendor.name);
    });

  const vendorTasks = vendors.map(({ vendor, dated }): TimelineTask => {
    const summary = vendorSummary(vendor, dated, weddingDate, today);
    details[vendorTaskId(vendor.id)] = summary;
    addToCashByMonth(cashByMonth, vendor, dated);

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
        rollup: true,
        draggable: false,
        resizable: false,
        eventColor: STATUS_COLOR[payment.display],
        cls: `payment payment-${payment.display}`,
      };
    });

    return {
      id: vendorTaskId(vendor.id),
      name: vendor.name,
      // Collapsed, so all vendors fit at once; the payments still show as
      // rollups in the vendor's row, and expanding lists them one per row.
      expanded: false,
      percentDone: summary.kind === "vendor" ? summary.percentPaid : 0,
      draggable: false,
      resizable: false,
      eventColor: vendorColor(vendor, dated),
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
  const end = new Date(
    Math.max(addDaysUtc(new Date(Math.max(...times)), RANGE_PADDING_DAYS).getTime(), addDaysUtc(weddingDate, WEDDING_TAIL_DAYS).getTime()),
  );

  return {
    tasks: [
      {
        id: WEDDING_TASK_ID,
        // The grid's first column is narrow, and the couple's names are already in
        // the page header (and in the tooltip), so the row says what and when.
        name: `Wedding day · ${shortDate(toIsoDate(weddingDate))}`,
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
    cashByMonth,
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
  };
}

/** The CSS class on every what-if ghost; styled in components/Gantt/gantt.css. */
export const BASELINE_CLS = "vw-ghost";

/**
 * A what-if preview with the schedule from before it as Bryntum baselines: every
 * milestone the preview moved (the wedding day and each wedding-anchored payment)
 * gets a ghost at its old date and a `was` note for its tooltip. Milestones that
 * didn't move get no ghost, and a vendor row with a moved payment opens so its
 * ghosts show. Cancelling (back to `base`) or confirming (the
 * preview becomes the new base) simply stops calling this, so the ghosts go.
 */
export function withBaseline(preview: TimelineData, base: TimelineData): TimelineData {
  const before = new Map<string, string>();
  const collect = (tasks: TimelineTask[]) =>
    tasks.forEach((task) => {
      if (task.startDate && task.duration === 0) before.set(task.id, task.startDate);
      if (task.children) collect(task.children);
    });
  collect(base.tasks);

  const details = { ...preview.details };
  const mark = (tasks: TimelineTask[]): TimelineTask[] =>
    tasks.map((task) => {
      const children = task.children ? mark(task.children) : undefined;
      // Open a vendor whose payments moved, so their ghosts (drawn on the
      // payment rows) show; the saved schedule collapses it again.
      const opened = children?.some((child) => child.baselines) ? { expanded: true } : {};
      const was = before.get(task.id);
      if (!was || !task.startDate || was === task.startDate) return children ? { ...task, ...opened, children } : task;
      const detail = details[task.id];
      if (detail && (detail.kind === "payment" || detail.kind === "wedding")) {
        details[task.id] = {
          ...detail,
          was: { dateLabel: shortDate(was), shiftDays: daysBetweenUtc(new Date(`${was}T00:00:00.000Z`), new Date(`${task.startDate}T00:00:00.000Z`)) },
        };
      }
      return { ...task, ...(children ? { children } : {}), baselines: [{ startDate: was, endDate: was, cls: BASELINE_CLS }] };
    });

  return {
    ...preview,
    tasks: mark(preview.tasks),
    details,
    // Keep the ghosts in view too.
    startDate: base.startDate < preview.startDate ? base.startDate : preview.startDate,
    endDate: base.endDate > preview.endDate ? base.endDate : preview.endDate,
  };
}
