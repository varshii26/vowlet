"use client";

import { useEffect, useMemo, useState } from "react";
import { layoutContract } from "@/lib/vendors/highlight";
import { clauseDomId } from "@/lib/vendors/links";
import type { ClauseKind, ViewerClause } from "@/lib/vendors/page-data";

export const KIND_LABEL: Record<ClauseKind, string> = {
  payment: "Payment",
  cancellation: "Cancellation",
  date_change: "Date change",
  other: "Other terms",
};

type Props = {
  /** Text of each contract page; null if the PDF couldn't be read. */
  pages: string[] | null;
  clauses: ViewerClause[];
  selectedClauseId: string | null;
  /** Changes on every selection, so picking the same clause again scrolls and flashes again. */
  selectionKey?: number;
  onSelect?: (clauseId: string) => void;
};

const FLASH_MS = 1600;

/**
 * The contract, page by page, with every extracted clause highlighted. The
 * selected clause is scrolled into view and flashes. Contract text is untrusted
 * and is only ever rendered as React text, never as HTML. A clause that can't
 * be found in the text is still shown, quoted, under its page.
 */
export function ClauseViewer({ pages, clauses, selectedClauseId, selectionKey = 0, onSelect }: Props) {
  const layout = useMemo(() => layoutContract(pages ?? [], clauses), [pages, clauses]);
  const byId = useMemo(() => new Map(clauses.map((c) => [c.id, c])), [clauses]);
  // The selection that has finished flashing; until then the selected clause pulses.
  const [flashed, setFlashed] = useState<string | null>(null);
  const flashing = selectedClauseId !== null && flashed !== `${selectedClauseId}:${selectionKey}`;

  useEffect(() => {
    if (!selectedClauseId) return;
    const el = document.getElementById(clauseDomId(selectedClauseId));
    el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    el?.focus({ preventScroll: true });
    const timer = setTimeout(() => setFlashed(`${selectedClauseId}:${selectionKey}`), FLASH_MS);
    return () => clearTimeout(timer);
  }, [selectedClauseId, selectionKey]);

  const selected = selectedClauseId ? byId.get(selectedClauseId) : undefined;

  const markClass = (id: string) =>
    id === selectedClauseId
      ? `cursor-pointer rounded-sm bg-amber-300 text-neutral-950 outline-none ring-2 ring-amber-500 ${flashing ? "animate-pulse" : ""}`
      : "cursor-pointer rounded-sm bg-amber-100 text-neutral-900 outline-none hover:bg-amber-200";

  return (
    <div className="space-y-4">
      {selected && (
        <div className="sticky top-2 z-10 rounded-lg border border-amber-300 bg-amber-50/95 p-3 text-sm shadow-sm backdrop-blur" aria-live="polite">
          <p className="font-medium text-amber-900">
            {KIND_LABEL[selected.kind]} clause, page {layout.foundOn[selected.id] ?? selected.page}
          </p>
          <p className="text-neutral-700">{selected.summary}</p>
        </div>
      )}

      {pages === null && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          The contract file couldn&rsquo;t be read, so the clauses are shown as quoted.
        </p>
      )}

      {layout.pages.map((segments, index) => (
        <section key={index} aria-label={`Page ${index + 1}`} className="rounded-lg border border-neutral-200 bg-white shadow-sm">
          <header className="border-b border-neutral-100 px-5 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Page {index + 1} of {layout.pages.length}
          </header>
          <p className="whitespace-pre-wrap px-5 py-4 font-serif text-[15px] leading-7 text-neutral-800">
            {segments.map((segment, i) =>
              segment.clauseId ? (
                <mark
                  key={i}
                  id={clauseDomId(segment.clauseId)}
                  data-clause-id={segment.clauseId}
                  data-selected={segment.clauseId === selectedClauseId ? "true" : undefined}
                  tabIndex={-1}
                  title={byId.get(segment.clauseId)?.summary}
                  onClick={() => onSelect?.(segment.clauseId as string)}
                  className={markClass(segment.clauseId)}
                >
                  {segment.text}
                </mark>
              ) : (
                <span key={i}>{segment.text}</span>
              ),
            )}
          </p>
        </section>
      ))}

      {layout.unlocated.length > 0 && (
        <section aria-label="Clauses not found in the contract text" className="space-y-2">
          <h3 className="text-sm font-semibold text-neutral-700">
            {pages === null ? "Extracted clauses" : "Clauses not found word for word in the contract text"}
          </h3>
          {layout.unlocated.map((clause) => (
            <blockquote
              key={clause.id}
              id={clauseDomId(clause.id)}
              data-clause-id={clause.id}
              data-selected={clause.id === selectedClauseId ? "true" : undefined}
              tabIndex={-1}
              className={`rounded border-l-4 p-3 text-sm outline-none ${clause.id === selectedClauseId ? `border-amber-500 bg-amber-100 ${flashing ? "animate-pulse" : ""}` : "border-amber-300 bg-white"}`}
            >
              <p className="whitespace-pre-line text-neutral-800">&ldquo;{clause.text}&rdquo;</p>
              <footer className="mt-1 text-xs text-neutral-500">
                Page {clause.page}, as quoted{pages === null ? "" : "; please check it against the original PDF"}
              </footer>
            </blockquote>
          ))}
        </section>
      )}
    </div>
  );
}
