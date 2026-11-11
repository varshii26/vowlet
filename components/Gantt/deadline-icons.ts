import type { DeadlineKind } from "@/lib/deadlines";

/**
 * The Font Awesome icon for each kind of contract deadline. Shared by the
 * Gantt's indicators and the legend that explains them, so the two can't
 * drift. A plain module on purpose: the legend renders before Bryntum loads and
 * must not pull the chart into the page bundle.
 */
export const DEADLINE_ICON: Record<DeadlineKind, string> = {
  date_change: "fa fa-calendar-day",
  cancellation: "fa fa-rotate-left",
};

/** What each deadline icon means, for the legend. */
export const DEADLINE_LEGEND: Record<DeadlineKind, { label: string; title: string }> = {
  date_change: {
    label: "Change date by",
    title: "The last day to move the wedding date at the current fee. Hover the icon in a vendor's row for the rule; click it for the clause.",
  },
  cancellation: {
    label: "Cancel by",
    title: "The last day to cancel at the current refund. Hover the icon in a vendor's row for the rule; click it for the clause.",
  },
};
