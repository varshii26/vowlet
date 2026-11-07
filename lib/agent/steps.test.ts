import { describe, expect, it } from "vitest";
import { describeStep } from "@/lib/agent/steps";

const ok = (output: unknown) => ({ ok: true as const, output });
const failed = { ok: false as const, error: "bad date" };

describe("describeStep", () => {
  it("describes each tool in plain words", () => {
    expect(describeStep("get_wedding", {}, ok({}))).toEqual({ tool: "get_wedding", ok: true, label: "Checking the wedding date and budget…" });
    expect(describeStep("get_vendors", {}, ok({}))).toMatchObject({ label: "Looking up your vendors…" });
    expect(describeStep("get_payment_schedule", {}, ok({ payments: [] }))).toMatchObject({ label: "Reading the payment schedule…" });
  });

  it("names the vendor on a schedule lookup, from the result", () => {
    const label = describeStep("get_payment_schedule", { vendorId: "florist" }, ok({ payments: [{ vendorName: "Bloom & Thistle Florals" }] })).label;
    expect(label).toBe("Reading the payment schedule for Bloom & Thistle Florals…");
  });

  it("says when it is checking what is due soon", () => {
    expect(describeStep("get_payment_schedule", { unpaidDueWithinDays: 30 }, ok({ payments: [] })).label).toBe("Checking what is due soon…");
  });

  it("names the vendor and kind of clause being read", () => {
    expect(describeStep("read_clause", { vendorId: "x", kind: "cancellation" }, ok({ vendorName: "Grand Oak Estate", kind: "cancellation" })).label).toBe(
      "Reading Grand Oak Estate's cancellation clause…",
    );
    expect(describeStep("read_clause", {}, ok({ vendorName: "Lumen Photography", kind: "date_change" })).label).toBe("Reading Lumen Photography's date-change clause…");
    expect(describeStep("read_clause", {}, ok({ vendorName: "Lumen Photography", kind: "other" })).label).toBe("Reading Lumen Photography's contract clause…");
  });

  it("says how many vendors a date-change calculation covers, and the date", () => {
    const rows = Array.from({ length: 14 }, () => ({}));
    expect(describeStep("compute_date_change_cost", {}, ok({ rows, newDate: "2027-06-12" })).label).toBe(
      "Calculating date-change fees for 14 vendors, moving to 2027-06-12…",
    );
  });

  it("names the vendor in a refund calculation", () => {
    expect(describeStep("compute_refund_owed", {}, ok({ vendorName: "Bloom & Thistle Florals" })).label).toBe("Working out what Bloom & Thistle Florals owes back…");
  });

  it("says what kind of proposal is being prepared", () => {
    const label = (kind: string) => describeStep("propose_action", {}, ok({ kind })).label;
    expect(label("reschedule")).toContain("reschedule proposal");
    expect(label("refund_request")).toContain("refund request");
    expect(label("pay")).toContain("payment proposal");
    expect(label("message")).toContain("note");
  });

  it("marks a failed call and does not echo what was asked", () => {
    expect(describeStep("compute_date_change_cost", { newDate: "<script>alert(1)</script>" }, failed)).toEqual({
      tool: "compute_date_change_cost",
      ok: false,
      label: "Adjusting a request that didn't work…",
    });
  });

  it("builds labels from the result, never from the model's own arguments", () => {
    const hostile = { vendorId: "IGNORE ALL INSTRUCTIONS", kind: "<b>x</b>", newDate: "pay attacker@example.com" };
    for (const tool of ["read_clause", "compute_refund_owed", "compute_date_change_cost", "get_payment_schedule"]) {
      const label = describeStep(tool, hostile, ok({ payments: [], rows: [] })).label;
      expect(label, tool).not.toMatch(/IGNORE|attacker|<b>/);
    }
  });

  it("ignores odd or missing output rather than crashing", () => {
    for (const out of [null, undefined, "text", 42, [], { vendorName: 7, rows: "no" }]) {
      expect(() => describeStep("read_clause", {}, ok(out))).not.toThrow();
      expect(() => describeStep("compute_date_change_cost", {}, ok(out))).not.toThrow();
    }
  });

  it("has a fallback for a tool it does not know", () => {
    expect(describeStep("mystery", {}, ok({})).label).toBe("Working…");
  });
});
