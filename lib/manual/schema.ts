import { z } from "zod";
import { cancellationRuleSchema, dateChangeRuleSchema } from "@/lib/rules";
import { isoDate } from "@/lib/upload/schema";

/**
 * A vendor the couple types in by hand, for when there is no contract to upload.
 * Shared by the form (browser) and POST /api/vendors/manual (server), so they can't
 * disagree. Browser-safe: no server imports. No clause quotes or pages: there is no
 * contract to cite, so nothing is "verified" and nothing is flagged.
 */
const cents = z.number().int().nonnegative().max(1_000_000_000);

export const manualPaymentSchema = z
  .object({
    label: z.string().trim().min(1, "Name this payment.").max(120),
    amountCents: cents.refine((v) => v > 0, "Enter an amount above zero."),
    anchor: z.enum(["wedding_date", "signing_date", "fixed"]),
    /** Days from the anchor: negative is before it. Ignored for a fixed date. */
    offsetDays: z.number().int().min(-3650).max(3650),
    fixedDate: isoDate.nullable(),
  })
  .refine((p) => p.anchor !== "fixed" || p.fixedDate !== null, { message: "Pick the date.", path: ["fixedDate"] });

export const manualVendorSchema = z.object({
  vendorName: z.string().trim().min(1, "Enter the vendor's name.").max(120),
  category: z.string().trim().min(1, "Pick or type a category.").max(40),
  /** Optional: blank means the server assigns a sandbox payee. */
  paypalEmail: z.union([z.literal(""), z.email("Enter a valid email address.").max(200)]),
  /** When the couple and vendor agreed: the anchor for "days after signing" payments. */
  signingDate: isoDate,
  payments: z.array(manualPaymentSchema).min(1, "Add at least one payment.").max(50),
  /** Optional terms: empty means the vendor agreed none, and the what-if and refund tools say so. */
  cancellationRules: z.array(cancellationRuleSchema).max(20),
  dateChangeRules: z.array(dateChangeRuleSchema).max(20),
  /** Anything else to put on the printed summary (a note for the vendor). */
  notes: z.string().trim().max(1000),
});

export type ManualPayment = z.infer<typeof manualPaymentSchema>;
export type ManualVendor = z.infer<typeof manualVendorSchema>;

/** The contract total is what the payments add up to: a total typed separately could only disagree with them. */
export const totalOf = (payments: readonly { amountCents: number }[]) => payments.reduce((sum, p) => sum + p.amountCents, 0);

/** "1,250", "$1,250.50" or "1250" to cents; null when it isn't an amount. */
export function parseDollarsToCents(raw: string): number | null {
  const text = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const dollars = Number(text);
  return dollars > 10_000_000 ? null : Math.round(dollars * 100);
}
