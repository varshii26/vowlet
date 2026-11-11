import type { VendorSummary } from "@/lib/vendors/summary";

/**
 * The one-page payment summary a couple hands to a vendor. Plain black on white so it
 * prints well: a table of what is paid and when, any cancellation and date-change terms
 * they agreed, and a line for each side to sign. It says it is a summary, not a contract.
 */
export function PrintableSummary({ summary }: { summary: VendorSummary }) {
  const { vendor } = summary;
  return (
    <article className="vw-print-sheet mx-auto w-full max-w-3xl bg-white p-10 text-[15px] leading-relaxed text-black shadow-card print:max-w-none print:p-0 print:shadow-none">
      <header className="border-b border-black pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em]">Payment summary</p>
        <h1 className="mt-1 text-3xl">{vendor.name}</h1>
        <p className="mt-1 capitalize">{vendor.category}</p>
      </header>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
        <dt className="font-semibold">Couple</dt>
        <dd>{summary.coupleNames}</dd>
        <dt className="font-semibold">Wedding date</dt>
        <dd>{summary.weddingDateLabel}</dd>
        <dt className="font-semibold">Agreed on</dt>
        <dd>{vendor.signingDateLabel}</dd>
        <dt className="font-semibold">Total</dt>
        <dd className="font-semibold">{vendor.totalLabel}</dd>
      </dl>

      <section className="mt-6" aria-labelledby="print-payments">
        <h2 id="print-payments" className="text-lg font-semibold">
          Payments
        </h2>
        <table className="mt-2 w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-black">
              <th className="py-1.5 pr-3 font-semibold">Payment</th>
              <th className="py-1.5 pr-3 font-semibold">Due</th>
              <th className="py-1.5 pr-3 font-semibold">When</th>
              <th className="py-1.5 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {summary.payments.map((p, i) => (
              <tr key={i} className="border-b border-neutral-300 align-top">
                <td className="py-1.5 pr-3">{p.label}</td>
                <td className="whitespace-nowrap py-1.5 pr-3">{p.dueDateLabel}</td>
                <td className="py-1.5 pr-3 text-neutral-700">{p.basis}</td>
                <td className="py-1.5 text-right tabular-nums">{p.amountLabel}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-2 font-semibold">
                Total
              </td>
              <td className="pt-2 text-right font-semibold tabular-nums">{vendor.totalLabel}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      {summary.cancellationTiers.length > 0 && (
        <section className="mt-6" aria-labelledby="print-cancel">
          <h2 id="print-cancel" className="text-lg font-semibold">
            If the couple cancels
          </h2>
          <ul className="mt-1 list-disc pl-5">
            {summary.cancellationTiers.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      )}

      {summary.dateChangeTiers.length > 0 && (
        <section className="mt-6" aria-labelledby="print-change">
          <h2 id="print-change" className="text-lg font-semibold">
            If the wedding date changes
          </h2>
          <ul className="mt-1 list-disc pl-5">
            {summary.dateChangeTiers.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      )}

      {vendor.notes && (
        <section className="mt-6" aria-labelledby="print-notes">
          <h2 id="print-notes" className="text-lg font-semibold">
            Notes
          </h2>
          <p className="mt-1 whitespace-pre-wrap">{vendor.notes}</p>
        </section>
      )}

      <section className="mt-10 grid grid-cols-2 gap-10" aria-label="Signatures">
        {["For the couple", `For ${vendor.name}`].map((who) => (
          <div key={who}>
            <div className="h-10 border-b border-black" />
            <p className="mt-1 text-sm">{who}</p>
            <div className="mt-6 h-px border-b border-black" />
            <p className="mt-1 text-sm">Date</p>
          </div>
        ))}
      </section>

      <p className="mt-8 border-t border-neutral-300 pt-3 text-xs text-neutral-600">
        Prepared {summary.preparedLabel} from the couple&apos;s own notes using Vowlet. This is a summary of what was agreed, not a contract, and it is not
        legal advice.
      </p>
    </article>
  );
}
