"use client";

import { BryntumGantt, type BryntumGanttProps } from "@bryntum/gantt-react-enterprise";
import type { TaskModel } from "@bryntum/gantt-enterprise";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { monthKey, renderCashCell, totalCash } from "@/components/Gantt/summary";
import { renderBaselineTip, renderTaskTooltip, renderWeddingDragTip } from "@/components/Gantt/tooltip";
import { formatCents } from "@/lib/money";
import { WEDDING_TASK_ID, type TaskDetail, type TimelineData, type TimelineTask } from "@/lib/timeline";
import { clauseHref } from "@/lib/vendors/links";

import "@bryntum/core-enterprise/fontawesome/css/fontawesome.css";
import "@bryntum/core-enterprise/fontawesome/css/solid.css";
import "@bryntum/gantt-enterprise/gantt.css";
import "@bryntum/gantt-enterprise/svalbard-light.css";
import "@/components/Gantt/gantt.css";

// Enterprise tier license (a trial key during the hackathon). It must be set
// before the first Gantt is created. Bryntum asks that the key stay out of
// public repos, so it comes from the environment; without it the chart runs as
// a 14-day trial per browser.
const licenseKey = process.env.NEXT_PUBLIC_BRYNTUM_LICENSE_KEY;
if (licenseKey) ((globalThis as { bryntum?: { licenseKey?: string } }).bryntum ??= {}).licenseKey = licenseKey;

export type PaymentSelection = Extract<TaskDetail, { kind: "payment" }>;

type Props = {
  data: TimelineData;
  /** Called when a payment milestone is clicked. Without it, the click opens the payment's contract clause. */
  onPaymentSelect?: (payment: PaymentSelection) => void;
  /**
   * Called with the new day (`YYYY-MM-DD`) when the "Wedding day" milestone is
   * dropped somewhere else. Without it the wedding day can't be dragged.
   */
  onWeddingDateChange?: (isoDate: string) => void;
  /** The earliest day the wedding can be dropped on (`YYYY-MM-DD`), normally today. */
  minWeddingDate?: string;
  /** `YYYY-MM-DD`: draws a dashed "Today" line at this day. */
  todayIso?: string;
};

/** `YYYY-MM-DD` of the calendar day Bryntum shows. Its dates are local midnights, built from our `YYYY-MM-DD` strings. */
export const localIsoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/**
 * The payment timeline. Payment dates come from the contracts via
 * lib/schedule.ts, so the chart never moves them itself: the only thing the
 * couple can drag is the "Wedding day" milestone, and dropping it just reports
 * the new day. The parent recomputes every date from it and hands back new data.
 * Browser only; load it through PaymentGantt, which skips server rendering.
 */
