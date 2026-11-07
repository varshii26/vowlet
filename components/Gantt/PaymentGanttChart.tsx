"use client";

import { BryntumGantt, type BryntumGanttProps } from "@bryntum/gantt-react-community";
import type { TaskModel } from "@bryntum/gantt-community";
import { useEffect, useMemo, useRef } from "react";
import { renderTaskTooltip } from "@/components/Gantt/tooltip";
import type { TaskDetail, TimelineData } from "@/lib/timeline";

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
};

/**
 * The payment timeline. Read-only: payment dates come from the contracts via
 * lib/schedule.ts, so the chart never moves them itself. Browser only; load it
 * through PaymentGantt, which skips server rendering.
 */
export function PaymentGanttChart({ data, onPaymentSelect }: Props) {
  // The chart is configured once, so it reads the latest data and callback
  // through refs instead of being rebuilt on every update.
  const ganttRef = useRef<BryntumGantt>(null);
  const detailsRef = useRef(data.details);
  const selectRef = useRef(onPaymentSelect);
  useEffect(() => {
    selectRef.current = onPaymentSelect;
  }, [onPaymentSelect]);
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

    return {
      readOnly: true,
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
  }, []);

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
