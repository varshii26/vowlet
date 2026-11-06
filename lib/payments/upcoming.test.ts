import { describe, expect, it } from "vitest";
import { selectUpcomingPayments } from "@/lib/payments/upcoming";
import type { PaymentStatus } from "@/lib/schedule";
import type { TimelineInput, TimelinePayment, TimelineVendor } from "@/lib/timeline";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const wedding = d("2027-04-17");
const today = d("2026-11-07");

const payment = (id: string, over: Partial<TimelinePayment> = {}): TimelinePayment => ({
  id,
  label: `Payment ${id}`,
  amountCents: 100_000,
  anchor: "wedding_date",
  offsetDays: -30,
  fixedDate: null,
  status: "scheduled",
  clause: null,
  ...over,
});
const vendor = (id: string, payments: TimelinePayment[], over: Partial<TimelineVendor> = {}): TimelineVendor => ({
  id,
  name: `Vendor ${id}`,
  status: "active",
  signingDate: d("2026-06-12"),
  payments,
  ...over,
});
const input = (vendors: TimelineVendor[]): TimelineInput => ({ wedding: { coupleNames: "A & B", date: wedding }, vendors });

describe("selectUpcomingPayments", () => {
  it("lists unpaid payments soonest first, across vendors", () => {
    const result = selectUpcomingPayments(
      input([
        vendor("a", [payment("late", { offsetDays: -10 }), payment("early", { offsetDays: -90 })]),
        vendor("b", [payment("mid", { offsetDays: -45 })]),
      ]),
      today,
    );
    expect(result.map((p) => p.paymentId)).toEqual(["early", "mid", "late"]);
  });

  it("leaves out anything the Pay button cannot act on", () => {
    const statuses: PaymentStatus[] = ["paid", "void", "refunded", "refund_requested"];
    const result = selectUpcomingPayments(
      input([
        vendor("a", [payment("open"), ...statuses.map((s) => payment(s, { status: s }))]),
        vendor("gone", [payment("cancelled-vendor")], { status: "cancelled" }),
      ]),
      today,
    );
    expect(result.map((p) => p.paymentId)).toEqual(["open"]);
  });

  it("includes payments stored as due", () => {
    expect(selectUpcomingPayments(input([vendor("a", [payment("x", { status: "due" })])]), today)).toHaveLength(1);
  });

  it("describes each payment for display", () => {
    const [p] = selectUpcomingPayments(
      input([vendor("a", [payment("x", { label: "Deposit", amountCents: 150_050, offsetDays: -30 })])]),
      today,
    );
    expect(p).toEqual({
      paymentId: "x",
      vendorName: "Vendor a",
      label: "Deposit",
      amountCents: 150_050,
      amountLabel: "$1,500.50",
      dueDate: "2027-03-18",
      dueDateLabel: "Mar 18, 2027",
      status: "scheduled",
      statusLabel: "Scheduled",
    });
  });

  it("marks payments overdue and due soon", () => {
    const result = selectUpcomingPayments(
      input([vendor("a", [payment("over", { offsetDays: -200 }), payment("soon", { offsetDays: -150 }), payment("later", { offsetDays: -30 })])]),
      today,
    );
    expect(result.map((p) => [p.paymentId, p.status])).toEqual([
      ["over", "overdue"],
      ["soon", "due_soon"],
      ["later", "scheduled"],
    ]);
  });

  it("breaks ties by vendor name, then label", () => {
    const result = selectUpcomingPayments(
      input([
        vendor("b", [payment("b1", { label: "Zed" })]),
        vendor("a", [payment("a2", { label: "Beta" }), payment("a1", { label: "Alpha" })]),
      ]),
      today,
    );
    expect(result.map((p) => p.paymentId)).toEqual(["a1", "a2", "b1"]);
  });

  it("limits the list, and the limit applies after sorting", () => {
    const many = vendor("a", Array.from({ length: 12 }, (_, i) => payment(`p${i}`, { offsetDays: -(100 - i) })));
    const result = selectUpcomingPayments(input([many]), today, 5);
    expect(result.map((p) => p.paymentId)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
    expect(selectUpcomingPayments(input([many]), today)).toHaveLength(8);
  });

  it("does not leak the sort key", () => {
    const [p] = selectUpcomingPayments(input([vendor("a", [payment("x")])]), today);
    expect(Object.keys(p)).not.toContain("sortKey");
  });

  it("returns nothing when everything is paid", () => {
    expect(selectUpcomingPayments(input([vendor("a", [payment("x", { status: "paid" })])]), today)).toEqual([]);
  });
});
