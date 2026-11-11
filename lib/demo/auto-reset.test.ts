import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { autoResetMessage, createAutoReset, idleMinutes, isStale } from "@/lib/demo/auto-reset";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase } from "@/lib/test-utils/db";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDatabase());
}, 60_000);
afterAll(async () => cleanup());
beforeEach(async () => seedDemo(prisma));

const minutesAgo = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000);

/** A change someone made `minutes` before `now`, as the app logs it. */
async function changedAt(now: Date, minutes: number) {
  const wedding = await prisma.wedding.findFirstOrThrow();
  await prisma.eventLog.create({ data: { weddingId: wedding.id, type: "payment_paid", message: "Paid $500 to DJ Marlow Sound", createdAt: minutesAgo(now, minutes) } });
  await prisma.payment.updateMany({ where: { label: "DJ booking fee" }, data: { status: "paid" } });
}

const now = new Date("2026-12-03T15:00:00.000Z");

describe("idleMinutes", () => {
  it("defaults to 30, takes a number, and 0 switches it off", () => {
    expect(idleMinutes(undefined)).toBe(30);
    expect(idleMinutes("")).toBe(30);
    expect(idleMinutes("45")).toBe(45);
    expect(idleMinutes("0")).toBe(0);
    expect(idleMinutes("soon")).toBe(30);
    expect(idleMinutes("-5")).toBe(30);
  });
});

describe("isStale", () => {
  it("is false for a demo nobody has changed since the seed, however old", async () => {
    await prisma.eventLog.updateMany({ data: { createdAt: minutesAgo(now, 600) } });
    expect(await isStale(prisma, now, 30)).toBe(false);
  });

  it("is false while someone is still making changes", async () => {
    await changedAt(now, 29);
    expect(await isStale(prisma, now, 30)).toBe(false);
  });

  it("is true once the latest change is 30 minutes old", async () => {
    await changedAt(now, 30);
    expect(await isStale(prisma, now, 30)).toBe(true);
  });

  it("never fires when switched off", async () => {
    await changedAt(now, 600);
    expect(await isStale(prisma, now, 0)).toBe(false);
  });
});

describe("createAutoReset", () => {
  it("puts a changed, idle demo back to the seed and says so in the activity feed", async () => {
    await changedAt(now, 45);
    const resetIfIdle = createAutoReset({ prisma, idleMinutes: 30 });

    expect(await resetIfIdle(now)).toBe(true);
    expect(await prisma.payment.count({ where: { label: "DJ booking fee", status: "paid" } })).toBe(0);
    const events = await prisma.eventLog.findMany();
    expect(events.map((e) => [e.type, e.message])).toEqual([["demo_seeded", autoResetMessage(30)]]);
    expect(autoResetMessage(30)).toBe("Reset to the starting demo after 30 minutes without changes");

    // Pristine again: the next visit leaves it alone.
    expect(await resetIfIdle(new Date(now.getTime() + 3_600_000))).toBe(false);
  });

  it("leaves a recently changed demo alone", async () => {
    await changedAt(now, 5);
    const seed = vi.fn(async () => {});
    expect(await createAutoReset({ prisma, idleMinutes: 30, seed })(now)).toBe(false);
    expect(seed).not.toHaveBeenCalled();
  });

  it("shares one reset between visits that arrive together", async () => {
    await changedAt(now, 45);
    const seed = vi.fn((db: PrismaClient, options: { message?: string }) => seedDemo(db, options));
    const resetIfIdle = createAutoReset({ prisma, idleMinutes: 30, seed });
    const results = await Promise.all([resetIfIdle(now), resetIfIdle(now), resetIfIdle(now)]);
    expect(results).toEqual([true, true, true]);
    expect(seed).toHaveBeenCalledTimes(1);
  });

  it("lets the page load if the reset fails", async () => {
    await changedAt(now, 45);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const seed = vi.fn(async () => {
      throw new Error("disk full");
    });
    expect(await createAutoReset({ prisma, idleMinutes: 30, seed })(now)).toBe(false);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
