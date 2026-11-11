import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { TODAY, ok, refused } from "@/lib/agent/tools/test-utils";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase } from "@/lib/test-utils/db";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDatabase());
}, 60_000);
afterAll(async () => cleanup());
beforeEach(async () => seedDemo(prisma));

type Row = { vendorName: string; cost: { cents: number; label: string }; clauseId: string | null; reason: string; noticeDays: number };
const row = (r: Record<string, unknown>, name: string) => (r.rows as Row[]).find((x) => x.vendorName === name)!;

describe("compute_date_change_cost", () => {
  it("costs $1,330 to move the wedding two months, worked out from each contract", async () => {
    const r = await ok(prisma, "compute_date_change_cost", { newDate: "2027-06-17" });
    expect(r).toMatchObject({ currentDate: "2027-04-17", newDate: "2027-06-17", today: "2026-11-07", vendorsCharging: 8 });
    expect(r.total).toEqual({ cents: 133_000, label: "$1,330" });
    expect(r.rows).toHaveLength(14);
    expect(row(r, "Grand Oak Estate").cost).toEqual({ cents: 45_000, label: "$450" });
    expect(row(r, "Lumen Photography").cost).toEqual({ cents: 0, label: "$0" });
  });

  it("reports the budget after the move and the biggest fee, all in code", async () => {
    const r = await ok(prisma, "compute_date_change_cost", { newDate: "2027-06-17" });
    const w = await ok(prisma, "get_wedding");
    const committed = w.paid.cents + w.scheduled.cents;
    expect(r.budget).toEqual({
      budget: { cents: 3_600_000, label: "$36,000" },
      committedBeforeMove: { cents: committed, label: expect.any(String) },
      totalAfterMove: { cents: committed + 133_000, label: expect.any(String) },
      overBudget: false,
      overBudgetBy: null,
    });
    expect(r.biggestFee).toEqual({ vendorName: "Grand Oak Estate", cost: { cents: 45_000, label: "$450" }, citation: "Grand Oak Estate contract, page 2" });
  });

  it("flags an over-budget move with the overage", async () => {
    const w = await ok(prisma, "get_wedding");
    const wedding = await prisma.wedding.findFirstOrThrow();
    await prisma.wedding.update({ where: { id: wedding.id }, data: { budget: w.paid.cents + w.scheduled.cents + 100_000 } });
    const r = await ok(prisma, "compute_date_change_cost", { newDate: "2027-06-17" });
    expect(r.budget).toMatchObject({ overBudget: true, overBudgetBy: { cents: 33_000, label: "$330" } });
  });

  it("matches the pure function in lib/terms.ts: the tool adds no arithmetic of its own", async () => {
    const r = await ok(prisma, "compute_date_change_cost", { newDate: "2027-06-17" });
    expect(r.rows.reduce((sum: number, x: Row) => sum + x.cost.cents, 0)).toBe(r.total.cents);
  });

  it("cites the clause behind every row, and each really is that vendor's date-change clause", async () => {
    const r = await ok(prisma, "compute_date_change_cost", { newDate: "2027-06-17" });
    for (const x of r.rows as Array<Row & { vendorId: string }>) {
      expect(x.clauseId).not.toBeNull();
      const clause = await prisma.clause.findUniqueOrThrow({ where: { id: x.clauseId! } });
      expect(clause).toMatchObject({ vendorId: x.vendorId, kind: "date_change" });
    }
  });

  it("gives every row a readable citation, so the answer can cite the contract in words", async () => {
    const r = await ok(prisma, "compute_date_change_cost", { newDate: "2027-06-17" });
    expect(row(r, "Grand Oak Estate")).toMatchObject({ citation: "Grand Oak Estate contract, page 2" } as object);
    for (const x of r.rows as Array<Row & { citation: string }>) {
      expect(x.citation).toBe(`${x.vendorName} contract, page 2`);
      expect(x.citation).not.toMatch(/cm[a-z0-9]{15,}/);
    }
  });

  it("explains each row in plain language", async () => {
    const r = await ok(prisma, "compute_date_change_cost", { newDate: "2027-06-17" });
    expect(row(r, "Grand Oak Estate").reason).toBe("$450 (5% of the contract) with 161 days' notice.");
    expect(row(r, "Lumen Photography").reason).toContain("Free");
  });

  it("charges more as the notice shrinks (75 days: strict vendors 30%, flat-fee vendors 15% plus $150)", async () => {
    const r = await ok(prisma, "compute_date_change_cost", { newDate: "2027-06-17" }, new Date("2027-02-01T00:00:00Z"));
    expect(row(r, "Grand Oak Estate").cost.cents).toBe(270_000);
    expect(row(r, "Bloom & Thistle Florals").cost.cents).toBe(51_000);
    expect(row(r, "Lumen Photography").cost.cents).toBe(0); // free with 60+ days
    expect(row(r, "Grand Oak Estate").noticeDays).toBe(75);
  });

  it("costs nothing when the date is unchanged, and says why", async () => {
    const r = await ok(prisma, "compute_date_change_cost", { newDate: "2027-04-17" });
    expect(r.total.cents).toBe(0);
    expect(r.rows.every((x: Row) => x.reason === "The wedding date is unchanged.")).toBe(true);
  });

  it("charges nothing for a cancelled vendor", async () => {
    const grandOak = await prisma.vendor.findFirstOrThrow({ where: { name: "Grand Oak Estate" } });
    await prisma.vendor.update({ where: { id: grandOak.id }, data: { status: "cancelled" } });
    const r = await ok(prisma, "compute_date_change_cost", { newDate: "2027-06-17" });
    expect(row(r, "Grand Oak Estate")).toMatchObject({ cost: { cents: 0 }, reason: expect.stringContaining("cancelled") });
    expect(r.total.cents).toBe(88_000);
  });

  it("flags a vendor with no stored terms rather than calling the change free", async () => {
    const lumen = await prisma.vendor.findFirstOrThrow({ where: { name: "Lumen Photography" } });
    await prisma.terms.delete({ where: { vendorId: lumen.id } });
    const r = await ok(prisma, "compute_date_change_cost", { newDate: "2027-06-17" });
    expect(row(r, "Lumen Photography").reason).toContain("No date-change terms apply");
  });

  it("refuses a date in the past, naming today", async () => {
    expect(await refused(prisma, "compute_date_change_cost", { newDate: "2026-01-01" })).toBe("newDate can't be in the past (today is 2026-11-07).");
  });

  it("refuses a date that is not written YYYY-MM-DD, or is not real", async () => {
    expect(await refused(prisma, "compute_date_change_cost", { newDate: "June 12" })).toContain("YYYY-MM-DD");
    expect(await refused(prisma, "compute_date_change_cost", { newDate: "2027-02-30" })).toContain("real calendar date");
    expect(await refused(prisma, "compute_date_change_cost", {})).toContain("newDate");
  });

  it("has no way to be handed an amount", async () => {
    // An invented figure in the arguments is simply dropped; the answer is still computed.
    const r = await ok(prisma, "compute_date_change_cost", { newDate: "2027-06-17", totalCents: 1, total: "$1" });
    expect(r.total.cents).toBe(133_000);
  });
});

