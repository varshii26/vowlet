import Link from "next/link";

/**
 * What a brand-new wedding shows instead of an empty chart: one clear next step.
 * The timeline, payment lists and what-if all come from contracts, so they wait for the first one.
 */
export function EmptyDashboard() {
  return (
    <section aria-labelledby="empty-title" className="rounded-card border border-line bg-surface p-8 text-center shadow-card">
      <h2 id="empty-title" className="text-2xl text-ink">
        Add your first vendor contract
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-muted">
        Upload a PDF and Vowlet reads out every payment and deadline, each linked to the clause it came from. Your timeline, the what-if
        planner and your budget bar fill in as soon as you confirm it.
      </p>
      <Link href="/upload" className="btn btn-primary mt-5 inline-flex">
        Upload a contract
      </Link>
    </section>
  );
}
