import type { CSSProperties } from "react";
import type { DisplayStatus } from "@/lib/schedule";
import { STATUS_COLOR, STATUS_LABEL } from "@/lib/timeline";

/** The statuses the legend explains, in the order a payment moves through them. Void is left out: it is rare and grey. */
export const LEGEND_STATUSES: DisplayStatus[] = ["scheduled", "due_soon", "overdue", "paid", "refund_requested", "refunded"];

/**
 * Bryntum paints a milestone in its named colour mixed 60% with white, so the
 * swatches use the same mix of the same theme variables and always match.
 */
const swatch = (bryntumColor: string): CSSProperties => ({
  background: `color-mix(in srgb, var(--b-color-${bryntumColor}) 60%, white)`,
});

function Diamond({ color }: { color: string }) {
  return <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rotate-45 rounded-[1px]" style={swatch(color)} />;
}

/** A one-line key for the Gantt's colours: one diamond per payment status, plus the wedding day. */
export function StatusLegend() {
  return (
    <ul aria-label="Timeline colours" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {LEGEND_STATUSES.map((status) => (
        <li key={status} className="flex items-center gap-1.5">
          <Diamond color={STATUS_COLOR[status]} />
          {STATUS_LABEL[status]}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <Diamond color="pink" />
        Wedding day
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="relative inline-block h-1.5 w-6 overflow-hidden rounded-full bg-line">
          <span className="absolute inset-y-0 left-0 w-2/3" style={swatch("green")} />
        </span>
        Vendor bar: share paid
      </li>
    </ul>
  );
}
