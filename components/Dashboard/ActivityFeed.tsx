import { LocalTime } from "@/components/Dashboard/LocalTime";
import type { ActivityItem, ActivityTone } from "@/lib/activity";

const DOT: Record<ActivityTone, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  neutral: "bg-neutral-300",
};

/**
 * What has happened lately: payments, proposals made and resolved, uploads,
 * resets, and payment problems PayPal reported. A server component, so it
 * re-renders from the database whenever the page refreshes after an action.
 */
export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <section aria-labelledby="activity-heading" className="space-y-3">
      <h2 id="activity-heading" className="text-lg font-semibold">
        Recent activity
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing has happened yet.</p>
      ) : (
        <ol className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 px-4 py-2.5 text-sm" data-tone={item.tone}>
              <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[item.tone]}`} />
              <span className={`min-w-0 flex-1 ${item.tone === "warning" ? "text-amber-800" : "text-neutral-800"}`}>
                {item.tone === "warning" ? <span className="sr-only">Needs checking: </span> : null}
                {item.message}
              </span>
              <LocalTime iso={item.at} className="shrink-0 text-xs text-neutral-500 tabular-nums" />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
