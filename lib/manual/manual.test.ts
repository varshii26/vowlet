import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { manualVendorHandler } from "@/lib/manual/handler";
import { manualVendorSchema, parseDollarsToCents, totalOf, type ManualVendor } from "@/lib/manual/schema";
import { createRateLimiter } from "@/lib/rate-limit";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase } from "@/lib/test-utils/db";
import { loadTimelineInput } from "@/lib/timeline-data";
import { describePaymentBasis, loadVendorSummary } from "@/lib/vendors/summary";

const good = (over: Partial<ManualVendor> = {}): ManualVendor => ({
  vendorName: "Blossom Florals",
  category: "Florist",
  paypalEmail: "",
  signingDate: "2026-10-01",
  payments: [
    { label: "Deposit", amountCents: 50_000, anchor: "signing_date", offsetDays: 0, fixedDate: null },
    { label: "Balance", amountCents: 100_000, anchor: "wedding_date", offsetDays: -14, fixedDate: null },
    { label: "Extras", amountCents: 25_000, anchor: "fixed", offsetDays: 0, fixedDate: "2027-03-01" },
  ],
  cancellationRules: [
    { minNoticeDays: 90, refundPercent: 50, flatFee: 10_000 },
    { minNoticeDays: 0, refundPercent: 0, flatFee: 0 },
  ],
  dateChangeRules: [{ minNoticeDays: 60, feePercent: 10, flatFee: 0 }],
  notes: "Delivery to the venue by 10am.",
  ...over,
});

describe("manualVendorSchema", () => {
  it("accepts a complete vendor, and one with no optional terms or notes", () => {
    expect(manualVendorSchema.safeParse(good()).success).toBe(true);
    expect(manualVendorSchema.safeParse(good({ cancellationRules: [], dateChangeRules: [], notes: "" })).success).toBe(true);
  });

  it.each([
    ["no name", { vendorName: "  " }],
    ["no category", { category: "" }],
    ["a bad email", { paypalEmail: "nope" }],
    ["an impossible date", { signingDate: "2026-02-30" }],
    ["no payments", { payments: [] }],
    ["a zero amount", { payments: [{ label: "x", amountCents: 0, anchor: "signing_date", offsetDays: 0, fixedDate: null }] }],
    ["a fixed payment with no date", { payments: [{ label: "x", amountCents: 100, anchor: "fixed", offsetDays: 0, fixedDate: null }] }],
    ["a refund over 100%", { cancellationRules: [{ minNoticeDays: 0, refundPercent: 150, flatFee: 0 }] }],
    ["a negative notice", { dateChangeRules: [{ minNoticeDays: -1, feePercent: 5, flatFee: 0 }] }],
    ["a huge note", { notes: "x".repeat(1001) }],
  ] as [string, Partial<ManualVendor>][])("rejects %s", (_name, over) => {
    expect(manualVendorSchema.safeParse(good(over)).success).toBe(false);
  });
});

describe("money helpers", () => {
  it.each([["1,500", 150_000], ["$1,250.50", 125_050], ["12", 1200]])("%s", (raw, cents) => expect(parseDollarsToCents(raw)).toBe(cents));
  it.each([[""], ["abc"], ["-5"], ["1.234"], ["99999999"]])("rejects %j", (raw) => expect(parseDollarsToCents(raw)).toBeNull());
  it("the total is what the payments add up to", () => expect(totalOf(good().payments)).toBe(175_000));
});

describe("describePaymentBasis", () => {
  it.each([
    [{ anchor: "wedding_date", offsetDays: -30 }, null, "30 days before the wedding"],
    [{ anchor: "wedding_date", offsetDays: -1 }, null, "1 day before the wedding"],
    [{ anchor: "wedding_date", offsetDays: 7 }, null, "7 days after the wedding"],
    [{ anchor: "wedding_date", offsetDays: 0 }, null, "On the wedding day"],
    [{ anchor: "signing_date", offsetDays: 0 }, null, "On signing"],
    [{ anchor: "signing_date", offsetDays: 10 }, null, "10 days after signing"],
    [{ anchor: "fixed", offsetDays: 0 }, new Date("2027-06-01T00:00:00Z"), "On June 1, 2027"],
  ] as const)("%j", (p, fixed, text) => expect(describePaymentBasis(p, fixed)).toBe(text));
});

