"use client";

import { BryntumGantt, type BryntumGanttProps } from "@bryntum/gantt-react-enterprise";
import type { TaskModel } from "@bryntum/gantt-enterprise";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { DEADLINE_ICON } from "@/components/Gantt/deadline-icons";
import { amountLabelFor, rollupLabels } from "@/components/Gantt/labels";
import { PRINT_OPTIONS, renderPrintFooter, renderPrintHeader } from "@/components/Gantt/print";
import { monthKey, renderCashCell, totalCash } from "@/components/Gantt/summary";
import { escapeHtml, renderBaselineTip, renderDeadlineTip, renderTaskTooltip, renderWeddingDragTip } from "@/components/Gantt/tooltip";
import type { Deadline, DeadlineKind } from "@/lib/deadlines";
import { formatCents } from "@/lib/money";
import { WEDDING_TASK_ID, type TaskDetail, type TimelineData, type TimelineTask } from "@/lib/timeline";
import { clauseHref } from "@/lib/vendors/links";

// TimeRanges is a Scheduler feature: it registers with Gantt only once its module is loaded.
import "@bryntum/scheduler-enterprise/lib/Scheduler/feature/TimeRanges.js";
// Likewise CellTooltip, a Grid feature (the vendor name column's hover tooltip).
import "@bryntum/grid-enterprise/lib/Grid/feature/CellTooltip.js";
import { DIM_CLS, type TimelineRange } from "@/lib/timeline-focus";

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
  /** Called once the chart exists with a function that prints the schedule (and with null when it goes). */
  onPrintReady?: (print: (() => Promise<void>) | null) => void;
  /** The couple's names, for the printed page header. */
  coupleNames?: string;
  /** Spans to shade (Enterprise TimeRanges), e.g. "Due in the next 30 days" from an agent answer. */
  timeRanges?: TimelineRange[];
  /** A row to scroll into view when it changes, e.g. the vendor an agent answer is about. */
  focusTaskId?: string | null;
  /**
   * Draw each vendor's contract deadlines (date-change and cancellation cutoffs)
   * in its row. Off by default: they matter while deciding to move the date.
   */
  showDeadlines?: boolean;
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
export function PaymentGanttChart({
  data,
  onPaymentSelect,
  onWeddingDateChange,
  minWeddingDate,
  todayIso,
  onPrintReady,
  coupleNames,
  timeRanges = NO_RANGES,
  focusTaskId = null,
  showDeadlines = false,
}: Props) {
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
  // The config is built once; later changes go through useDeadlines.
  const [showDeadlinesAtStart] = useState(showDeadlines);
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

  const weddingDetail = data.details[WEDDING_TASK_ID];
  const weddingIso = weddingDetail?.kind === "wedding" ? weddingDetail.isoDate : undefined;
  useMarkerLines(ganttRef, todayIso, weddingIso);
  useDeadlines(ganttRef, showDeadlines);
  useDeadlineClicks(ganttRef);
  usePrint(ganttRef, onPrintReady);
  useScrollToFocus(ganttRef, focusTaskId);
  const printHeaderRef = useRef({ coupleNames: coupleNames ?? "", todayIso: todayIso ?? "" });
  useEffect(() => {
    printHeaderRef.current = { coupleNames: coupleNames ?? "", todayIso: todayIso ?? "" };
  }, [coupleNames, todayIso]);

  // The wrapper syncs new tasks into the existing records, and a field left out
  // keeps its old value. So every task states its baselines, empty when it has
  // no ghost, or the ghosts of a cancelled what-if would stay on screen.
  const tasks = useMemo(() => withExplicitBaselines(data.tasks), [data.tasks]);

  const config = useMemo((): BryntumGanttProps => {
    // Ctrl+wheel and double-click zoom would drift to quarters or weeks, where
    // payments bunch up; the chart stays on months, fitted to the space (useMarkerLines).

    const detailOf = (record: TaskModel) => detailsRef.current[String(record.id)];

    const tooEarly = (date: Date) => Boolean(minDateRef.current && localIsoDay(date) < minDateRef.current);

    return {
      // Not read-only when the wedding day can move, so every other editing
      // feature is switched off below and only the wedding milestone drags.
      readOnly: !canDragWedding,
      zoomOnMouseWheel: false,
      zoomOnTimeAxisDoubleClick: false,
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
      // Amount labels (Labels feature), so the timeline reads as a cash plan
      // without hovering; only money still to pay is labelled. A payment row,
      // or a single-payment vendor (one diamond), gets its amount right of the
      // diamond. A collapsed vendor bar's right label holds one amount beside
      // each unpaid rollup diamond, placed by date (see labels.ts). Right labels take no row height, so diamonds keep
      // their size, and they sit outside the bar, whose bracket shape clips.
      labelsFeature: {
        right: {
          renderer: ({ taskRecord, domConfig }: { taskRecord: TaskModel; domConfig: LabelDomConfig }) => {
            const single = onlyPayment(taskRecord);
            const children = taskRecord.children instanceof Array ? (taskRecord.children as TaskModel[]) : [];
            if (single || children.length === 0) return amountLabelFor(detailOf(single ?? taskRecord));
            const gantt = ganttRef.current?.instance as unknown as Timeline | undefined;
            if (!gantt || !taskRecord.startDate) return "";
            const start = gantt.getCoordinateFromDate(new Date(taskRecord.startDate));
            const labels = rollupLabels(
              children.map((child) => ({
                detail: detailOf(child),
                x: child.startDate ? gantt.getCoordinateFromDate(new Date(child.startDate)) - start : 0,
              })),
            );
            // Keep Bryntum's own label element and fill it with amounts. They
            // are positioned against the row's task wrapper, which starts where
            // the vendor bar starts, so each offset is measured from there.
            domConfig.children = labels.map((label) => ({
              tag: "span",
              className: `vw-rollup-amount vw-amount-${label.status}`,
              style: { insetInlineStart: `${label.x}px` },
              text: label.text,
            }));
            return undefined;
          },
        },
      },
      // Contract deadlines in each vendor's row (Enterprise Indicators): the
      // last day to change the date, and to cancel, at the current tier
      // (lib/deadlines.ts, computed in code from the extracted terms). They
      // move with the wedding during a what-if. Bryntum's own scheduling
      // indicators (early/late dates, constraints) mean nothing here.
      indicatorsFeature: {
        disabled: !showDeadlinesAtStart,
        items: {
          earlyDates: false,
          lateDates: false,
          constraintDate: false,
          deadlineDate: false,
          dateChange: (taskRecord: TaskModel) => deadlineIndicator(detailOf(taskRecord), "date_change", isDimmed(taskRecord)),
          cancellation: (taskRecord: TaskModel) => deadlineIndicator(detailOf(taskRecord), "cancellation", isDimmed(taskRecord)),
        },
        tooltipTemplate: ({ indicator }: { indicator: DeadlineIndicator }) => indicator.tipHtml ?? "",
      },
      // Shaded spans from an agent answer ("what do we owe in the next 30
      // days?"). The today and wedding lines are our own (see useMarkerLines).
      // The banner above the chart names the span, so no header label.
      timeRangesFeature: { showCurrentTimeLine: false, showHeaderElements: false },
      // Print the schedule through the browser's print dialog (Enterprise
      // Print feature; see print.ts and usePrint below).
      printFeature: {
        headerTpl: () => {
          const wedding = detailsRef.current[WEDDING_TASK_ID];
          const { coupleNames: names, todayIso: asOf } = printHeaderRef.current;
          return renderPrintHeader(names, wedding?.kind === "wedding" ? wedding.isoDate : "", asOf);
        },
        footerTpl: ({ currentPage, totalPages }: { currentPage: number; totalPages: number }) => renderPrintFooter(currentPage, totalPages),
      },
      // Enables the name column's tooltip above (it has no effect without this feature).
      cellTooltipFeature: true,
      // Months, widened to fill the chart (useMarkerLines fits them to the space).
      viewPreset: { base: "monthAndYear", tickWidth: 64 },
      // One narrow column: the vendor's name with what's paid under it. The
      // timeline gets the width; amounts are on the diamonds themselves.
      subGridConfigs: { locked: { width: 248 } },
      rowHeight: 42,
      barMargin: 10,
      columnLines: true,
      columns: [
        {
          type: "name",
          text: "Vendor",
          flex: 1,
          sum: "count",
          summaryRenderer: () =>
            `<span class="vw-name-main">Cash needed each month</span><span class="vw-name-sub">${escapeHtml(formatCents(totalCash(cashRef.current)))} still to pay</span>`,
          renderer: ({ record }: { record: TaskModel }) => nameCell(String(record.name), subLineFor(detailOf(record))),
          // A long vendor name is cut off by the column ("Starlight Lighting & De…"):
          // hovering it shows the whole name. Only when it really is cut off.
          tooltipRenderer: ({ cellElement, record }: { cellElement: HTMLElement; record: TaskModel }) => {
            const value = cellElement.querySelector<HTMLElement>(".vw-name-main");
            return value && value.scrollWidth > value.clientWidth ? escapeHtml(String(record.name)) : undefined;
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
        const detail = detailOf(onlyPayment(taskRecord) ?? taskRecord);
        if (detail?.kind !== "payment") return;
        // Without a select handler, a payment opens the clause it comes from.
        if (selectRef.current) selectRef.current(detail);
        else if (detail.clauseId) window.location.assign(clauseHref(detail.vendorId, detail.clauseId));
      },
    };
  }, [canDragWedding, showDeadlinesAtStart]);

  return (
    <BryntumGantt
      ref={ganttRef}
      {...config}
      tasks={tasks}
      dependencies={data.dependencies}
      timeRanges={timeRanges}
      startDate={data.startDate}
      endDate={data.endDate}
    />
  );
}

type DeadlineIndicator = {
  startDate: Date;
  name: string;
  iconCls: string;
  cls: string;
  /** Our own tooltip, escaped (tooltip.ts). */
  tipHtml: string;
  /** Where clicking the indicator goes: the clause the terms come from. */
  href: string | null;
};

/**
 * Clicking a deadline indicator opens the contract clause its terms come from.
 * Bryntum keeps the indicator object on its element as `elementData`.
 */
function useDeadlineClicks(ganttRef: RefObject<BryntumGantt | null>) {
  useEffect(() => {
    const element = (ganttRef.current?.instance as unknown as { element?: HTMLElement } | undefined)?.element;
    if (!element) return;
    const onClick = (event: MouseEvent) => {
      const indicator = (event.target as Element | null)?.closest?.(".b-indicator.vw-deadline") as (Element & { elementData?: DeadlineIndicator }) | null;
      if (indicator?.elementData?.href) window.location.assign(indicator.elementData.href);
    };
    element.addEventListener("click", onClick);
    return () => element.removeEventListener("click", onClick);
  }, [ganttRef]);
}

/** The indicator for a vendor's next deadline of one kind, or null when it has none. */
/** A row the agent's focus steps back (lib/timeline-focus.ts). */
const isDimmed = (task: TaskModel) => String(task.cls ?? "").split(/\s+/).includes(DIM_CLS);

function deadlineIndicator(detail: TaskDetail | undefined, kind: DeadlineKind, dimmed = false): DeadlineIndicator | null {
  if (detail?.kind !== "vendor") return null;
  const deadline: Deadline | undefined = detail.deadlines?.find((d) => d.kind === kind);
  if (!deadline) return null;
  const [y, m, d] = deadline.isoDate.split("-").map(Number);
  return {
    startDate: new Date(y, m - 1, d), // Bryntum dates are local midnights
    name: deadline.title,
    iconCls: DEADLINE_ICON[kind],
    cls: `vw-deadline vw-deadline-${kind}${dimmed ? ` ${DIM_CLS}` : ""}`,
    tipHtml: renderDeadlineTip(deadline, detail.title),
    href: deadline.clauseId ? clauseHref(detail.vendorId, deadline.clauseId) : null,
  };
}

const NO_RANGES: TimelineRange[] = [];

/**
 * Selects and scrolls the row an agent answer is about into view, once per new focus. The
 * timeline's own scrollers only, so the page doesn't jump to the chart.
 */
function useScrollToFocus(ganttRef: RefObject<BryntumGantt | null>, taskId: string | null) {
  useEffect(() => {
    const gantt = ganttRef.current?.instance as unknown as
      | {
          taskStore: { getById(id: string): unknown };
          scrollRowIntoView(record: unknown, options: object): Promise<unknown>;
          selectRow(options: { record: unknown; scrollIntoView: boolean }): void;
        }
      | undefined;
    if (!gantt || !taskId) return;
    // Wait a frame: a vendor the answer opens is expanded by this same render.
    const frame = requestAnimationFrame(() => {
      const record = gantt.taskStore.getById(taskId);
      if (!record) return;
      // Selecting the row is what highlights it in the grid (the theme's rose selection).
      gantt.selectRow({ record, scrollIntoView: false });
      void gantt.scrollRowIntoView(record, { block: "center", animate: 300 }).catch(() => {});
    });
    return () => cancelAnimationFrame(frame);
  }, [ganttRef, taskId]);
}

type PrintableGantt = {
  features: { print?: { print(config: object): Promise<unknown> } };
  taskStore: { rootNode: { children?: { id: string | number; isExpanded(store: unknown): boolean }[] } };
  expandAll(): Promise<unknown>;
  collapse(id: string | number): Promise<unknown>;
};

/**
 * Hands the parent a print function. Every vendor is expanded for the printout,
 * so each payment gets its own line with its amount and status, and the rows
 * the couple had collapsed are collapsed again afterwards.
 */
function usePrint(ganttRef: RefObject<BryntumGantt | null>, onPrintReady: Props["onPrintReady"]) {
  const readyRef = useRef(onPrintReady);
  useEffect(() => {
    readyRef.current = onPrintReady;
  }, [onPrintReady]);
  useEffect(() => {
    const gantt = ganttRef.current?.instance as unknown as PrintableGantt | undefined;
    if (!gantt?.features.print) return;
    const print = async () => {
      const store = gantt.taskStore;
      const collapsed = (store.rootNode.children ?? []).filter((row) => !row.isExpanded(store)).map((row) => row.id);
      await gantt.expandAll();
      try {
        await gantt.features.print!.print(PRINT_OPTIONS);
      } finally {
        await Promise.all(collapsed.map((id) => gantt.collapse(id)));
      }
    };
    readyRef.current?.(print);
    return () => readyRef.current?.(null);
  }, [ganttRef]);
}

/** A vendor with a single payment is drawn as one diamond that stands for that payment. */
function onlyPayment(task: TaskModel): TaskModel | undefined {
  return task.children instanceof Array && task.children.length === 1 ? (task.children[0] as TaskModel) : undefined;
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
/** Days kept visible before today when the chart opens. */
const PAST_VIEW_DAYS = 30;
/** Months never get narrower than this, or the amount labels collide. */
const MIN_MONTH_WIDTH = 56;
const DAY_MS = 86_400_000;

/**
 * Grid cell: the row's name, with a smaller line under it (what's paid, or a
 * payment's amount and status). A DomConfig, so Bryntum sets both as text.
 */
function nameCell(name: string, sub: string) {
  const main = { tag: "span", className: "vw-name-main", text: name };
  return { children: sub ? [main, { tag: "span", className: "vw-name-sub", text: sub }] : [main] };
}

export function subLineFor(detail: TaskDetail | undefined): string {
  if (detail?.kind === "vendor") return detail.progressLabel;
  if (detail?.kind === "payment") return `${detail.amountLabel} · ${detail.statusLabel}`;
  if (detail?.kind === "wedding") return "Drag it to try another date";
  return "";
}

/** Contract deadlines show only when asked for (the toggle, or a what-if preview). */
function useDeadlines(ganttRef: RefObject<BryntumGantt | null>, show: boolean) {
  useEffect(() => {
    const gantt = ganttRef.current?.instance;
    const indicators = (gantt?.features as { indicators?: { disabled: boolean } } | undefined)?.indicators;
    if (!gantt || !indicators || indicators.disabled === !show) return;
    // Bryntum's features are the chart's own mutable state, not React's.
    Object.assign(indicators, { disabled: !show });
    // Switching the feature doesn't repaint the rows already drawn.
    gantt.refreshRows();
  }, [ganttRef, show]);
}

type LabelDomConfig = { children?: object[] };

type SummaryFeature = { refresh?: () => void; updateTimelineSummaries?: () => void };

type Timeline = {
  foregroundCanvas?: HTMLElement;
  getCoordinateFromDate: (date: Date) => number;
  tickSize: number;
  timeAxisSubGrid?: { element?: HTMLElement; scrollable?: { scrollTo: (x: number) => unknown } };
  ion: (listeners: Record<string, () => void>) => () => void;
};

const localDay = (iso: string, plusDays = 0) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d + plusDays); // Bryntum dates are local midnights
};

const shortDay = (iso: string) => localDay(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * Two full-height lines across the chart: a dashed "Today" and a solid
 * "Wedding" line, so every payment reads against both. Hand-made, in a canvas
 * of our own beside Bryntum's canvases in the time axis sub-grid (it scrolls
 * with the timeline). Never put it inside Bryntum's foreground canvas: Bryntum
 * recycles that canvas's children as task elements. The wedding line follows a
 * what-if preview.
 *
 * When the chart opens (and when its width changes), the months are widened so
 * a month before today through just after the wedding fills the timeline, and
 * it scrolls there.
 */
function useMarkerLines(ganttRef: RefObject<BryntumGantt | null>, todayIso: string | undefined, weddingIso: string | undefined) {
  const weddingRef = useRef(weddingIso);
  const placeRef = useRef<(() => void) | null>(null);
  // The first wedding date decides the opening view; a preview doesn't refit it.
  const [openingWeddingIso] = useState(weddingIso);

  useEffect(() => {
    weddingRef.current = weddingIso;
    placeRef.current?.();
  }, [weddingIso]);

  useEffect(() => {
    const gantt = ganttRef.current?.instance as unknown as Timeline | undefined;
    if (!gantt || !todayIso) return;
    const today = localDay(todayIso);
    const canvas = document.createElement("div");
    canvas.className = "vw-today-canvas";
    canvas.setAttribute("aria-hidden", "true");
    const todayLine = document.createElement("div");
    todayLine.className = "vw-today-line";
    const weddingLine = document.createElement("div");
    weddingLine.className = "vw-wedding-line";
    canvas.append(todayLine, weddingLine);

    const position = (line: HTMLElement, date: Date) => {
      const x = gantt.getCoordinateFromDate(date);
      line.style.display = x >= 0 ? "" : "none";
      line.style.left = `${x}px`;
    };
    const place = () => {
      const subGrid = gantt.foregroundCanvas?.parentElement;
      if (!subGrid) return;
      if (canvas.parentElement !== subGrid) subGrid.appendChild(canvas);
      position(todayLine, today);
      const wedding = weddingRef.current;
      if (wedding) {
        weddingLine.dataset.label = `Wedding · ${shortDay(wedding)}`;
        position(weddingLine, localDay(wedding));
      } else weddingLine.style.display = "none";
      canvas.style.height = "0"; // measure the rows without our own canvas in the way
      canvas.style.height = `${subGrid.scrollHeight}px`;
    };
    placeRef.current = place;

    // Fit a month before today through just after the wedding into the
    // timeline's width. Set the timeline's own scroll; scrollToDate would also
    // scroll the page to the chart.
    let fittedWidth = 0;
    const fit = () => {
      const viewport = gantt.timeAxisSubGrid?.element?.clientWidth ?? 0;
      if (viewport <= 0 || Math.abs(viewport - fittedWidth) < 8) return;
      fittedWidth = viewport;
      // From the first of the month PAST_VIEW_DAYS back, so the view starts on a whole month.
      const back = localDay(todayIso, -PAST_VIEW_DAYS);
      const from = new Date(back.getFullYear(), back.getMonth(), 1);
      const to = openingWeddingIso ? localDay(openingWeddingIso, WEDDING_VIEW_MARGIN_DAYS) : localDay(todayIso, 240);
      const months = Math.max(1, (to.getTime() - from.getTime()) / DAY_MS / 30.44);
      const tick = Math.max(MIN_MONTH_WIDTH, Math.floor(viewport / months));
      if (gantt.tickSize !== tick) Object.assign(gantt, { tickSize: tick }); // Bryntum's own state, not React's
      void gantt.timeAxisSubGrid?.scrollable?.scrollTo(Math.max(0, gantt.getCoordinateFromDate(from)));
      place();
    };

    fit();
    place();
    const detach = gantt.ion({
      timeAxisChange: place,
      timelineViewportResize: () => {
        fit();
        place();
      },
      renderRows: place,
      horizontalScroll: place,
    });
    return () => {
      detach();
      placeRef.current = null;
      canvas.remove();
    };
  }, [ganttRef, todayIso, openingWeddingIso]);
}
