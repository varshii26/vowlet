"use client";

import type { ReactNode } from "react";
import { GanttFocusProvider } from "@/components/Gantt/FocusContext";
import { PaymentDrawerProvider } from "@/components/Payments/PaymentDrawer";
import type { TaskDetail } from "@/lib/timeline";

type Props = {
  /** Task details of the saved timeline, for the payment drawer. */
  details: Record<string, TaskDetail>;
  /** Header strip, Gantt hero and tabs. */
  main: ReactNode;
  /** The "Ask Vowlet" panel. */
  aside: ReactNode;
  /** Ids of proposals waiting for the couple, for the timeline's refund preview. */
  pendingProposalIds?: string[];
};

/**
 * The dashboard frame. On a laptop-width screen (1280px and up) the main column
 * scrolls and the agent panel stays full height on the right, so asking,
 * approving and the Gantt reflowing are all in one view. On a narrower one, which
 * is also what a browser zoomed to 200% looks like, the panel stacks below the
 * main content instead: a fixed 26rem panel would leave the timeline no room. Provides the payment drawer, and the agent's focus on the
 * timeline (what the latest answer is about), to everything inside.
 */
export function DashboardShell({ details, main, aside, pendingProposalIds = [] }: Props) {
  return (
    <GanttFocusProvider pendingProposalIds={pendingProposalIds}>
    <PaymentDrawerProvider details={details}>
      <div className="flex min-h-screen w-full flex-col xl:h-screen xl:min-h-0 xl:flex-row">
        <main className="min-w-0 flex-1 xl:overflow-y-auto">{main}</main>
        <aside
          aria-label="Ask Vowlet"
          className="flex h-[36rem] w-full shrink-0 flex-col border-t border-line bg-canvas/60 backdrop-blur xl:h-screen xl:w-[26rem] xl:border-l xl:border-t-0"
        >
          {aside}
        </aside>
      </div>
    </PaymentDrawerProvider>
    </GanttFocusProvider>
  );
}
