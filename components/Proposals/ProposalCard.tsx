"use client";

import { useState } from "react";
import { PayButton } from "@/components/Payments/PayButton";
import { requestResolve } from "@/lib/proposals/client";
import type { ProposalView } from "@/lib/proposals/view";

export type Resolved = { proposal: ProposalView; status: "approved" | "dismissed"; message: string; draft?: string };

const APPROVE_LABEL = {
  reschedule: "Approve and move the wedding",
  refund_request: "Approve this request",
  message: "Got it",
  pay: "",
} as const;

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
    <article aria-labelledby={headingId} className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 id={headingId} className="font-semibold">
            {proposal.title}
          </h3>
          <p className="text-sm text-neutral-700">{proposal.summary}</p>
        </div>
        {proposal.amount && (
          <p className="text-right">
            <span className="block text-xl font-semibold">{proposal.amount.label}</span>
            <span className="block text-xs text-neutral-500">{proposal.amount.caption}</span>
          </p>
        )}
      </div>

      {proposal.details.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-neutral-600">
          {proposal.details.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {proposal.draft && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Drafted message to the vendor</summary>
          <p className="mt-1 whitespace-pre-wrap rounded bg-neutral-50 p-2 text-neutral-700">{proposal.draft}</p>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        {proposal.citation && <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-medium text-neutral-700">{proposal.citation}</span>}
        {proposal.reason && <span>Why: {proposal.reason}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {pays && proposal.paymentId && <PayButton paymentId={proposal.paymentId} onSettled={() => void resolve("approve")} />}
        {!pays && proposal.approvable && (
          <button
            type="button"
            onClick={() => void resolve("approve")}
            disabled={busy !== null}
            className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:bg-neutral-300"
          >
            {busy === "approve" ? "Working…" : APPROVE_LABEL[proposal.kind]}
          </button>
        )}
        {pays && error && (
          <button type="button" onClick={() => void resolve("approve")} disabled={busy !== null} className="text-sm underline">
            Check again
          </button>
        )}
        <button
          type="button"
          onClick={() => void resolve("dismiss")}
          disabled={busy !== null}
          className="rounded-lg border border-neutral-300 px-4 py-1.5 text-sm font-medium hover:bg-neutral-50 disabled:text-neutral-400"
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
