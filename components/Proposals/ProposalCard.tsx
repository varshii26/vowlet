"use client";

import { useState } from "react";
import { ClauseChip } from "@/components/Clauses/ClauseChip";
import { PayButton } from "@/components/Payments/PayButton";
import { requestResolve } from "@/lib/proposals/client";
import type { ProposalDateChange, ProposalFeeLine, ProposalView } from "@/lib/proposals/view";

export type Resolved = { proposal: ProposalView; status: "approved" | "dismissed"; message: string; draft?: string };

const APPROVE_LABEL = {
  reschedule: "Approve and move the wedding",
  refund_request: "Approve this request",
  message: "Got it",
  pay: "",
} as const;

/** Old vs new: the wedding date, then the next payments that move with it. */
function DateChangePreview({ change }: { change: ProposalDateChange }) {
  return (
    <div className="rounded-lg bg-canvas p-3 text-sm" data-testid="proposal-dates">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs uppercase tracking-wide text-muted">Wedding</span>
        <span className="text-muted line-through decoration-muted/60">{change.from}</span>
        <span aria-hidden="true" className="text-muted">→</span>
        <span className="sr-only">to</span>
        <span className="font-medium text-ink">{change.to}</span>
      </p>
      {change.payments.length > 0 && (
        <>
          <p className="mt-2 text-xs uppercase tracking-wide text-muted">Next payments that move</p>
          <ul className="mt-1 space-y-0.5">
            {change.payments.map((p) => (
              <li key={p.key} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-ink">{p.title}</span>
                <span className="tabular-nums text-muted">
                  <span className="line-through decoration-muted/60">{p.from}</span> <span aria-hidden="true">→</span>
                  <span className="sr-only">to</span> <span className="font-medium text-ink">{p.to}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Each vendor's fee, largest first, with a chip that opens the clause it comes from. */
function FeeLines({ fees }: { fees: ProposalFeeLine[] }) {
  return (
    <ul className="space-y-1 text-sm" aria-label="Change fee per vendor">
      {fees.map((fee) => (
        <li key={fee.vendorId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-ink">{fee.vendorName}</span>
          <span className="tabular-nums text-ink">{fee.amountLabel}</span>
          {fee.citation && <ClauseChip label={fee.citation} clause={null} href={fee.clauseHref} />}
        </li>
      ))}
    </ul>
  );
}

/**
 * One thing the assistant proposed: what will happen, how much, which clause it
 * rests on, and why. Nothing happens until the couple clicks. For a payment the
 * PayPal popup is the approval (the server only marks the proposal approved
 * once the payment has really gone through); everything else has Approve.
 */
export function ProposalCard({ proposal, onResolved }: { proposal: ProposalView; onResolved: (result: Resolved) => void }) {
  const [busy, setBusy] = useState<"approve" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(action: "approve" | "dismiss") {
    setBusy(action);
    setError(null);
    const result = await requestResolve(proposal.id, action);
    setBusy(null);
    if (!result.ok) return setError(result.message);
    onResolved({ proposal, status: result.status, message: result.message, draft: result.draft });
  }

  const headingId = `proposal-${proposal.id}`;
  const pays = proposal.kind === "pay" && proposal.paymentId !== null;

  return (
    <article
      aria-labelledby={headingId}
      data-warning={proposal.warning ? "over-budget" : undefined}
      className={`animate-fade-up space-y-3 rounded-card border border-l-4 p-4 shadow-card ${
        proposal.warning ? "border-amber-300 border-l-amber-500 bg-amber-50/60" : "border-accent/25 border-l-accent bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 id={headingId} className="text-base text-ink">
            {proposal.title}
          </h3>
          <p className="text-sm text-muted">{proposal.summary}</p>
        </div>
        {proposal.amount && (
          <p className="text-right">
            <span className="block font-serif text-xl font-semibold tabular-nums text-ink">{proposal.amount.label}</span>
            <span className="block text-xs text-muted">{proposal.amount.caption}</span>
          </p>
        )}
      </div>

      {proposal.warning && (
        <p role="note" className="rounded-lg border border-amber-300 bg-amber-100 p-2 text-sm font-medium text-amber-900">
          {proposal.warning}
        </p>
      )}

      {proposal.dateChange && <DateChangePreview change={proposal.dateChange} />}

      {proposal.fees.length > 0 && <FeeLines fees={proposal.fees} />}

      {proposal.details.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted">
          {proposal.details.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {proposal.draft && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Drafted message to the vendor</summary>
          <p className="mt-1 whitespace-pre-wrap rounded-lg bg-canvas p-2 text-ink">{proposal.draft}</p>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        {proposal.citation &&
          (proposal.clauseHref ? (
            <a
              href={proposal.clauseHref}
              className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent-strong underline decoration-dotted underline-offset-2 hover:bg-accent/15"
            >
              {proposal.citation}
            </a>
          ) : (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent-strong">{proposal.citation}</span>
          ))}
        {proposal.reason && <span>Why: {proposal.reason}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {pays && proposal.paymentId && <PayButton paymentId={proposal.paymentId} onSettled={() => void resolve("approve")} />}
        {!pays && proposal.approvable && (
          <button
            type="button"
            onClick={() => void resolve("approve")}
            disabled={busy !== null}
            className="btn btn-primary"
          >
            {busy === "approve" ? "Working…" : APPROVE_LABEL[proposal.kind]}
          </button>
        )}
        {pays && error && (
          <button type="button" onClick={() => void resolve("approve")} disabled={busy !== null} className="rounded text-sm underline">
            Check again
          </button>
        )}
        <button
          type="button"
          onClick={() => void resolve("dismiss")}
          disabled={busy !== null}
          className="btn btn-secondary"
        >
          {busy === "dismiss" ? "Working…" : "Dismiss"}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </article>
  );
}
