// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SummaryBar, type SummaryBarProps } from "@/components/Dashboard/SummaryBar";
import { summarizeBudget } from "@/lib/budget";
import type { UpcomingPayment } from "@/lib/payments/upcoming";

// PayButton has its own tests and needs the PayPal SDK.
vi.mock("@/components/Payments/PayButton", async () => {
  const { createElement } = await import("react");
  return { PayButton: ({ paymentId }: { paymentId: string }) => createElement("button", null, `Pay ${paymentId}`) };
});

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
  coupleNames: "Priya & Sam",
  weddingDateLabel: "Sat, Apr 17, 2027",
  daysToGo: 161,
  summary: summarizeBudget(3_600_000, [
    { amountCents: 650_000, status: "paid", vendorActive: true },
    { amountCents: 2_450_000, status: "scheduled", vendorActive: true },
  ]),
  next,
  ...over,
});

const stat = (label: string) => screen.getByText(label, { selector: "dt" }).parentElement as HTMLElement;
const value = (label: string) => within(stat(label)).getByRole("definition").textContent;

describe("SummaryBar", () => {
  it("shows the couple, the wedding date, the countdown and the budget totals", () => {
    render(<SummaryBar {...props()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Priya & Sam" })).toBeTruthy();
    expect(screen.getByText("Sat, Apr 17, 2027")).toBeTruthy();
    expect(screen.getByText("161 days to go")).toBeTruthy();
    expect(value("Paid")).toBe("$6,500");
    expect(value("Still to pay")).toBe("$24,500 (1 payment)");
    expect(value("Left")).toBe("$5,000 of $36,000");
  });

  it("describes the bar in words for screen readers", () => {
    render(<SummaryBar {...props()} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("$6,500 paid, $24,500 still to pay and $5,000 left of a $36,000 budget.");
  });

  it("says so plainly when over budget", () => {
    render(<SummaryBar {...props({ summary: summarizeBudget(1_000_000, [{ amountCents: 1_200_000, status: "scheduled", vendorActive: true }]) })} />);
    expect(value("Over budget by")).toBe("$2,000");
    expect(screen.queryByText("Left", { selector: "dt" })).toBeNull();
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/^Over budget/);
  });

  it("names the next payment with its one Pay button, or says nothing is left", () => {
    render(<SummaryBar {...props()} />);
    expect(screen.getByText("Next payment")).toBeTruthy();
    expect(screen.getByText(/DJ Marlow Sound/).textContent).toMatch(/\$500 DJ Marlow Sound · Dec 1, 2026/);
    expect(screen.getAllByRole("button", { name: /^Pay / })).toHaveLength(1);
    cleanup();
    render(<SummaryBar {...props({ next: null })} />);
    expect(screen.getByText("Nothing left to pay.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Pay / })).toBeNull();
  });

  it("shows the page actions it is given", () => {
    render(<SummaryBar {...props({ actions: <a href="/upload">Upload contracts</a> })} />);
    expect(screen.getByRole("link", { name: "Upload contracts" })).toBeTruthy();
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
