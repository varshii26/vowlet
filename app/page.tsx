import { PaymentGantt } from "@/components/Gantt/PaymentGantt";
import { prisma } from "@/lib/db";
import { buildTimeline } from "@/lib/timeline";
import { loadTimelineInput } from "@/lib/timeline-data";

// Read the database on every request, so the timeline is never frozen at build.
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

  const timeline = buildTimeline(input, new Date());

  return (
    <main className="mx-auto w-full max-w-7xl space-y-4 p-8">
      <h1 className="text-3xl font-semibold">Vowlet</h1>
      <p className="text-neutral-600">
        {input.wedding.coupleNames}: every vendor payment, anchored to the wedding day.
      </p>
      <PaymentGantt data={timeline} />
    </main>
  );
}
