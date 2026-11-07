"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { PaymentGanttChart as PaymentGanttChartType } from "@/components/Gantt/PaymentGanttChart";

// Bryntum needs the DOM, so it is never rendered on the server.
const PaymentGanttChart = dynamic(
  () => import("@/components/Gantt/PaymentGanttChart").then((module) => module.PaymentGanttChart),
  {
    ssr: false,
    loading: () => <p className="p-6 text-sm text-neutral-500">Loading timeline...</p>,
  },
);

type Props = ComponentProps<typeof PaymentGanttChartType>;

/** The payment timeline, sized to fill its container's width. */
export function PaymentGantt(props: Props) {
  return (
    <div className="h-[680px] w-full overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <PaymentGanttChart {...props} />
    </div>
  );
}
