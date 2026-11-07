"use client";

import { useId, useState } from "react";

type Props = {
  /** "Grand Oak Estate contract, page 2" */
  label: string;
  /** The clause as quoted in the contract. Without it the chip is a plain label. */
  clause: { text: string; page: number } | null;
  /** The vendor page at this clause (see clauseHref), for an "Open in contract" link. */
  href?: string | null;
};

/**
 * A "Vendor contract, page N" chip. Clicking it opens the clause the number came
 * from, quoted from the contract, right where the couple is reading. Contract
 * text is shown as plain text, never as HTML. With `href`, it also links to the
 * clause highlighted in the full contract on the vendor page.
 */
export function ClauseChip({ label, clause, href }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();

  if (!clause && href) {
    return (
      <a href={href} className="whitespace-nowrap rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700 underline decoration-dotted underline-offset-2 hover:bg-neutral-200">
        {label}
      </a>
    );
  }
  if (!clause) {
    return <span className="whitespace-nowrap rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">{label}</span>;
  }

  return (
    <span className="inline-block max-w-full align-top">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="whitespace-nowrap rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700 underline decoration-dotted underline-offset-2 hover:bg-neutral-200"
      >
        {label}
      </button>
      {open && (
        <blockquote id={id} className="mt-1 rounded border-l-4 border-pink-300 bg-white p-2 text-xs leading-relaxed text-neutral-800 shadow-sm">
          <p className="whitespace-pre-line">&ldquo;{clause.text}&rdquo;</p>
          <footer className="mt-1 flex flex-wrap items-center justify-between gap-2 text-neutral-500">
            <span>{label}</span>
            {href && (
              <a href={href} className="font-medium text-pink-700 underline underline-offset-2 hover:text-pink-900">
                Open in contract
              </a>
            )}
          </footer>
        </blockquote>
      )}
    </span>
  );
}
