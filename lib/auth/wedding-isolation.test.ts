import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadActivity } from "@/lib/activity";
import { executeTool } from "@/lib/agent/tools";
import { TODAY } from "@/lib/agent/tools/test-utils";
import { loadPendingProposals } from "@/lib/proposals/data";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase } from "@/lib/test-utils/db";
import { loadTimelineInput } from "@/lib/timeline-data";
import { applyDateChange, previewDateChange } from "@/lib/whatif/service";

/**
 * Two couples in one database: the seeded demo (Priya & Sam, 14 vendors) and a
 * second couple with a single vendor. Everything that used to look up "the first
 * wedding" now takes the signed-in couple's wedding id; these tests prove each of
 * them sees only its own wedding, in both directions.
 */
let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let demoId: string;
let mine: { weddingId: string; vendorId: string; paymentId: string };

beforeAll(async () => {
  ({ prisma, cleanup } = createTestDatabase());
  await seedDemo(prisma);
  demoId = (await prisma.wedding.findFirstOrThrow()).id;

  const user = await prisma.user.create({ data: { email: "ana@example.com" } });
  const wedding = await prisma.wedding.create({ data: { userId: user.id, coupleNames: "Ana & Ben", date: new Date("2027-09-04"), budget: 2_000_000 } });
  const vendor = await prisma.vendor.create({
    data: { weddingId: wedding.id, name: "Ana's Florist", category: "florist", paypalEmail: "f@example.com", contractPath: "", signingDate: new Date("2026-08-01"), totalCost: 100_000 },
  });
  const payment = await prisma.payment.create({
    data: { vendorId: vendor.id, label: "Florist deposit", amount: 50_000, anchor: "signing_date", status: "paid" },
  });
  await prisma.terms.create({
    data: { vendorId: vendor.id, cancellationRules: [{ minNoticeDays: 0, refundPercent: 0, flatFee: 0 }], dateChangeRules: [{ minNoticeDays: 0, feePercent: 10, flatFee: 0 }], clauseIds: [] },
  });
  await prisma.eventLog.create({ data: { weddingId: wedding.id, type: "contract_uploaded", message: "Uploaded Ana's Florist" } });
  await prisma.proposal.create({ data: { weddingId: wedding.id, kind: "message", payload: { text: "Hello from Ana" }, status: "pending" } });
  mine = { weddingId: wedding.id, vendorId: vendor.id, paymentId: payment.id };
}, 60_000);
afterAll(async () => cleanup());

const tool = async (name: string, args: unknown, weddingId: string) => executeTool(name, args, { prisma, today: TODAY, weddingId });

describe("the dashboard's data", () => {
  it("loads each couple's own vendors and nobody else's", async () => {
    const ana = await loadTimelineInput(prisma, mine.weddingId);
    expect(ana?.wedding.coupleNames).toBe("Ana & Ben");
    expect(ana?.vendors.map((v) => v.name)).toEqual(["Ana's Florist"]);

    const demo = await loadTimelineInput(prisma, demoId);
    expect(demo?.vendors).toHaveLength(14);
    expect(demo?.vendors.map((v) => v.name)).not.toContain("Ana's Florist");
  });

  it("loads a couple's own activity and proposals only", async () => {
    expect((await loadActivity(prisma, mine.weddingId)).map((a) => a.message)).toEqual(["Uploaded Ana's Florist"]);
    expect((await loadActivity(prisma, demoId)).map((a) => a.message)).not.toContain("Uploaded Ana's Florist");

    const proposals = await loadPendingProposals(prisma, mine.weddingId);
    expect(proposals).toHaveLength(1);
    expect(JSON.stringify(proposals)).toContain("Hello from Ana");
    expect(JSON.stringify(await loadPendingProposals(prisma, demoId))).not.toContain("Hello from Ana");
  });

  it("loads nothing for a wedding id that doesn't exist", async () => {
    expect(await loadTimelineInput(prisma, "no-such-wedding")).toBeNull();
    expect(await loadActivity(prisma, "no-such-wedding")).toEqual([]);
    expect(await loadPendingProposals(prisma, "no-such-wedding")).toEqual([]);
  });
});

