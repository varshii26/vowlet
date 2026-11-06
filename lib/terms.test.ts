import { describe, expect, it } from "vitest";
import type { CancellationRule, DateChangeRule } from "@/lib/rules";
import { addDaysUtc } from "@/lib/schedule";
import { VENDORS, WEDDING, vendorTotalCents } from "@/lib/seed/demo-data";
import {
  dateChangeCost,
  pickTier,
  refundOwed,
  type DateChangeVendor,
  type RefundPayment,
} from "@/lib/terms";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const wedding = d("2027-04-17");
const daysBefore = (days: number) => addDaysUtc(wedding, -days);

describe("pickTier", () => {
  const rules = [
    { minNoticeDays: 0, label: "short" },
    { minNoticeDays: 90, label: "mid" },
    { minNoticeDays: 180, label: "long" },
  ];

  it("picks the largest tier the notice qualifies for, exactly at the boundary", () => {
    expect(pickTier(rules, 180)?.label).toBe("long");
    expect(pickTier(rules, 179)?.label).toBe("mid");
    expect(pickTier(rules, 90)?.label).toBe("mid");
    expect(pickTier(rules, 89)?.label).toBe("short");
    expect(pickTier(rules, 0)?.label).toBe("short");
    expect(pickTier(rules, 1000)?.label).toBe("long");
  });

  it("treats negative notice as zero", () => {
    expect(pickTier(rules, -5)?.label).toBe("short");
  });

  it("returns null when no tier qualifies or there are no rules", () => {
    expect(pickTier([{ minNoticeDays: 30 }], 10)).toBeNull();
    expect(pickTier([], 10)).toBeNull();
  });

  it("does not mutate the input", () => {
    const input = [{ minNoticeDays: 0 }, { minNoticeDays: 90 }];
    pickTier(input, 100);
    expect(input.map((r) => r.minNoticeDays)).toEqual([0, 90]);
  });
});

