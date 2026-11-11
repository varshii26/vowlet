import { DEADLINE_ICON, DEADLINE_LEGEND } from "@/components/Gantt/deadline-icons";
import type { DeadlineKind } from "@/lib/deadlines";
import type { DisplayStatus } from "@/lib/schedule";
import { STATUS_HEX, STATUS_LABEL } from "@/lib/timeline";

/** The statuses the legend always explains: the ones every schedule shows, in the order a payment moves through them. */
export const LEGEND_STATUSES: DisplayStatus[] = ["scheduled", "due_soon", "overdue", "paid"];

/** Rarer statuses, listed only while some payment on the chart has one. Void is left out: it is rare and grey. */
const OCCASIONAL_STATUSES: DisplayStatus[] = ["refund_requested", "refunded"];

/** A diamond in the status colour, the same one the chart's diamonds use. */
function Diamond({ status }: { status: DisplayStatus }) {
  return <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rotate-45 rounded-[1px]" style={{ background: STATUS_HEX[status] }} />;
}

// The deadline icons are Font Awesome glyphs, like on the chart. The chart imports
// the font with Bryntum, but the legend renders first, so load it here too (shared, so it's one copy).
import "@bryntum/core-enterprise/fontawesome/css/fontawesome.css";
import "@bryntum/core-enterprise/fontawesome/css/solid.css";

const DEADLINE_COLOR: Record<DeadlineKind, string> = {
  date_change: "var(--vw-deadline-date-change)",
  cancellation: "var(--vw-deadline-cancellation)",
};

type Props = {
  /** Statuses some payment on the chart has; a rarer one (refund requested, refunded) is listed only when present. */
  present?: Iterable<DisplayStatus>;
  /** Explain the deadline icons too, while they are on the chart. */
  showDeadlines?: boolean;
};

/** A one-line key for the Gantt: the payment colours, the wedding and Today lines, and the deadline icons when they show. */
export function StatusLegend({ present = [], showDeadlines = false }: Props) {
  const shown = new Set(present);
  const statuses = [...LEGEND_STATUSES, ...OCCASIONAL_STATUSES.filter((status) => shown.has(status))];
  return (
    <ul aria-label="Timeline colours" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      {statuses.map((status) => (
        <li key={status} className="flex items-center gap-1.5">
          <Diamond status={status} />
          {STATUS_LABEL[status]}
        </li>
      ))}
      <li className="flex items-center gap-1.5" title="The wedding day: the solid pink line on the timeline. Drag its diamond to try another date.">
        <span aria-hidden="true" className="inline-block h-3 w-0 border-l-2 border-pink-600/60" />
        Wedding day
      </li>
      <li className="flex items-center gap-1.5" title="Today: the dashed line on the timeline.">
        <span aria-hidden="true" className="inline-block h-3 w-0 border-l-2 border-dashed border-accent/70" />
        Today
      </li>
      {showDeadlines &&
        (Object.keys(DEADLINE_LEGEND) as DeadlineKind[]).map((kind) => (
          <li key={kind} className="flex items-center gap-1.5" title={DEADLINE_LEGEND[kind].title}>
            <i aria-hidden="true" className={`${DEADLINE_ICON[kind]} text-[0.7rem]`} style={{ color: DEADLINE_COLOR[kind] }} />
            {DEADLINE_LEGEND[kind].label}
          </li>
        ))}
    </ul>
  );
}
