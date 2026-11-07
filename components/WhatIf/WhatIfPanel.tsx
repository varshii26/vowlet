"use client";

import { ClauseChip } from "@/components/Clauses/ClauseChip";
import { describeShift } from "@/components/Gantt/tooltip";
import { formatCents } from "@/lib/money";
import type { WhatIfPreviewView, WhatIfRowView } from "@/lib/whatif/client";

export type WhatIfState =
  | { status: "loading" }
  | { status: "ready"; preview: WhatIfPreviewView }
  | { status: "error"; message: string };

/** The short written summary. It is optional: on failure the panel simply shows none. */
export type ExplanationState = { status: "loading" } | { status: "ready"; text: string } | { status: "none" };

type Props = {
  currentDate: string;
  newDate: string;
  shiftDays: number;
  /** Payments due relative to the wedding date: they moved with it. */
  movedCount: number;
  /** Payments on a fixed or signing date: they stay put. */
  fixedCount: number;
  state: WhatIfState;
  explanation?: ExplanationState;
  applying: boolean;
  applyError: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

const longDay = (iso: string) =>
  new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Citation({ row }: { row: WhatIfRowView }) {
  if (!row.citation) return null;
  return <ClauseChip label={row.citation} clause={row.clause} />;
}

function FeeTable({ rows }: { rows: WhatIfRowView[] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs uppercase tracking-wide text-neutral-500">
        <tr>
          <th className="py-1 pr-3 font-medium">Vendor</th>
          <th className="py-1 pr-3 text-right font-medium">Fee</th>
          <th className="py-1 font-medium">Why</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.vendorId} className="border-t border-neutral-100 align-top">
            <td className="py-1.5 pr-3 font-medium">{row.vendorName}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{formatCents(row.costCents)}</td>
            <td className="space-x-2 py-1.5 text-neutral-600">
              <span>{row.basis}</span>
              <Citation row={row} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * What moving the wedding to the dropped date would cost, vendor by vendor.
 * Every amount comes from the server's `dateChangeCost()`; this only displays
 * it. Nothing is saved until the couple presses the confirm button.
 */
export function WhatIfPanel({ currentDate, newDate, shiftDays, movedCount, fixedCount, state, explanation = { status: "none" }, applying, applyError, onConfirm, onCancel }: Props) {
  const ready = state.status === "ready" ? state.preview : null;
  const fees = ready?.rows.filter((r) => r.kind === "fee") ?? [];
  const free = ready?.rows.filter((r) => r.kind === "free") ?? [];
  const check = ready?.rows.filter((r) => r.kind === "check") ?? [];

  return (
    <section aria-labelledby="whatif-heading" className="space-y-4 rounded-lg border border-pink-200 bg-pink-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 id="whatif-heading" className="text-lg font-semibold">
            What if the wedding moves to {longDay(newDate)}?
          </h2>
          <p className="text-sm text-neutral-700">
            {describeShift(shiftDays)} than {longDay(currentDate)}. {plural(movedCount, "payment")} tied to the wedding date moved with it on the timeline
            {fixedCount > 0 ? `; ${plural(fixedCount, "payment")} on fixed or signing dates stay put` : ""}.
          </p>
        </div>
        <p className="text-right" aria-live="polite">
          <span className="block text-2xl font-semibold tabular-nums">{ready ? formatCents(ready.totalCents) : "..."}</span>
          <span className="block text-xs text-neutral-500">in date-change fees</span>
        </p>
      </div>

      {ready && (
        <p className="text-sm text-neutral-700" data-testid="whatif-notice">
          Telling vendors today gives them {plural(ready.noticeDays, "day")}&apos; notice before {longDay(currentDate)}. Each contract sets its fee by
          that notice, so the fee is the same whichever new date you pick.
        </p>
      )}

      {state.status === "loading" && <p className="text-sm text-neutral-600">Working out each vendor&apos;s fee from their contract...</p>}
      {state.status === "error" && (
        <p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {state.message}
        </p>
      )}

      {ready && explanation.status === "loading" && (
        <p className="text-sm italic text-neutral-500" aria-live="polite">
          Writing a short summary...
        </p>
      )}
      {ready && explanation.status === "ready" && (
        <p className="text-sm text-neutral-800" aria-live="polite" data-testid="whatif-explanation">
          {explanation.text}
        </p>
      )}

      {ready && (
        <div className="space-y-3">
          {fees.length > 0 ? (
            <FeeTable rows={fees} />
          ) : (
            <p className="text-sm text-neutral-700">No vendor charges for this move.</p>
          )}

          {check.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
              <p className="font-medium">Check these contracts: no date-change terms were found, so the fee is unknown.</p>
              <ul className="mt-1 list-disc pl-5">
                {check.map((row) => (
                  <li key={row.vendorId}>{row.vendorName}</li>
                ))}
              </ul>
            </div>
          )}

          {free.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-neutral-700">{plural(free.length, "vendor")} won&apos;t charge for this move</summary>
              <ul className="mt-1 space-y-1 pl-5">
                {free.map((row) => (
                  <li key={row.vendorId} className="space-x-2">
                    <span className="font-medium">{row.vendorName}</span>
                    <span className="text-neutral-600">{row.basis}</span>
                    <Citation row={row} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {applyError && (
        <p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {applyError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onConfirm}
          disabled={!ready || applying}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {applying ? "Moving the wedding..." : `Move the wedding to ${longDay(newDate)}`}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={applying}
          className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          Cancel
        </button>
        <span className="text-xs text-neutral-500">Nothing is saved until you confirm.</span>
      </div>
    </section>
  );
}
