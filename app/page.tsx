import Link from "next/link";
import { AgentPanel } from "@/components/Agent/AgentPanel";
import { SummaryBar } from "@/components/Dashboard/SummaryBar";
import { ResetDemoButton } from "@/components/Demo/ResetDemoButton";
import { UpcomingPayments } from "@/components/Payments/UpcomingPayments";
import { PendingProposals } from "@/components/Proposals/PendingProposals";
import { WhatIfTimeline } from "@/components/WhatIf/WhatIfTimeline";
import { dashboardSummary } from "@/lib/dashboard";
import { prisma } from "@/lib/db";
import { selectUpcomingPayments } from "@/lib/payments/upcoming";
import { loadPendingProposals } from "@/lib/proposals/data";
import { toIsoDate } from "@/lib/schedule";
import { loadTimelineInput } from "@/lib/timeline-data";

// Read the database on every request, so the page is never frozen at build.
export const dynamic = "force-dynamic";

export default async function Home() {
  const input = await loadTimelineInput(prisma);

  if (!input) {
    return (
      <main className="mx-auto w-full max-w-6xl p-8">
        <h1 className="text-3xl font-semibold">Vowlet</h1>
        <p className="mt-4 text-neutral-600">No wedding found yet. Run `npm run db:seed` to load the demo.</p>
      </main>
    );
  }

  const now = new Date();
  const upcoming = selectUpcomingPayments(input, now);
  const proposals = await loadPendingProposals(prisma);
  const budget = (await prisma.wedding.findFirst({ select: { budget: true } }))?.budget ?? 0;

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold">Vowlet</h1>
          <p className="text-neutral-600">
            {input.wedding.coupleNames}: every vendor payment, anchored to the wedding day.
          </p>
        </div>
        <div className="flex items-start gap-2">
          <Link href="/upload" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50">
            Upload contracts
          </Link>
          <ResetDemoButton />
        </div>
      </header>
      <SummaryBar {...dashboardSummary(input, budget, upcoming, now)} />
      <AgentPanel />
      <PendingProposals proposals={proposals} />
      <WhatIfTimeline input={input} todayIso={toIsoDate(now)} />
      <UpcomingPayments payments={upcoming} />
    </main>
  );
}
