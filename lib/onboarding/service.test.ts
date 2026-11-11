import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { parseBudgetCents } from "@/lib/onboarding/rules";
import { createWeddingFromForm } from "@/lib/onboarding/service";
import { createTestDatabase } from "@/lib/test-utils/db";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let userId: string;
beforeAll(() => {
  ({ prisma, cleanup } = createTestDatabase());
}, 60_000);
afterAll(async () => cleanup());
beforeEach(async () => {
  await prisma.wedding.deleteMany();
  await prisma.user.deleteMany();
  userId = (await prisma.user.create({ data: { email: "new@example.com" } })).id;
});

const form = (f: Record<string, string>) => {
  const d = new FormData();
  for (const [k, v] of Object.entries(f)) d.set(k, v);
  return d;
};
const good = { coupleNames: " Ana & Ben ", date: "2027-09-04", budget: "$25,000" };

describe("parseBudgetCents", () => {
  it.each([["25,000", 2_500_000], ["$1,250.50", 125_050], ["", 0], ["  ", 0], ["12", 1200]])("%s", (raw, cents) => expect(parseBudgetCents(raw)).toBe(cents));
  it.each([["abc"], ["-5"], ["1.234"], ["99999999"]])("rejects %s", (raw) => expect(parseBudgetCents(raw)).toBeNull());
});

describe("createWeddingFromForm", () => {
  it("creates the user's wedding with trimmed names, the date and the budget in cents, and logs it", async () => {
    const r = await createWeddingFromForm(prisma, userId, form(good));
    expect(r.ok).toBe(true);
    const w = await prisma.wedding.findUniqueOrThrow({ where: { userId }, include: { events: true } });
    expect(w).toMatchObject({ coupleNames: "Ana & Ben", budget: 2_500_000 });
    expect(w.date.toISOString()).toBe("2027-09-04T00:00:00.000Z");
    expect(w.events).toHaveLength(1);
  });

  it("reports each problem against its field, keeps what was typed, and creates nothing", async () => {
    const r = await createWeddingFromForm(prisma, userId, form({ coupleNames: " ", date: "2027-02-30", budget: "lots" }));
    expect(r).toEqual({
      ok: false,
      state: { errors: { coupleNames: "Enter your names, for example Priya & Sam.", date: "Pick your wedding date.", budget: "Enter an amount like 25,000." }, values: { coupleNames: " ", date: "2027-02-30", budget: "lots" } },
    });
    expect(await prisma.wedding.count()).toBe(0);
  });

  it("keeps the existing wedding on a second submit instead of duplicating or replacing it", async () => {
    const first = await createWeddingFromForm(prisma, userId, form(good));
    const second = await createWeddingFromForm(prisma, userId, form({ ...good, coupleNames: "Someone Else" }));
    expect(second).toEqual(first);
    expect(await prisma.wedding.count()).toBe(1);
    expect((await prisma.wedding.findUniqueOrThrow({ where: { userId } })).coupleNames).toBe("Ana & Ben");
  });
});