describe("compute_refund_owed", () => {
  const refund = (args: Record<string, unknown>, today = TODAY) => ok(prisma, "compute_refund_owed", args, today);

  it("works out what Grand Oak owes back if the couple cancels today (161 days' notice: 50%)", async () => {
    const r = await refund({ vendorId: "Grand Oak Estate", cancelledBy: "couple" });
    expect(r).toMatchObject({ vendorName: "Grand Oak Estate", cancelledBy: "couple", cancellationDate: "2026-11-07", noticeDays: 161 });
    expect(r.owedBack).toEqual({ cents: 150_000, label: "$1,500" });
    expect(r.paidSoFar).toEqual({ cents: 300_000, label: "$3,000" });
    expect(r.vendorKeeps).toEqual({ cents: 150_000, label: "$1,500" });
    expect(r.reason).toBe("161 days' notice: 50% of $3,000 paid = $1,500 owed back.");
  });

  it("returns everything paid, with no fee, when the vendor cancels", async () => {
    const r = await refund({ vendorId: "Grand Oak Estate", cancelledBy: "vendor" });
    expect(r.owedBack.cents).toBe(300_000);
    expect(r.vendorKeeps.cents).toBe(0);
    expect(r.reason).toContain("Vendor cancelled");
  });

  it("gives a readable citation, and the right page for the cancellation terms on an addendum", async () => {
    expect((await refund({ vendorId: "Grand Oak Estate", cancelledBy: "couple" })).citation).toBe("Grand Oak Estate contract, page 2");
    expect((await refund({ vendorId: "DJ Marlow Sound", cancelledBy: "couple" })).citation).toBe("DJ Marlow Sound contract, page 3");
  });

  it("cites the cancellation clause, which really is that vendor's", async () => {
    const r = await refund({ vendorId: "Grand Oak Estate", cancelledBy: "couple" });
    const clause = await prisma.clause.findUniqueOrThrow({ where: { id: r.clauseId } });
    expect(clause).toMatchObject({ kind: "cancellation", vendorId: r.vendorId });
  });

  it("accepts the vendor by category, the way the couple says it ('the photographer')", async () => {
    const r = await refund({ vendorId: "photographer", cancelledBy: "couple" });
    expect(r.vendorName).toBe("Lumen Photography");
    expect(r.owedBack.cents).toBe(50_000); // $1,000 paid, 161 days: 50%
  });

  it("uses the date given: a cancellation 16 days out earns no refund", async () => {
    const r = await refund({ vendorId: "Grand Oak Estate", cancelledBy: "couple", date: "2027-04-01" });
    expect(r).toMatchObject({ cancellationDate: "2027-04-01", noticeDays: 16 });
    expect(r.owedBack.cents).toBe(0);
    expect(r.vendorKeeps.cents).toBe(300_000);
  });

  it("owes nothing when nothing has been paid", async () => {
    const r = await refund({ vendorId: "Velvet Strings Quartet", cancelledBy: "couple" });
    expect(r.paidSoFar.cents).toBe(0);
    expect(r.owedBack.cents).toBe(0);
  });

  it("counts only payments that are actually paid", async () => {
    const deposit = await prisma.payment.findFirstOrThrow({ where: { label: "Venue deposit" } });
    await prisma.payment.update({ where: { id: deposit.id }, data: { status: "refunded" } });
    const r = await refund({ vendorId: "Grand Oak Estate", cancelledBy: "vendor" });
    expect(r.paidSoFar.cents).toBe(0);
    expect(r.owedBack.cents).toBe(0);
  });

  it("refuses an unknown vendor, listing the real ones", async () => {
    expect(await refused(prisma, "compute_refund_owed", { vendorId: "the circus", cancelledBy: "couple" })).toContain("Known vendors");
  });

  it("refuses an ambiguous vendor instead of guessing", async () => {
    expect(await refused(prisma, "compute_refund_owed", { vendorId: "attire", cancelledBy: "couple" })).toContain("matches several vendors");
  });

  it("refuses an unknown canceller, and a missing one", async () => {
    expect(await refused(prisma, "compute_refund_owed", { vendorId: "florist", cancelledBy: "the weather" })).toContain("cancelledBy");
    expect(await refused(prisma, "compute_refund_owed", { vendorId: "florist" })).toContain("cancelledBy");
  });

  it("refuses a badly formatted date", async () => {
    expect(await refused(prisma, "compute_refund_owed", { vendorId: "florist", cancelledBy: "couple", date: "tomorrow" })).toContain("YYYY-MM-DD");
  });

  it("has no way to be handed an amount", async () => {
    const r = await refund({ vendorId: "Grand Oak Estate", cancelledBy: "couple", owedCents: 999_999, amount: "$9,999" });
    expect(r.owedBack.cents).toBe(150_000);
  });
});
