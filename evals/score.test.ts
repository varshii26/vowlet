import { describe, expect, it } from "vitest";
import { scoreExtraction } from "@/evals/score";
import { extraction, payment } from "@/lib/extraction/fixtures";
import { toTerms } from "@/lib/extraction/terms";
import { verifyTerms } from "@/lib/extraction/verify";
import { VENDORS } from "@/lib/seed/demo-data";

const grandOak = VENDORS.find((v) => v.slug === "grand-oak-estate")!;
const dapper = VENDORS.find((v) => v.slug === "dapper-and-co-tailoring")!;

/** Text containing every quote in the fixture extraction, so quotes verify. */
function pagesFor(e: ReturnType<typeof extraction>) {
  return [e.payments.map((p) => p.clauseQuote).join("\n"), `${e.cancellation.clauseQuote}\n${e.dateChange.clauseQuote}`];
}

function score(e: ReturnType<typeof extraction>, spec = grandOak, pages = pagesFor(e)) {
  const terms = toTerms(e);
  if (!terms.ok) throw new Error(terms.errors.join("; "));
  return scoreExtraction(spec, verifyTerms(terms.terms, pages));
}

describe("scoreExtraction", () => {
  it("gives a perfect score to a perfect extraction", () => {
    const s = score(extraction());
    expect(s).toMatchObject({ correct: 6, total: 6, accuracy: 1, paymentsMatched: 3, paymentsExtra: 0, quoteRate: 1 });
    expect(s).toMatchObject({ totalMatches: true, cancellationMatches: true, dateChangeMatches: true });
  });

  it("does not count a payment with the wrong offset", () => {
    const e = extraction();
    e.payments[1].offsetDays = -90;
    expect(score(e)).toMatchObject({ paymentsMatched: 2, correct: 5 });
  });

  it("does not count a payment with the wrong amount, even by one cent", () => {
    const e = extraction();
    e.payments[0].amount = "3000.01";
    e.totalAmount = "9000.01";
    expect(score(e)).toMatchObject({ paymentsMatched: 2, totalMatches: false, correct: 4 });
  });

  it("matches payments regardless of order, and each only once", () => {
    const e = extraction();
    e.payments.reverse();
    expect(score(e).paymentsMatched).toBe(3);

    const dup = extraction({ payments: [payment(), payment(), payment()] });
    expect(score(dup).paymentsMatched).toBe(1); // three identical deposits, but only one was expected
  });

  it("counts extra payments", () => {
    const e = extraction();
    e.payments.push(payment({ label: "Made up", amount: "1" }));
    expect(score(e)).toMatchObject({ paymentsMatched: 3, paymentsExtra: 1 });
  });

  it("requires every rule tier to match", () => {
    const wrongPercent = extraction();
    wrongPercent.cancellation.tiers[0].refundPercent = 75;
    expect(score(wrongPercent).cancellationMatches).toBe(false);

    const missingTier = extraction();
    missingTier.dateChange.tiers.pop();
    expect(score(missingTier).dateChangeMatches).toBe(false);

    const wrongFee = extraction();
    wrongFee.dateChange.tiers[0].flatFee = "10";
    expect(score(wrongFee).dateChangeMatches).toBe(false);
  });

  it("ignores the order of tiers", () => {
    const e = extraction();
    e.cancellation.tiers.reverse();
    expect(score(e).cancellationMatches).toBe(true);
  });

  it("does not count terms reported as not found", () => {
    const none = { found: false, tiers: [], clauseQuote: "", page: 1, confidence: 1 };
    expect(score(extraction({ cancellation: none, dateChange: none }))).toMatchObject({
      cancellationMatches: false,
      dateChangeMatches: false,
    });
  });

  it("reports how many quotes really appear in the PDF", () => {
    const e = extraction();
    expect(score(e, grandOak, ["nothing from the contract"]).quoteRate).toBe(0);
    const half = score(e, grandOak, [e.payments.map((p) => p.clauseQuote).join("\n")]);
    expect(half.quoteRate).toBeCloseTo(3 / 5);
  });

  it("scores a fixed-date payment by its date", () => {
    const dj = VENDORS.find((v) => v.slug === "dj-marlow-sound")!;
    const base = extraction({
      totalAmount: "1500",
      payments: [
        payment({ label: "DJ booking fee", amount: "500", anchor: "fixed", fixedDate: "2026-12-01", clauseQuote: "The DJ booking fee of $500 is due on or before 2026-12-01." }),
        payment({ label: "DJ final balance", amount: "1000", anchor: "wedding_date", offsetDays: -7, clauseQuote: "The DJ final balance of $1,000 is due no later than 7 days before the Event Date." }),
      ],
    });
    expect(score(base, dj).paymentsMatched).toBe(2);

    const wrongDate = structuredClone(base);
    wrongDate.payments[0].fixedDate = "2026-12-02";
    expect(score(wrongDate, dj).paymentsMatched).toBe(1);
  });

  describe("review flags", () => {
    const vagueText = dapper.payments[0].ambiguousText!;
    const dapperExtraction = (confidence: number) =>
      extraction({
        totalAmount: "1100",
        payments: [payment({ label: "Suit full payment", amount: "1100", anchor: "wedding_date", offsetDays: -30, confidence, clauseQuote: vagueText })],
      });

    it("wants the deliberately vague payment flagged", () => {
      expect(score(dapperExtraction(0.6), dapper).flags).toEqual({ vagueFlagged: true, plainFlagged: 0, plainTotal: 0 });
      expect(score(dapperExtraction(0.95), dapper).flags.vagueFlagged).toBe(false);
    });

    it("has no vague payment to judge in a plain contract, and counts plain payments flagged by mistake", () => {
      const e = extraction();
      e.payments[0].confidence = 0.5; // flagged although the wording is plain
      expect(score(e).flags).toEqual({ vagueFlagged: null, plainFlagged: 1, plainTotal: 3 });
    });
  });
});
