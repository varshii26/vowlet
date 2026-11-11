"use client";

import type { DisplayStatus } from "@/lib/schedule";
import type { VendorPageData, ViewerClause } from "@/lib/vendors/page-data";

const BADGE: Record<DisplayStatus, string> = {
  overdue: "bg-red-100 text-red-800",
  due_soon: "bg-amber-100 text-amber-800",
  scheduled: "bg-slate-100 text-slate-700",
  paid: "bg-green-100 text-green-800",
  refund_requested: "bg-purple-100 text-purple-800",
  refunded: "bg-teal-100 text-teal-800",
  void: "bg-stone-100 text-stone-600",
};

type Props = {
  data: Pick<VendorPageData, "payments" | "cancellation" | "dateChange" | "clauses">;
  selectedClauseId: string | null;
  onSelect: (clauseId: string) => void;
};

type SourceProps = { what: string; clause: ViewerClause | undefined; selectedClauseId: string | null; onSelect: (clauseId: string) => void };

/** "Page 2": jumps to the clause a term was read from. */
function Source({ what, clause, selectedClauseId, onSelect }: SourceProps) {
  if (!clause) return <span className="text-xs text-muted/70">No clause linked</span>;
  const active = clause.id === selectedClauseId;
  return (
    <button
      type="button"
      onClick={() => onSelect(clause.id)}
      aria-label={`Show the clause for ${what}, page ${clause.page}`}
      aria-pressed={active}
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium underline decoration-dotted underline-offset-2 ${active ? "bg-amber-300 text-neutral-950" : "bg-canvas text-ink hover:bg-amber-100"}`}
    >
      Page {clause.page}
    </button>
  );
}

/** Every extracted term, each with a link to the clause it was read from. */
export function TermsPanel({ data, selectedClauseId, onSelect }: Props) {
  const byId = new Map(data.clauses.map((c) => [c.id, c]));
  const others = data.clauses.filter((c) => c.kind === "other");

  const source = (clauseId: string | null, what: string) => <Source what={what} clause={clauseId ? byId.get(clauseId) : undefined} selectedClauseId={selectedClauseId} onSelect={onSelect} />;

  const ruleSection = (title: string, rule: VendorPageData["cancellation"], empty: string) => (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        {source(rule.clauseId, `${title.toLowerCase()} terms`)}
      </div>
      {rule.tiers.length > 0 ? (
        <ul className="space-y-1 text-sm text-ink">
          {rule.tiers.map((tier) => (
            <li key={tier}>{tier}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{empty}</p>
      )}
    </section>
  );

  return (
    <div className="space-y-6 rounded-lg border border-line bg-white p-4 shadow-sm">
      <section className="space-y-2">
        <h3 className="font-semibold">Payments</h3>
        {data.payments.length === 0 ? (
          <p className="text-sm text-muted">No payments found in this contract.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.payments.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{p.label}</p>
                  <p className="text-xs text-muted">
                    Due {p.dueDateLabel} <span className={`ml-1 rounded-full px-1.5 py-0.5 font-semibold ${BADGE[p.status]}`}>{p.statusLabel}</span>
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-semibold tabular-nums">{p.amountLabel}</span>
                  {source(p.clauseId, p.label)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {ruleSection("Cancellation", data.cancellation, "No cancellation terms found.")}
      {ruleSection("Date change", data.dateChange, "No date-change terms found.")}

      {others.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-semibold">Other terms</h3>
          <ul className="space-y-2 text-sm text-ink">
            {others.map((c: ViewerClause) => (
              <li key={c.id} className="flex items-start justify-between gap-3">
                <span>{c.summary}</span>
                {source(c.id, c.summary)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