export function PaymentGanttChart({ data, onPaymentSelect, onWeddingDateChange, minWeddingDate, todayIso }: Props) {
  // The chart is configured once, so it reads the latest data and callback
  // through refs instead of being rebuilt on every update.
  const ganttRef = useRef<BryntumGantt>(null);
  const detailsRef = useRef(data.details);
  const cashRef = useRef(data.cashByMonth);
  const selectRef = useRef(onPaymentSelect);
  const weddingDropRef = useRef(onWeddingDateChange);
  const minDateRef = useRef(minWeddingDate);
  // The drag feature is switched on once, at creation, if the parent can handle a drop.
  const [canDragWedding] = useState(() => Boolean(onWeddingDateChange));
  useEffect(() => {
    selectRef.current = onPaymentSelect;
    weddingDropRef.current = onWeddingDateChange;
    minDateRef.current = minWeddingDate;
  }, [onPaymentSelect, onWeddingDateChange, minWeddingDate]);
  useEffect(() => {
    if (detailsRef.current === data.details) return;
    detailsRef.current = data.details;
    // BryntumGantt applies the new tasks in its own effect, which runs before
    // this one, so it repaints the Amount and Status cells while detailsRef
    // still holds the old details. Repaint once more now that they are current;
    // otherwise a paid payment keeps saying "Scheduled" until a page reload.
    ganttRef.current?.instance?.refreshRows();
  }, [data.details]);
  useEffect(() => {
    // The footer reads cash per month through a ref, so tell it to redraw when
    // the numbers change: a what-if preview, a payment, a reset.
    if (cashRef.current === data.cashByMonth) return;
    cashRef.current = data.cashByMonth;
    const summary = (ganttRef.current?.instance?.features as { summary?: SummaryFeature } | undefined)?.summary;
    summary?.refresh?.();
    summary?.updateTimelineSummaries?.();
  }, [data.cashByMonth]);
  useEffect(() => {
    // The wrapper applies new dependencies before new tasks, and replacing the
    // tasks removes every link to the old ones, which empties the dependency
    // store after a refresh (approve, pay, reset). Load the links again once the
    // tasks are in.
    const gantt = ganttRef.current?.instance;
    const links = gantt?.dependencyStore;
    if (links && links.count !== data.dependencies.length) {
      links.removeAll(true);
      links.add(data.dependencies);
    }
  }, [data.dependencies]);

  // Read once, when the chart opens, to choose where it scrolls to.
  const [openingWeddingIso] = useState(() => {
    const wedding = data.details[WEDDING_TASK_ID];
    return wedding?.kind === "wedding" ? wedding.isoDate : undefined;
  });
  useTodayLine(ganttRef, todayIso, openingWeddingIso);
  useVendorProgress(ganttRef, data.tasks);

  // The wrapper syncs new tasks into the existing records, and a field left out
  // keeps its old value. So every task states its baselines, empty when it has
  // no ghost, or the ghosts of a cancelled what-if would stay on screen.
  const tasks = useMemo(() => withExplicitBaselines(data.tasks), [data.tasks]);

  const config = useMemo((): BryntumGanttProps => {
    const detailOf = (record: TaskModel) => detailsRef.current[String(record.id)];

    const tooEarly = (date: Date) => Boolean(minDateRef.current && localIsoDay(date) < minDateRef.current);

    return {
      // Not read-only when the wedding day can move, so every other editing
      // feature is switched off below and only the wedding milestone drags.
      readOnly: !canDragWedding,
      cellEditFeature: false,
      cellMenuFeature: false,
      taskMenuFeature: false,
      scheduleMenuFeature: false,
      taskDragCreateFeature: false,
      taskResizeFeature: false,
      // Business/Enterprise features that are on by default. Payment dates come
      // from the contracts, so nothing may edit, paste or split a task, and the
      // project-end line would sit on top of the wedding day.
      taskEditFeature: false,
      taskCopyPasteFeature: false,
      taskSegmentDragFeature: false,
      taskSegmentResizeFeature: false,
      projectLinesFeature: false,
      criticalPathsFeature: false,
      // Every payment links to the wedding day, so the lines would bunch into
      // one stripe there. They stay hidden (gantt.css) and show only for the
      // milestone under the mouse.
      dependenciesFeature: { allowCreate: false, highlightDependenciesOnEventHover: true },
      // Vendor rows start collapsed so all of them fit; each payment still shows
      // as a diamond in its vendor's row, in its status colour. Clicking one
      // fires taskClick with the payment itself (handled below).
      rollupsFeature: {
        template: ({ children }: { children: TaskModel[] }) =>
          children
            .map((child) => renderTaskTooltip(detailOf(child), child.startDate ? localIsoDay(new Date(child.startDate)) : undefined))
            .join(""),
      },
      // What-if before/after: a task whose data carries `baselines` (only while
      // a preview is showing, see withBaseline in lib/timeline) gets a faded
      // ghost at its old date under it. Tasks without baselines draw nothing.
      baselinesFeature: {
        template: ({ baseline }: { baseline: { task: TaskModel } }) => renderBaselineTip(detailOf(baseline.task)),
      },
      taskDragFeature: {
        disabled: !canDragWedding,
        validatorFn: (_records: TaskModel[], startDate: Date) =>
          tooEarly(startDate) ? { valid: false, message: "The wedding can't move into the past" } : true,
        tooltipTemplate: ({ startDate, valid }: { startDate: Date; valid: boolean }) =>
          renderWeddingDragTip(detailsRef.current[WEDDING_TASK_ID], localIsoDay(startDate), valid),
      },
      onBeforeTaskDrag: ({ taskRecord }: { taskRecord: TaskModel }) => taskRecord.id === WEDDING_TASK_ID,
      onTaskDrop: ({ taskRecords }: { taskRecords: TaskModel[] }) => {
        const wedding = taskRecords.find((task) => task.id === WEDDING_TASK_ID);
        if (wedding?.startDate) weddingDropRef.current?.(localIsoDay(new Date(wedding.startDate)));
      },
      // Enterprise Summary footer: cash needed each month (unpaid payments only,
      // integer cents from lib/timeline), so the couple sees cash-flow peaks.
      // The busiest month is highlighted; it follows a what-if preview live.
      summaryFeature: {
        renderer: ({ startDate }: { startDate: Date }) => renderCashCell(cashRef.current, monthKey(startDate)),
      },
      // Narrow months, so today through the wedding fits without scrolling.
      viewPreset: { base: "monthAndYear", tickWidth: 64 },
      subGridConfigs: { locked: { width: 400 } },
      rowHeight: 36,
      barMargin: 8,
      columnLines: true,
      columns: [
        { type: "name", text: "Vendor / payment", width: 210, sum: "count", summaryRenderer: () => "Cash needed each month" },
        {
          text: "Amount",
          width: 84,
          align: "right",
          sortable: false,
          sum: "count",
          summaryRenderer: () => formatCents(totalCash(cashRef.current)),
          renderer: ({ record }: { record: TaskModel }) => {
            const detail = detailOf(record);
            return detail && detail.kind !== "wedding" ? detail.amountLabel : "";
          },
        },
        {
          text: "Status",
          width: 104,
          sortable: false,
          renderer: ({ record }: { record: TaskModel }) => {
            const detail = detailOf(record);
            if (detail?.kind === "vendor") return detail.progressLabel;
            return detail?.kind === "payment" ? detail.statusLabel : "";
          },
        },
      ],
      taskTooltipFeature: {
        template: ({ taskRecord }: { taskRecord: TaskModel }) =>
          renderTaskTooltip(detailOf(taskRecord), taskRecord.startDate ? localIsoDay(new Date(taskRecord.startDate)) : undefined),
      },
      onTaskClick: ({ taskRecord }: { taskRecord: TaskModel }) => {
        // A rollup click hands us the payment itself. A vendor with a single
        // payment is drawn as one diamond (its own summary), so it stands for
        // that payment.
        const only = taskRecord.children instanceof Array && taskRecord.children.length === 1 ? (taskRecord.children[0] as TaskModel) : undefined;
        const detail = detailOf(only ?? taskRecord);
        if (detail?.kind !== "payment") return;
        // Without a select handler, a payment opens the clause it comes from.
        if (selectRef.current) selectRef.current(detail);
        else if (detail.clauseId) window.location.assign(clauseHref(detail.vendorId, detail.clauseId));
      },
    };
  }, [canDragWedding]);

  return (
    <BryntumGantt
      ref={ganttRef}
      {...config}
      tasks={tasks}
      dependencies={data.dependencies}
      startDate={data.startDate}
      endDate={data.endDate}
    />
  );
}