describe("refundOwed", () => {
  const tiered: CancellationRule[] = [
    { minNoticeDays: 180, refundPercent: 75, flatFee: 0 },
    { minNoticeDays: 90, refundPercent: 50, flatFee: 0 },
    { minNoticeDays: 30, refundPercent: 25, flatFee: 0 },
    { minNoticeDays: 0, refundPercent: 0, flatFee: 0 },
  ];
  const flexible: CancellationRule[] = [
    { minNoticeDays: 60, refundPercent: 100, flatFee: 10_000 },
    { minNoticeDays: 30, refundPercent: 50, flatFee: 10_000 },
    { minNoticeDays: 0, refundPercent: 0, flatFee: 0 },
  ];
  const paid100: RefundPayment[] = [{ amountCents: 100_000, status: "paid" }];

  const couple = (rules: CancellationRule[], payments: RefundPayment[], noticeDays: number, clauseId: string | null = "c1") =>
    refundOwed({
      cancelledBy: "couple",
      rules,
      clauseId,
      payments,
      weddingDate: wedding,
      cancellationDate: daysBefore(noticeDays),
    });

  it("applies each tier at, just above and just below its boundary", () => {
    expect(couple(tiered, paid100, 200).owedCents).toBe(75_000);
    expect(couple(tiered, paid100, 180).owedCents).toBe(75_000);
    expect(couple(tiered, paid100, 179).owedCents).toBe(50_000);
    expect(couple(tiered, paid100, 90).owedCents).toBe(50_000);
    expect(couple(tiered, paid100, 89).owedCents).toBe(25_000);
    expect(couple(tiered, paid100, 30).owedCents).toBe(25_000);
    expect(couple(tiered, paid100, 29).owedCents).toBe(0);
    expect(couple(tiered, paid100, 0).owedCents).toBe(0);
  });

  it("treats a cancellation after the wedding as zero notice", () => {
    const result = couple(tiered, paid100, -10);
    expect(result.owedCents).toBe(0);
    expect(result.appliedRule?.minNoticeDays).toBe(0);
  });

  it("subtracts the flat fee from the refund", () => {
    expect(couple(flexible, paid100, 60).owedCents).toBe(90_000);
    expect(couple(flexible, paid100, 59).owedCents).toBe(40_000); // 50% = 50,000 less 10,000
  });

  it("never refunds less than zero when the fee exceeds the refund", () => {
    const result = couple(flexible, [{ amountCents: 5_000, status: "paid" }], 60);
    expect(result.owedCents).toBe(0);
    expect(result.retainedCents).toBe(5_000);
  });

  it("counts only payments with status paid", () => {
    const payments: RefundPayment[] = [
      { amountCents: 100_000, status: "paid" },
      { amountCents: 50_000, status: "scheduled" },
      { amountCents: 50_000, status: "due" },
      { amountCents: 40_000, status: "refunded" },
      { amountCents: 30_000, status: "refund_requested" },
      { amountCents: 20_000, status: "void" },
    ];
    const result = couple(tiered, payments, 200);
    expect(result.paidCents).toBe(100_000);
    expect(result.owedCents).toBe(75_000);
  });

  it("rounds the refund half up to a whole cent", () => {
    expect(couple(tiered, [{ amountCents: 3, status: "paid" }], 90).owedCents).toBe(2); // 1.5 -> 2
    expect(couple(tiered, [{ amountCents: 1, status: "paid" }], 90).owedCents).toBe(1); // 0.5 -> 1
  });

  it("returns zero owed when nothing has been paid", () => {
    const result = couple(tiered, [{ amountCents: 100_000, status: "scheduled" }], 200);
    expect(result.paidCents).toBe(0);
    expect(result.owedCents).toBe(0);
    expect(result.retainedCents).toBe(0);
  });

  it("refunds nothing when no tier applies, and says so", () => {
    const result = couple([{ minNoticeDays: 30, refundPercent: 50, flatFee: 0 }], paid100, 10);
    expect(result.owedCents).toBe(0);
    expect(result.retainedCents).toBe(100_000);
    expect(result.appliedRule).toBeNull();
    expect(result.reason).toMatch(/No cancellation terms apply/);
    expect(couple([], paid100, 100).owedCents).toBe(0);
  });

  it("refunds everything paid, with no fees, when the vendor cancels", () => {
    const result = refundOwed({
      cancelledBy: "vendor",
      rules: [], // the couple's tiers are irrelevant
      clauseId: "c9",
      payments: [
        { amountCents: 100_000, status: "paid" },
        { amountCents: 25_050, status: "paid" },
        { amountCents: 70_000, status: "scheduled" },
      ],
      weddingDate: wedding,
      cancellationDate: daysBefore(5),
    });
    expect(result.owedCents).toBe(125_050);
    expect(result.retainedCents).toBe(0);
    expect(result.appliedRule).toBeNull();
    expect(result.reason).toBe("Vendor cancelled, so all $1,250.50 paid is owed back.");
  });

  it("carries the clause id and notice, and owed plus retained always equals paid", () => {
    for (const notice of [200, 120, 45, 10, 0, -3]) {
      for (const rules of [tiered, flexible]) {
        const r = couple(rules, paid100, notice, "clause-42");
        expect(r.clauseId).toBe("clause-42");
        expect(r.noticeDays).toBe(notice);
        expect(r.owedCents + r.retainedCents).toBe(r.paidCents);
        expect(Number.isInteger(r.owedCents)).toBe(true);
      }
    }
  });

  it("explains the calculation in plain language", () => {
    expect(couple(flexible, paid100, 60).reason).toBe(
      "60 days' notice: 100% of $1,000 paid, less a $100 fee = $900 owed back.",
    );
  });
});

