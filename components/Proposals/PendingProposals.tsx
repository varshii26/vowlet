"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ProposalCard, type Resolved } from "@/components/Proposals/ProposalCard";
import { useToast } from "@/components/ui/Toast";
import type { ProposalView } from "@/lib/proposals/view";

type Confirmation = { message: string; draft?: string };

/**
 * What the assistant has proposed and the couple hasn't decided on yet. A
 * resolved card leaves the list when the page refreshes, so what happened stays
 * on screen until it is dismissed, along with a refund request's drafted message
 * to copy: nothing is ever sent for the couple.
 */
export function PendingProposals({ proposals, heading = "Waiting for your approval" }: { proposals: ProposalView[]; heading?: string | null }) {
  const router = useRouter();
  const { toast, celebrate } = useToast();
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [copied, setCopied] = useState(false);

  function resolved(result: Resolved) {
    setConfirmation({ message: result.message, draft: result.draft });
    setCopied(false);
    toast(result.message, result.status === "approved" ? "success" : "info");
    if (result.status === "approved" && result.proposal.kind === "pay") celebrate();
    router.refresh(); // the timeline, payments and this list re-render from the database
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false); // the text is on screen to select by hand
    }
  }

  if (proposals.length === 0 && !confirmation) return null;

  return (
    <section aria-label={heading ?? "Proposals"} className="space-y-3">
      {heading && <h3 className="text-xs font-sans font-semibold uppercase tracking-wide text-muted">{heading}</h3>}

      {confirmation && (
        <div role="status" className="animate-fade-up space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <div className="flex items-start justify-between gap-4">
            <span>{confirmation.message}</span>
            <button type="button" onClick={() => setConfirmation(null)} className="shrink-0 rounded font-medium underline">
              Dismiss
            </button>
          </div>
          {confirmation.draft && (
            <div className="space-y-2">
              <p className="whitespace-pre-wrap rounded-lg bg-white p-2 text-ink">{confirmation.draft}</p>
              <button type="button" onClick={() => void copy(confirmation.draft ?? "")} className="btn btn-secondary">
                {copied ? "Copied" : "Copy message"}
              </button>
            </div>
          )}
        </div>
      )}

      {proposals.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} onResolved={resolved} />
      ))}
    </section>
  );
}
