// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpcomingPayments } from "@/components/Payments/UpcomingPayments";
import type { UpcomingPayment } from "@/lib/payments/upcoming";

// PayButton has its own tests; here it is a stub that reports a settled payment when clicked.
const stub = vi.hoisted(() => ({ state: "paid" as "paid" | "pending" }));
vi.mock("@/components/Payments/PayButton", async () => {
  const { createElement } = await import("react");
  return {
    PayButton: ({ paymentId, onSettled }: { paymentId: string; onSettled?: (o: unknown) => void }) =>
      createElement(
        "button",
        {
          onClick: () =>
            onSettled?.({
              ok: true,
              state: stub.state,
              message: stub.state === "pending" ? "PayPal is still processing this payment." : "Payment complete.",
            }),
        },
        `Pay ${paymentId}`,
      ),
  };
});

afterEach(() => {
  cleanup();
  stub.state = "paid";
});

const payment = (over: Partial<UpcomingPayment> = {}): UpcomingPayment => ({
  paymentId: "p1",
  vendorName: "Grand Oak Estate",
  label: "Venue second installment",
  amountCents: 300_000,
  amountLabel: "$3,000",
  dueDate: "2026-12-18",
  dueDateLabel: "Dec 18, 2026",
  status: "scheduled",
  statusLabel: "Scheduled",
  ...over,
});

describe("UpcomingPayments", () => {
  it("lists each payment with its vendor, due date, status, amount and a Pay button", () => {
    render(<UpcomingPayments payments={[payment(), payment({ paymentId: "p2", label: "Catering final", vendorName: "Saffron & Sage Catering", amountLabel: "$1,500", status: "overdue", statusLabel: "Overdue" })]} />);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Venue second installment")).toBeTruthy();
    expect(within(rows[0]).getByText(/Grand Oak Estate · due Dec 18, 2026/)).toBeTruthy();
    expect(within(rows[0]).getByText("Scheduled")).toBeTruthy();
    expect(within(rows[0]).getByText("$3,000")).toBeTruthy();
    expect(within(rows[0]).getByRole("button", { name: "Pay p1" })).toBeTruthy();
    expect(within(rows[1]).getByText("Overdue")).toBeTruthy();
    expect(within(rows[1]).getByRole("button", { name: "Pay p2" })).toBeTruthy();
  });

  it("says so when nothing is left to pay", () => {
    render(<UpcomingPayments payments={[]} />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText("No payments left to make.")).toBeTruthy();
  });

  it("confirms a payment, and keeps the confirmation until dismissed", () => {
    render(<UpcomingPayments payments={[payment()]} />);
    expect(screen.queryByRole("status")).toBeNull();

    act(() => screen.getByRole("button", { name: "Pay p1" }).click());
    expect(screen.getByRole("status").textContent).toContain("Paid $3,000 to Grand Oak Estate (Venue second installment).");

    act(() => screen.getByRole("button", { name: "Dismiss" }).click());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps the confirmation visible after the paid payment drops off the list", () => {
    const { rerender } = render(<UpcomingPayments payments={[payment()]} />);
    act(() => screen.getByRole("button", { name: "Pay p1" }).click());

    rerender(<UpcomingPayments payments={[]} />); // the server refresh removes the paid row
    expect(screen.getByRole("status").textContent).toContain("Paid $3,000");
    expect(screen.getByText("No payments left to make.")).toBeTruthy();
  });

  it("reports a pending payment as pending, not as paid", () => {
    stub.state = "pending";
    render(<UpcomingPayments payments={[payment()]} />);
    act(() => screen.getByRole("button", { name: "Pay p1" }).click());

    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain("PayPal is still processing this payment.");
    expect(text).not.toContain("Paid $3,000");
  });
});
