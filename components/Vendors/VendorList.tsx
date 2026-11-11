import Link from "next/link";

export type VendorCardData = {
  id: string;
  name: string;
  category: string;
  totalLabel: string;
  /** "3 payments, $2,000 of $6,000 paid." */
  summary: string;
  cancelled: boolean;
};

/** Every vendor as a card linking to its contract (replaces the old chip cloud). */
export function VendorList({ vendors }: { vendors: VendorCardData[] }) {
  if (vendors.length === 0) return <p className="text-sm text-muted">No vendors yet. Upload a contract to add one.</p>;

  return (
    <ul aria-label="Vendors" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {vendors.map((v) => (
        <li key={v.id}>
          <Link
            href={`/vendors/${v.id}`}
            className={`card group block h-full p-4 transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-float ${v.cancelled ? "opacity-70" : ""}`}
          >
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className={`block truncate font-serif text-base font-semibold text-ink ${v.cancelled ? "line-through decoration-muted" : ""}`}>{v.name}</span>
                <span className="block text-[11px] font-medium uppercase tracking-wide text-muted">{v.category}</span>
              </span>
              <span className="font-serif text-base font-semibold tabular-nums text-ink">{v.totalLabel}</span>
            </span>
            <span className="mt-3 flex items-center justify-between gap-2 text-xs">
              <span className="text-muted">{v.summary}</span>
              {v.cancelled ? (
                <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-800">Cancelled</span>
              ) : (
                <span aria-hidden className="font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  Contract →
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
