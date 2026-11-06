import { describe, expect, it } from "vitest";
import { cancellationRulesSchema, dateChangeRulesSchema } from "@/lib/rules";
import { VENDORS, WEDDING, vendorTotalCents } from "@/lib/seed/demo-data";

const allPayments = VENDORS.flatMap((v) => v.payments);
const totalCents = VENDORS.reduce((sum, v) => sum + vendorTotalCents(v), 0);

describe("demo data", () => {
  it("matches the Priya & Sam persona", () => {
    expect(WEDDING.coupleNames).toBe("Priya & Sam");
    expect(WEDDING.date).toBe("2027-04-17");
    expect(VENDORS).toHaveLength(14);
  });

  it("has about 23 payments totalling $31,000", () => {
    expect(allPayments).toHaveLength(23);
    expect(totalCents).toBe(3_100_000);
    expect(totalCents).toBeLessThanOrEqual(WEDDING.budgetCents);
  });

  it("uses integer cents for every payment", () => {
    for (const p of allPayments) {
      expect(Number.isInteger(p.amountCents)).toBe(true);
      expect(p.amountCents).toBeGreaterThan(0);
    }
  });

  it("has unique slugs", () => {
    expect(new Set(VENDORS.map((v) => v.slug)).size).toBe(VENDORS.length);
  });

  it("gives fixed-anchor payments a fixed date and others none", () => {
    for (const p of allPayments) {
      if (p.anchor === "fixed") expect(p.fixedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      else expect(p.fixedDate).toBeUndefined();
    }
  });

  it("has valid rules, each ending in a zero-notice tier", () => {
    for (const v of VENDORS) {
      expect(cancellationRulesSchema.parse(v.cancellation).some((r) => r.minNoticeDays === 0)).toBe(true);
      expect(dateChangeRulesSchema.parse(v.dateChange).some((r) => r.minNoticeDays === 0)).toBe(true);
    }
  });

  it("covers the scenarios the sample contracts need", () => {
    expect(allPayments.some((p) => p.anchor === "fixed")).toBe(true);
    expect(allPayments.some((p) => p.anchor === "signing_date")).toBe(true);
    expect(VENDORS.some((v) => v.cancellationInAddendum)).toBe(true);
  });
});
