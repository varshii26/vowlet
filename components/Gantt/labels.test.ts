import { describe, expect, it } from "vitest";
import { MIN_LABEL_GAP_PX, amountLabelFor, rollupLabels } from "@/components/Gantt/labels";
import type { DisplayStatus } from "@/lib/schedule";
import type { TaskDetail } from "@/lib/timeline";

const payment = (status: DisplayStatus, amountLabel = "$3,000"): TaskDetail => ({
  kind: "payment",
  title: "Venue balance",
  vendorId: "v1",
  vendorName: "Grand Oak Estate",
  paymentId: "p1",
  amountLabel,
  dateLabel: "Mar 18, 2027",
  status,
  statusLabel: status,
  clauseId: null,
  clauseSummary: null,
  clausePage: null,
  clauseText: null,
});

describe("amountLabelFor", () => {
  it("labels money still to pay", () => {
    expect(amountLabelFor(payment("scheduled"))).toBe("$3,000");
    expect(amountLabelFor(payment("due_soon"))).toBe("$3,000");
    expect(amountLabelFor(payment("overdue"))).toBe("$3,000");
  });

  it("stays quiet for settled payments, vendor rows and the wedding", () => {
    for (const status of ["paid", "refunded", "refund_requested", "void"] as const) expect(amountLabelFor(payment(status))).toBe("");
    expect(amountLabelFor({ kind: "wedding", title: "Wedding day", dateLabel: "Apr 17, 2027", isoDate: "2027-04-17" })).toBe("");
    expect(amountLabelFor(undefined)).toBe("");
  });
});

describe("rollupLabels", () => {
  it("labels each unpaid diamond at its offset, left to right", () => {
    const labels = rollupLabels([
      { detail: payment("scheduled", "$1,500"), x: 300 },
      { detail: payment("paid"), x: 0 },
      { detail: payment("due_soon", "$3,000"), x: 120 },
    ]);
    expect(labels).toEqual([
      { text: "$3,000", x: 120, status: "due_soon" },
      { text: "$1,500", x: 300, status: "scheduled" },
    ]);
  });

  it("drops a label that would crowd the one before it", () => {
    const labels = rollupLabels([
      { detail: payment("scheduled", "$3,000"), x: 100 },
      { detail: payment("scheduled", "$1,500"), x: 100 + MIN_LABEL_GAP_PX - 1 },
      { detail: payment("scheduled", "$900"), x: 100 + MIN_LABEL_GAP_PX * 2 },
    ]);
    expect(labels.map((l) => l.text)).toEqual(["$3,000", "$900"]);
  });
});