type ProgressProject = {
  autoCalculatePercentDoneForParentTasks: boolean;
  taskStore: { getById(id: string): { percentDone: number } | undefined };
};

/**
 * Vendor bars fill by the share of the contract paid, by amount (lib/timeline).
 * Bryntum's engine would replace that with its own average over the payment
 * milestones, which have no duration and so always read 0%. A `project` config
 * can't sit beside inline tasks, so switch the engine's roll-up off once the
 * chart exists and put our numbers back, again whenever the data changes.
 */
function useVendorProgress(ganttRef: RefObject<BryntumGantt | null>, tasks: TimelineTask[]) {
  useEffect(() => {
    const project = ganttRef.current?.instance?.project as unknown as ProgressProject | undefined;
    if (!project) return;
    project.autoCalculatePercentDoneForParentTasks = false;
    for (const task of tasks) {
      const record = task.percentDone === undefined ? undefined : project.taskStore.getById(task.id);
      if (record && record.percentDone !== task.percentDone) record.percentDone = task.percentDone!;
    }
  }, [ganttRef, tasks]);
}

function withExplicitBaselines(tasks: TimelineTask[]): TimelineTask[] {
  return tasks.map((task) => ({
    ...task,
    baselines: task.baselines ?? [],
    ...(task.children ? { children: withExplicitBaselines(task.children) } : {}),
  }));
}

