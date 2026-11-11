"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { PaymentGanttChart as PaymentGanttChartType } from "@/components/Gantt/PaymentGanttChart";

/** Placeholder rows while Bryntum loads, shaped like the chart. */
export function GanttSkeleton() {
  return (
    <div role="status" aria-label="Loading the payment timeline" className="flex h-full">
      <div className="w-[30rem] shrink-0 space-y-4 border-r border-line p-4">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className={`skeleton h-4 ${i % 3 === 0 ? "w-2/3" : "ml-6 w-1/2"}`} />
        ))}
      </div>
      <div className="flex-1 space-y-4 p-4">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="skeleton size-4 rotate-45" style={{ marginLeft: `${(i * 37) % 70}%` }} />
        ))}
      </div>
    </div>
  );
}

// Bryntum needs the DOM, so it is never rendered on the server.
const PaymentGanttChart = dynamic(
  () => import("@/components/Gantt/PaymentGanttChart").then((module) => module.PaymentGanttChart),
  { ssr: false, loading: () => <GanttSkeleton /> },
);

type Props = ComponentProps<typeof PaymentGanttChartType> & {
  /** Size of the chart box. Defaults to a fixed height. */
  className?: string;
};

/** The payment timeline, sized to fill its container's width. */
export function PaymentGantt({ className = "h-[680px]", ...props }: Props) {
  return (
    <div className={`vw-gantt w-full overflow-hidden rounded-card border border-line bg-surface shadow-card ${className}`}>
      <PaymentGanttChart {...props} />
    </div>
  );
}
