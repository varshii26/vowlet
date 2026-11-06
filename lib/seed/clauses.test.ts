import { describe, expect, it } from "vitest";
import {
  STYLE_COUNT,
  buildVendorClauses,
  cancellationClause,
  dateChangeClause,
  paymentClause,
  vendorStyle,
  type Style,
} from "@/lib/seed/clauses";
import { VENDORS } from "@/lib/seed/demo-data";

const styles: Style[] = [0, 1, 2];

describe("paymentClause", () => {
  const deposit = { label: "Venue deposit", amountCents: 300_000, anchor: "signing_date" as const };

  it("words the same payment three different ways", () => {
    expect(paymentClause(deposit, 0).text).toBe("The Client shall pay $3,000 (Venue deposit) upon signing this agreement.");
    expect(paymentClause(deposit, 1).text).toBe("Venue deposit: $3,000 is payable upon signing this agreement.");
    expect(paymentClause(deposit, 2).text).toBe("A payment of $3,000 (Venue deposit) falls due upon signing this agreement.");
  });

  it("defaults to style 0", () => {
    expect(paymentClause(deposit).text).toBe(paymentClause(deposit, 0).text);
  });

  it("describes offsets before and after the event, singular and plural", () => {
    const before = paymentClause({ label: "Balance", amountCents: 150_050, anchor: "wedding_date", offsetDays: -30 });
    expect(before.text).toContain("$1,500.50");
    expect(before.text).toContain("no later than 30 days before the Event Date");

    const oneDay = paymentClause({ label: "Pay", amountCents: 100, anchor: "wedding_date", offsetDays: -1 });
    expect(oneDay.text).toContain("1 day before");

    const after = paymentClause({ label: "Pay", amountCents: 100, anchor: "wedding_date", offsetDays: 14 });
    expect(after.text).toContain("within 14 days after the Event Date");

    const onDay = paymentClause({ label: "Pay", amountCents: 100, anchor: "wedding_date" });
    expect(onDay.text).toContain("on the Event Date");
  });

  it("describes a fixed due date", () => {
    const c = paymentClause({ label: "Booking", amountCents: 50_000, anchor: "fixed", fixedDate: "2026-12-01" });
    expect(c.text).toContain("on or before 2026-12-01");
  });

  it("uses deliberately ambiguous wording when given, but keeps the confirmed summary", () => {
    const c = paymentClause(
      { label: "Suit", amountCents: 110_000, anchor: "wedding_date", offsetDays: -30, ambiguousText: "Due about a month before." },
      1,
    );
    expect(c.text).toBe("Due about a month before.");
    expect(c.summary).toBe("$1,100 suit, due no later than 30 days before the Event Date");
  });
});

describe("cancellationClause", () => {
  const rules = [
    { minNoticeDays: 0, refundPercent: 0, flatFee: 0 },
    { minNoticeDays: 60, refundPercent: 100, flatFee: 10_000 },
  ];

  it("lists tiers from longest notice to shortest in every style", () => {
    for (const style of styles) {
      const { text } = cancellationClause(rules, style);
      expect(text.indexOf("60")).toBeGreaterThan(-1);
      expect(text.indexOf("60")).toBeLessThan(text.search(/no refund|forfeits/));
      expect(text).toContain("$100");
      expect(text).toContain("non-refundable");
    }
  });

  it("is worded differently in each style, with one shared summary", () => {
    const results = styles.map((s) => cancellationClause(rules, s));
    expect(new Set(results.map((r) => r.text)).size).toBe(3);
    expect(new Set(results.map((r) => r.summary))).toEqual(new Set(["60+ days: 100% refund, 0+ days: 0% refund"]));
  });
});

describe("dateChangeClause", () => {
  const rules = [
    { minNoticeDays: 90, feePercent: 0, flatFee: 0 },
    { minNoticeDays: 0, feePercent: 15, flatFee: 15_000 },
  ];

  it("states free tiers and combines percent and flat fees in every style", () => {
    for (const style of styles) {
      const { text } = dateChangeClause(rules, style);
      expect(text).toMatch(/no fee applies|no charge/);
      expect(text).toContain("15% of the total contract price plus a flat fee of $150");
    }
  });

  it("is worded differently in each style, with one shared summary", () => {
    const results = styles.map((s) => dateChangeClause(rules, s));
    expect(new Set(results.map((r) => r.text)).size).toBe(3);
    expect(new Set(results.map((r) => r.summary))).toEqual(new Set(["90+ days: 0%, 0+ days: 15% + $150"]));
  });
});

describe("vendorStyle and buildVendorClauses", () => {
  it("spreads the vendors across all wording styles", () => {
    const used = new Set(VENDORS.map((v) => vendorStyle(v, VENDORS)));
    expect(used.size).toBe(STYLE_COUNT);
  });

  it("rejects a vendor that is not in the list", () => {
    expect(() => vendorStyle({ ...VENDORS[0] }, VENDORS)).toThrow(/Unknown vendor/);
  });

  it("puts payments on page 1, date changes on page 2 and cancellation on page 2 or the addendum", () => {
    for (const spec of VENDORS) {
      const clauses = buildVendorClauses(spec, vendorStyle(spec, VENDORS));
      expect(clauses.payments).toHaveLength(spec.payments.length);
      expect(clauses.payments.every((c) => c.page === 1)).toBe(true);
      expect(clauses.dateChange.page).toBe(2);
      expect(clauses.cancellation.page).toBe(spec.cancellationInAddendum ? 3 : 2);
    }
  });
});
