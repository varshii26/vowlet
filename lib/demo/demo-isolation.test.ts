import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createAutoReset, isStale } from "@/lib/demo/auto-reset";
import { createResetHandler } from "@/lib/demo/reset";
import { createRateLimiter } from "@/lib/rate-limit";
import { ensureSeeded, seedDemo } from "@/lib/seed/demo";
import { DEMO_USER } from "@/lib/seed/demo-user";
import { createTestDatabase } from "@/lib/test-utils/db";

/**
 * The shared demo must never touch a real couple: resetting it, auto-resetting it and
 * re-seeding on startup all leave their account, wedding, vendors, payments, clauses,
 * proposals and activity exactly as they were.
 */
let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let ana: { userId: string; weddingId: string };

beforeAll(() => {
  ({ prisma, cleanup } = createTestDatabase());
}, 60_000);
afterAll(async () => cleanup());

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { isDemo: false } });
  await seedDemo(prisma);
  const user = await prisma.user.create({ data: { email: "ana@example.com", passwordHash: "scrypt$x" } });
  const wedding = await prisma.wedding.create({ data: { userId: user.id, coupleNames: "Ana & Ben", date: new Date("2027-09-04"), budget: 2_500_000 } });
  const vendor = await prisma.vendor.create({
    data: { weddingId: wedding.id, name: "Ana's Florist", category: "florist", paypalEmail: "f@example.com", contractPath: "data/uploads/x.pdf", signingDate: new Date("2026-08-01"), totalCost: 100_000 },
  });
  const clause = await prisma.clause.create({ data: { vendorId: vendor.id, kind: "payment", text: "Pay $500 on signing.", page: 1, summary: "deposit" } });
  await prisma.payment.create({ data: { vendorId: vendor.id, label: "Florist deposit", amount: 50_000, anchor: "signing_date", status: "paid", clauseId: clause.id } });
  await prisma.terms.create({ data: { vendorId: vendor.id, cancellationRules: [{ minNoticeDays: 0, refundPercent: 0, flatFee: 0 }], dateChangeRules: [{ minNoticeDays: 0, feePercent: 10, flatFee: 0 }], clauseIds: [clause.id] } });
  await prisma.proposal.create({ data: { weddingId: wedding.id, kind: "message", payload: { text: "hi" }, status: "pending" } });
  await prisma.eventLog.create({ data: { weddingId: wedding.id, type: "payment_paid", message: "Paid $500 to Ana's Florist" } });
  ana = { userId: user.id, weddingId: wedding.id };
});

/** Everything that belongs to Ana, in a form that can be compared before and after. */
async function snapshot() {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ana.userId } });
  const wedding = await prisma.wedding.findUniqueOrThrow({
    where: { id: ana.weddingId },
    include: { vendors: { include: { payments: true, clauses: true, terms: true } }, proposals: true, events: true },
  });
  return JSON.parse(JSON.stringify({ user, wedding }));
}

const demoWedding = () => prisma.wedding.findFirstOrThrow({ where: { userId: DEMO_USER.id } });

