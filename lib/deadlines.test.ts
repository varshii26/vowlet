import { describe, expect, it } from "vitest";
import { nextDeadlines, type DeadlineInput } from "@/lib/deadlines";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// Wedding 2027-04-17; on 2026-11-11 the couple has 157 days' notice.
const base: DeadlineInput = {
  weddingDate: d("2027-04-17"),
  today: d("2026-11-11"),
  totalCostCents: 240_000,
  payments: [
    { amountCents: 80_000, status: "paid" },
    { amountCents: 160_000, status: "scheduled" },
  ],
  terms: {
    // 60+ days free, 30+ days 10%, otherwise 25%
    dateChange: [
      { minNoticeDays: 60, feePercent: 0, flatFee: 0 },
      { minNoticeDays: 30, feePercent: 10, flatFee: 0 },
      { minNoticeDays: 0, feePercent: 25, flatFee: 0 },
    ],
    // 180+ days 75%, 90+ 50%, 30+ 25%, otherwise nothing
    cancellation: [
      { minNoticeDays: 180, refundPercent: 75, flatFee: 0 },
      { minNoticeDays: 90, refundPercent: 50, flatFee: 0 },
      { minNoticeDays: 30, refundPercent: 25, flatFee: 0 },
      { minNoticeDays: 0, refundPercent: 0, flatFee: 0 },
    ],
    dateChangeClause: { id: "c-change", page: 2 },
    cancellationClause: { id: "c-cancel", page: 3 },
  },
};

const byKind = (input: DeadlineInput) => Object.fromEntries(nextDeadlines(input).map((x) => [x.kind, x]));

describe("nextDeadlines", () => {
  it("finds the last free date change: the wedding minus the tier's notice", () => {
    const change = byKind(base).date_change;
    expect(change).toEqual({
      kind: "date_change",
      isoDate: "2027-02-16", // 60 days before 2027-04-17
      title: "Last day to change the date for free",
      until: "Moving the date: free (60+ days' notice).",
      after: "After that: a $240 fee.", // 10% of $2,400
      clauseId: "c-change",
      clausePage: 2,
    });
  });

  it("skips cancellation tiers already passed and prices the refund on what is paid", () => {
    // The 180-day tier ran out on 2026-10-19; the 90-day tier is current.
    const cancel = byKind(base).cancellation;
    expect(cancel).toMatchObject({
      isoDate: "2027-01-17",
      title: "Last day to cancel for a 50% refund",
      until: "Cancelling: 50% refunded ($400 of the $800 paid so far).",
      after: "After that: 25% refunded ($200 of the $800 paid so far).",
      clauseId: "c-cancel",
      clausePage: 3,
    });
  });

  it("counts the last day itself as still inside the tier", () => {
    expect(byKind({ ...base, today: d("2027-02-16") }).date_change.isoDate).toBe("2027-02-16");
    expect(byKind({ ...base, today: d("2027-02-17") }).date_change).toMatchObject({
      isoDate: "2027-03-18",
      title: "Last day to change the date for $240",
      after: "After that: a $600 fee.", // 25% of $2,400
    });
  });

  it("has no deadline once only the no-notice tier is left", () => {
    expect(byKind({ ...base, today: d("2027-03-20") })).toEqual({});
  });

  it("moves with the wedding date", () => {
    expect(byKind({ ...base, weddingDate: d("2027-06-12") }).date_change.isoDate).toBe("2027-04-13");
  });

  it("includes flat fees, and leaves out the paid amount before anything is paid", () => {
    const deadlines = byKind({
      ...base,
      payments: [{ amountCents: 240_000, status: "scheduled" }],
      terms: {
        ...base.terms,
        dateChange: [
          { minNoticeDays: 90, feePercent: 0, flatFee: 15_000 },
          { minNoticeDays: 0, feePercent: 15, flatFee: 15_000 },
        ],
      },
    });
    expect(deadlines.date_change).toMatchObject({ title: "Last day to change the date for $150", after: "After that: a $510 fee." });
    expect(deadlines.cancellation.until).toBe("Cancelling: 50% refunded.");
  });

  it("says when the contract has no tier after the last one", () => {
    const deadlines = byKind({ ...base, terms: { ...base.terms, dateChange: [{ minNoticeDays: 30, feePercent: 0, flatFee: 0 }] } });
    expect(deadlines.date_change.after).toBe("After that: the contract sets no terms; check with the vendor.");
  });

  it("returns nothing without terms", () => {
    expect(nextDeadlines({ ...base, terms: { ...base.terms, dateChange: [], cancellation: [] } })).toEqual([]);
  });
});
