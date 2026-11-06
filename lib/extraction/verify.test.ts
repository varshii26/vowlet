import { describe, expect, it } from "vitest";
import { extraction, payment } from "@/lib/extraction/fixtures";
import { toTerms } from "@/lib/extraction/terms";
import { CONFIDENCE_THRESHOLD, checkEvidence, verifyTerms } from "@/lib/extraction/verify";

const page1 = [
  "Venue Rental Agreement",
  "The Client shall pay $3,000 (Venue deposit) upon signing this agreement.",
  "The Client shall pay $3,000 (Venue second installment) no later than 120 days before the Event Date.",
  "The Client shall pay $3,000 (Venue final balance) no later than 30 days before the Event Date.",
].join("\n");
const page2 =
  "Cancellation by the Client: with at least 90 days' written notice, 50% of payments made will be refunded; shorter notice results in no refund.\n" +
  "Change of Event Date: with at least 120 days' written notice, a fee of 5% of the total contract price applies; otherwise 30%.";
const pages = [page1, page2];

function terms(over: Parameters<typeof extraction>[0] = {}) {
  const result = toTerms(extraction(over));
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.terms;
}

describe("checkEvidence", () => {
  const item = { clauseQuote: "The Client shall pay $3,000 (Venue deposit) upon signing this agreement.", page: 1, confidence: 0.95 };

  it("verifies a quote that is in the PDF and keeps its confidence", () => {
    expect(checkEvidence(item, pages)).toMatchObject({ quoteVerified: true, needsReview: false, confidence: 0.95, page: 1 });
  });

  it("corrects a page the model got wrong", () => {
    expect(checkEvidence({ ...item, page: 2 }, pages)).toMatchObject({ quoteVerified: true, page: 1 });
  });

  it("zeroes confidence and flags review when the quote is not in the PDF", () => {
    const result = checkEvidence({ ...item, clauseQuote: "The Client shall pay $30,000 (Venue deposit) upon signing this agreement." }, pages);
    expect(result).toMatchObject({ quoteVerified: false, needsReview: true, confidence: 0 });
  });

  it("flags review, but keeps the confidence, for a verified quote the model was unsure about", () => {
    const result = checkEvidence({ ...item, confidence: 0.6 }, pages);
    expect(result).toMatchObject({ quoteVerified: true, needsReview: true, confidence: 0.6 });
  });

  it("treats exactly the threshold as confident", () => {
    expect(CONFIDENCE_THRESHOLD).toBe(0.8);
    expect(checkEvidence({ ...item, confidence: 0.8 }, pages).needsReview).toBe(false);
    expect(checkEvidence({ ...item, confidence: 0.79 }, pages).needsReview).toBe(true);
  });

  it("treats an empty quote as unverified", () => {
    expect(checkEvidence({ ...item, clauseQuote: "" }, pages)).toMatchObject({ quoteVerified: false, needsReview: true, confidence: 0 });
  });

  it("does not change the other fields", () => {
    expect(checkEvidence({ ...item, label: "keep me" }, pages)).toMatchObject({ label: "keep me" });
  });
});

describe("verifyTerms", () => {
  it("verifies every quote in a correct extraction", () => {
    const v = verifyTerms(terms(), pages);
    expect(v.payments.every((p) => p.quoteVerified && !p.needsReview)).toBe(true);
    expect(v.cancellation).toMatchObject({ quoteVerified: true, needsReview: false });
    expect(v.dateChange).toMatchObject({ quoteVerified: true, needsReview: false });
    expect(v.quoteChecks).toEqual({ total: 5, verified: 5 });
  });

  it("flags only the term whose quote is made up", () => {
    const e = extraction();
    e.payments[1].clauseQuote = "The Client shall pay $2,000 (Venue second installment) at some point.";
    const v = verifyTerms(terms(e), pages);
    expect(v.payments.map((p) => p.needsReview)).toEqual([false, true, false]);
    expect(v.payments[1].confidence).toBe(0);
    expect(v.quoteChecks).toEqual({ total: 5, verified: 4 });
  });

  it("flags a vague clause for review even when the quote is real", () => {
    const e = extraction({ payments: [payment({ confidence: 0.55 })] });
    const v = verifyTerms(terms(e), pages);
    expect(v.payments[0]).toMatchObject({ quoteVerified: true, needsReview: true });
  });

  it("leaves absent terms alone: nothing to quote, nothing to confirm", () => {
    const none = { found: false, tiers: [], clauseQuote: "", page: 1, confidence: 1 };
    const v = verifyTerms(terms({ cancellation: none, dateChange: none }), pages);
    expect(v.cancellation).toMatchObject({ found: false, needsReview: false, quoteVerified: false });
    expect(v.dateChange).toMatchObject({ found: false, needsReview: false });
    expect(v.quoteChecks).toEqual({ total: 3, verified: 3 }); // only the three payments are checked
  });

  it("keeps everything else in the terms", () => {
    const v = verifyTerms(terms(), pages);
    expect(v).toMatchObject({ vendorName: "Grand Oak Estate", category: "venue", totalCents: 900_000 });
    expect(v.cancellation.rules).toHaveLength(2);
  });
});
