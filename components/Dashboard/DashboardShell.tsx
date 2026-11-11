"use client";

import type { ReactNode } from "react";
import { PaymentDrawerProvider } from "@/components/Payments/PaymentDrawer";
import type { TaskDetail } from "@/lib/timeline";

type Props = {
  /** Task details of the saved timeline, for the payment drawer. */
  details: Record<string, TaskDetail>;
  /** Header strip, Gantt hero and tabs. */
  main: ReactNode;
  /** The "Ask Vowlet" panel. */
  aside: ReactNode;
};

/**
 * The dashboard frame (desktop): the main column scrolls, the agent panel stays
 * full height on the right, so asking, approving and the Gantt reflowing are all
 * in one view. Provides the payment drawer to everything inside.
 */
export function DashboardShell({ details, main, aside }: Props) {
  return (
    <PaymentDrawerProvider details={details}>
      <div className="flex h-screen min-h-0 w-full">
        <main className="min-w-0 flex-1 overflow-y-auto">{main}</main>
        <aside aria-label="Ask Vowlet" className="flex h-screen w-[26rem] shrink-0 flex-col border-l border-line bg-canvas/60 backdrop-blur">
          {aside}
        </aside>
      </div>
    </PaymentDrawerProvider>
  );
}
