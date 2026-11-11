/**
 * Puts an agent answer's focus (lib/agent/focus.ts) on the timeline data:
 * highlight the payments and vendors the answer is about and dim the rest,
 * shade the date range it asked about, open the vendors it named, and preview
 * a pending refund request. Pure data in and out, tested without a browser.
 * Money and dates are untouched: this only changes how tasks are drawn.
 */
import type { AgentFocus } from "@/lib/agent/focus";
import { addDaysUtc, toIsoDate } from "@/lib/schedule";
import { STATUS_COLOR, STATUS_LABEL, paymentTaskId, vendorTaskId, type TaskDetail, type TimelineData, type TimelineTask } from "@/lib/timeline";

/** A shaded span on the timeline (Bryntum TimeRanges). `endDate` is exclusive. */
export type TimelineRange = { id: string; name: string; startDate: string; endDate: string; cls: string };

export type FocusedTimeline = TimelineData & {
  timeRanges: TimelineRange[];
  /** The row to scroll into view, if the focus names one. */
  focusTaskId: string | null;
};

export const FOCUS_CLS = "vw-focus";
export const DIM_CLS = "vw-dim";
export const PREVIEW_CLS = "vw-preview";

const withCls = (task: TimelineTask, cls: string) => ({ ...task, cls: `${task.cls} ${cls}` });

export function applyFocus(data: TimelineData, focus: AgentFocus | null, pendingProposalIds: ReadonlySet<string>): FocusedTimeline {
  if (!focus) return { ...data, timeRanges: [], focusTaskId: null };

  const vendorTasks = new Set(focus.vendors.map((v) => vendorTaskId(v.id)));
  const paymentTasks = new Set(focus.paymentIds.map(paymentTaskId));
  const highlighting = vendorTasks.size > 0 || paymentTasks.size > 0;
  // The refund preview lasts only while its proposal waits: once approved the
  // real statuses say the same, and once dismissed nothing changed.
  const refundVendorTask = focus.refund && pendingProposalIds.has(focus.refund.proposalId) ? vendorTaskId(focus.refund.vendorId) : null;
  const details: Record<string, TaskDetail> = { ...data.details };
  let focusTaskId: string | null = [...vendorTasks].find((id) => data.tasks.some((t) => t.id === id)) ?? null;

  const tasks = data.tasks.map((row): TimelineTask => {
    if (!row.children) return row; // the wedding day stays as it is
    const vendorFocused = vendorTasks.has(row.id);
    let anyChildFocused = false;

    const children = row.children.map((child) => {
      let task = child;
      const detail = details[child.id];
      if (row.id === refundVendorTask && detail?.kind === "payment" && detail.status === "paid") {
        task = {
          ...task,
          eventColor: STATUS_COLOR.refund_requested,
          cls: `${task.cls.replace("payment-paid", "payment-refund_requested")} ${PREVIEW_CLS}`,
        };
        details[child.id] = { ...detail, status: "refund_requested", statusLabel: `${STATUS_LABEL.refund_requested} (if you approve)` };
      }
      const focused = vendorFocused || paymentTasks.has(child.id);
      if (paymentTasks.has(child.id)) {
        anyChildFocused = true;
        focusTaskId ??= row.id;
      }
      return focused ? withCls(task, FOCUS_CLS) : highlighting ? withCls(task, DIM_CLS) : task;
    });

    const marked = vendorFocused || anyChildFocused ? withCls(row, FOCUS_CLS) : highlighting ? withCls(row, DIM_CLS) : row;
    // A vendor the answer names opens, so its payments show one per line.
    return { ...marked, ...(vendorFocused || row.id === refundVendorTask ? { expanded: true } : {}), children };
  });

  const timeRanges: TimelineRange[] = focus.range
    ? [
        {
          id: "agent-range",
          name: focus.range.label,
          startDate: focus.range.from,
          // Bryntum's end is exclusive: run to the end of the last day.
          endDate: toIsoDate(addDaysUtc(new Date(`${focus.range.to}T00:00:00.000Z`), 1)),
          cls: "vw-focus-range",
        },
      ]
    : [];

  return { ...data, tasks, details, timeRanges, focusTaskId };
}