describe("POST /api/vendors/manual", () => {
  let prisma: PrismaClient;
  let cleanup: () => Promise<void>;
  let ana: string; // a couple's wedding id
  let demoId: string;
  beforeAll(() => {
    ({ prisma, cleanup } = createTestDatabase());
  }, 60_000);
  afterAll(async () => cleanup());
  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { isDemo: false } });
    await seedDemo(prisma);
    demoId = (await prisma.wedding.findFirstOrThrow()).id;
    const user = await prisma.user.create({ data: { email: "ana@example.com" } });
    ana = (await prisma.wedding.create({ data: { userId: user.id, coupleNames: "Ana & Ben", date: new Date("2027-09-04"), budget: 0 } })).id;
  });

  const call = async (body: unknown, over: { weddingId?: string | null; max?: number; emails?: string } = {}) => {
    const res = await manualVendorHandler(new Request("http://x/api/vendors/manual", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), {
      prisma,
      limiter: createRateLimiter({ max: over.max ?? 100, windowMs: 60_000 }),
      resolveWeddingId: async () => (over.weddingId === undefined ? ana : over.weddingId),
      vendorEmails: over.emails,
    });
    return { status: res.status, body: await res.json() };
  };

  it("saves the vendor, its payments and terms into the caller's wedding, with no contract or clauses", async () => {
    const r = await call(good());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, vendorName: "Blossom Florals" });

    const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: r.body.vendorId }, include: { payments: true, clauses: true, terms: true } });
    expect(vendor).toMatchObject({ weddingId: ana, category: "florist", contractPath: "", totalCost: 175_000, status: "active", notes: "Delivery to the venue by 10am." });
    expect(vendor.clauses).toHaveLength(0);
    expect(vendor.payments.map((p) => [p.label, p.amount, p.anchor, p.offsetDays, p.status, p.clauseId]).sort()).toEqual([
      ["Balance", 100_000, "wedding_date", -14, "scheduled", null],
      ["Deposit", 50_000, "signing_date", 0, "scheduled", null],
      ["Extras", 25_000, "fixed", 0, "scheduled", null],
    ]);
    expect(vendor.payments.find((p) => p.label === "Extras")?.fixedDate?.toISOString()).toBe("2027-03-01T00:00:00.000Z");
    expect(vendor.terms?.cancellationRules).toHaveLength(2);
    expect(vendor.terms?.dateChangeRules).toEqual([{ minNoticeDays: 60, feePercent: 10, flatFee: 0 }]);
    expect(await prisma.eventLog.count({ where: { weddingId: ana, type: "vendor_added_manually" } })).toBe(1);
  });

  it("never touches the demo wedding", async () => {
    const before = await prisma.vendor.count({ where: { weddingId: demoId } });
    await call(good());
    expect(await prisma.vendor.count({ where: { weddingId: demoId } })).toBe(before);
  });

  it("puts the vendor on the timeline like an uploaded one", async () => {
    await call(good());
    const input = await loadTimelineInput(prisma, ana);
    expect(input?.vendors.map((v) => v.name)).toEqual(["Blossom Florals"]);
    expect(input?.vendors[0].payments).toHaveLength(3);
  });

  it("assigns a sandbox payee when no email is given, and uses the one that is", async () => {
    const blank = await call(good(), { emails: "payee@business.example.com" });
    expect((await prisma.vendor.findUniqueOrThrow({ where: { id: blank.body.vendorId } })).paypalEmail).toBe("payee@business.example.com");
    const own = await call(good({ vendorName: "Other", paypalEmail: "vendor@example.com" }));
    expect((await prisma.vendor.findUniqueOrThrow({ where: { id: own.body.vendorId } })).paypalEmail).toBe("vendor@example.com");
  });

  it("answers 400 for bad input and saves nothing", async () => {
    const before = await prisma.vendor.count();
    expect((await call(good({ payments: [] }))).status).toBe(400);
    expect((await call("not json")).status).toBe(400);
    expect((await call({})).status).toBe(400);
    expect(await prisma.vendor.count()).toBe(before);
  });

  it("answers 409 for an account with no wedding yet", async () => {
    const r = await call(good(), { weddingId: null });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("no_wedding");
  });

  it("is rate limited per wedding", async () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    const deps = { prisma, limiter, resolveWeddingId: async () => ana };
    const make = () => manualVendorHandler(new Request("http://x", { method: "POST", body: JSON.stringify(good()) }), deps);
    expect((await make()).status).toBe(200);
    const second = await make();
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("loadVendorSummary", () => {
  let prisma: PrismaClient;
  let cleanup: () => Promise<void>;
  beforeAll(() => {
    ({ prisma, cleanup } = createTestDatabase());
  }, 60_000);
  afterAll(async () => cleanup());

  it("builds the printable summary, scoped to the caller's wedding", async () => {
    await seedDemo(prisma);
    const user = await prisma.user.create({ data: { email: "ana@example.com" } });
    const wedding = await prisma.wedding.create({ data: { userId: user.id, coupleNames: "Ana & Ben", date: new Date("2027-09-04"), budget: 0 } });
    const saved = await manualVendorHandler(new Request("http://x", { method: "POST", body: JSON.stringify(good()) }), {
      prisma,
      limiter: createRateLimiter({ max: 10, windowMs: 60_000 }),
      resolveWeddingId: async () => wedding.id,
    });
    const { vendorId } = await saved.json();

    const s = await loadVendorSummary(prisma, wedding.id, vendorId, new Date("2026-11-12T10:00:00Z"));
    expect(s).toMatchObject({ coupleNames: "Ana & Ben", weddingDateLabel: "September 4, 2027", preparedLabel: "November 12, 2026" });
    expect(s?.vendor).toMatchObject({ name: "Blossom Florals", category: "florist", totalLabel: "$1,750", notes: "Delivery to the venue by 10am.", entered: "by_hand" });
    // Sorted by due date: on signing, the set date, then 14 days before the wedding.
    expect(s?.payments.map((p) => [p.label, p.dueDateLabel, p.basis, p.amountLabel])).toEqual([
      ["Deposit", "October 1, 2026", "On signing", "$500"],
      ["Extras", "March 1, 2027", "On March 1, 2027", "$250"],
      ["Balance", "August 21, 2027", "14 days before the wedding", "$1,000"],
    ]);
    expect(s?.cancellationTiers).toEqual(["90+ days' notice: 50% of payments made refunded, less $100", "Any notice: no refund"]);
    expect(s?.dateChangeTiers).toEqual(["60+ days' notice: 10% of the contract price ($175)"]);

    // Someone else's vendor id is simply not found, like one that doesn't exist.
    const demo = await prisma.wedding.findFirstOrThrow({ where: { coupleNames: "Priya & Sam" } });
    expect(await loadVendorSummary(prisma, demo.id, vendorId)).toBeNull();
    expect(await loadVendorSummary(prisma, wedding.id, "no-such-vendor")).toBeNull();
  });
});
