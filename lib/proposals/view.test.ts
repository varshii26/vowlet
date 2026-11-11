import { describe, expect, it } from "vitest";
import { formatIsoDate, toProposalView, type ProposalRow } from "@/lib/proposals/view";

const row = (over: Partial<ProposalRow> & Pick<ProposalRow, "kind" | "payload">): ProposalRow => ({
  id: "p1",
  createdAt: new Date("2026-11-07T10:00:00Z"),
  clause: null,
  ...over,
});

describe("formatIsoDate", () => {
  it("writes a short readable date", () => {
    expect(formatIsoDate("2027-06-12")).toBe("Jun 12, 2027");
    expect(formatIsoDate("2026-12-01")).toBe("Dec 1, 2026");
  });

  it("returns what it was given when it isn't a date", () => {
    expect(formatIsoDate("someday")).toBe("someday");
  });
});

describe("toProposalView", () => {
  it("describes a payment", () => {
    const v = toProposalView(
      row({
        kind: "pay",
        payload: { paymentId: "pay1", vendorId: "v1", vendorName: "Grand Oak Estate", label: "Venue second installment", amountCents: 300_000, dueDate: "2026-12-18", reason: "It is next." },
        clause: { id: "cl1", vendorId: "v1", page: 1, vendor: { name: "Grand Oak Estate" } },
      }),
    );
    expect(v).toEqual({
      id: "p1",
      kind: "pay",
      title: "Pay Grand Oak Estate",
      summary: "Venue second installment, due Dec 18, 2026.",
      amount: { label: "$3,000", caption: "to pay now" },
      details: [],
      draft: null,
      reason: "It is next.",
      citation: "Grand Oak Estate contract, page 1",
      clauseHref: "/vendors/v1?clause=cl1",
      paymentId: "pay1",
      approvable: true,
      fees: [],
      dateChange: null,
      warning: null,
      createdAt: "2026-11-07T10:00:00.000Z",
    });
  });

  it("describes a reschedule, with the fee per vendor", () => {
    const v = toProposalView(
      row({
        kind: "reschedule",
        payload: {
          previousDate: "2027-04-17",
          newDate: "2027-06-12",
          totalCostCents: 133_000,
          charges: [
            { vendorId: "a", vendorName: "Grand Oak Estate", costCents: 45_000, clauseId: "c1" },
            { vendorId: "b", vendorName: "Bloom & Thistle Florals", costCents: 15_000, clauseId: null },
          ],
          reason: "They asked.",
        },
      }),
    );
    expect(v.title).toBe("Move the wedding");
    expect(v.summary).toBe("From Apr 17, 2027 to Jun 12, 2027. Every payment date moves with it.");
    expect(v.amount).toEqual({ label: "$1,330", caption: "in vendor change fees" });
    expect(v.fees).toEqual([
      { vendorId: "a", vendorName: "Grand Oak Estate", amountLabel: "$450", citation: null, clauseHref: "/vendors/a?clause=c1" },
      { vendorId: "b", vendorName: "Bloom & Thistle Florals", amountLabel: "$150", citation: null, clauseHref: null },
    ]);
    expect(v.dateChange).toEqual({ from: "Apr 17, 2027", to: "Jun 12, 2027", payments: [] });
    expect(v.warning).toBeNull();
    expect(v.paymentId).toBeNull();
    expect(v.citation).toBeNull();
  });

  const rich = {
    previousDate: "2027-04-17",
    newDate: "2027-06-12",
    totalCostCents: 321_000,
    charges: [
      { vendorId: "b", vendorName: "Bloom & Thistle Florals", costCents: 51_000, clauseId: "c2", citation: "Bloom & Thistle Florals contract, page 2" },
      { vendorId: "a", vendorName: "Grand Oak Estate", costCents: 270_000, clauseId: "c1", citation: "Grand Oak Estate contract, page 2" },
    ],
    budget: { budgetCents: 3_600_000, committedCents: 3_450_000, projectedCents: 3_771_000, overByCents: 171_000 },
    movingPayments: [{ vendorName: "Grand Oak Estate", label: "Venue balance", fromDate: "2027-03-18", toDate: "2027-05-13" }],
    reason: "",
  };

  it("sorts a reschedule's fees largest first, each with its own clause chip", () => {
    const v = toProposalView(row({ kind: "reschedule", payload: rich }));
    expect(v.fees.map((f) => [f.vendorName, f.amountLabel, f.citation, f.clauseHref])).toEqual([
      ["Grand Oak Estate", "$2,700", "Grand Oak Estate contract, page 2", "/vendors/a?clause=c1"],
      ["Bloom & Thistle Florals", "$510", "Bloom & Thistle Florals contract, page 2", "/vendors/b?clause=c2"],
    ]);
  });

  it("shows the next payments that move, before and after", () => {
    const v = toProposalView(row({ kind: "reschedule", payload: rich }));
    expect(v.dateChange?.payments).toEqual([{ key: "Grand Oak Estate|Venue balance", title: "Grand Oak Estate: Venue balance", from: "Mar 18, 2027", to: "May 13, 2027" }]);
  });

  it("warns when the move pushes the wedding over budget, naming the costliest vendor", () => {
    const v = toProposalView(row({ kind: "reschedule", payload: rich }));
    expect(v.warning).toBe(
      "Over budget by $1,710: the wedding would cost $37,710 against a $36,000 budget. The biggest change fee is Grand Oak Estate ($2,700).",
    );
  });

  it("does not warn within budget", () => {
    const v = toProposalView(row({ kind: "reschedule", payload: { ...rich, budget: { ...rich.budget, projectedCents: 3_500_000, overByCents: 0 } } }));
    expect(v.warning).toBeNull();
  });

  it("says there are no fees when there are none", () => {
    const v = toProposalView(row({ kind: "reschedule", payload: { previousDate: "2027-04-17", newDate: "2027-04-24", totalCostCents: 0, charges: [], reason: "" } }));
    expect(v.amount).toEqual({ label: "$0", caption: "no change fees" });
    expect(v.fees).toEqual([]);
  });

  it("describes a refund request with the drafted message and who cancelled", () => {
    const payload = {
      vendorId: "v",
      vendorName: "Bloom & Thistle Florals",
      cancelledBy: "vendor",
      cancellationDate: "2026-11-07",
      owedCents: 80_000,
      paidCents: 80_000,
      calculation: "Vendor cancelled, so all $800 paid is owed back.",
      message: "Dear Bloom & Thistle, please refund.",
      reason: "The florist cancelled.",
    };
    const v = toProposalView(row({ kind: "refund_request", payload, clause: { id: "cl2", vendorId: "v1", page: 2, vendor: { name: "Bloom & Thistle Florals" } } }));
    expect(v.title).toBe("Request a refund");
    expect(v.summary).toBe("Ask Bloom & Thistle Florals for $800 back of the $800 paid.");
    expect(v.amount).toEqual({ label: "$800", caption: "to ask back" });
    expect(v.details).toEqual(["Vendor cancelled, so all $800 paid is owed back.", "Cancelled by the vendor on Nov 7, 2026."]);
    expect(v.draft).toBe("Dear Bloom & Thistle, please refund.");
    expect(v.citation).toBe("Bloom & Thistle Florals contract, page 2");

    const couple = toProposalView(row({ kind: "refund_request", payload: { ...payload, cancelledBy: "couple" } }));
    expect(couple.details[1]).toBe("Cancelled by you on Nov 7, 2026.");
  });

  it("describes a note", () => {
    const v = toProposalView(row({ kind: "message", payload: { text: "The deposit is non-refundable.", reason: "Explaining." } }));
    expect(v).toMatchObject({ title: "A note for you", summary: "The deposit is non-refundable.", amount: null, draft: null, approvable: true });
  });

  it("marks a proposal whose details can't be read as not approvable, instead of guessing", () => {
    for (const kind of ["pay", "reschedule", "refund_request", "message"] as const) {
      for (const payload of [null, {}, "text", { amountCents: "lots" }]) {
        const v = toProposalView(row({ kind, payload }));
        expect(v.approvable, `${kind} ${JSON.stringify(payload)}`).toBe(false);
        expect(v.title).toBe("Unreadable proposal");
        expect(v.amount).toBeNull();
        expect(v.paymentId).toBeNull();
      }
    }
  });

  it("keeps the clause citation even for an unreadable proposal", () => {
    expect(toProposalView(row({ kind: "pay", payload: {}, clause: { id: "cl3", vendorId: "v1", page: 3, vendor: { name: "DJ Marlow Sound" } } })).citation).toBe("DJ Marlow Sound contract, page 3");
  });

  it("is plain data that survives JSON, so it can cross from the server to the browser", () => {
    const v = toProposalView(row({ kind: "message", payload: { text: "hi", reason: "" } }));
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });
});
