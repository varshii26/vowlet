// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PrintableSummary } from "@/components/Manual/PrintableSummary";
import type { VendorSummary } from "@/lib/vendors/summary";

afterEach(cleanup);

const summary = (over: Partial<VendorSummary> = {}): VendorSummary => ({
  coupleNames: "Ana & Ben",
  weddingDateLabel: "September 4, 2027",
  preparedLabel: "November 12, 2026",
  vendor: { name: "Blossom Florals", category: "florist", totalLabel: "$1,750", signingDateLabel: "October 1, 2026", notes: "Deliver by 10am.", entered: "by_hand" },
  payments: [
    { label: "Deposit", amountLabel: "$500", dueDateLabel: "October 1, 2026", basis: "On signing" },
    { label: "Balance", amountLabel: "$1,250", dueDateLabel: "August 21, 2027", basis: "14 days before the wedding" },
  ],
  cancellationTiers: ["90+ days' notice: 50% of payments made refunded"],
  dateChangeTiers: ["60+ days' notice: 10% of the contract price ($175)"],
  ...over,
});

describe("PrintableSummary", () => {
  it("shows who, when, every payment with its due date and basis, and the total", () => {
    render(<PrintableSummary summary={summary()} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Blossom Florals");
    expect(screen.getByText("Ana & Ben")).toBeTruthy();
    expect(screen.getByText("September 4, 2027")).toBeTruthy();
    const rows = screen.getAllByRole("row").map((r) => r.textContent);
    expect(rows.some((r) => r?.includes("Deposit") && r.includes("October 1, 2026") && r.includes("On signing") && r.includes("$500"))).toBe(true);
    expect(rows.some((r) => r?.includes("Balance") && r.includes("14 days before the wedding") && r.includes("$1,250"))).toBe(true);
    expect(rows[rows.length - 1]).toContain("$1,750");
  });

  it("lists the cancellation and date-change terms and the notes, when there are any", () => {
    render(<PrintableSummary summary={summary()} />);
    expect(screen.getByRole("heading", { name: "If the couple cancels" })).toBeTruthy();
    expect(screen.getByText("90+ days' notice: 50% of payments made refunded")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "If the wedding date changes" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Notes" })).toBeTruthy();
    expect(screen.getByText("Deliver by 10am.")).toBeTruthy();
  });

  it("leaves out the sections that have nothing in them", () => {
    render(<PrintableSummary summary={summary({ cancellationTiers: [], dateChangeTiers: [], vendor: { ...summary().vendor, notes: "" } })} />);
    expect(screen.queryByRole("heading", { name: "If the couple cancels" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "If the wedding date changes" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Notes" })).toBeNull();
  });

  it("has a signature line for each side, and says it is a summary, not a contract", () => {
    render(<PrintableSummary summary={summary()} />);
    const signatures = screen.getByLabelText("Signatures");
    expect(signatures.textContent).toContain("For the couple");
    expect(signatures.textContent).toContain("For Blossom Florals");
    expect(screen.getByText(/not a contract/).textContent).toContain("November 12, 2026");
  });
});