describe("the agent's tools", () => {
  it("see only the caller's wedding, whoever asks", async () => {
    const own = await tool("get_vendors", {}, mine.weddingId);
    expect(own.ok && (own.output as { vendors: { name: string }[] }).vendors.map((v) => v.name)).toEqual(["Ana's Florist"]);

    const demo = await tool("get_vendors", {}, demoId);
    expect(demo.ok && (demo.output as { vendors: unknown[] }).vendors).toHaveLength(14);

    const wedding = await tool("get_wedding", {}, mine.weddingId);
    expect(wedding.ok && (wedding.output as { couple: string }).couple).toBe("Ana & Ben");
  });

  it("can't find another couple's vendor by name or id", async () => {
    const demoVendor = await prisma.vendor.findFirstOrThrow({ where: { weddingId: demoId, name: "Grand Oak Estate" } });
    for (const ref of ["Grand Oak Estate", demoVendor.id]) {
      const result = await tool("read_clause", { vendorId: ref, kind: "cancellation" }, mine.weddingId);
      expect(result.ok, ref).toBe(false);
    }
    expect((await tool("get_payment_schedule", { vendorId: demoVendor.id }, mine.weddingId)).ok).toBe(false);
    // And the other way round.
    expect((await tool("read_clause", { vendorId: "Ana's Florist", kind: "payment" }, demoId)).ok).toBe(false);
  });

  it("can't propose paying another couple's payment", async () => {
    const demoPayment = await prisma.payment.findFirstOrThrow({ where: { status: "scheduled", vendor: { weddingId: demoId } } });
    const result = await tool("propose_action", { kind: "pay", paymentId: demoPayment.id, reason: "x" }, mine.weddingId);
    expect(result.ok).toBe(false);
    expect(await prisma.proposal.count({ where: { weddingId: mine.weddingId, kind: "pay" } })).toBe(0);
  });

  it("price a date change from the caller's vendors only", async () => {
    const result = await tool("compute_date_change_cost", { newDate: "2027-10-02" }, mine.weddingId);
    expect(result.ok).toBe(true);
    const rows = (result.ok ? (result.output as { rows: { vendorName: string }[] }).rows : []).map((r) => r.vendorName);
    expect(rows).toEqual(["Ana's Florist"]);
  });
});

describe("the what-if flow", () => {
  it("previews only the caller's vendors", async () => {
    const preview = await previewDateChange(prisma, mine.weddingId, "2027-10-02", TODAY);
    expect(preview.ok).toBe(true);
    expect(preview.ok && preview.rows.map((r) => r.vendorName)).toEqual(["Ana's Florist"]);
    expect(preview.ok && preview.currentDate).toBe("2027-09-04");
  });

  it("changes only the caller's wedding date when a move is confirmed", async () => {
    const demoBefore = (await prisma.wedding.findUniqueOrThrow({ where: { id: demoId } })).date.toISOString();
    const applied = await applyDateChange(prisma, mine.weddingId, { newDate: "2027-10-02", previousDate: "2027-09-04" }, TODAY);
    expect(applied.ok).toBe(true);

    expect((await prisma.wedding.findUniqueOrThrow({ where: { id: mine.weddingId } })).date.toISOString()).toBe("2027-10-02T00:00:00.000Z");
    expect((await prisma.wedding.findUniqueOrThrow({ where: { id: demoId } })).date.toISOString()).toBe(demoBefore);
  });

  it("reports no wedding for an id that doesn't exist", async () => {
    const result = await previewDateChange(prisma, "no-such-wedding", "2027-10-02", TODAY);
    expect(result).toMatchObject({ ok: false, code: "no_wedding" });
  });
});
