import { describe, expect, it } from "vitest";
import { monthKey, peakCents, renderCashCell, shortMoney, totalCash } from "@/components/Gantt/summary";

describe("monthKey", () => {
  it("names the local calendar month a tick starts in", () => {
    expect(monthKey(new Date(2027, 2, 1))).toBe("2027-03");
    expect(monthKey(new Date(2026, 11, 1))).toBe("2026-12");
  });
});

describe("shortMoney", () => {
  it("keeps small amounts exact to the dollar and shortens large ones", () => {
    expect(shortMoney(95_000)).toBe("$950");
    expect(shortMoney(300_000)).toBe("$3,000");
    expect(shortMoney(999_900)).toBe("$9,999");
    expect(shortMoney(1_250_000)).toBe("$12.5k");
    expect(shortMoney(1_200_000)).toBe("$12k");
    expect(shortMoney(10_040_000)).toBe("$100k");
  });
});

describe("renderCashCell", () => {
  const cash = { "2027-03": 450_000, "2027-04": 1_250_000 };

  it("shows the month's amount with the exact figure in its title", () => {
    expect(renderCashCell(cash, "2027-03")).toBe('<span class="vw-cash" title="$4,500 due in March 2027" aria-label="$4,500 due in March 2027">$4,500</span>');
  });

  it("highlights the busiest month", () => {
    const html = renderCashCell(cash, "2027-04");
    expect(html).toContain('class="vw-cash vw-cash-peak"');
    expect(html).toContain("$12,500 due in April 2027 (the busiest month)");
    expect(html).toContain(">$12.5k<");
  });

  it("is empty for a month with nothing due", () => {
    expect(renderCashCell(cash, "2027-05")).toBe("");
    expect(renderCashCell({}, "2027-05")).toBe("");
  });
});

describe("totals", () => {
  it("adds up every month, and finds the peak", () => {
    expect(totalCash({ a: 1, b: 2 })).toBe(3);
    expect(peakCents({ a: 1, b: 2 })).toBe(2);
    expect(peakCents({})).toBe(0);
  });
});
