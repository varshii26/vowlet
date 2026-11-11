import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { TODAY, ok } from "@/lib/agent/tools/test-utils";
import { dashboardSummary } from "@/lib/dashboard";
import { selectUpcomingPayments } from "@/lib/payments/upcoming";
import { seedDemo } from "@/lib/seed/demo";
import { WEDDING } from "@/lib/seed/demo-data";
import { createTestDatabase, soleWeddingId } from "@/lib/test-utils/db";
import { loadTimelineInput } from "@/lib/timeline-data";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, cleanup } = createTestDatabase());
  await seedDemo(prisma);
}, 60_000);
afterAll(async () => cleanup());

async function load() {
  const input = (await loadTimelineInput(prisma, await soleWeddingId(prisma)))!;
  return dashboardSummary(input, WEDDING.budgetCents, selectUpcomingPayments(input, TODAY), TODAY);
}

describe("dashboardSummary on the demo wedding", () => {
  it("shows the date and the countdown", async () => {
    const d = await load();
    expect(d.weddingDateLabel).toBe("Sat, Apr 17, 2027");
    expect(d.daysToGo).toBe(161);
  });

  it("agrees with what the assistant's get_wedding tool says", async () => {
    const [d, w] = [await load(), await ok(prisma, "get_wedding")];
    expect(d.summary.budgetCents).toBe(w.budget.cents);
    expect(d.summary.paidCents).toBe(w.paid.cents);
    expect(d.summary.scheduledCents).toBe(w.scheduled.cents);
    expect(d.summary.remainingCents).toBe(w.remainingBudget.cents);
    expect(d.summary.unpaidCount).toBe(w.unpaidPayments);
  });

  it("names the soonest unpaid payment as next, and lists all 14 vendors", async () => {
    const d = await load();
    expect(d.next).toMatchObject({ vendorName: "DJ Marlow Sound", label: "DJ booking fee" });
    expect(d.vendors).toHaveLength(14);
  });

  it("updates when a payment is made", async () => {
    const before = await load();
    const dj = await prisma.payment.findFirstOrThrow({ where: { label: "DJ booking fee" } });
    await prisma.payment.update({ where: { id: dj.id }, data: { status: "paid" } });
    const after = await load();
    expect(after.summary.paidCents - before.summary.paidCents).toBe(dj.amount);
    expect(after.summary.scheduledCents - before.summary.scheduledCents).toBe(-dj.amount);
    expect(after.next?.label).not.toBe("DJ booking fee");
  });
});
