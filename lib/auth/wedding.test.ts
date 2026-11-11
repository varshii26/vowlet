import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { weddingIdFor } from "@/lib/auth/wedding";
import { createTestDatabase } from "@/lib/test-utils/db";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDatabase());
}, 60_000);
afterAll(async () => cleanup());
beforeEach(async () => {
  await prisma.wedding.deleteMany();
  await prisma.user.deleteMany();
});

const wedding = (userId: string | null, coupleNames: string) => prisma.wedding.create({ data: { userId, coupleNames, date: new Date("2027-04-17"), budget: 0 } });

describe("weddingIdFor", () => {
  it("is the signed-in user's own wedding, never another couple's", async () => {
    const demo = await prisma.user.create({ data: { id: "demo-user", email: "demo@vowlet.invalid", isDemo: true } });
    const ana = await prisma.user.create({ data: { email: "ana@example.com" } });
    const ben = await prisma.user.create({ data: { email: "ben@example.com" } });
    const demoWedding = await wedding(demo.id, "Priya & Sam");
    const anaWedding = await wedding(ana.id, "Ana & Co");
    const benWedding = await wedding(ben.id, "Ben & Co");

    expect(await weddingIdFor(prisma, ana.id)).toBe(anaWedding.id);
    expect(await weddingIdFor(prisma, ben.id)).toBe(benWedding.id);
    expect(await weddingIdFor(prisma, demo.id)).toBe(demoWedding.id);
  });

  it("is null for a user who hasn't created a wedding yet, even when other weddings exist", async () => {
    const demo = await prisma.user.create({ data: { id: "demo-user", email: "demo@vowlet.invalid", isDemo: true } });
    await wedding(demo.id, "Priya & Sam");
    const newcomer = await prisma.user.create({ data: { email: "new@example.com" } });
    expect(await weddingIdFor(prisma, newcomer.id)).toBeNull();
  });

  it("is nothing for a signed-out visitor, however many weddings exist", async () => {
    const demo = await prisma.user.create({ data: { id: "demo-user", email: "demo@vowlet.invalid", isDemo: true } });
    await wedding(demo.id, "Priya & Sam");
    expect(await weddingIdFor(prisma, null)).toBeNull();
  });

  it("is null for an unknown user id", async () => {
    expect(await weddingIdFor(prisma, "no-such-user")).toBeNull();
  });
});