describe("dateChangeCost", () => {
  const free60: DateChangeRule[] = [
    { minNoticeDays: 60, feePercent: 0, flatFee: 0 },
    { minNoticeDays: 30, feePercent: 10, flatFee: 0 },
    { minNoticeDays: 0, feePercent: 25, flatFee: 0 },
  ];
  const flat: DateChangeRule[] = [
    { minNoticeDays: 90, feePercent: 0, flatFee: 15_000 },
    { minNoticeDays: 0, feePercent: 15, flatFee: 15_000 },
  ];
  const vendor = (over: Partial<DateChangeVendor> = {}): DateChangeVendor => ({
    vendorId: "v1",
    vendorName: "Vendor One",
    totalCostCents: 100_000,
    status: "active",
    dateChangeRules: free60,
    clauseId: "clause-1",
    ...over,
  });
  const run = (vendors: DateChangeVendor[], noticeDays: number, newDate = d("2027-06-17")) =>
    dateChangeCost({ vendors, originalDate: wedding, newDate, today: daysBefore(noticeDays) });

  it("is free with enough notice and steps up at each boundary", () => {
    expect(run([vendor()], 162).totalCents).toBe(0);
    expect(run([vendor()], 60).totalCents).toBe(0);
    expect(run([vendor()], 59).totalCents).toBe(10_000);
    expect(run([vendor()], 30).totalCents).toBe(10_000);
    expect(run([vendor()], 29).totalCents).toBe(25_000);
    expect(run([vendor()], 0).totalCents).toBe(25_000);
  });

  it("combines a percentage and a flat fee", () => {
    const row = run([vendor({ dateChangeRules: flat, totalCostCents: 80_000 })], 10).rows[0];
    expect(row.costCents).toBe(27_000); // 15% of 80,000 + 15,000
    expect(row.reason).toBe("$270 (15% of the contract plus a $150 flat fee) with 10 days' notice.");
    expect(run([vendor({ dateChangeRules: flat, totalCostCents: 80_000 })], 100).rows[0].costCents).toBe(15_000);
  });

  it("measures notice from today to the ORIGINAL date, and works for earlier or later dates", () => {
    const later = run([vendor()], 45, d("2027-09-01"));
    const earlier = run([vendor()], 45, d("2027-03-20")); // after today (2027-03-03), before the wedding
    expect(later.rows[0].noticeDays).toBe(45);
    expect(later.totalCents).toBe(10_000);
    expect(earlier.totalCents).toBe(10_000);
  });

  it("costs nothing for a cancelled vendor", () => {
    const row = run([vendor({ status: "cancelled" })], 10).rows[0];
    expect(row.costCents).toBe(0);
    expect(row.reason).toMatch(/cancelled/);
  });

  it("costs nothing when the date is unchanged", () => {
    const result = run([vendor(), vendor({ vendorId: "v2" })], 10, wedding);
    expect(result.totalCents).toBe(0);
    expect(result.rows.every((r) => r.reason === "The wedding date is unchanged.")).toBe(true);
  });

  it("rejects a new date in the past", () => {
    expect(() =>
      dateChangeCost({ vendors: [vendor()], originalDate: wedding, newDate: d("2026-01-01"), today: d("2026-11-06") }),
    ).toThrow(RangeError);
  });

  it("allows moving the wedding to today", () => {
    const today = d("2026-11-06");
    expect(() => dateChangeCost({ vendors: [vendor()], originalDate: wedding, newDate: today, today })).not.toThrow();
  });

  it("flags vendors with no applicable terms instead of calling the change free", () => {
    const row = run([vendor({ dateChangeRules: [] })], 100).rows[0];
    expect(row.costCents).toBe(0);
    expect(row.appliedRule).toBeNull();
    expect(row.reason).toMatch(/No date-change terms apply/);
  });

  it("sums rows into the total and carries vendor and clause ids", () => {
    const result = run(
      [
        vendor({ vendorId: "a", clauseId: "ca" }),
        vendor({ vendorId: "b", clauseId: "cb", dateChangeRules: flat, totalCostCents: 80_000 }),
        vendor({ vendorId: "c", clauseId: null, status: "cancelled" }),
      ],
      45,
    );
    expect(result.rows.map((r) => [r.vendorId, r.clauseId, r.costCents])).toEqual([
      ["a", "ca", 10_000],
      ["b", "cb", 27_000],
      ["c", null, 0],
    ]);
    expect(result.totalCents).toBe(37_000);
  });

  it("returns an empty result for no vendors", () => {
    expect(run([], 100)).toEqual({ rows: [], totalCents: 0 });
  });
});

describe("dateChangeCost on the demo contracts", () => {
  it("costs $1,330 to postpone Priya & Sam two months from 2026-11-06", () => {
    // Worked out by hand from the rule presets (notice = 162 days):
    // strict vendors 5% (Grand Oak $450, Maison Eclat $100, Paper Crane $30),
    // flat-fee vendors $150 each x5 (Bloom, Velvet, Sweet Layers, Glow, Starlight),
    // free-60 vendors $0.
    const vendors: DateChangeVendor[] = VENDORS.map((v) => ({
      vendorId: v.slug,
      vendorName: v.name,
      totalCostCents: vendorTotalCents(v),
      status: "active",
      dateChangeRules: v.dateChange,
      clauseId: null,
    }));
    const result = dateChangeCost({
      vendors,
      originalDate: d(WEDDING.date),
      newDate: d("2027-06-17"),
      today: d("2026-11-06"),
    });
    expect(result.rows).toHaveLength(14);
    expect(result.totalCents).toBe(133_000);
    expect(result.rows.find((r) => r.vendorId === "grand-oak-estate")?.costCents).toBe(45_000);
    expect(result.rows.find((r) => r.vendorId === "lumen-photography")?.costCents).toBe(0);
  });
});
