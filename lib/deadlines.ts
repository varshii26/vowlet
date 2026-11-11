/**
 * Contract deadlines for the timeline: the last day each vendor's current
 * date-change or cancellation tier still applies. After that day the couple
 * gives less notice than the tier needs, and the next (worse) tier kicks in.
 *
 * Pure code over the extracted terms, using the same tier selection and money
 * math as the agent (lib/terms.ts). The model never computes these dates.
 */
import { formatCents } from "@/lib/money";
import type { CancellationRule, DateChangeRule } from "@/lib/rules";
import { addDaysUtc, daysBetweenUtc, startOfUtcDay, toIsoDate } from "@/lib/schedule";
import { dateChangeFee, refundOwed, type RefundPayment } from "@/lib/terms";

export type DeadlineKind = "date_change" | "cancellation";

export type Deadline = {
  kind: DeadlineKind;
  /** `YYYY-MM-DD`: the last day this tier applies. */
  isoDate: string;
  /** "Last day to change the date for free" */
  title: string;
  /** What applies up to and including that day. */
  until: string;
  /** What applies from the next day. */
  after: string;
  /** The contract clause the terms come from. */
  clauseId: string | null;
  clausePage: number | null;
};

export type DeadlineTerms = {
  cancellation: CancellationRule[];
  dateChange: DateChangeRule[];
  cancellationClause: { id: string; page: number } | null;
  dateChangeClause: { id: string; page: number } | null;
};

export type DeadlineInput = {
  weddingDate: Date;
  today: Date;
  totalCostCents: number;
  payments: RefundPayment[];
  terms: DeadlineTerms;
};

type Tiered = { minNoticeDays: number };

/**
 * The tier that applies today, if it still has a future last day, and the tier
 * after it. Tiers with no notice requirement never run out, so they have none.
 */
function currentTier<T extends Tiered>(rules: T[], weddingDate: Date, today: Date): { rule: T; next: T | null; lastDay: Date } | null {
  const sorted = [...rules].sort((a, b) => b.minNoticeDays - a.minNoticeDays);
  for (let i = 0; i < sorted.length; i++) {
    const rule = sorted[i];
    if (rule.minNoticeDays <= 0) return null;
    const lastDay = addDaysUtc(weddingDate, -rule.minNoticeDays);
    if (daysBetweenUtc(today, lastDay) >= 0) return { rule, next: sorted[i + 1] ?? null, lastDay };
  }
  return null;
}

const feeText = (cents: number) => (cents === 0 ? "free" : `a ${formatCents(cents)} fee`);

function dateChangeDeadline(input: DeadlineInput): Deadline | null {
  const { weddingDate, today, totalCostCents, terms } = input;
  const tier = currentTier(terms.dateChange, weddingDate, today);
  if (!tier) return null;
  const fee = dateChangeFee(totalCostCents, tier.rule);
  const nextFee = tier.next ? dateChangeFee(totalCostCents, tier.next) : null;
  return {
    kind: "date_change",
    isoDate: toIsoDate(tier.lastDay),
    title: fee === 0 ? "Last day to change the date for free" : `Last day to change the date for ${formatCents(fee)}`,
    until: `Moving the date: ${feeText(fee)} (${tier.rule.minNoticeDays}+ days' notice).`,
    after: nextFee === null ? "After that: the contract sets no terms; check with the vendor." : `After that: ${feeText(nextFee)}.`,
    clauseId: terms.dateChangeClause?.id ?? null,
    clausePage: terms.dateChangeClause?.page ?? null,
  };
}

function cancellationDeadline(input: DeadlineInput): Deadline | null {
  const { weddingDate, today, payments, terms } = input;
  const tier = currentTier(terms.cancellation, weddingDate, today);
  if (!tier) return null;
  // What cancelling on the last day, and the day after, would refund of what
  // is paid today: the same refundOwed() the agent uses.
  const refundOn = (day: Date) =>
    refundOwed({ cancelledBy: "couple", rules: terms.cancellation, clauseId: null, payments, weddingDate, cancellationDate: day });
  const onLastDay = refundOn(tier.lastDay);
  const dayAfter = refundOn(addDaysUtc(tier.lastDay, 1));
  const describe = (percent: number | undefined, owed: number) =>
    `${percent ?? 0}% refunded${onLastDay.paidCents > 0 ? ` (${formatCents(owed)} of the ${formatCents(onLastDay.paidCents)} paid so far)` : ""}`;
  return {
    kind: "cancellation",
    isoDate: toIsoDate(tier.lastDay),
    title: `Last day to cancel for a ${tier.rule.refundPercent}% refund`,
    until: `Cancelling: ${describe(onLastDay.appliedRule?.refundPercent, onLastDay.owedCents)}.`,
    after: `After that: ${describe(dayAfter.appliedRule?.refundPercent, dayAfter.owedCents)}.`,
    clauseId: terms.cancellationClause?.id ?? null,
    clausePage: terms.cancellationClause?.page ?? null,
  };
}

/**
 * The next date-change and cancellation deadline for one vendor, as of
 * `today`. Either is left out when no tier with a notice period still lies
 * ahead. Both move with the wedding date.
 */
export function nextDeadlines(input: DeadlineInput): Deadline[] {
  const normalized = { ...input, weddingDate: startOfUtcDay(input.weddingDate), today: startOfUtcDay(input.today) };
  return [dateChangeDeadline(normalized), cancellationDeadline(normalized)].filter((d): d is Deadline => d !== null);
}
