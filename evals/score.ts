import type { VerifiedTerms } from "@/lib/extraction/verify";
import type { VendorSpec } from "@/lib/seed/demo-data";

/** What a correct extraction contains. A `VendorSpec` satisfies it, and so does an `evals/expected/*.json` file. */
export type Expected = Pick<VendorSpec, "slug" | "payments" | "cancellation" | "dateChange">;

/**
 * Scores one extraction against the demo data the contract was generated from.
 * Amounts, anchors, offsets and rules must match exactly: a close number is a
 * wrong number when the number is money.
 */

export type ExtractionScore = {
  /** Fields that match, out of fields scored. Payments count one each. */
  correct: number;
  total: number;
  accuracy: number;
  paymentsMatched: number;
  paymentsExpected: number;
  paymentsExtra: number;
  totalMatches: boolean;
  cancellationMatches: boolean;
  dateChangeMatches: boolean;
  /** Share of quotes that really appear in the PDF. */
  quoteRate: number;
  /**
   * Did the review flags land right? The deliberately vague payment should be
   * flagged, every plain one should not.
   */
  flags: { vagueFlagged: boolean | null; plainFlagged: number; plainTotal: number };
};

const paymentKey = (p: { amountCents: number; anchor: string; offsetDays: number; fixedDate: string | null }) =>
  [p.amountCents, p.anchor, p.anchor === "fixed" ? 0 : p.offsetDays, p.fixedDate ?? ""].join("|");

const tiersKey = (tiers: Array<Record<string, number>>, percentField: string) =>
  [...tiers]
    .sort((a, b) => b.minNoticeDays - a.minNoticeDays)
    .map((t) => `${t.minNoticeDays}:${t[percentField]}:${t.flatFee}`)
    .join(",");

export function scoreExtraction(spec: Expected, terms: VerifiedTerms): ExtractionScore {
  // Payments: each expected payment is matched at most once, on every field.
  const remaining = new Map<string, number>();
  for (const p of spec.payments) {
    const key = paymentKey({ amountCents: p.amountCents, anchor: p.anchor, offsetDays: p.offsetDays ?? 0, fixedDate: p.fixedDate ?? null });
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  let paymentsMatched = 0;
  for (const p of terms.payments) {
    const key = paymentKey(p);
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      paymentsMatched++;
      remaining.set(key, left - 1);
    }
  }

  const totalMatches = terms.totalCents === spec.payments.reduce((sum, p) => sum + p.amountCents, 0);
  const cancellationMatches =
    terms.cancellation.found && tiersKey(terms.cancellation.rules as never, "refundPercent") === tiersKey(spec.cancellation as never, "refundPercent");
  const dateChangeMatches =
    terms.dateChange.found && tiersKey(terms.dateChange.rules as never, "feePercent") === tiersKey(spec.dateChange as never, "feePercent");

  const total = spec.payments.length + 3; // payments, total, cancellation, date change
  const correct = paymentsMatched + Number(totalMatches) + Number(cancellationMatches) + Number(dateChangeMatches);

  // Review flags. A payment is "vague" if the contract wording was made vague on purpose.
  const vagueIndexes = spec.payments.flatMap((p, i) => (p.ambiguousText ? [i] : []));
  const plain = terms.payments.filter((_, i) => !vagueIndexes.includes(i));
  const vague = vagueIndexes.map((i) => terms.payments[i]).filter(Boolean);

  return {
    correct,
    total,
    accuracy: correct / total,
    paymentsMatched,
    paymentsExpected: spec.payments.length,
    paymentsExtra: Math.max(0, terms.payments.length - spec.payments.length),
    totalMatches,
    cancellationMatches,
    dateChangeMatches,
    quoteRate: terms.quoteChecks.total === 0 ? 0 : terms.quoteChecks.verified / terms.quoteChecks.total,
    flags: {
      vagueFlagged: vague.length === 0 ? null : vague.every((p) => p.needsReview),
      plainFlagged: plain.filter((p) => p.needsReview).length,
      plainTotal: plain.length,
    },
  };
}
