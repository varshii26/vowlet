import { describe, expect, it } from "vitest";
import { formatCents, percentOf } from "@/lib/money";

describe("formatCents", () => {
  it("drops decimals for whole dollars and groups thousands", () => {
    expect(formatCents(300_000)).toBe("$3,000");
    expect(formatCents(0)).toBe("$0");
    expect(formatCents(100)).toBe("$1");
  });

  it("always shows two decimals when there are cents", () => {
    expect(formatCents(150_050)).toBe("$1,500.50");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(1999)).toBe("$19.99");
  });

  it("formats negative amounts", () => {
    expect(formatCents(-12_550)).toBe("-$125.50");
  });
});

describe("percentOf", () => {
  it("computes whole percentages", () => {
    expect(percentOf(100_000, 25)).toBe(25_000);
    expect(percentOf(100_000, 0)).toBe(0);
    expect(percentOf(100_000, 100)).toBe(100_000);
  });

  it("rounds half up to a whole cent", () => {
    expect(percentOf(1, 50)).toBe(1); // 0.5 -> 1
    expect(percentOf(3, 50)).toBe(2); // 1.5 -> 2
    expect(percentOf(1, 49)).toBe(0); // 0.49 -> 0
    expect(percentOf(333, 10)).toBe(33); // 33.3 -> 33
    expect(percentOf(335, 10)).toBe(34); // 33.5 -> 34
  });

  it("always returns an integer", () => {
    expect(Number.isInteger(percentOf(12_345, 33.33))).toBe(true);
  });
});
