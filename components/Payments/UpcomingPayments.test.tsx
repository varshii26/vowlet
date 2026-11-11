// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentDrawerProvider } from "@/components/Payments/PaymentDrawer";
import { UpcomingPayments } from "@/components/Payments/UpcomingPayments";
import { ToastProvider } from "@/components/ui/Toast";
import { paymentTaskId, vendorTaskId, type TaskDetail } from "@/lib/timeline";
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

/** Timeline details the drawer reads, for payment p1 and its vendor. */
const details = (over: Partial<Extract<TaskDetail, { kind: "payment" }>> = {}, cancelled = false): Record<string, TaskDetail> => ({
  [vendorTaskId("v1")]: { kind: "vendor", vendorId: "v1", title: "Grand Oak Estate", amountLabel: "$9,000", summary: "", cancelled, percentPaid: 0, progressLabel: "0% paid" },
  [paymentTaskId("p1")]: {
    kind: "payment",
    title: "Venue second installment",
    vendorId: "v1",
    vendorName: "Grand Oak Estate",
    paymentId: "p1",
    amountLabel: "$3,000",
    dateLabel: "Dec 18, 2026",
    status: "scheduled",
    statusLabel: "Scheduled",
    clauseId: "c1",
    clauseSummary: "Second installment",
    clausePage: 2,
    clauseText: "The second installment of $3,000 is due 120 days before the event.",
    ...over,
  },
});

function renderList(payments: UpcomingPayment[], d = details()) {
  return render(
    <ToastProvider>
      <PaymentDrawerProvider details={d}>
        <UpcomingPayments payments={payments} />
      </PaymentDrawerProvider>
    </ToastProvider>,
  );
}

const openRow = (name: RegExp) => act(() => fireEvent.click(screen.getByRole("button", { name })));
const dialog = () => screen.getByRole("dialog", { name: "Venue second installment" });

describe("UpcomingPayments", () => {
  it("lists each payment with its vendor, due date, status and amount, without a Pay button per row", () => {
    renderList([payment(), payment({ paymentId: "p2", label: "Catering deposit", status: "due_soon", statusLabel: "Due soon" })]);
    const rows = within(screen.getByRole("list", { name: "Upcoming payments" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Venue second installment");
    expect(rows[0].textContent).toContain("Grand Oak Estate · due Dec 18, 2026");
    expect(rows[0].textContent).toContain("Scheduled");
    expect(rows[0].textContent).toContain("$3,000");
    expect(rows[1].textContent).toContain("Due soon");
    expect(screen.queryByRole("button", { name: /^Pay / })).toBeNull();
  });

  it("says so when nothing is left to pay", () => {
    renderList([]);
    expect(screen.getByText("No payments left to make.")).toBeTruthy();
  });
});

describe("the payment drawer", () => {
  it("opens from a row with the amount, due date, status, the clause quote and its page, and the Pay button", () => {
    renderList([payment()]);
    openRow(/Venue second installment/);
    const d = within(dialog());
    expect(d.getByText("$3,000")).toBeTruthy();
    expect(d.getByText("Dec 18, 2026")).toBeTruthy();
    expect(d.getByText("Scheduled")).toBeTruthy();
    expect(d.getByText(/The second installment of \$3,000 is due 120 days before the event\./)).toBeTruthy();
    expect(d.getByText("Grand Oak Estate contract, page 2")).toBeTruthy();
    expect(d.getByRole("link", { name: "Open in contract" }).getAttribute("href")).toContain("/vendors/v1");
    expect(d.getByRole("button", { name: "Pay p1" })).toBeTruthy();
  });

  it("moves focus into the drawer, and Escape closes it", () => {
    renderList([payment()]);
    openRow(/Venue second installment/);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close payment details");
    act(() => fireEvent.keyDown(window, { key: "Escape" }));
    expect(screen.queryByRole("dialog")).toBeNull(); // hidden from assistive tech once closed
  });

  it("celebrates a completed payment with a toast", () => {
    renderList([payment()]);
    openRow(/Venue second installment/);
    act(() => fireEvent.click(within(dialog()).getByRole("button", { name: "Pay p1" })));
    expect(screen.getByRole("status").textContent).toContain("Paid $3,000 to Grand Oak Estate (Venue second installment).");
  });

  it("reports a pending payment as pending, not as paid", () => {
    stub.state = "pending";
    renderList([payment()]);
    openRow(/Venue second installment/);
    act(() => fireEvent.click(within(dialog()).getByRole("button", { name: "Pay p1" })));
    expect(screen.getByRole("status").textContent).toContain("still processing");
    expect(screen.getByRole("status").textContent).not.toContain("Paid $3,000");
  });

  it("offers no Pay button for a paid payment or a cancelled vendor", () => {
    renderList([payment()], details({ status: "paid", statusLabel: "Paid" }));
    openRow(/Venue second installment/);
    expect(within(dialog()).queryByRole("button", { name: "Pay p1" })).toBeNull();
    expect(within(dialog()).getByText("Nothing to pay: this payment is paid.")).toBeTruthy();
    cleanup();

    renderList([payment()], details({}, true));
    openRow(/Venue second installment/);
    expect(within(dialog()).getByText(/This vendor is cancelled/)).toBeTruthy();
  });
});
