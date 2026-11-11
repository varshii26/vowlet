import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { VendorContractView } from "@/components/Clauses/VendorContractView";
import { CancelModal } from "@/components/Vendors/CancelModal";
import { prisma } from "@/lib/db";
import { loadVendorPage } from "@/lib/vendors/page-data";

// Read the database on every request, so the page is never frozen at build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Vendor contract · Vowlet" };

export default async function VendorPage({ params, searchParams }: PageProps<"/vendors/[id]">) {
  const { id } = await params;
  const { clause } = await searchParams;
  const data = await loadVendorPage(prisma, id);
  if (!data) notFound();

  const initialClauseId = typeof clause === "string" && clause.length > 0 ? clause : null;
  const { vendor } = data;

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Vowlet</p>
      <nav>
        <Link href="/" className="rounded text-sm font-medium text-accent hover:text-accent-strong">
          &larr; Back to the dashboard
        </Link>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl text-ink">{vendor.name}</h1>
            {vendor.status === "cancelled" && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Cancelled</span>}
          </div>
          <p className="text-muted">
            <span className="capitalize">{vendor.category}</span> · contract total {vendor.totalLabel} · wedding {data.weddingDateLabel}
          </p>
        </div>
        {vendor.status === "active" && <CancelModal vendorId={vendor.id} vendorName={vendor.name} />}
      </header>
      <VendorContractView key={initialClauseId ?? ""} data={data} initialClauseId={initialClauseId} />
    </main>
  );
}
