// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManualVendorForm } from "@/components/Manual/ManualVendorForm";
import type { SaveManualOutcome } from "@/lib/manual/client";
import type { ManualVendor } from "@/lib/manual/schema";

const client = vi.hoisted(() => ({ requestSaveManualVendor: vi.fn<(v: ManualVendor) => Promise<SaveManualOutcome>>() }));
vi.mock("@/lib/manual/client", () => client);

beforeEach(() => {
  client.requestSaveManualVendor.mockReset();
  client.requestSaveManualVendor.mockResolvedValue({ ok: true, vendorId: "v-1", vendorName: "Blossom Florals", message: "saved" });
});
afterEach(cleanup);

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const open = () => {
  render(<ManualVendorForm today="2026-11-12" />);
  fireEvent.click(screen.getByRole("button", { name: "Enter a vendor by hand" }));
};
const save = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save vendor" }));
  });
};
function fillBasics() {
  type("Vendor name", "Blossom Florals");
  type("Category", "Florist");
  type("Payment 1", "Deposit");
  type("Amount ($)", "500");
  type("Payment 1 days", "0");
}

describe("ManualVendorForm", () => {
  it("starts as an invitation and opens the form", () => {
    render(<ManualVendorForm today="2026-11-12" />);
    expect(screen.getByText("No contract to upload?")).toBeTruthy();
    expect(screen.queryByLabelText("Vendor name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Enter a vendor by hand" }));
    expect(screen.getByLabelText("Vendor name")).toBeTruthy();
    expect((screen.getByLabelText("Date you agreed with them") as HTMLInputElement).value).toBe("2026-11-12");
  });

  it("sends what was typed in the shape the server expects", async () => {
    open();
    fillBasics();
    await save();
    expect(client.requestSaveManualVendor).toHaveBeenCalledWith({
      vendorName: "Blossom Florals",
      category: "Florist",
      paypalEmail: "",
      signingDate: "2026-11-12",
      payments: [{ label: "Deposit", amountCents: 50_000, anchor: "wedding_date", offsetDays: 0, fixedDate: null }],
      cancellationRules: [],
      dateChangeRules: [],
      notes: "",
    });
  });

  it("turns each kind of due date into an anchor and offset", async () => {
    open();
    fillBasics();
    fireEvent.click(screen.getByRole("button", { name: "Add a payment" }));
    type("Payment 2", "Balance");
    fireEvent.change(screen.getAllByLabelText("Amount ($)")[1], { target: { value: "1,250.50" } });
    fireEvent.change(screen.getAllByLabelText("Due")[1], { target: { value: "days_after_signing" } });
    type("Payment 2 days", "10");
    fireEvent.click(screen.getByRole("button", { name: "Add a payment" }));
    type("Payment 3", "Final");
    fireEvent.change(screen.getAllByLabelText("Amount ($)")[2], { target: { value: "100" } });
    fireEvent.change(screen.getAllByLabelText("Due")[2], { target: { value: "fixed" } });
    type("Payment 3 date", "2027-03-01");
    await save();

    const sent = client.requestSaveManualVendor.mock.calls[0][0];
    expect(sent.payments).toEqual([
      { label: "Deposit", amountCents: 50_000, anchor: "wedding_date", offsetDays: 0, fixedDate: null },
      { label: "Balance", amountCents: 125_050, anchor: "signing_date", offsetDays: 10, fixedDate: null },
      { label: "Final", amountCents: 10_000, anchor: "fixed", offsetDays: 0, fixedDate: "2027-03-01" },
    ]);
  });

  it("shows the running total", () => {
    open();
    type("Amount ($)", "500");
    fireEvent.click(screen.getByRole("button", { name: "Add a payment" }));
    fireEvent.change(screen.getAllByLabelText("Amount ($)")[1], { target: { value: "1,250.50" } });
    expect(screen.getByText(/Total:/).textContent).toContain("$1,750.50");
  });

  it("sends optional terms and notes when they are filled in", async () => {
    open();
    fillBasics();
    fireEvent.click(screen.getByRole("button", { name: "Add a cancellation line" }));
    type("Cancellation 1 notice days", "90");
    type("Cancellation 1 refund percent", "50");
    type("Cancellation 1 fee", "100");
    fireEvent.click(screen.getByRole("button", { name: "Add a date-change line" }));
    type("Date change 1 notice days", "60");
    type("Date change 1 fee percent", "10");
    type(/Notes for the vendor/, "Deliver by 10am.");
    await save();
    const sent = client.requestSaveManualVendor.mock.calls[0][0];
    expect(sent.cancellationRules).toEqual([{ minNoticeDays: 90, refundPercent: 50, flatFee: 10_000 }]);
    expect(sent.dateChangeRules).toEqual([{ minNoticeDays: 60, feePercent: 10, flatFee: 0 }]);
    expect(sent.notes).toBe("Deliver by 10am.");
  });

  it("explains each problem next to its field, keeps what was typed, and saves nothing", async () => {
    open();
    type("Payment 1", "Deposit");
    type("Amount ($)", "lots");
    await save();
    expect(client.requestSaveManualVendor).not.toHaveBeenCalled();
    expect(screen.getByText("Enter the vendor's name.")).toBeTruthy();
    expect(screen.getByText("Pick or type a category.")).toBeTruthy();
    expect(screen.getByText("Enter an amount like 1,500.")).toBeTruthy();
    expect((screen.getByLabelText("Payment 1") as HTMLInputElement).value).toBe("Deposit");
    expect(screen.getByLabelText("Vendor name").getAttribute("aria-invalid")).toBe("true");
  });

  it("flags a fixed-date payment with no date, and a refund over 100%", async () => {
    open();
    fillBasics();
    fireEvent.change(screen.getByLabelText("Due"), { target: { value: "fixed" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a cancellation line" }));
    type("Cancellation 1 refund percent", "150");
    await save();
    expect(client.requestSaveManualVendor).not.toHaveBeenCalled();
    expect(screen.getByText("Pick the date.")).toBeTruthy();
    expect(screen.getByText(/percentage up to 100/)).toBeTruthy();
  });

  it("removes a payment, but never the last one", () => {
    open();
    expect(screen.queryByRole("button", { name: "Remove payment 1" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add a payment" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove payment 2" }));
    expect(screen.queryByLabelText("Payment 2")).toBeNull();
  });

  it("shows the server's message when saving fails, and lets the person try again", async () => {
    client.requestSaveManualVendor.mockResolvedValueOnce({ ok: false, message: "Couldn't save this vendor." });
    open();
    fillBasics();
    await save();
    expect(screen.getByRole("alert").textContent).toContain("Couldn't save this vendor.");
    await save();
    expect(screen.getByText("Blossom Florals is on your timeline")).toBeTruthy();
  });

  it("after saving, offers the printable summary, and can start another vendor", async () => {
    open();
    fillBasics();
    await save();
    expect(screen.getByRole("link", { name: "Print summary for the vendor" }).getAttribute("href")).toBe("/vendors/v-1/print");
    expect(screen.getByRole("link", { name: "Back to the dashboard" }).getAttribute("href")).toBe("/");
    fireEvent.click(screen.getByRole("button", { name: "Add another vendor" }));
    expect((screen.getByLabelText("Vendor name") as HTMLInputElement).value).toBe("");
  });
});
