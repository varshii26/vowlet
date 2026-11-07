import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { VendorContractView } from "@/components/Clauses/VendorContractView";
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
      <nav>
        <Link href="/" className="text-sm font-medium text-neutral-600 hover:text-neutral-900">
          &larr; Back to the dashboard
        </Link>
      </nav>
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">{vendor.name}</h1>
          {vendor.status === "cancelled" && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Cancelled</span>}
        </div>
        <p className="text-neutral-600">
          <span className="capitalize">{vendor.category}</span> · contract total {vendor.totalLabel} · wedding {data.weddingDateLabel}
        </p>
      </header>
      <VendorContractView key={initialClauseId ?? ""} data={data} initialClauseId={initialClauseId} />
    </main>
  );
}
