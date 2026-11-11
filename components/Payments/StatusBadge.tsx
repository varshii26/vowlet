import type { DisplayStatus } from "@/lib/schedule";

/** Badge colours per status. Keep in step with STATUS_COLOR (lib/timeline.ts) and gantt.css. */
export const STATUS_BADGE: Record<DisplayStatus, string> = {
  overdue: "bg-red-100 text-red-800",
  due_soon: "bg-amber-100 text-amber-900",
  scheduled: "bg-sky-100 text-sky-900",
  paid: "bg-emerald-100 text-emerald-800",
  refund_requested: "bg-purple-100 text-purple-800",
  refunded: "bg-teal-100 text-teal-800",
  void: "bg-stone-100 text-stone-600",
};

export function StatusBadge({ status, label }: { status: DisplayStatus; label: string }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[status]}`}>{label}</span>;
}
