import { describe, expect, it } from "vitest";
import { cancellationClause, dateChangeClause, paymentClause } from "@/lib/seed/clauses";

describe("paymentClause", () => {
  it("describes a deposit due at signing", () => {
    const c = paymentClause({ label: "Venue deposit", amountCents: 300_000, anchor: "signing_date" });
    expect(c.text).toBe("The Client shall pay $3,000 (Venue deposit) upon signing this agreement.");
  });

  it("describes offsets before and after the event, singular and plural", () => {
    const before = paymentClause({ label: "Balance", amountCents: 150_050, anchor: "wedding_date", offsetDays: -30 });
    expect(before.text).toContain("$1,500.5");
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
});

describe("cancellationClause", () => {
  it("lists tiers from longest notice to shortest and mentions flat fees", () => {
    const c = cancellationClause([
      { minNoticeDays: 0, refundPercent: 0, flatFee: 0 },
      { minNoticeDays: 60, refundPercent: 100, flatFee: 10_000 },
    ]);
    expect(c.text.indexOf("60 days")).toBeLessThan(c.text.indexOf("no refund"));
    expect(c.text).toContain("$100 administrative fee");
    expect(c.summary).toBe("60+ days: 100% refund, 0+ days: 0% refund");
  });
});

describe("dateChangeClause", () => {
  it("says no fee applies for free tiers and combines percent and flat fees", () => {
    const c = dateChangeClause([
      { minNoticeDays: 90, feePercent: 0, flatFee: 0 },
      { minNoticeDays: 0, feePercent: 15, flatFee: 15_000 },
    ]);
    expect(c.text).toContain("no fee applies");
    expect(c.text).toContain("15% of the total contract price plus a flat fee of $150");
    expect(c.summary).toBe("90+ days: 0%, 0+ days: 15% + $150");
  });
});
