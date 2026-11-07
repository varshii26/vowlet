"use client";

import { BryntumGantt, type BryntumGanttProps } from "@bryntum/gantt-react-community";
import type { TaskModel } from "@bryntum/gantt-community";
import { useEffect, useMemo, useRef, useState } from "react";
import { renderTaskTooltip, renderWeddingDragTip } from "@/components/Gantt/tooltip";
import { WEDDING_TASK_ID, type TaskDetail, type TimelineData } from "@/lib/timeline";

import "@bryntum/core-community/fontawesome/css/fontawesome.css";
import "@bryntum/core-community/fontawesome/css/solid.css";
import "@bryntum/gantt-community/gantt.css";
import "@bryntum/gantt-community/svalbard-light.css";
import "@/components/Gantt/gantt.css";

export type PaymentSelection = Extract<TaskDetail, { kind: "payment" }>;

type Props = {
  data: TimelineData;
  /** Called when a payment milestone is clicked. */
  onPaymentSelect?: (payment: PaymentSelection) => void;
  /**
   * Called with the new day (`YYYY-MM-DD`) when the "Wedding day" milestone is
   * dropped somewhere else. Without it the wedding day can't be dragged.
   */
  onWeddingDateChange?: (isoDate: string) => void;
  /** The earliest day the wedding can be dropped on (`YYYY-MM-DD`), normally today. */
  minWeddingDate?: string;
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
export function PaymentGanttChart({ data, onPaymentSelect, onWeddingDateChange, minWeddingDate }: Props) {
  // The chart is configured once, so it reads the latest data and callback
  // through refs instead of being rebuilt on every update.
  const ganttRef = useRef<BryntumGantt>(null);
  const detailsRef = useRef(data.details);
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
      dependenciesFeature: { allowCreate: false },
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
      viewPreset: "monthAndYear",
      rowHeight: 40,
      barMargin: 8,
      columnLines: true,
      columns: [
        { type: "name", text: "Vendor / payment", width: 280 },
        {
          text: "Amount",
          width: 100,
          align: "right",
          sortable: false,
          renderer: ({ record }: { record: TaskModel }) => {
            const detail = detailOf(record);
            return detail && detail.kind !== "wedding" ? detail.amountLabel : "";
          },
        },
        {
          text: "Status",
          width: 130,
          sortable: false,
          renderer: ({ record }: { record: TaskModel }) => {
            const detail = detailOf(record);
            return detail?.kind === "payment" ? detail.statusLabel : "";
          },
        },
      ],
      taskTooltipFeature: {
        template: ({ taskRecord }: { taskRecord: TaskModel }) => renderTaskTooltip(detailOf(taskRecord)),
      },
      onTaskClick: ({ taskRecord }: { taskRecord: TaskModel }) => {
        const detail = detailOf(taskRecord);
        if (detail?.kind === "payment") selectRef.current?.(detail);
      },
    };
  }, [canDragWedding]);

  return (
    <BryntumGantt
      ref={ganttRef}
      {...config}
      tasks={data.tasks}
      dependencies={data.dependencies}
      startDate={data.startDate}
      endDate={data.endDate}
    />
  );
}
