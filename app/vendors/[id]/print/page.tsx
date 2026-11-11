import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountHeader } from "@/components/Account/AccountHeader";
import { PrintButton } from "@/components/Manual/PrintButton";
import { PrintableSummary } from "@/components/Manual/PrintableSummary";
import { requireWeddingOrOnboarding } from "@/lib/auth/require-wedding";
import { prisma } from "@/lib/db";
import { loadVendorSummary } from "@/lib/vendors/summary";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payment summary · Vowlet" };

export default async function VendorPrintPage({ params }: PageProps<"/vendors/[id]/print">) {
  const { id } = await params;
  const { weddingId } = await requireWeddingOrOnboarding(`/vendors/${id}/print`);
  const summary = await loadVendorSummary(prisma, weddingId, id);
  if (!summary) notFound();

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 p-8 print:p-0">
      <div className="vw-no-print flex flex-wrap items-center justify-between gap-3">
        <Link href={`/vendors/${encodeURIComponent(id)}`} className="rounded text-sm font-medium text-accent hover:text-accent-strong">
          &larr; Back to {summary.vendor.name}
        </Link>
        <div className="flex items-center gap-3">
          <PrintButton />
          <AccountHeader />
        </div>
      </div>
      <p className="vw-no-print text-sm text-muted">
        This is what you can give to {summary.vendor.name}: what is paid and when, with a line for each side to sign. Use the button to print it or save it as
        a PDF.
      </p>
      <PrintableSummary summary={summary} />
    </main>
  );
}
