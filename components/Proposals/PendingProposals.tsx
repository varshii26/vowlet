"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ProposalCard, type Resolved } from "@/components/Proposals/ProposalCard";
import type { ProposalView } from "@/lib/proposals/view";

type Confirmation = { message: string; draft?: string };

/**
 * What the assistant has proposed and the couple hasn't decided on yet. A
 * resolved card leaves the list when the page refreshes, so what happened stays
 * on screen until it is dismissed, along with a refund request's drafted message
 * to copy: nothing is ever sent for the couple.
 */
export function PendingProposals({ proposals }: { proposals: ProposalView[] }) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [copied, setCopied] = useState(false);

  function resolved(result: Resolved) {
    setConfirmation({ message: result.message, draft: result.draft });
    setCopied(false);
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
    <section aria-labelledby="proposals-heading" className="space-y-3">
      <h2 id="proposals-heading" className="text-xl font-semibold">
        Waiting for your approval
      </h2>

      {confirmation && (
        <div role="status" className="space-y-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          <div className="flex items-start justify-between gap-4">
            <span>{confirmation.message}</span>
            <button type="button" onClick={() => setConfirmation(null)} className="font-medium underline">
              Dismiss
            </button>
          </div>
          {confirmation.draft && (
            <div className="space-y-2">
              <p className="whitespace-pre-wrap rounded bg-white p-2 text-neutral-800">{confirmation.draft}</p>
              <button type="button" onClick={() => void copy(confirmation.draft ?? "")} className="rounded border border-green-300 bg-white px-3 py-1 font-medium">
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
