import type { ContractExtraction, ExtractedPayment } from "@/lib/extraction/schema";

/** A valid extraction for tests: Grand Oak Estate, three payments, strict terms. */
export function payment(over: Partial<ExtractedPayment> = {}): ExtractedPayment {
  return {
    label: "Venue deposit",
    amountType: "fixed",
    amount: "3000",
    anchor: "signing_date",
    offsetDays: 0,
    fixedDate: "",
    clauseQuote: "The Client shall pay $3,000 (Venue deposit) upon signing this agreement.",
    page: 1,
    confidence: 0.95,
    ...over,
  };
}

export function extraction(over: Partial<ContractExtraction> = {}): ContractExtraction {
  return {
    vendorName: "Grand Oak Estate",
    category: "venue",
    totalAmount: "9000",
    payments: [
      payment(),
      payment({
        label: "Venue second installment",
        anchor: "wedding_date",
        offsetDays: -120,
        clauseQuote: "The Client shall pay $3,000 (Venue second installment) no later than 120 days before the Event Date.",
      }),
      payment({
        label: "Venue final balance",
        anchor: "wedding_date",
        offsetDays: -30,
        clauseQuote: "The Client shall pay $3,000 (Venue final balance) no later than 30 days before the Event Date.",
      }),
    ],
    cancellation: {
      found: true,
      tiers: [
        { minNoticeDays: 90, refundPercent: 50, flatFee: "0" },
        { minNoticeDays: 0, refundPercent: 0, flatFee: "0" },
      ],
      clauseQuote: "Cancellation by the Client: with at least 90 days' written notice, 50% of payments made will be refunded",
      page: 2,
      confidence: 0.9,
    },
    dateChange: {
      found: true,
      tiers: [
        { minNoticeDays: 120, feePercent: 5, flatFee: "0" },
        { minNoticeDays: 0, feePercent: 30, flatFee: "0" },
      ],
      clauseQuote: "Change of Event Date: with at least 120 days' written notice, a fee of 5% of the total contract price applies",
      page: 2,
      confidence: 0.9,
    },
    ...over,
  };
}
