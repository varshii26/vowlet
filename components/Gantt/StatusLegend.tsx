import type { CSSProperties } from "react";
import { DEADLINE_ICON, DEADLINE_LEGEND } from "@/components/Gantt/deadline-icons";
import type { DeadlineKind } from "@/lib/deadlines";
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

// The deadline icons are Font Awesome glyphs, like on the chart. The chart imports
// the font with Bryntum, but the legend renders first, so load it here too (shared, so it's one copy).
import "@bryntum/core-enterprise/fontawesome/css/fontawesome.css";
import "@bryntum/core-enterprise/fontawesome/css/solid.css";

const DEADLINE_COLOR: Record<DeadlineKind, string> = {
  date_change: "var(--vw-deadline-date-change)",
  cancellation: "var(--vw-deadline-cancellation)",
};

/** A one-line key for the Gantt: a diamond per payment status, the wedding day, the vendor bar, the deadline icons and the Today line. */
export function StatusLegend() {
  return (
    <ul aria-label="Timeline colours" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
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
      <li className="flex items-center gap-1.5" title="The green part of a vendor's bar is the share of its contract already paid.">
        <span aria-hidden="true" className="relative inline-block h-1.5 w-6 overflow-hidden rounded-full bg-line">
          <span className="absolute inset-y-0 left-0 w-2/3" style={swatch("green")} />
        </span>
        Share paid
      </li>
      {(Object.keys(DEADLINE_LEGEND) as DeadlineKind[]).map((kind) => (
        <li key={kind} className="flex items-center gap-1.5" title={DEADLINE_LEGEND[kind].title}>
          <i aria-hidden="true" className={`${DEADLINE_ICON[kind]} text-[0.7rem]`} style={{ color: DEADLINE_COLOR[kind] }} />
          {DEADLINE_LEGEND[kind].label}
        </li>
      ))}
      <li className="flex items-center gap-1.5" title="Today: the dashed line on the timeline.">
        <span aria-hidden="true" className="inline-block h-3 w-0 border-l-2 border-dashed border-accent/70" />
        Today
      </li>
    </ul>
  );
}
