/**
 * Contract-terms math: what a date change costs and what a cancellation
 * refunds. Pure TypeScript; the LLM never computes these numbers.
 *
 * Money is integer cents. Dates are UTC calendar days. Tier selection: the rule
 * with the largest `minNoticeDays` that is <= the notice given applies. Notice
 * is clamped at zero, so changes made on or after the original date use the
 * shortest-notice tier.
 */
import { formatCents, percentOf } from "@/lib/money";
import type { CancellationRule, DateChangeRule } from "@/lib/rules";
import { daysBetweenUtc } from "@/lib/schedule";

type Tiered = { minNoticeDays: number };

/** The applicable tier for the notice given, or null if none qualifies. */
export function pickTier<T extends Tiered>(rules: T[], noticeDays: number): T | null {
  const notice = Math.max(0, noticeDays);
  const sorted = [...rules].sort((a, b) => b.minNoticeDays - a.minNoticeDays);
  return sorted.find((rule) => rule.minNoticeDays <= notice) ?? null;
}

// ---------------------------------------------------------------- date change

export type DateChangeVendor = {
  vendorId: string;
  vendorName: string;
  /** Contract total, cents. */
  totalCostCents: number;
  status: "active" | "cancelled";
  dateChangeRules: DateChangeRule[];
  /** The contract clause the date-change terms come from. */
  clauseId: string | null;
};

export type DateChangeRow = {
  vendorId: string;
  vendorName: string;
  costCents: number;
  clauseId: string | null;
  /** Days between today and the original wedding date. */
  noticeDays: number;
  /** The tier that was applied, or null when no terms apply. */
  appliedRule: DateChangeRule | null;
  /** Plain-language explanation, safe to show the couple. */
  reason: string;
};

export type DateChangeResult = {
  rows: DateChangeRow[];
  totalCents: number;
};

export type DateChangeInput = {
  vendors: DateChangeVendor[];
  originalDate: Date;
  newDate: Date;
  today: Date;
};

/**
 * Fee for each vendor if the wedding moves from `originalDate` to `newDate`,
 * requested `today`. Notice is measured from today to the ORIGINAL date.
 * Fee = feePercent of the contract total + flatFee. Cancelled vendors cost
 * nothing. A vendor with no applicable tier costs 0 and says so in `reason`;
 * callers should surface that rather than imply the change is free.
 */
export function dateChangeCost(input: DateChangeInput): DateChangeResult {
  const { vendors, originalDate, newDate, today } = input;
  if (daysBetweenUtc(today, newDate) < 0) throw new RangeError("newDate cannot be in the past");

  const unchanged = daysBetweenUtc(originalDate, newDate) === 0;
  const noticeDays = daysBetweenUtc(today, originalDate);

  const rows = vendors.map((vendor): DateChangeRow => {
    const base = { vendorId: vendor.vendorId, vendorName: vendor.vendorName, clauseId: vendor.clauseId, noticeDays };

    if (vendor.status === "cancelled") {
      return { ...base, costCents: 0, appliedRule: null, reason: "Vendor is cancelled; no date-change fee." };
    }
    if (unchanged) {
      return { ...base, costCents: 0, appliedRule: null, reason: "The wedding date is unchanged." };
    }
    const rule = pickTier(vendor.dateChangeRules, noticeDays);
    if (!rule) {
      return { ...base, costCents: 0, appliedRule: null, reason: "No date-change terms apply; check the contract." };
    }
    const costCents = percentOf(vendor.totalCostCents, rule.feePercent) + rule.flatFee;
    return { ...base, costCents, appliedRule: rule, reason: dateChangeReason(rule, noticeDays, costCents) };
  });

  return { rows, totalCents: rows.reduce((sum, row) => sum + row.costCents, 0) };
}

function dateChangeReason(rule: DateChangeRule, noticeDays: number, costCents: number): string {
  const notice = `${Math.max(0, noticeDays)} days' notice`;
  if (costCents === 0) return `Free with ${notice} (needs at least ${rule.minNoticeDays}).`;
  const parts: string[] = [];
  if (rule.feePercent > 0) parts.push(`${rule.feePercent}% of the contract`);
  if (rule.flatFee > 0) parts.push(`a ${formatCents(rule.flatFee)} flat fee`);
  return `${formatCents(costCents)} (${parts.join(" plus ")}) with ${notice}.`;
}

// ----------------------------------------------------------------- cancellation

export type CancelledBy = "couple" | "vendor";

export type RefundPayment = {
  amountCents: number;
  status: "scheduled" | "due" | "paid" | "refund_requested" | "refunded" | "void";
};

export type RefundInput = {
  cancelledBy: CancelledBy;
  rules: CancellationRule[];
  /** The contract clause the cancellation terms come from. */
  clauseId: string | null;
  payments: RefundPayment[];
  weddingDate: Date;
  /** The day the cancellation takes effect. */
  cancellationDate: Date;
};

export type RefundResult = {
  /** Cents the vendor owes back to the couple. */
  owedCents: number;
  /** Cents the couple has actually paid this vendor. */
  paidCents: number;
  /** Cents the vendor keeps (paid minus owed). */
  retainedCents: number;
  noticeDays: number;
  cancelledBy: CancelledBy;
  /** The tier applied; null when the vendor cancelled or no tier qualified. */
  appliedRule: CancellationRule | null;
  clauseId: string | null;
  reason: string;
};

/**
 * What the vendor owes back after a cancellation. Only payments with status
 * `paid` count; refunded, refund-requested, void and unpaid ones do not.
 *
 * - Vendor cancels: everything paid is owed back, no fees. (Assumption: the
 *   contracts treat a vendor cancellation as a full refund. Contracts that say
 *   otherwise would need their own rule.)
 * - Couple cancels: the tier for the notice given applies. The refund is
 *   `refundPercent` of what was paid, less the tier's `flatFee`, never below 0.
 *   With no qualifying tier nothing is refunded.
 */
export function refundOwed(input: RefundInput): RefundResult {
  const { cancelledBy, rules, clauseId, payments, weddingDate, cancellationDate } = input;
  const paidCents = payments.filter((p) => p.status === "paid").reduce((sum, p) => sum + p.amountCents, 0);
  const noticeDays = daysBetweenUtc(cancellationDate, weddingDate);
  const base = { paidCents, noticeDays, cancelledBy, clauseId };

  if (cancelledBy === "vendor") {
    return {
      ...base,
      owedCents: paidCents,
      retainedCents: 0,
      appliedRule: null,
      reason: `Vendor cancelled, so all ${formatCents(paidCents)} paid is owed back.`,
    };
  }

  const rule = pickTier(rules, noticeDays);
  if (!rule) {
    return {
      ...base,
      owedCents: 0,
      retainedCents: paidCents,
      appliedRule: null,
      reason: "No cancellation terms apply; check the contract.",
    };
  }

  const refundable = percentOf(paidCents, rule.refundPercent);
  const owedCents = Math.max(0, refundable - rule.flatFee);
  return {
    ...base,
    owedCents,
    retainedCents: paidCents - owedCents,
    appliedRule: rule,
    reason: refundReason(rule, Math.max(0, noticeDays), paidCents, owedCents),
  };
}

function refundReason(rule: CancellationRule, noticeDays: number, paidCents: number, owedCents: number): string {
  const fee = rule.flatFee > 0 ? `, less a ${formatCents(rule.flatFee)} fee` : "";
  return `${noticeDays} days' notice: ${rule.refundPercent}% of ${formatCents(paidCents)} paid${fee} = ${formatCents(owedCents)} owed back.`;
}
