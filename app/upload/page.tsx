import type { Metadata } from "next";
import Link from "next/link";
import { UploadContracts } from "@/components/Upload/UploadContracts";

export const metadata: Metadata = { title: "Upload contracts · Vowlet" };

export default function UploadPage() {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-8">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Vowlet</p>
        <Link href="/" className="rounded text-sm font-medium text-accent hover:text-accent-strong">
          &larr; Back to the dashboard
        </Link>
        <h1 className="text-3xl text-ink">Upload contracts</h1>
        <p className="text-muted">
          Add a vendor from their contract. AI reads the payments, cancellation and date-change terms, and every term shows the clause it came from.
          Anything it isn&apos;t sure of is marked <span className="font-medium text-amber-800">Please confirm</span>. Amounts are worked out in code, never by
          the AI.
        </p>
      </header>
      <UploadContracts />
    </main>
  );
}
