import type { CancellationRule, DateChangeRule } from "@/lib/rules";
import type { PaymentSpec } from "@/lib/seed/demo-data";

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

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

export function paymentClause(p: PaymentSpec) {
  return {
    text: `The Client shall pay ${money(p.amountCents)} (${p.label}) ${whenText(p)}.`,
    summary: `${money(p.amountCents)} ${p.label.toLowerCase()}, due ${whenText(p)}`,
  };
}

export function cancellationClause(rules: CancellationRule[]) {
  const tiers = sortDesc(rules).map((r) => {
    const fee = r.flatFee > 0 ? `, less a ${money(r.flatFee)} administrative fee` : "";
    if (r.refundPercent === 0) {
      return `if the Client cancels with fewer than the notice period above, no refund is due`;
    }
    return `with at least ${r.minNoticeDays} days' written notice, ${r.refundPercent}% of payments made will be refunded${fee}`;
  });
  return {
    text: `Cancellation by the Client: ${tiers.join("; ")}.`,
    summary: sortDesc(rules)
      .map((r) => `${r.minNoticeDays}+ days: ${r.refundPercent}% refund`)
      .join(", "),
  };
}

export function dateChangeClause(rules: DateChangeRule[]) {
  const tiers = sortDesc(rules).map((r) => {
    const parts: string[] = [];
    if (r.feePercent > 0) parts.push(`${r.feePercent}% of the total contract price`);
    if (r.flatFee > 0) parts.push(`a flat fee of ${money(r.flatFee)}`);
    const fee = parts.length > 0 ? `a fee of ${parts.join(" plus ")} applies` : "no fee applies";
    return `with at least ${r.minNoticeDays} days' written notice, ${fee}`;
  });
  return {
    text: `Change of Event Date: ${tiers.join("; ")}.`,
    summary: sortDesc(rules)
      .map((r) => `${r.minNoticeDays}+ days: ${r.feePercent}%${r.flatFee > 0 ? ` + ${money(r.flatFee)}` : ""}`)
      .join(", "),
  };
}
