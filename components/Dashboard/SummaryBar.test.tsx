// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SummaryBar, type SummaryBarProps } from "@/components/Dashboard/SummaryBar";
import { summarizeBudget } from "@/lib/budget";
import type { UpcomingPayment } from "@/lib/payments/upcoming";

afterEach(cleanup);

const next: UpcomingPayment = {
  paymentId: "p1",
  vendorName: "DJ Marlow Sound",
  label: "DJ booking fee",
  amountCents: 50_000,
  amountLabel: "$500",
  dueDate: "2026-12-01",
  dueDateLabel: "Dec 1, 2026",
  status: "scheduled",
  statusLabel: "Scheduled",
};

const props = (over: Partial<SummaryBarProps> = {}): SummaryBarProps => ({
  weddingDateLabel: "Sat, Apr 17, 2027",
  daysToGo: 161,
  summary: summarizeBudget(3_600_000, [
    { amountCents: 650_000, status: "paid", vendorActive: true },
    { amountCents: 2_450_000, status: "scheduled", vendorActive: true },
  ]),
  next,
  vendors: [
    { id: "v1", name: "Grand Oak Estate", cancelled: false },
    { id: "v2", name: "Bloom & Thistle Florals", cancelled: true },
  ],
  ...over,
});

const stat = (label: string) => screen.getByText(label, { selector: "dt" }).parentElement as HTMLElement;

describe("SummaryBar", () => {
  it("shows the wedding date, the countdown and the budget totals", () => {
    render(<SummaryBar {...props()} />);
    expect(within(stat("Wedding")).getByText("Sat, Apr 17, 2027")).toBeTruthy();
    expect(within(stat("Wedding")).getByText("161 days to go")).toBeTruthy();
    expect(within(stat("Paid")).getByText("$6,500")).toBeTruthy();
    expect(within(stat("Still to pay")).getByText("$24,500")).toBeTruthy();
    expect(within(stat("Still to pay")).getByText("1 payment")).toBeTruthy();
    expect(within(stat("Left in budget")).getByText("$5,000")).toBeTruthy();
    expect(within(stat("Left in budget")).getByText("of $36,000")).toBeTruthy();
  });

  it("describes the bar in words for screen readers", () => {
    render(<SummaryBar {...props()} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("$6,500 paid, $24,500 still to pay and $5,000 left of a $36,000 budget.");
  });

  it("says so plainly when over budget", () => {
    render(<SummaryBar {...props({ summary: summarizeBudget(1_000_000, [{ amountCents: 1_200_000, status: "scheduled", vendorActive: true }]) })} />);
    expect(within(stat("Over budget by")).getByText("$2,000")).toBeTruthy();
    expect(screen.queryByText("Left in budget", { selector: "dt" })).toBeNull();
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/^Over budget/);
  });

  it("names the next payment, or says nothing is left", () => {
    render(<SummaryBar {...props()} />);
    expect(screen.getByText(/\$500 to DJ Marlow Sound \(DJ booking fee\), due Dec 1, 2026\./)).toBeTruthy();
    cleanup();
    render(<SummaryBar {...props({ next: null })} />);
    expect(screen.getByText("Nothing left to pay.")).toBeTruthy();
  });

  it("links every vendor to its contract page, marking cancelled ones", () => {
    render(<SummaryBar {...props()} />);
    const nav = screen.getByRole("navigation", { name: "Vendor contracts" });
    expect(within(nav).getByRole("link", { name: "Grand Oak Estate" }).getAttribute("href")).toBe("/vendors/v1");
    expect(within(nav).getByRole("link", { name: "Bloom & Thistle Florals" }).className).toContain("line-through");
  });

  it.each([
    [0, "It's the wedding day"],
    [1, "1 day to go"],
    [-3, "3 days ago"],
  ])("counts down: %i -> %s", (daysToGo, text) => {
    render(<SummaryBar {...props({ daysToGo })} />);
    expect(screen.getByText(text)).toBeTruthy();
  });
});
