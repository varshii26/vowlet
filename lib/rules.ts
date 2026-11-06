import { z } from "zod";

// Money is integer cents everywhere.
const cents = z.number().int().nonnegative();
const days = z.number().int().nonnegative();

/**
 * Tiered cancellation terms. The tier with the largest `minNoticeDays` that is
 * <= the notice given applies. `refundPercent` is of the amount already paid;
 * `flatFee` is withheld on top (cents).
 */
export const cancellationRuleSchema = z.object({
  minNoticeDays: days,
  refundPercent: z.number().min(0).max(100),
  flatFee: cents,
});
export const cancellationRulesSchema = z.array(cancellationRuleSchema);

/**
 * Tiered date-change terms. Same tier selection as cancellation. The fee is
 * `feePercent` of the vendor's total cost plus `flatFee` (cents).
 */
export const dateChangeRuleSchema = z.object({
  minNoticeDays: days,
  feePercent: z.number().min(0).max(100),
  flatFee: cents,
});
export const dateChangeRulesSchema = z.array(dateChangeRuleSchema);

export const clauseIdsSchema = z.array(z.string());

export type CancellationRule = z.infer<typeof cancellationRuleSchema>;
export type DateChangeRule = z.infer<typeof dateChangeRuleSchema>;
