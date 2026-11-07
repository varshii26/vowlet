import { z } from "zod";
import { cancellationRulesSchema, dateChangeRulesSchema } from "@/lib/rules";

/**
 * The contract terms after the couple reviewed them on the upload page. The
 * browser sends this with the PDF to POST /api/contracts/confirm, and the
 * server validates it here before writing anything. Browser-safe: no server
 * imports, so the review form can share the types.
 *
 * Every term that was flagged for review (low confidence or a quote that isn't
 * in the PDF) must carry `acknowledged: true`: the couple either edited it or
 * ticked "I've checked this". The server also re-checks every quote against the
 * PDF, so a client that clears `flagged` can't skip the confirmation.
 */

const cents = z.number().int().nonnegative().max(1_000_000_000);

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date written YYYY-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "must be a real calendar date");

const review = {
  clauseQuote: z.string().max(4000),
  page: z.number().int().min(1).max(500),
  /** Shown with a "Please confirm" badge on the upload page. */
  flagged: z.boolean(),
  /** The couple edited it or ticked "I've checked this". */
  acknowledged: z.boolean(),
};

export const reviewedPaymentSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    amountCents: cents.refine((v) => v > 0, "must be above zero"),
    anchor: z.enum(["wedding_date", "signing_date", "fixed"]),
    offsetDays: z.number().int().min(-3650).max(3650),
    fixedDate: isoDate.nullable(),
    ...review,
  })
  .refine((p) => p.anchor !== "fixed" || p.fixedDate !== null, { message: "a fixed-date payment needs a date", path: ["fixedDate"] });

export const reviewedCancellationSchema = z.object({ found: z.boolean(), rules: cancellationRulesSchema.max(20), ...review });
export const reviewedDateChangeSchema = z.object({ found: z.boolean(), rules: dateChangeRulesSchema.max(20), ...review });

export const reviewedContractSchema = z
  .object({
    vendorName: z.string().trim().min(1).max(120),
    category: z.string().trim().min(1).max(40),
    /** Optional: blank means the server assigns a sandbox payee. */
    paypalEmail: z.union([z.literal(""), z.email().max(200)]),
    signingDate: isoDate,
    totalCents: cents,
    payments: z.array(reviewedPaymentSchema).min(1).max(50),
    cancellation: reviewedCancellationSchema,
    dateChange: reviewedDateChangeSchema,
  })
  .superRefine((c, ctx) => {
    for (const [name, term] of [["cancellation", c.cancellation], ["dateChange", c.dateChange]] as const) {
      if (term.found && term.rules.length === 0) {
        ctx.addIssue({ code: "custom", path: [name, "rules"], message: "add at least one tier, or mark the terms as not in the contract" });
      }
    }
  });

export type ReviewedPayment = z.infer<typeof reviewedPaymentSchema>;
export type ReviewedContract = z.infer<typeof reviewedContractSchema>;

/** A term that still needs the couple's confirmation, by a readable name. */
export function unacknowledged(contract: ReviewedContract): string[] {
  const names: string[] = [];
  contract.payments.forEach((p) => {
    if (p.flagged && !p.acknowledged) names.push(`payment "${p.label}"`);
  });
  if (contract.cancellation.found && contract.cancellation.flagged && !contract.cancellation.acknowledged) names.push("cancellation terms");
  if (contract.dateChange.found && contract.dateChange.flagged && !contract.dateChange.acknowledged) names.push("date-change terms");
  return names;
}
