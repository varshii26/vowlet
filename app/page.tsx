import { AgentPanel } from "@/components/Agent/AgentPanel";
import { PaymentGantt } from "@/components/Gantt/PaymentGantt";
import { UpcomingPayments } from "@/components/Payments/UpcomingPayments";
import { PendingProposals } from "@/components/Proposals/PendingProposals";
import { prisma } from "@/lib/db";
import { selectUpcomingPayments } from "@/lib/payments/upcoming";
import { loadPendingProposals } from "@/lib/proposals/data";
import { buildTimeline } from "@/lib/timeline";
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
  const timeline = buildTimeline(input, now);
  const upcoming = selectUpcomingPayments(input, now);
  const proposals = await loadPendingProposals(prisma);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 p-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Vowlet</h1>
        <p className="text-neutral-600">
          {input.wedding.coupleNames}: every vendor payment, anchored to the wedding day.
        </p>
      </header>
      <AgentPanel />
      <PendingProposals proposals={proposals} />
      <PaymentGantt data={timeline} />
      <UpcomingPayments payments={upcoming} />
    </main>
  );
}
