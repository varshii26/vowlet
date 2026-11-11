import Link from "next/link";
import { AgentPanel } from "@/components/Agent/AgentPanel";
import { AccountHeader } from "@/components/Account/AccountHeader";
import { ActivityFeed } from "@/components/Dashboard/ActivityFeed";
import { PAYMENT_LISTS_ID } from "@/components/Dashboard/anchors";
import { EmptyDashboard } from "@/components/Dashboard/EmptyDashboard";
import { DashboardShell } from "@/components/Dashboard/DashboardShell";
import { SummaryBar } from "@/components/Dashboard/SummaryBar";
import { ResetDemoButton } from "@/components/Demo/ResetDemoButton";
import { UpcomingPayments } from "@/components/Payments/UpcomingPayments";
import { Tabs } from "@/components/ui/Tabs";
import {
  VendorList,
  type VendorCardData,
} from "@/components/Vendors/VendorList";
import { WhatIfTimeline } from "@/components/WhatIf/WhatIfTimeline";
import { loadActivity } from "@/lib/activity";
import { requireWeddingOrOnboarding } from "@/lib/auth/require-wedding";
import { dashboardSummary } from "@/lib/dashboard";
import { resetIfIdle } from "@/lib/demo/idle-reset";
import { prisma } from "@/lib/db";
import { selectUpcomingPayments } from "@/lib/payments/upcoming";
import { loadPendingProposals } from "@/lib/proposals/data";
import { toIsoDate } from "@/lib/schedule";
import { buildTimeline, vendorTaskId } from "@/lib/timeline";
import { loadTimelineInput } from "@/lib/timeline-data";

// Read the database on every request, so the page is never frozen at build.
export const dynamic = "force-dynamic";

export default async function Home() {
  // Signed out goes to /login, and a new account with no wedding goes to onboarding.
  const { weddingId, isDemo } = await requireWeddingOrOnboarding("/");
  // Judges share one demo wedding: when the demo account visits and it was left changed and idle,
  // it goes back to the seed before the page reads it (lib/demo/auto-reset.ts). Real couples' data is never touched.
  if (isDemo) await resetIfIdle();
  const input = await loadTimelineInput(prisma, weddingId);

  if (!input) {
    return (
      <main className="mx-auto w-full max-w-6xl p-8">
        <h1 className="text-3xl">Vowlet</h1>
        <p className="mt-4 text-muted">
          No wedding found yet. Run `npm run db:seed` to load the demo.
        </p>
      </main>
    );
  }

  const now = new Date();
  // Every unpaid payment for the tab; the list has no per-row Pay buttons, so it stays light.
  const upcoming = selectUpcomingPayments(input, now, Number.MAX_SAFE_INTEGER);
  const [proposals, wedding, activity, categories] = await Promise.all([
    loadPendingProposals(prisma, weddingId),
    prisma.wedding.findUnique({
      where: { id: weddingId },
      select: { budget: true },
    }),
    loadActivity(prisma, weddingId),
    prisma.vendor.findMany({
      where: { weddingId },
      select: { id: true, category: true },
    }),
  ]);
  const summary = dashboardSummary(input, wedding?.budget ?? 0, upcoming, now);
  const { details } = buildTimeline(input, now);

  const categoryOf = new Map(categories.map((v) => [v.id, v.category]));
  const vendors: VendorCardData[] = input.vendors.map((v) => {
    const detail = details[vendorTaskId(v.id)];
    return {
      id: v.id,
      name: v.name,
      category: categoryOf.get(v.id) ?? "",
      totalLabel: detail?.kind === "vendor" ? detail.amountLabel : "",
      summary: detail?.kind === "vendor" ? detail.summary : "",
      cancelled: v.status === "cancelled",
    };
  });

  const actions = (
    <div className="flex items-start gap-2">
      <Link href="/upload" className="btn btn-secondary">
        Upload contracts
      </Link>
      {/* Reset wipes and reseeds everything: only for the shared demo, never a couple's real data. */}
      {isDemo && <ResetDemoButton />}
      <AccountHeader />
    </div>
  );

  return (
    <DashboardShell
      details={details}
      pendingProposalIds={proposals.map((p) => p.id)}
      aside={
        <AgentPanel proposals={proposals} empty={input.vendors.length === 0} />
      }
      main={
        <div className="mx-auto w-full max-w-[1400px] space-y-6 px-8 py-6">
          <SummaryBar
            coupleNames={input.wedding.coupleNames}
            weddingDateLabel={summary.weddingDateLabel}
            daysToGo={summary.daysToGo}
            summary={summary.summary}
            next={summary.next}
            actions={actions}
          />
          {input.vendors.length === 0 ? (
            <EmptyDashboard />
          ) : (
            <>
              {/* The hero: sized so the chart fills the rest of a 1440×900 screen. */}
              <WhatIfTimeline
                input={input}
                todayIso={toIsoDate(now)}
                className="h-[max(28rem,calc(100vh-23rem))]"
              />
              <Tabs
                id={PAYMENT_LISTS_ID}
                label="More about your payments"
                tabs={[
                  {
                    id: "upcoming",
                    label: "Upcoming",
                    count: upcoming.length,
                    content: <UpcomingPayments payments={upcoming} />,
                  },
                  {
                    id: "vendors",
                    label: "Vendors",
                    count: vendors.length,
                    content: <VendorList vendors={vendors} />,
                  },
                  {
                    id: "activity",
                    label: "Activity",
                    content: <ActivityFeed items={activity} />,
                  },
                ]}
              />
            </>
          )}
        </div>
      }
    />
  );
}
