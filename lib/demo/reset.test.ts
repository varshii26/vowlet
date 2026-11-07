import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createResetHandler } from "@/lib/demo/reset";
import { createRateLimiter } from "@/lib/rate-limit";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase } from "@/lib/test-utils/db";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDatabase());
}, 60_000);
afterAll(async () => cleanup());
beforeEach(async () => seedDemo(prisma));

const roomy = () => createRateLimiter({ max: 100, windowMs: 60_000 });
const call = async (reset: () => Promise<Response>) => {
  const res = await reset();
  return { status: res.status, body: await res.json() };
};

/** What "the exact starting demo state" means for the acceptance criteria. */
async function snapshot() {
  const wedding = await prisma.wedding.findFirstOrThrow();
  const payments = await prisma.payment.findMany({ include: { vendor: true } });
  return {
    weddings: await prisma.wedding.count(),
    date: wedding.date.toISOString(),
    vendors: await prisma.vendor.count(),
    cancelledVendors: await prisma.vendor.count({ where: { status: "cancelled" } }),
    proposals: await prisma.proposal.count(),
    payments: payments.length,
    statuses: payments.map((p) => `${p.vendor.name} / ${p.label}: ${p.status}`).sort(),
    withPayPalOrder: payments.filter((p) => p.paypalOrderId !== null).length,
  };
}

/** Everything a demo session can change: pay, propose, reschedule, cancel a vendor. */
async function messUpTheDemo() {
  const wedding = await prisma.wedding.findFirstOrThrow();
  const dj = await prisma.payment.findFirstOrThrow({ where: { label: "DJ booking fee" } });
  await prisma.payment.update({
    where: { id: dj.id },
    data: { status: "paid", paidAt: new Date(), paypalOrderId: "ORDER-1", captureId: "CAPTURE-1" },
  });
  await prisma.proposal.create({ data: { weddingId: wedding.id, kind: "message", payload: { message: "hi" }, status: "pending" } });
  await prisma.wedding.update({ where: { id: wedding.id }, data: { date: new Date("2027-06-12T00:00:00.000Z") } });
  await prisma.vendor.updateMany({ where: { name: "Bloom & Thistle Florals" }, data: { status: "cancelled" } });
}

describe("POST /api/demo/reset", () => {
  it("puts the app back in the exact starting demo state", async () => {
    const start = await snapshot();
    await messUpTheDemo();
    expect(await snapshot()).not.toEqual(start);

    const reset = createResetHandler({ prisma, limiter: roomy() });
    const r = await call(reset);

    expect(r).toEqual({ status: 200, body: { ok: true, message: "The demo is back to its starting state." } });
    const after = await snapshot();
    expect(after).toEqual(start);
    // Spelled out, as the issue states them.
    expect(after.date).toBe("2027-04-17T00:00:00.000Z");
    expect(after.proposals).toBe(0);
    expect(after.statuses).toContain("DJ Marlow Sound / DJ booking fee: scheduled");
  });

  it("is safe to click repeatedly, one after another", async () => {
    const start = await snapshot();
    const reset = createResetHandler({ prisma, limiter: roomy() });
    for (let i = 0; i < 3; i++) expect((await call(reset)).status).toBe(200);
    expect(await snapshot()).toEqual(start);
  });

  it("is safe to click repeatedly at the same time: overlapping clicks share one reset", async () => {
    const start = await snapshot();
    await messUpTheDemo();
    const reset = createResetHandler({ prisma, limiter: roomy() });

    const results = await Promise.all([call(reset), call(reset), call(reset)]);

    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await snapshot()).toEqual(start);
  });

  it("limits how often the public endpoint can wipe the database", async () => {
    const reset = createResetHandler({ prisma, limiter: createRateLimiter({ max: 1, windowMs: 60_000 }) });
    expect((await call(reset)).status).toBe(200);

    const res = await reset();
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: "too_many_requests" } });
  });

  it("answers 500 with a readable message if the reset fails, and leaves the data alone", async () => {
    const start = await snapshot();
    const reset = createResetHandler({
      prisma,
      limiter: roomy(),
      seed: async () => {
        throw new Error("disk full");
      },
    });
    expect(await call(reset)).toEqual({
      status: 500,
      body: { ok: false, error: { code: "reset_failed", message: "Couldn't reset the demo. Please try again." } },
    });
    expect(await snapshot()).toEqual(start);
  });
});
