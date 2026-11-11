import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadTimelineInput } from "@/lib/timeline-data";
import { buildTimeline, paymentTaskId } from "@/lib/timeline";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase, soleWeddingId } from "@/lib/test-utils/db";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDatabase());
}, 60_000);

afterAll(async () => cleanup());

describe("loadTimelineInput", () => {
  it("returns null when there is no wedding", async () => {
    expect(await loadTimelineInput(prisma, await soleWeddingId(prisma))).toBeNull();
  });

  it("loads the demo wedding, vendors, payments and clauses", async () => {
    await seedDemo(prisma);
    const input = (await loadTimelineInput(prisma, await soleWeddingId(prisma)))!;

    expect(input.wedding.coupleNames).toBe("Priya & Sam");
    expect(input.wedding.date.toISOString()).toBe("2027-04-17T00:00:00.000Z");
    expect(input.vendors).toHaveLength(14);
    expect(input.vendors.flatMap((v) => v.payments)).toHaveLength(23);
    expect(input.vendors.flatMap((v) => v.payments).every((p) => p.clause !== null)).toBe(true);
  });

  it("loads each vendor's terms with the clauses they come from, for the deadline indicators", async () => {
    const input = (await loadTimelineInput(prisma, await soleWeddingId(prisma)))!;
    const grandOak = input.vendors.find((v) => v.name === "Grand Oak Estate")!;
    const clauses = await prisma.clause.findMany({ where: { vendorId: grandOak.id, kind: { in: ["cancellation", "date_change"] } } });
    expect(grandOak.terms!.cancellation.length).toBeGreaterThan(0);
    expect(grandOak.terms!.dateChange.length).toBeGreaterThan(0);
    expect(grandOak.terms!.cancellationClause!.id).toBe(clauses.find((c) => c.kind === "cancellation")!.id);
    expect(grandOak.terms!.dateChangeClause!.id).toBe(clauses.find((c) => c.kind === "date_change")!.id);

    // Every active demo vendor gets at least one deadline ahead of it on 2026-11-07.
    const data = buildTimeline(input, new Date("2026-11-07T00:00:00Z"));
    const vendorDetails = Object.values(data.details).filter((x) => x.kind === "vendor");
    expect(vendorDetails.every((x) => x.kind === "vendor" && (x.deadlines?.length ?? 0) > 0)).toBe(true);
  });

  it("feeds buildTimeline: 14 vendor rows, 23 milestones, 23 links", async () => {
    const data = buildTimeline((await loadTimelineInput(prisma, await soleWeddingId(prisma)))!, new Date("2026-11-07T00:00:00Z"));
    expect(data.tasks).toHaveLength(15);
    expect(data.tasks.flatMap((t) => t.children ?? [])).toHaveLength(23);
    expect(data.dependencies).toHaveLength(23);
  });

  it("reflects a live status change", async () => {
    const payment = await prisma.payment.findFirstOrThrow({ where: { label: "Venue second installment" } });
    const today = new Date("2026-11-07T00:00:00Z");
    const classOf = async () => {
      const data = buildTimeline((await loadTimelineInput(prisma, await soleWeddingId(prisma)))!, today);
      return data.tasks.flatMap((t) => t.children ?? []).find((t) => t.id === paymentTaskId(payment.id))!.cls;
    };

    expect(await classOf()).toBe("payment payment-scheduled");
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "paid", paidAt: today } });
    expect(await classOf()).toBe("payment payment-paid");
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "refund_requested" } });
    expect(await classOf()).toBe("payment payment-refund_requested");
  });

  it("includes a cancelled vendor with its voided payments", async () => {
    const vendor = await prisma.vendor.findFirstOrThrow({ where: { name: "Lumen Photography" } });
    await prisma.vendor.update({ where: { id: vendor.id }, data: { status: "cancelled" } });
    await prisma.payment.updateMany({ where: { vendorId: vendor.id }, data: { status: "void" } });

    const data = buildTimeline((await loadTimelineInput(prisma, await soleWeddingId(prisma)))!, new Date("2026-11-07T00:00:00Z"));
    const row = data.tasks.find((t) => t.id === `vendor-${vendor.id}`)!;
    expect(row.cls).toBe("vendor vendor-cancelled");
    expect(row.children!.every((c) => c.cls === "payment payment-void")).toBe(true);
  });
});
