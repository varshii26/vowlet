import { describe, expect, it } from "vitest";
import { extraction, payment } from "@/lib/extraction/fixtures";
import { toTerms } from "@/lib/extraction/terms";

function ok(result: ReturnType<typeof toTerms>) {
  if (!result.ok) throw new Error(`expected ok, got errors: ${result.errors.join("; ")}`);
  return result.terms;
}
function errors(result: ReturnType<typeof toTerms>) {
  if (result.ok) throw new Error("expected errors");
  return result.errors;
}

describe("toTerms", () => {
  it("turns dollars into integer cents and keeps anchors and offsets", () => {
    const terms = ok(toTerms(extraction()));
    expect(terms.totalCents).toBe(900_000);
    expect(terms.payments.map((p) => [p.amountCents, p.anchor, p.offsetDays])).toEqual([
      [300_000, "signing_date", 0],
      [300_000, "wedding_date", -120],
      [300_000, "wedding_date", -30],
    ]);
  });

  it("keeps the evidence for each payment", () => {
    const [first] = ok(toTerms(extraction())).payments;
    expect(first).toMatchObject({ clauseQuote: expect.stringContaining("$3,000"), page: 1, confidence: 0.95 });
  });

  it("reads cents exactly", () => {
    expect(ok(toTerms(extraction({ payments: [payment({ amount: "1500.5" })], totalAmount: "9000.50" }))).payments[0].amountCents).toBe(150_050);
  });

  it("turns a percent payment into cents of the total, in code", () => {
    const terms = ok(toTerms(extraction({ payments: [payment({ amountType: "percent", amount: "25" })], totalAmount: "9000" })));
    expect(terms.payments[0].amountCents).toBe(225_000);
  });

  it("rounds a percent payment to a whole cent, half up", () => {
    const pct = (amount: string, total: string) =>
      ok(toTerms(extraction({ payments: [payment({ amountType: "percent", amount })], totalAmount: total }))).payments[0].amountCents;
    expect(pct("33.33", "100.01")).toBe(3_333); // 10001 cents x 33.33% = 3333.33
    expect(pct("25", "0.10")).toBe(3); // 10 cents x 25% = 2.5 -> 3
    expect(pct("25", "0.14")).toBe(4); // 14 cents x 25% = 3.5 -> 4
  });

  it("keeps a fixed-date payment's date and zeroes its offset", () => {
    const terms = ok(toTerms(extraction({ payments: [payment({ anchor: "fixed", fixedDate: "2026-12-01", offsetDays: 7 })] })));
    expect(terms.payments[0]).toMatchObject({ anchor: "fixed", fixedDate: "2026-12-01", offsetDays: 0 });
  });

  it("ignores a stray fixed date on a payment that is not fixed", () => {
    const terms = ok(toTerms(extraction({ payments: [payment({ anchor: "signing_date", fixedDate: "2026-12-01" })] })));
    expect(terms.payments[0].fixedDate).toBeNull();
  });

  it("converts rule tiers, including flat fees, to cents", () => {
    const e = extraction();
    e.cancellation.tiers[0].flatFee = "100";
    e.dateChange.tiers[1].flatFee = "150.50";
    const terms = ok(toTerms(e));
    expect(terms.cancellation.rules[0]).toEqual({ minNoticeDays: 90, refundPercent: 50, flatFee: 10_000 });
    expect(terms.dateChange.rules[1]).toEqual({ minNoticeDays: 0, feePercent: 30, flatFee: 15_050 });
  });

  it("accepts a contract without cancellation or date-change terms", () => {
    const none = { found: false, tiers: [], clauseQuote: "", page: 1, confidence: 1 };
    const terms = ok(toTerms(extraction({ cancellation: none, dateChange: none })));
    expect(terms.cancellation).toMatchObject({ found: false, rules: [] });
    expect(terms.dateChange).toMatchObject({ found: false, rules: [] });
  });

  describe("rejects bad model output instead of guessing", () => {
    it.each(["$3,000", "3,000", "3k", "-5", "1.234", "", " ", "three thousand", "1e3"])('dollar amount "%s"', (amount) => {
      const result = toTerms(extraction({ payments: [payment({ amount })] }));
      expect(errors(result).join(" ")).toContain("Venue deposit");
    });

    it.each(["0", "101", "-5", "abc", "25%", "1e1"])('percent "%s"', (amount) => {
      const result = toTerms(extraction({ payments: [payment({ amountType: "percent", amount })] }));
      expect(errors(result).join(" ")).toContain("percentage");
    });

    it("a percent payment when the total is unreadable or zero", () => {
      expect(errors(toTerms(extraction({ totalAmount: "0", payments: [payment({ amountType: "percent", amount: "25" })] }))).join(" ")).toContain(
        "needs a total",
      );
      expect(errors(toTerms(extraction({ totalAmount: "lots" }))).join(" ")).toContain("total");
    });

    it.each(["", "12/01/2026", "2026-13-01", "2026-02-30", "Dec 1, 2026"])('fixed date "%s"', (fixedDate) => {
      const result = toTerms(extraction({ payments: [payment({ anchor: "fixed", fixedDate })] }));
      expect(errors(result).join(" ")).toContain("YYYY-MM-DD");
    });

    it("a payment of zero dollars", () => {
      expect(errors(toTerms(extraction({ payments: [payment({ amount: "0" })] }))).join(" ")).toContain("above zero");
    });

    it("no payments at all", () => {
      expect(errors(toTerms(extraction({ payments: [] })))).toContain("no payments were extracted");
    });

    it("terms marked found with no tiers", () => {
      const e = extraction();
      e.cancellation.tiers = [];
      e.dateChange.tiers = [];
      const all = errors(toTerms(e)).join(" ");
      expect(all).toContain("cancellation terms were marked found");
      expect(all).toContain("date-change terms were marked found");
    });

    it("a bad flat fee", () => {
      const e = extraction();
      e.cancellation.tiers[0].flatFee = "$100";
      expect(errors(toTerms(e)).join(" ")).toContain("flat fee");
    });

    it("reports every problem at once, so one retry can fix them all", () => {
      const result = toTerms(extraction({ totalAmount: "x", payments: [payment({ amount: "bad" }), payment({ label: "Other", amount: "also bad" })] }));
      const all = errors(result);
      expect(all.length).toBeGreaterThanOrEqual(3);
      expect(all.join(" ")).toContain("Other");
    });
  });
});
