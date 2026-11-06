import { describe, expect, it } from "vitest";
import {
  cancellationRulesSchema,
  clauseIdsSchema,
  dateChangeRulesSchema,
} from "@/lib/rules";

describe("cancellationRulesSchema", () => {
  it("accepts valid tiers", () => {
    const rules = [
      { minNoticeDays: 90, refundPercent: 50, flatFee: 0 },
      { minNoticeDays: 0, refundPercent: 0, flatFee: 10_000 },
    ];
    expect(cancellationRulesSchema.parse(rules)).toEqual(rules);
  });

  it("rejects a refund over 100%", () => {
    expect(() => cancellationRulesSchema.parse([{ minNoticeDays: 1, refundPercent: 101, flatFee: 0 }])).toThrow();
  });

  it("rejects negative notice and fractional cents", () => {
    expect(() => cancellationRulesSchema.parse([{ minNoticeDays: -1, refundPercent: 10, flatFee: 0 }])).toThrow();
    expect(() => cancellationRulesSchema.parse([{ minNoticeDays: 1, refundPercent: 10, flatFee: 1.5 }])).toThrow();
  });

  it("rejects missing fields", () => {
    expect(() => cancellationRulesSchema.parse([{ minNoticeDays: 1 }])).toThrow();
  });
});

describe("dateChangeRulesSchema", () => {
  it("accepts valid tiers", () => {
    const rules = [{ minNoticeDays: 60, feePercent: 0, flatFee: 0 }];
    expect(dateChangeRulesSchema.parse(rules)).toEqual(rules);
  });

  it("rejects a fee over 100%", () => {
    expect(() => dateChangeRulesSchema.parse([{ minNoticeDays: 1, feePercent: 150, flatFee: 0 }])).toThrow();
  });
});

describe("clauseIdsSchema", () => {
  it("accepts a list of ids and rejects non-strings", () => {
    expect(clauseIdsSchema.parse(["a", "b"])).toEqual(["a", "b"]);
    expect(() => clauseIdsSchema.parse([1])).toThrow();
  });
});
