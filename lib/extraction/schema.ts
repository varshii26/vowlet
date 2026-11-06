import { z } from "zod";

/**
 * What the model returns for one vendor contract. One Zod schema serves three
 * jobs: it becomes the JSON Schema the model must follow, it validates what
 * comes back, and `toTerms` (terms.ts) turns it into cents and rule tiers.
 *
 * The model reads and quotes; code does the arithmetic. Amounts are strings so
 * "1500.50" can be parsed exactly, and percentages stay percentages until code
 * applies them to the total.
 *
 * No nullable fields: "not found" is `found: false`, which every model and
 * JSON Schema dialect handles.
 */

const evidence = {
  clauseQuote: z
    .string()
    .describe("The exact words from the contract that state this term, copied verbatim, within a single page."),
  page: z.number().int().min(1).describe("1-based page number the quote is on."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("How sure you are, 0 to 1. Use below 0.8 if the wording is vague, ambiguous or you had to infer a number."),
};

export const PAYMENT_ANCHORS = ["wedding_date", "signing_date", "fixed"] as const;

export const extractedPaymentSchema = z.object({
  label: z.string().describe("Short name of the payment, e.g. 'Venue deposit'."),
  amountType: z.enum(["fixed", "percent"]).describe("'fixed' for a dollar amount, 'percent' for a share of the total."),
  amount: z
    .string()
    .describe("A plain number, no symbols. Dollars for 'fixed' (e.g. 3000 or 1500.50). Percent for 'percent' (e.g. 25)."),
  anchor: z
    .enum(PAYMENT_ANCHORS)
    .describe("'wedding_date' if due relative to the event, 'signing_date' if due on signing, 'fixed' if due on a calendar date."),
  offsetDays: z
    .number()
    .int()
    .describe("Whole days from the anchor. Negative = before, positive = after, 0 for 'upon signing' or 'on the date'."),
  fixedDate: z.string().describe("YYYY-MM-DD when anchor is 'fixed'; otherwise an empty string."),
  ...evidence,
});

export const extractedCancellationSchema = z.object({
  found: z.boolean().describe("False if the contract has no cancellation or refund terms; then tiers is empty."),
  tiers: z
    .array(
      z.object({
        minNoticeDays: z.number().int().min(0).describe("Minimum written notice, in days, for this tier to apply."),
        refundPercent: z.number().min(0).max(100).describe("Percent of amounts paid that is refunded."),
        flatFee: z.string().describe("Flat fee withheld, plain dollars like '100', or '0'."),
      }),
    )
    .describe("One entry per notice tier, including a final tier for short notice (usually 0 days, 0% refund)."),
  ...evidence,
});

export const extractedDateChangeSchema = z.object({
  found: z.boolean().describe("False if the contract has no terms about changing the event date; then tiers is empty."),
  tiers: z
    .array(
      z.object({
        minNoticeDays: z.number().int().min(0).describe("Minimum written notice, in days, for this tier to apply."),
        feePercent: z.number().min(0).max(100).describe("Fee as a percent of the total contract price."),
        flatFee: z.string().describe("Flat fee, plain dollars like '150', or '0'."),
      }),
    )
    .describe("One entry per notice tier, including a final tier for short notice (usually 0 days)."),
  ...evidence,
});

export const contractExtractionSchema = z.object({
  vendorName: z.string(),
  category: z.string().describe("One word, e.g. venue, caterer, photographer, florist."),
  totalAmount: z.string().describe("Total contract price, plain dollars like '9000'."),
  payments: z.array(extractedPaymentSchema).describe("Every payment the Client must make, in contract order."),
  cancellation: extractedCancellationSchema,
  dateChange: extractedDateChangeSchema,
});

export type ContractExtraction = z.infer<typeof contractExtractionSchema>;
export type ExtractedPayment = z.infer<typeof extractedPaymentSchema>;

/**
 * The same schema as plain JSON Schema, for the model. `$schema` is dropped
 * because the Gemini API rejects it.
 */
export function contractExtractionJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(contractExtractionSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}
