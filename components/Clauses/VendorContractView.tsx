"use client";

import { useState } from "react";
import { ClauseViewer } from "@/components/Clauses/ClauseViewer";
import { TermsPanel } from "@/components/Clauses/TermsPanel";
import type { VendorPageData } from "@/lib/vendors/page-data";

type Props = {
  data: VendorPageData;
  /** From `?clause=<id>`: open the contract at this clause. */
  initialClauseId: string | null;
};

/**
 * The vendor page body: the contract with its clauses highlighted, and the
 * extracted terms beside it. Clicking a term jumps to its clause; the URL keeps
 * the clause, so the view can be linked to.
 */
export function VendorContractView({ data, initialClauseId }: Props) {
  const known = initialClauseId !== null && data.clauses.some((c) => c.id === initialClauseId);
  const [selected, setSelected] = useState<string | null>(known ? initialClauseId : null);
  const [selectionKey, setSelectionKey] = useState(0);
  const [view, setView] = useState<"text" | "pdf">("text");

  const selectedPage = data.clauses.find((c) => c.id === selected)?.page ?? 1;

  function select(clauseId: string) {
    setSelected(clauseId);
    setSelectionKey((k) => k + 1);
    setView("text");
    window.history.replaceState(null, "", `?clause=${encodeURIComponent(clauseId)}`);
  }

  const tab = (value: "text" | "pdf", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === value}
      onClick={() => setView(value)}
      className={`rounded-md px-3 py-1 text-sm font-medium ${view === value ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"}`}
    >
      {label}
    </button>
  );

  if (data.vendor.manual) {
    return (
      <div className="max-w-2xl space-y-3">
        <h2 className="text-lg font-semibold">What you entered</h2>
        <p className="text-sm text-muted">
          There is no contract on file for {data.vendor.name}: you entered these payments and terms yourself, so there are no clauses to show.
        </p>
        <TermsPanel data={data} selectedClauseId={null} onSelect={select} />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <aside className="space-y-3 lg:sticky lg:top-4 lg:order-2 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto" aria-label="Extracted terms">
        <h2 className="text-lg font-semibold">What the contract says</h2>
        <TermsPanel data={data} selectedClauseId={selected} onSelect={select} />
      </aside>

      <div className="min-w-0 space-y-3 lg:order-1">
        {initialClauseId !== null && !known && (
          <p role="status" className="rounded-lg border border-line bg-canvas p-3 text-sm text-ink">
            That clause isn&rsquo;t in this contract any more. Showing the whole contract.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="tablist" aria-label="Contract view" className="inline-flex rounded-lg bg-canvas p-1">
            {tab("text", "Highlighted clauses")}
            {tab("pdf", "Original PDF")}
          </div>
          <a href={data.vendor.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-ink underline underline-offset-2">
            Open original PDF
          </a>
        </div>

        {view === "text" ? (
          <ClauseViewer pages={data.pages} clauses={data.clauses} selectedClauseId={selected} selectionKey={selectionKey} onSelect={select} />
        ) : (
          <iframe
            title={`${data.vendor.name} contract (PDF)`}
            src={`${data.vendor.pdfUrl}#page=${selectedPage}`}
            className="h-[80vh] w-full rounded-lg border border-line bg-white"
          />
        )}
      </div>
    </div>
  );
}