describe("seedDemo", () => {
  it("leaves a real couple's account, wedding, vendors, payments, clauses, terms, proposals and activity untouched", async () => {
    const before = await snapshot();
    await prisma.payment.updateMany({ where: { vendor: { weddingId: (await demoWedding()).id } }, data: { status: "paid" } }); // dirty the demo
    await seedDemo(prisma);
    expect(await snapshot()).toEqual(before);
  });

  it("really resets the demo wedding when it runs", async () => {
    const demo = await demoWedding();
    await prisma.payment.updateMany({ where: { vendor: { weddingId: demo.id } }, data: { status: "void" } });
    await prisma.proposal.create({ data: { weddingId: demo.id, kind: "message", payload: { text: "x" }, status: "pending" } });
    await prisma.wedding.update({ where: { id: demo.id }, data: { date: new Date("2028-01-01") } });

    await seedDemo(prisma);

    const after = await demoWedding();
    expect(after.date.toISOString()).toBe("2027-04-17T00:00:00.000Z");
    expect(await prisma.vendor.count({ where: { weddingId: after.id } })).toBe(14);
    expect(await prisma.payment.count({ where: { vendor: { weddingId: after.id }, status: "void" } })).toBe(0);
    expect(await prisma.proposal.count({ where: { weddingId: after.id } })).toBe(0);
    expect(await prisma.wedding.count({ where: { userId: DEMO_USER.id } })).toBe(1); // replaced, not duplicated
  });

  it("keeps the demo user without a password, even if one was somehow set", async () => {
    await prisma.user.update({ where: { id: DEMO_USER.id }, data: { passwordHash: "scrypt$planted" } });
    await seedDemo(prisma);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: DEMO_USER.id } })).passwordHash).toBeNull();
  });
});

describe("ensureSeeded", () => {
  it("seeds the demo when the database has only real couples, and doesn't when the demo is there", async () => {
    const before = await snapshot();
    expect(await ensureSeeded(prisma)).toBe(false); // the demo wedding exists

    await prisma.wedding.delete({ where: { id: (await demoWedding()).id } });
    expect(await ensureSeeded(prisma)).toBe(true); // a real couple's wedding doesn't count as "already seeded"
    expect((await demoWedding()).coupleNames).toBe("Priya & Sam");
    expect(await snapshot()).toEqual(before);
  });
});

describe("Try the demo", () => {
  it("signs into the demo user, whose wedding is Priya & Sam with 14 vendors", async () => {
    const demo = await prisma.user.findUniqueOrThrow({ where: { id: DEMO_USER.id }, include: { wedding: { include: { vendors: true } } } });
    expect(demo).toMatchObject({ isDemo: true, passwordHash: null, email: "demo@vowlet.invalid" });
    expect(demo.wedding?.coupleNames).toBe("Priya & Sam");
    expect(demo.wedding?.vendors).toHaveLength(14);
  });
});

describe("auto-reset", () => {
  const now = new Date("2026-12-03T15:00:00.000Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  it("ignores a real couple's activity: it neither triggers nor postpones a reset", async () => {
    // Untouched demo (last event is the seed) + a real couple busy right now: nothing to reset.
    await prisma.eventLog.create({ data: { weddingId: ana.weddingId, type: "payment_paid", message: "busy", createdAt: ago(1) } });
    expect(await isStale(prisma, now, 30)).toBe(false);

    // Demo changed an hour ago, real couple active a minute ago: the demo is still idle, so it resets.
    await prisma.eventLog.create({ data: { weddingId: (await demoWedding()).id, type: "payment_paid", message: "judge paid", createdAt: ago(60) } });
    expect(await isStale(prisma, now, 30)).toBe(true);
  });

  it("resets only the demo, leaving the real couple untouched", async () => {
    const demo = await demoWedding();
    await prisma.eventLog.create({ data: { weddingId: demo.id, type: "payment_paid", message: "judge paid", createdAt: ago(60) } });
    await prisma.payment.updateMany({ where: { vendor: { weddingId: demo.id } }, data: { status: "paid" } });
    const before = await snapshot();

    expect(await createAutoReset({ prisma, idleMinutes: 30 })(now)).toBe(true);

    expect(await prisma.payment.count({ where: { vendor: { weddingId: (await demoWedding()).id }, status: "paid" } })).toBeLessThan(23);
    expect(await snapshot()).toEqual(before);
  });
});

describe("the reset handler (Reset demo button)", () => {
  it("leaves a real couple untouched", async () => {
    const before = await snapshot();
    const handler = createResetHandler({ prisma, limiter: createRateLimiter({ max: 5, windowMs: 60_000 }) });
    expect((await handler()).status).toBe(200);
    expect(await snapshot()).toEqual(before);
  });
});
