import { formatCents as money } from "@/lib/money";
import type { CancellationRule, DateChangeRule } from "@/lib/rules";
import type { PaymentSpec, VendorSpec } from "@/lib/seed/demo-data";

/**
 * Contract clause wording. The sample PDFs and the seeded `Clause` rows both
 * come from here, so a clause quoted in the database appears word for word in
 * the contract, on the page the database says. Three wording styles keep the
 * 14 contracts from reading as one template.
 */

export const STYLE_COUNT = 3;
export type Style = 0 | 1 | 2;

/** Each vendor gets a style by position, so the mix is stable. */
export function vendorStyle(spec: VendorSpec, vendors: readonly VendorSpec[]): Style {
  const index = vendors.indexOf(spec);
  if (index < 0) throw new Error(`Unknown vendor ${spec.slug}`);
  return (index % STYLE_COUNT) as Style;
}

const sortDesc = <T extends { minNoticeDays: number }>(rules: T[]) =>
  [...rules].sort((a, b) => b.minNoticeDays - a.minNoticeDays);

function whenText(p: PaymentSpec): string {
  if (p.anchor === "signing_date") return "upon signing this agreement";
  if (p.anchor === "fixed") return `on or before ${p.fixedDate}`;
  const offset = p.offsetDays ?? 0;
  if (offset === 0) return "on the Event Date";
  const n = Math.abs(offset);
  const unit = n === 1 ? "day" : "days";
  return offset < 0
    ? `no later than ${n} ${unit} before the Event Date`
    : `within ${n} ${unit} after the Event Date`;
}

export function paymentClause(p: PaymentSpec, style: Style = 0) {
  const amount = money(p.amountCents);
  const when = whenText(p);
  const wording = [
    `The Client shall pay ${amount} (${p.label}) ${when}.`,
    `${p.label}: ${amount} is payable ${when}.`,
    `A payment of ${amount} (${p.label}) falls due ${when}.`,
  ];
  return {
    // A deliberately vague clause replaces the wording; `when` is then the
    // reading the couple confirmed, which extraction should flag as uncertain.
    text: p.ambiguousText ?? wording[style],
    summary: `${amount} ${p.label.toLowerCase()}, due ${when}`,
  };
}

export function cancellationClause(rules: CancellationRule[], style: Style = 0) {
  const feeText = (r: CancellationRule) =>
    r.flatFee > 0 ? `, less a non-refundable fee of ${money(r.flatFee)}` : "";

  const tiers = sortDesc(rules).map((r) => {
    switch (style) {
      case 0:
        return r.refundPercent === 0
          ? "with less notice than that, no refund is due"
          : `with at least ${r.minNoticeDays} days' written notice, ${r.refundPercent}% of payments made will be refunded${feeText(r)}`;
      case 1:
        return r.refundPercent === 0
          ? "shorter notice results in no refund"
          : `written notice of ${r.minNoticeDays} or more days results in a refund of ${r.refundPercent}% of amounts paid${feeText(r)}`;
      case 2:
        return r.refundPercent === 0
          ? "Any shorter notice forfeits all sums paid."
          : `Notice of at least ${r.minNoticeDays} days entitles the Client to ${r.refundPercent}% of all sums paid back${feeText(r)}.`;
    }
  });

  const text = [
    `Cancellation by the Client: ${tiers.join("; ")}.`,
    `If the Client terminates this Agreement: ${tiers.join("; ")}.`,
    `Termination by the Client. ${tiers.join(" ")}`,
  ][style];

  return {
    text,
    summary: sortDesc(rules)
      .map((r) => `${r.minNoticeDays}+ days: ${r.refundPercent}% refund`)
      .join(", "),
  };
}

export function dateChangeClause(rules: DateChangeRule[], style: Style = 0) {
  const feeParts = (r: DateChangeRule) => {
    const parts: string[] = [];
    if (r.feePercent > 0) parts.push(`${r.feePercent}% of the total contract price`);
    if (r.flatFee > 0) parts.push(`a flat fee of ${money(r.flatFee)}`);
    return parts.join(" plus ");
  };

  const tiers = sortDesc(rules).map((r) => {
    const fee = feeParts(r);
    switch (style) {
      case 0:
        return `with at least ${r.minNoticeDays} days' written notice, ${fee ? `a fee of ${fee} applies` : "no fee applies"}`;
      case 1:
        return `at least ${r.minNoticeDays} days' written notice: ${fee ? `a charge of ${fee}` : "no charge"}`;
      case 2:
        return `Written notice of at least ${r.minNoticeDays} days: ${fee ? `a rescheduling fee of ${fee}` : "no charge"}.`;
    }
  });

  const text = [
    `Change of Event Date: ${tiers.join("; ")}.`,
    `The Client may reschedule the Event Date as follows: ${tiers.join("; ")}.`,
    `Rescheduling. ${tiers.join(" ")}`,
  ][style];

  return {
    text,
    summary: sortDesc(rules)
      .map((r) => `${r.minNoticeDays}+ days: ${r.feePercent}%${r.flatFee > 0 ? ` + ${money(r.flatFee)}` : ""}`)
      .join(", "),
  };
}

export type PlacedClause = { text: string; summary: string; page: number };

export type VendorClauses = {
  payments: (PlacedClause & { payment: PaymentSpec })[];
  cancellation: PlacedClause;
  dateChange: PlacedClause;
  /** The billing addendum carrying a hidden instruction, for the one vendor that has it. */
  billingNotes?: PlacedClause;
};

/** Contract categories with a "Schedule A: Service Details" page after the terms. */
export const SCHEDULE_PAGE_CATEGORIES: ReadonlySet<string> = new Set(["venue", "caterer", "photographer"]);

/** The ordinary sentence the billing addendum opens with, before its fine print. */
export const BILLING_NOTES_INTRO =
  "Invoices are issued to the Client by email. Payments are made only through the payment method agreed with the Client.";

/** Every clause a vendor's contract contains, with its page. */
export function buildVendorClauses(spec: VendorSpec, style: Style): VendorClauses {
  return {
    payments: spec.payments.map((payment) => ({ payment, page: 1, ...paymentClause(payment, style) })),
    cancellation: { page: spec.cancellationPage ?? 2, ...cancellationClause(spec.cancellation, style) },
    dateChange: { page: 2, ...dateChangeClause(spec.dateChange, style) },
    ...(spec.hiddenInstruction
      ? {
          billingNotes: {
            // After the terms page and any addendum or schedule page.
            page: spec.cancellationPage === 3 || SCHEDULE_PAGE_CATEGORIES.has(spec.category) ? 4 : 3,
            text: `${BILLING_NOTES_INTRO} ${spec.hiddenInstruction}`,
            summary: "Billing notes. Contains text addressed to AI assistants, which Vowlet ignores.",
          },
        }
      : {}),
  };
}
