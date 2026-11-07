import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { TODAY } from "@/lib/agent/tools/test-utils";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase } from "@/lib/test-utils/db";
import { layoutContract } from "@/lib/vendors/highlight";
import { describeCancellationTiers, describeDateChangeTiers, loadVendorPage } from "@/lib/vendors/page-data";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDatabase());
}, 60_000);
afterAll(async () => cleanup());
beforeEach(async () => seedDemo(prisma));

const vendorNamed = (name: string) => prisma.vendor.findFirstOrThrow({ where: { name } });

describe("loadVendorPage", () => {
  it("returns null for an unknown vendor", async () => {
    expect(await loadVendorPage(prisma, "nope", { today: TODAY })).toBeNull();
  });

  it("links every extracted fact to one of the vendor's clauses", async () => {
    const vendor = await vendorNamed("Grand Oak Estate");
    const data = await loadVendorPage(prisma, vendor.id, { today: TODAY, readPages: async () => [] });
    expect(data).not.toBeNull();
    if (!data) return;

    expect(data.vendor).toMatchObject({ id: vendor.id, name: "Grand Oak Estate", totalLabel: "$9,000", pdfUrl: `/api/vendors/${vendor.id}/contract` });
    const ids = new Set(data.clauses.map((c) => c.id));
    expect(data.payments).toHaveLength(3);
    for (const p of data.payments) expect(ids.has(p.clauseId ?? "")).toBe(true);
    expect(ids.has(data.cancellation.clauseId ?? "")).toBe(true);
    expect(ids.has(data.dateChange.clauseId ?? "")).toBe(true);
    expect(data.clauses.find((c) => c.id === data.cancellation.clauseId)?.kind).toBe("cancellation");
    expect(data.clauses.find((c) => c.id === data.dateChange.clauseId)?.kind).toBe("date_change");
  });

  it("computes due dates and statuses from the schedule, soonest first", async () => {
    const vendor = await vendorNamed("Grand Oak Estate");
    const data = await loadVendorPage(prisma, vendor.id, { today: TODAY, readPages: async () => [] });
    expect(data?.payments.map((p) => [p.label, p.amountLabel, p.dueDateLabel, p.statusLabel])).toEqual([
      ["Venue deposit", "$3,000", "Jun 12, 2026", "Paid"],
      ["Venue second installment", "$3,000", "Dec 18, 2026", "Scheduled"],
      ["Venue final balance", "$3,000", "Mar 18, 2027", "Scheduled"],
    ]);
    expect(data?.weddingDateLabel).toBe("Apr 17, 2027");
    expect(data?.cancellation.tiers).toEqual(["90+ days' notice: 50% of payments made refunded", "Any notice: no refund"]);
    expect(data?.dateChange.tiers).toEqual(["120+ days' notice: 5% of the contract price ($450)", "Any notice: 30% of the contract price ($2,700)"]);
  });

  it("reads the real PDF, and every seeded clause is found in it", async () => {
    const vendors = await prisma.vendor.findMany();
    expect(vendors).toHaveLength(14);
    for (const vendor of vendors) {
      const data = await loadVendorPage(prisma, vendor.id, { today: TODAY });
      expect(data?.pages?.length, vendor.name).toBeGreaterThanOrEqual(2);
      const layout = layoutContract(data?.pages ?? [], data?.clauses ?? []);
      expect(layout.unlocated, vendor.name).toEqual([]);
      for (const clause of data?.clauses ?? []) expect(layout.foundOn[clause.id], `${vendor.name} ${clause.kind}`).toBe(clause.page);
    }
  }, 30_000);

  it("still loads when the PDF can't be read", async () => {
    const vendor = await vendorNamed("Grand Oak Estate");
    await prisma.vendor.update({ where: { id: vendor.id }, data: { contractPath: "data/uploads/gone.pdf" } });
    const data = await loadVendorPage(prisma, vendor.id, { today: TODAY });
    expect(data?.pages).toBeNull();
    expect(data?.clauses.length).toBeGreaterThan(0);
  });
});

describe("tier descriptions", () => {
  it("describes cancellation tiers with fees, highest notice first", () => {
    expect(
      describeCancellationTiers([
        { minNoticeDays: 0, refundPercent: 0, flatFee: 0 },
        { minNoticeDays: 180, refundPercent: 100, flatFee: 25_000 },
      ]),
    ).toEqual(["180+ days' notice: 100% of payments made refunded, less $250", "Any notice: no refund"]);
  });

  it("describes date-change tiers with the fee computed in cents", () => {
    expect(
      describeDateChangeTiers(
        [
          { minNoticeDays: 60, feePercent: 0, flatFee: 0 },
          { minNoticeDays: 0, feePercent: 10, flatFee: 5_000 },
        ],
        123_450,
      ),
    ).toEqual(["60+ days' notice: free", "Any notice: 10% of the contract price + $50 flat ($173.45)"]);
  });
});
