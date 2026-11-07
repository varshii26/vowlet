import { describe, expect, it } from "vitest";
import type { ExtractedTermsView } from "@/lib/upload/client";
import { buildReview, centsToInput, parseAmount, parseDollars, pendingConfirmations, toDraft } from "@/lib/upload/draft";

const ev = (over: Partial<{ confidence: number; quoteVerified: boolean; needsReview: boolean }> = {}) => ({
  clauseQuote: "The Client shall pay $3,000 upon signing.",
  page: 1,
  confidence: 0.95,
  quoteVerified: true,
  needsReview: false,
  ...over,
});

const terms: ExtractedTermsView = {
  vendorName: "Bloom & Thistle",
  category: "florist",
  totalCents: 400_050,
  payments: [
    { label: "Deposit", amountCents: 100_000, anchor: "signing_date", offsetDays: 0, fixedDate: null, ...ev() },
    { label: "Balance", amountCents: 300_050, anchor: "wedding_date", offsetDays: -14, fixedDate: null, ...ev({ confidence: 0.5, needsReview: true }) },
  ],
  cancellation: { found: true, rules: [{ minNoticeDays: 60, refundPercent: 50, flatFee: 2_500 }], ...ev({ quoteVerified: false, confidence: 0, needsReview: true }) },
  dateChange: { found: false, rules: [], ...ev({ needsReview: false, quoteVerified: false }) },
};

describe("money inputs", () => {
  it("round-trips cents through the input text", () => {
    expect(centsToInput(300_000)).toBe("3000");
    expect(centsToInput(150_050)).toBe("1500.50");
    expect(centsToInput(5)).toBe("0.05");
    expect(parseDollars("$1,500.50")).toBe(150_050);
    expect(parseDollars("12.345")).toBeNull();
    expect(parseDollars("-5")).toBeNull();
    expect(parseDollars("abc")).toBeNull();
  });

  it("turns a percent into cents of the reviewed total, in code", () => {
    expect(parseAmount("25%", 900_000)).toBe(225_000);
    expect(parseAmount("33.3 %", 100_001)).toBe(33_300); // rounded half up to a cent
    expect(parseAmount("25%", null)).toBeNull();
    expect(parseAmount("120%", 900_000)).toBeNull();
    expect(parseAmount("3000", null)).toBe(300_000);
  });
});

describe("review draft", () => {
  it("flags what the extraction flagged, and nothing is acknowledged yet", () => {
    const draft = toDraft(terms, "2026-11-07");
    expect(draft.signingDate).toBe("2026-11-07");
    expect(draft.total).toBe("4000.50");
    expect(draft.payments[1]).toMatchObject({ amount: "3000.50", offsetDays: "-14", flagged: true, acknowledged: false });
    expect(pendingConfirmations(draft)).toEqual(["Balance", "Cancellation terms"]);
  });

  it("builds a confirm body in integer cents once the form is valid", () => {
    const draft = toDraft(terms, "2026-11-07");
    draft.payments[1].acknowledged = true;
    draft.cancellation.acknowledged = true;
    draft.payments[0].amount = "25%";
    const built = buildReview(draft);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.review.payments.map((p) => p.amountCents)).toEqual([100_013, 300_050]);
    expect(built.review.cancellation.rules).toEqual([{ minNoticeDays: 60, refundPercent: 50, flatFee: 2_500 }]);
    expect(built.review.dateChange).toMatchObject({ found: false, rules: [] });
    expect(built.review.payments[1]).toMatchObject({ flagged: true, acknowledged: true });
  });

  it("explains what is wrong instead of guessing", () => {
    const draft = toDraft(terms, "2026-11-07");
    draft.total = "lots";
    draft.payments[0].amount = "10%";
    draft.payments[1].offsetDays = "two weeks";
    draft.cancellation.tiers[0].percent = "150";
    const built = buildReview(draft);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors).toEqual([
      "Total: enter a dollar amount like 9000 or 1500.50.",
      "Deposit: enter an amount like 1500 or 25%.",
      "Balance: days must be a whole number.",
      "Cancellation tier 1: use whole days, a percent from 0 to 100 and a dollar fee.",
    ]);
  });

  it("needs a date for a fixed-date payment and a valid email if one is given", () => {
    const draft = toDraft(terms, "2026-11-07");
    draft.payments[0].anchor = "fixed";
    expect(buildReview(draft)).toEqual({ ok: false, errors: ["Deposit: pick the due date."] });
    draft.payments[0].fixedDate = "2027-01-15";
    draft.paypalEmail = "not-an-email";
    const built = buildReview(draft);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.errors[0]).toMatch(/^PayPal email/);
  });
});