/** Days kept visible after the wedding day when the chart opens. */
const WEDDING_VIEW_MARGIN_DAYS = 21;

type SummaryFeature = { refresh?: () => void; updateTimelineSummaries?: () => void };

type Timeline = {
  foregroundCanvas?: HTMLElement;
  getCoordinateFromDate: (date: Date) => number;
  timeAxisSubGrid?: { element?: HTMLElement; scrollable?: { scrollTo: (x: number) => unknown } };
  ion: (listeners: Record<string, () => void>) => () => void;
};

/**
 * A dashed "Today" line, hand-made (it predates the move to the Enterprise
 * tier, whose TimeRanges feature could replace it), so the line lives in a canvas of our own beside Bryntum's canvases in the time
 * axis sub-grid (it scrolls with the timeline). Never put it inside Bryntum's
 * foreground canvas: Bryntum recycles that canvas's children as task elements.
 */
function useTodayLine(ganttRef: RefObject<BryntumGantt | null>, todayIso: string | undefined, weddingIso: string | undefined) {
  useEffect(() => {
    const gantt = ganttRef.current?.instance as unknown as Timeline | undefined;
    if (!gantt || !todayIso) return;
    const [y, m, d] = todayIso.split("-").map(Number);
    const today = new Date(y, m - 1, d); // Bryntum dates are local midnights
    const canvas = document.createElement("div");
    canvas.className = "vw-today-canvas";
    canvas.setAttribute("aria-hidden", "true");
    const line = document.createElement("div");
    line.className = "vw-today-line";
    canvas.appendChild(line);

    const place = () => {
      const subGrid = gantt.foregroundCanvas?.parentElement;
      if (!subGrid) return;
      if (canvas.parentElement !== subGrid) subGrid.appendChild(canvas);
      const x = gantt.getCoordinateFromDate(today);
      line.style.display = x >= 0 ? "" : "none";
      line.style.left = `${x}px`;
      canvas.style.height = "0"; // measure the rows without our own canvas in the way
      canvas.style.height = `${subGrid.scrollHeight}px`;
    };

    place();
    // Open on the part that matters: from a month before today onwards, but
    // never so far right that the wedding day (plus room to drag it) is cut
    // off. Set the timeline's own scroll; scrollToDate would also scroll the
    // page to the chart.
    const scroller = gantt.timeAxisSubGrid?.scrollable;
    let x = gantt.getCoordinateFromDate(new Date(y, m - 2, d));
    const viewport = gantt.timeAxisSubGrid?.element?.clientWidth ?? 0;
    if (weddingIso && viewport > 0) {
      const [wy, wm, wd] = weddingIso.split("-").map(Number);
      x = Math.min(x, gantt.getCoordinateFromDate(new Date(wy, wm - 1, wd + WEDDING_VIEW_MARGIN_DAYS)) - viewport);
    }
    void scroller?.scrollTo(Math.max(0, x));
    const detach = gantt.ion({ timeAxisChange: place, timelineViewportResize: place, renderRows: place, horizontalScroll: place });
    return () => {
      detach();
      canvas.remove();
    };
  }, [ganttRef, todayIso, weddingIso]);
}
